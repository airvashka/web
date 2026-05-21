/**
 * Cenik analyze endpoint.
 *
 * POST multipart/form-data:
 *   - pdf: File (max ~30MB)
 *   - context: stringified JSON s { brand, model, year } pro lepší AI hinting
 *
 * Response:
 *   { detected: {...}, trim_levels: [...], option_packages: [...], technical_data: {...} }
 *
 * Pošle PDF přímo do Claude API (nativní document support, žádný pdf-parse).
 */
import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';
import { jsonrepair } from 'jsonrepair';

export const prerender = false;

const SYSTEM_PROMPT = `Jsi expert na extrakci dat z českých ceníků automobilů (značky KGM, OMODA & JAECOO, Farizon).

ÚKOL: Z PDF extrahuj data v **PER-TRIM** struktuře — z pohledu zákazníka.
Pro každý trim (CLUB, STYLE, PREMIUM, SELECT, EXCLUSIVE, …) odpověz na 3 otázky:
  1. **Co dostanu, když si koupím tento trim?** → \`features\` (grouped by section)
  2. **Co si k tomu můžu dokoupit?** → \`optional_items\` (name + code + cena)
  3. **Jaké pakety jsou pro tento trim dostupné?** → \`packages_available\` (kód paketu)

═══════════════════════════════════════════════════════════════
TYPY CENÍKŮ — UMÍŠ OBA
═══════════════════════════════════════════════════════════════

**TYP A — MATRIX (KGM Torres, Korando, Actyon, …):** Tabulka. Sloupce = trimy (CLUB, STYLE, PREMIUM nebo i 4 sloupce). Řádky = features. Buňky obsahují "S", "-", číslo (cena dokoupení), nebo kód paketu (CLUB+, BLACK, SAFETY).

PŘEVOD MATRIX → PER-TRIM (povinné):
- Pro každý trim (sloupec) projdi všechny řádky:
  - Pokud cell = "S" → feature je včleněn → patří do \`trims[i].features\` pod sekcí ze sloupce 1 řádku
  - Pokud cell = číslo (např. "49900") → feature je dokoupitelný → \`trims[i].optional_items.push({ name, code, price: 49900 })\`
  - Pokud cell = kód paketu (např. "CLUB+") → feature je pro tento trim dostupná JEN v paketu. Udělej TŘI věci:
      a) \`trims[i].package_items.push({ name, package_code: "CLUB+", package_name: "CLUB+ paket" })\` ← KLÍČOVÉ: zachovává vazbu KTERÝ prvek je v KTERÉM paketu pro TENTO trim. Bez toho matice neumí vykreslit paket do buňky.
      b) \`trims[i].packages_available.push("CLUB+")\` (unique)
      c) feature uveď i v \`packages[].contents\`
    POZN.: package_items NENÍ duplikát features ani optional_items — je to třetí, oddělený stav buňky (✓ / cena / PAKET / —).
  - Pokud cell = "-" → ignoruj pro tento trim
  - Pokud cell = "S (Hybrid)" → \`features\` s notou v názvu "Adaptivní tempomat (pouze pro Hybrid verze)"
- Příklad: Torres má řádek "Panoramatická střecha" s cells = ["-", "29900", "S"]:
  - STYLE.optional_items += { name: "Panoramatická střecha", price: 29900 }
  - PREMIUM.features += pod sekci "EXTERIÉR" (nebo kde to je v PDF) → "Panoramatická střecha"
  - CLUB → nic (cell = "-")

**TYP B — LIST (JAECOO 5, OMODA single-trim, …):** Ceník je strukturovaný jako per-trim seznam výbavy. Nemá tabulkové sloupce. Typický pattern:
\`\`\`
SELECT                                  629 000 Kč
Základní výbava
  ASISTENT
  - Adaptivní tempomat
  - Asistent rozjezdu do kopce
  ...
  BEZPEČNOST
  - Autoalarm
  ...

EXCLUSIVE                               709 000 Kč
Navíc k předchozí výbavě
  ASISTENT
  - Kamerový systém 540°
  EXTERIÉR
  - Panoramatická střecha
  ...
\`\`\`

PŘEVOD TYP B → PER-TRIM:
- trims = [{ name: "SELECT", … }, { name: "EXCLUSIVE", … }]
- detected.format = "list"
- Pro SELECT: features = vše ze "Základní výbava" seznamu, grouped by uppercase heading (ASISTENT, BEZPEČNOST, …)
- Pro EXCLUSIVE: features = **VŠECHNO ze SELECT + features z "Navíc k předchozí výbavě"** (kumulativní! "Navíc" znamená přidat k tomu co už SELECT má)
- Pokud má EXCLUSIVE svůj kompletní seznam (ne "Navíc"), použij ten — porovnání s SELECT není potřeba.
- optional_items, packages_available často prázdné pro list-style.

═══════════════════════════════════════════════════════════════
KONKRÉTNÍ PŘÍKLAD — JAECOO 5 (LIST STYLE)
═══════════════════════════════════════════════════════════════

PDF obsahuje:
\`\`\`
SELECT  629 000 Kč  (ceníková 669 000 Kč)
Základní výbava
  ASISTENT:
    - Adaptivní tempomat (ACC+LKA)
    - Asistent jízdy v koloně (TJA)
  BEZPEČNOST:
    - Autoalarm
    - Boční airbagy předních sedadel

EXCLUSIVE  709 000 Kč  (ceníková 749 000 Kč)
Navíc k předchozí výbavě
  ASISTENT:
    - Kamerový systém 540°
  EXTERIÉR:
    - Panoramatická střecha
\`\`\`

SPRÁVNÝ output:
\`\`\`json
{
  "detected": { "model_name": "JAECOO 5", "year": 2026, "format": "list" },
  "trims": [
    {
      "name": "SELECT",
      "list_price": 669000,
      "features": [
        { "section": "ASISTENT",   "items": ["Adaptivní tempomat (ACC+LKA)", "Asistent jízdy v koloně (TJA)"] },
        { "section": "BEZPEČNOST", "items": ["Autoalarm", "Boční airbagy předních sedadel"] }
      ],
      "optional_items": [],
      "packages_available": []
    },
    {
      "name": "EXCLUSIVE",
      "list_price": 749000,
      "features": [
        { "section": "ASISTENT",   "items": ["Adaptivní tempomat (ACC+LKA)", "Asistent jízdy v koloně (TJA)", "Kamerový systém 540°"] },
        { "section": "BEZPEČNOST", "items": ["Autoalarm", "Boční airbagy předních sedadel"] },
        { "section": "EXTERIÉR",   "items": ["Panoramatická střecha"] }
      ],
      "optional_items": [],
      "packages_available": []
    }
  ],
  "packages": [],
  "colors_exterior": [ … ],
  "colors_interior": [ … ],
  "technical_data": { … }
}
\`\`\`

VŠIMNI SI:
- EXCLUSIVE.features OBSAHUJE VŠE ze SELECT + "Navíc". To je to co zákazník dostane když si koupí EXCLUSIVE.
- list_price = **CENÍKOVÁ** (669/749 tisíc), ne **AKČNÍ** (629/709). Akční ignoruj.
- **MUSÍŠ projít VŠECHNY features v PDF**, ne jen prvních pár. JAECOO 5 má typicky 40+ položek per trim.

═══════════════════════════════════════════════════════════════
PŘÍKLAD — KGM Torres (MATRIX STYLE, 3 trimy)
═══════════════════════════════════════════════════════════════

PDF řádek "Panoramatická střecha (kód: ISN)" má cells: ["-", "29900", "S"] pro trimy [CLUB, STYLE, PREMIUM].
PDF řádek "Vyhřívaný volant" má cells: ["-", "CLUB+", "S"].

Výsledek pro tento KUS dat:
- CLUB:    obě features ignored (cell "-")
- STYLE:   optional_items += { name: "Panoramatická střecha", code: "ISN", price: 29900 } (cell "29900"); package_items += { name: "Vyhřívaný volant", package_code: "CLUB+", package_name: "CLUB+ paket" } (cell "CLUB+"); packages_available += "CLUB+"
- PREMIUM: features.EXTERIÉR += "Panoramatická střecha"; features.KOMFORT += "Vyhřívaný volant" (obě "S")

Plus packages[] dostane:
\`\`\`
{ "name": "CLUB+ paket", "code": "CLUB+", "contents": ["Vyhřívaný volant", ...], "pricing_per_trim": { "club": 14900, "style": 14900, "premium": "standard" } }
\`\`\`

═══════════════════════════════════════════════════════════════
KLÍČOVÁ PRAVIDLA
═══════════════════════════════════════════════════════════════

1) **TRIMS — 1 záznam per výbavový stupeň.** Můžeš mít 1, 2, 3 nebo 4 trimy. List_price = CENÍKOVÁ cena v Kč jako integer (např. 669000), ne akční.

2) **SEKCE V FEATURES = LITERAL Z PDF.** Sekce z PDF (např. "MOTORIZACE", "ZAVĚŠENÍ KOL", "BEZPEČNOST", "ASISTENT", "INFOTAINMENT", "INTERIÉR", "KOMFORT", "EXTERIÉR") drž doslova. Nekategorizuj do vlastních škatulek typu "podvozek/komfort".

3) **OPTIONAL_ITEMS = dokoupitelné věci k trimu** (cell = číslo v matrix-style, nebo explicit "navíc za X Kč" v list-style):
   - name = LITERAL z PDF
   - code = kód výbavy (např. "ISN", "PT6/E11") nebo prázdný string
   - price = integer Kč (např. 29900)

4) **PACKAGES_AVAILABLE = list kódů paketů** dostupných pro tento trim (např. ["CLUB+", "BLACK"]). Pokud trim nemá pakety, prázdné [].

4b) **PACKAGE_ITEMS = prvky dostupné pro tento trim JEN v paketu** (cell = kód paketu v matrix-style). Každý: { name (LITERAL z PDF), package_code (např. "CLUB+"), package_name (např. "CLUB+ paket") }. Toto je oddělené od features (✓ v ceně) i optional_items (samostatná cena) — je to čtvrtý stav buňky. Pokud trim nemá nic v paketech, prázdné [].

5) **PACKAGES (samostatné pole)**:
   - name (např. "CLUB+ paket"), code (např. "CLUB+"), contents (list features co paket přidává), pricing_per_trim (object: trim_slug → price | "standard" | "unavailable")
   - Pokud ceník nemá pakety, packages = []

6) **BARVY** (colors_exterior, colors_interior):
   - name, code (např. "WAA"), type ("základní"/"metalická"/"dvoutónová")
   - pricing_per_trim: object trim_slug → cena v Kč (např. { "select": 14000, "exclusive": 14000 })

7) **TECH DATA** = key-value object. Pokud trimy mají různé hodnoty, použij " / " jako separátor ("SELECT: 7DCT / EXCLUSIVE: 7DCT").

8) **PRESERVUJ LITERAL FORMULACE.** Neparafrázuj. Včetně závorek, čárek, podmínek.

9) **JSON ESCAPING — KRITICKÉ:**
   - Pokud má feature uvozovky (např. \`18" kola\`), **ZAPIŠ** \`18'' kola\` (dva apostrofy) nebo \`18 palců kola\`. NEPOUŽÍVEJ ASCII \`"\` uvnitř hodnot.
   - Smart quotes (\`„"\`, \`''\`) nepoužívej — ASCII single quote \`'\` nebo vynech.
   - Drž features SHORT a CHECK že JSON je validní. NIKDY nezapisuj features pole jako stringifikovaný JSON — vrať to jako nativní array.

10) **NIKDY NEVRACEJ trims s prázdnými features.** Pokud z PDF vytáhneš trimy, MUSÍŠ vyplnit features pro každý. Trim bez features = rozbitý.

Vrať data přes tool extract_pricelist. ŽÁDNÝ text mimo tool call.`;

const RESPONSE_SCHEMA = `{
  "detected": {
    "has_trim_levels": boolean,
    "has_option_packages": boolean,
    "has_technical_data": boolean,
    "model_name_guess": "string | null",
    "year_guess": "number | null"
  },
  "trim_levels": [
    {
      "name": "Style+",
      "list_price": 549900,
      "features": {
        "pohon": ["Pohon předních kol (FWD)", "Manuální převodovka 6-stup"],
        "podvozek": ["..."],
        "bezpecnost": ["..."],
        "asistent": ["..."],
        "komfort": ["..."],
        "multimedia": ["..."],
        "exterier": ["..."],
        "ostatni": ["..."]
      }
    }
  ],
  "option_packages": [
    {
      "name": "TECH paket",
      "features": ["18\\" alu", "LED matrix"],
      "pricing_per_trim": {
        "style": 19900,
        "style+": "standard",
        "premium": "unavailable"
      }
    }
  ],
  "technical_data": {
    "Typ motoru": "1.5 GDi-Turbo benzín",
    "Max. výkon": "120 kW / 163 k",
    "Zdvihový objem": "1497 cm³"
  }
}`;

const DIRECTUS_URL = import.meta.env.PUBLIC_DIRECTUS_URL ?? import.meta.env.DIRECTUS_URL ?? '';

/** Ověř Directus token — vrátí true pokud user platí. Brání Anthropic spam. */
async function verifyDirectusToken(token: string): Promise<boolean> {
  if (!token) return false;
  try {
    const r = await fetch(`${DIRECTUS_URL}/users/me`, { headers: { Authorization: `Bearer ${token}` } });
    return r.ok;
  } catch {
    return false;
  }
}

export const POST: APIRoute = async ({ request }) => {
  try {
    if (!import.meta.env.ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY není v env nastaven' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    // Ověř Directus token — brání anonymnímu API zneužití (Anthropic náklady)
    const authHeader = request.headers.get('authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!(await verifyDirectusToken(token))) {
      return new Response(JSON.stringify({ error: 'Neautorizováno — chybí nebo neplatný Directus token' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    // PDF zdroj: file_id v Directus (bypasses Vercel 4.5MB body limit) NEBO inline FormData/base64
    let base64: string;
    let context: { brand?: string; model?: string; year?: number } = {};
    let uploadedFileId: string | undefined; // pro auto-cleanup po Claude response
    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const body = await request.json().catch(() => null);
      if (!body || typeof body !== 'object') {
        return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      context = (body as any).context ?? {};

      const file_id: string | undefined = (body as any).file_id;
      const pdf_base64: string | undefined = (body as any).pdf_base64;

      if (file_id) {
        // Fetch z Directus (žádný Vercel body limit problém)
        uploadedFileId = file_id; // si pamatuju pro cleanup po analyze
        const assetUrl = `${DIRECTUS_URL}/assets/${file_id}`;
        const assetResp = await fetch(assetUrl, { headers: { Authorization: `Bearer ${token}` } });
        if (!assetResp.ok) {
          return new Response(JSON.stringify({ error: `Directus file fetch ${assetResp.status}: ${await assetResp.text()}` }), { status: 502, headers: { 'Content-Type': 'application/json' } });
        }
        const ab = await assetResp.arrayBuffer();
        if (ab.byteLength > 50 * 1024 * 1024) {
          return new Response(JSON.stringify({ error: 'PDF příliš velké (>50MB)' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        base64 = Buffer.from(ab).toString('base64');
      } else if (pdf_base64) {
        base64 = pdf_base64;
      } else {
        return new Response(JSON.stringify({ error: 'Chybí file_id nebo pdf_base64 v JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
    } else if (contentType.includes('multipart/form-data')) {
      // Legacy FormData support (pro malé PDFs)
      const formData = await request.formData();
      const pdf = formData.get('pdf');
      const contextRaw = formData.get('context');
      if (!(pdf instanceof File)) {
        return new Response(JSON.stringify({ error: 'Chybí pdf v form-data' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      if (typeof contextRaw === 'string') { try { context = JSON.parse(contextRaw); } catch {} }
      const ab = await pdf.arrayBuffer();
      base64 = Buffer.from(ab).toString('base64');
    } else {
      return new Response(JSON.stringify({ error: 'Unsupported content-type — use application/json with file_id, nebo multipart/form-data' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const userPrompt = `Extrahuj data z přiloženého ceníku.

${context.brand ? `Brand: ${context.brand}` : ''}
${context.model ? `Model: ${context.model}` : ''}
${context.year ? `Modelový rok: ${context.year}` : ''}

Použij tool extract_pricelist a předej strukturovaná data. Vyplň co najdeš, neexistující sekce nech prázdné.`;

    const anthropic = new Anthropic({ apiKey: import.meta.env.ANTHROPIC_API_KEY });

    // Tool use — PER-TRIM schema (customer view: co dostanu když koupím trim X)
    const tools: any[] = [{
      name: 'extract_pricelist',
      description: 'Uloží extrahovaná data z ceníku v PER-TRIM struktuře (pro každý trim: features grouped by section + optional_items + dostupné pakety).',
      input_schema: {
        type: 'object',
        properties: {
          detected: {
            type: 'object',
            properties: {
              model_name: { type: 'string', description: 'Detekovaný název modelu (např. "Torres", "JAECOO 5")' },
              year: { type: 'number', description: 'Detekovaný modelový rok' },
              format: { type: 'string', enum: ['matrix', 'list'], description: '"matrix" pokud tabulkový ceník se sloupci, "list" pokud per-trim seznam.' },
            },
          },
          trims: {
            type: 'array',
            description: 'Pro každý trim: co dostanu, co můžu dokoupit, jaké pakety jsou dostupné. Min 1 trim. Pokud má model 3 výbavy (CLUB/STYLE/PREMIUM), 3 entries.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Název trimu LITERAL z PDF (např. "CLUB", "STYLE", "PREMIUM", "SELECT", "EXCLUSIVE").' },
                list_price: { type: 'number', description: 'CENÍKOVÁ cena v Kč jako integer (např. 669000), NE akční.' },
                features: {
                  type: 'array',
                  description: 'CO ZÁKAZNÍK DOSTANE když si koupí tento trim, grouped by section z PDF. Pro každou sekci pole items. U list-style EXCLUSIVE = SELECT features + nové (kumulativně).',
                  items: {
                    type: 'object',
                    properties: {
                      section: { type: 'string', description: 'Název sekce LITERAL z PDF (např. "ASISTENT", "BEZPEČNOST", "EXTERIÉR", "MOTORIZACE")' },
                      items: { type: 'array', description: 'Features v této sekci pro tento trim. LITERAL z PDF.', items: { type: 'string' } },
                    },
                    required: ['section', 'items'],
                  },
                },
                optional_items: {
                  type: 'array',
                  description: 'Co si zákazník MŮŽE DOKOUPIT k tomuto trimu. V matrix-style ceníku = řádky kde má daný trim cenu místo "S".',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string', description: 'Název položky LITERAL z PDF (např. "Panoramatická střecha")' },
                      code: { type: 'string', description: 'Kód výbavy (např. "ISN", "PT6/E11") nebo prázdný string' },
                      price: { type: 'number', description: 'Cena dokoupení v Kč jako integer (např. 29900)' },
                    },
                    required: ['name', 'price'],
                  },
                },
                packages_available: {
                  type: 'array',
                  description: 'Kódy paketů dostupných pro tento trim (např. ["CLUB+", "BLACK"]). Cena paketu je v packages[].pricing_per_trim. Pokud trim nemá pakety, [].',
                  items: { type: 'string' },
                },
                package_items: {
                  type: 'array',
                  description: 'Prvky výbavy dostupné pro tento trim JEN jako součást paketu (v matrix-style ceníku = buňka obsahuje kód paketu místo "S" nebo ceny). Oddělené od features i optional_items.',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string', description: 'Název prvku LITERAL z PDF (např. "Vyhřívaný volant")' },
                      package_code: { type: 'string', description: 'Kód paketu, ve kterém je prvek dostupný (např. "CLUB+", "BLACK")' },
                      package_name: { type: 'string', description: 'Název paketu (např. "CLUB+ paket"). Pokud znáš jen kód, zopakuj kód.' },
                    },
                    required: ['name', 'package_code'],
                  },
                },
              },
              required: ['name', 'features'],
            },
          },
          packages: {
            type: 'array',
            description: 'Volitelné paketové sady (samostatně). Pokud ceník nemá pakety, [].',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Název paketu (např. "CLUB+ paket")' },
                code: { type: 'string', description: 'Kód paketu (např. "CLUB+", "BLACK", "SAFETY")' },
                contents: { type: 'array', description: 'Co paket obsahuje (list features LITERAL z PDF)', items: { type: 'string' } },
                pricing_per_trim: {
                  type: 'object',
                  description: 'Cena paketu per trim. Klíče = lowercase trim names (slugified). Hodnoty = integer (cena Kč) | "standard" | "unavailable".',
                  additionalProperties: true,
                },
              },
              required: ['name', 'contents'],
            },
          },
          colors_exterior: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                code: { type: 'string', description: 'Kód barvy (např. "WAA", "ADE", "2DE (E22B)")' },
                type: { type: 'string', description: '"základní" / "metalická" / "dvoutónová" / atd.' },
                pricing_per_trim: { type: 'object', description: 'Cena barvy per trim. Klíče = trim slug. Hodnoty = integer Kč.', additionalProperties: { type: 'number' } },
              },
            },
          },
          colors_interior: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                code: { type: 'string' },
                material: { type: 'string', description: '"textil" / "syntetická kůže" / "pravá kůže" / atd.' },
                pricing_per_trim: { type: 'object', description: 'Cena per trim.', additionalProperties: { type: 'number' } },
              },
            },
          },
          technical_data: {
            type: 'object',
            description: 'Key-value technické údaje. Klíče literal z PDF. Hodnota string.',
            additionalProperties: { type: 'string' },
          },
        },
        required: ['trims'],
      },
    }];

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 64000,
      system: SYSTEM_PROMPT,
      tools,
      tool_choice: { type: 'tool', name: 'extract_pricelist' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
            { type: 'text', text: userPrompt },
          ],
        },
      ],
    }, {
      headers: { 'anthropic-beta': 'output-128k-2025-02-19' },
    });

    // Extract tool_use block — guaranteed valid object
    const toolUse = message.content.find((b) => b.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
      return new Response(JSON.stringify({
        error: 'AI nevrátila tool_use response',
        raw: message,
        stop_reason: message.stop_reason,
      }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }
    let extracted = toolUse.input as any;

    // DEBUG info — vidíme reálnou strukturu
    const debugInfo: any = {
      extracted_type: typeof extracted,
      trims_type: typeof extracted?.trims,
      trims_is_array: Array.isArray(extracted?.trims),
      trims_count: Array.isArray(extracted?.trims) ? extracted.trims.length : 'N/A',
      sections_type: typeof extracted?.sections,
      sections_is_array: Array.isArray(extracted?.sections),
      sections_count: Array.isArray(extracted?.sections) ? extracted.sections.length : 'N/A',
      packages_count: Array.isArray(extracted?.packages) ? extracted.packages.length : 'N/A',
    };

    // Defenzivní: pokud Claude vrátí celý input jako string, parsuj
    if (typeof extracted === 'string') {
      try { extracted = JSON.parse(extracted); } catch {}
    }

    // Defenzivní: pokud Claude vrátí field jako JSON string místo objektu, parsuj
    // Multi-pass repair: 1) JSON.parse → 2) jsonrepair → 3) custom regex escape pro běžné LLM chyby (palce 18", apostrofy)
    debugInfo.parse_errors = [];
    debugInfo.raw_strings = {};

    const escapeUnescapedQuotes = (s: string): string => {
      // Nejčastější vzorec: "18" kola" (palce uvnitř stringu).
      // Hledáme `<digit>"` následované znakem typu mezera/písmeno/čárka — taková `"` nemůže být legitimní string-closer.
      let fixed = s.replace(/(\d)"(?=\s|,|\)|]|[A-Za-zÁ-ž])/g, '$1\\"');
      // "Follow me home" v ASCII uvnitř JSON stringu (znaků kolem `"Follow`)
      // Heuristika: `"word "` (otevírající ASCII " uvnitř hodnoty) — neprovádím, riskantní.
      // Smart quotes na ASCII apostrof
      fixed = fixed.replace(/[„"]/g, '\\"').replace(/[']/g, "'");
      return fixed;
    };

    const ensureParsed = (v: any, fieldName?: string) => {
      if (typeof v === 'string') {
        // Pass 1: clean JSON.parse
        try { return JSON.parse(v); } catch (e1) {
          debugInfo.parse_errors.push(`${fieldName} JSON.parse: ${(e1 as Error).message.substring(0, 200)}`);
        }
        // Pass 2: jsonrepair
        try {
          const fixed = jsonrepair(v);
          const parsed = JSON.parse(fixed);
          debugInfo.parse_errors.push(`${fieldName} → jsonrepair succeeded`);
          return parsed;
        } catch (e2) {
          debugInfo.parse_errors.push(`${fieldName} jsonrepair fail: ${(e2 as Error).message.substring(0, 200)}`);
        }
        // Pass 3: custom regex escape pro běžné LLM chyby
        try {
          const escaped = escapeUnescapedQuotes(v);
          const fixed = jsonrepair(escaped);
          const parsed = JSON.parse(fixed);
          debugInfo.parse_errors.push(`${fieldName} → custom escape + jsonrepair succeeded`);
          return parsed;
        } catch (e3) {
          debugInfo.parse_errors.push(`${fieldName} custom-escape fail: ${(e3 as Error).message.substring(0, 200)}`);
        }
        // Pass 4: vrať raw string + uložím ho do debugu pro diagnostiku
        debugInfo.raw_strings[fieldName ?? '?'] = v.substring(0, 500) + (v.length > 500 ? `\n... [+${v.length - 500} chars]` : '');
        return v;
      }
      return v;
    };
    if (extracted && typeof extracted === 'object') {
      for (const key of ['trims', 'packages', 'colors_exterior', 'colors_interior', 'technical_data', 'detected']) {
        if (key in extracted) extracted[key] = ensureParsed(extracted[key], key);
      }
      // Nested: trims[i].features, optional_items, packages_available
      if (Array.isArray(extracted.trims)) {
        extracted.trims = extracted.trims.map((t: any, i: number) => {
          if (t && typeof t === 'object') {
            for (const innerKey of ['features', 'optional_items', 'packages_available', 'package_items']) {
              if (innerKey in t) t[innerKey] = ensureParsed(t[innerKey], `trims[${i}].${innerKey}`);
            }
          }
          return t;
        });
      }
    }

    // Final safety net — pokud pole stále zůstanou jako strings, set na []
    for (const arrayField of ['trims', 'packages', 'colors_exterior', 'colors_interior']) {
      if (extracted && typeof extracted[arrayField] === 'string') {
        debugInfo.parse_errors.push(`${arrayField} stále string po všech repair pokusech, coerce na []`);
        extracted[arrayField] = [];
      }
    }
    if (extracted && typeof extracted.technical_data === 'string') {
      extracted.technical_data = {};
    }
    // Nested safety net pro trims[i].features apod.
    if (Array.isArray(extracted?.trims)) {
      for (const t of extracted.trims) {
        if (typeof t.features === 'string') t.features = [];
        if (typeof t.optional_items === 'string') t.optional_items = [];
        if (typeof t.packages_available === 'string') t.packages_available = [];
        if (typeof t.package_items === 'string') t.package_items = [];
      }
    }

    // Po-parsing log
    debugInfo.after_parse_trims_count = Array.isArray(extracted?.trims) ? extracted.trims.length : 'N/A';
    if (Array.isArray(extracted?.trims)) {
      debugInfo.trims_features_summary = extracted.trims.map((t: any) => ({
        name: t.name,
        features_sections: Array.isArray(t.features) ? t.features.length : 'NOT_ARRAY',
        optional_count: Array.isArray(t.optional_items) ? t.optional_items.length : 'NOT_ARRAY',
      }));
    }

    // Auto-cleanup uploaded PDF — analyze proběhlo, soubor v Directus už nepotřebujeme
    if (uploadedFileId) {
      try {
        const delResp = await fetch(`${DIRECTUS_URL}/files/${uploadedFileId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        debugInfo.cleanup = delResp.ok ? 'deleted' : `failed ${delResp.status}`;
      } catch (e) {
        debugInfo.cleanup = `error: ${(e as Error).message}`;
      }
    }

    return new Response(JSON.stringify({
      ...extracted,
      meta: {
        usage: message.usage,
        model: message.model,
        stop_reason: message.stop_reason,
      },
      __debug: debugInfo,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (e) {
    console.error('Cenik analyze error:', e);
    return new Response(JSON.stringify({ error: (e as Error).message, stack: (e as Error).stack }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
