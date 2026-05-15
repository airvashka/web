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

ÚKOL: Z PDF extrahuj data v MATRIX struktuře (sekce × řádky × buňky per trim) přesně tak, jak je v PDF.

═══════════════════════════════════════════════════════════════
TYPY CENÍKŮ — UMÍŠ OBA
═══════════════════════════════════════════════════════════════

**TYP A — MATRIX (KGM Torres, Korando, ...):** Ceník je tabulka. Sloupce = trimy (CLUB, STYLE, PREMIUM). Řádky = features. Buňky obsahují "S", "-", číslo, nebo kód paketu. Zachovej 1:1.

**TYP B — LIST (JAECOO 5, OMODA single-trim, ...):** Ceník je strukturovaný jako per-trim seznam výbavy. Nemá tabulkové sloupce. Typický pattern:
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

**PŘEVOD TYP B → MATRIX (POVINNÉ — nesmíš vrátit prázdné sections!):**
- trims = [SELECT, EXCLUSIVE] (každý jako jeden sloupec, list_price = ceníková ne akční)
- detected.format = "list"
- Sekce = bold/uppercase headings ze seznamu (ASISTENT, BEZPEČNOST, EXTERIÉR, INFOTAINMENT, INTERIÉR, KOMFORT)
- **Každá feature** ze SELECT seznamu má cells = ["S", "S"] (je v obou trimech — EXCLUSIVE má všechno ze SELECT + nové)
- **Každá feature** ze "EXCLUSIVE Navíc k předchozí výbavě" má cells = ["-", "S"] (jen v EXCLUSIVE)
- Pokud má EXCLUSIVE celý vlastní seznam (ne "Navíc"), porovnej oba — features v obou = ["S","S"], jen v EXCLUSIVE = ["-","S"], jen v SELECT = ["S","-"]
- Sekce neorganizuj — drž pořadí z PDF (každý trim přispěje features do svojí sekce, dedupuj features napříč trimy)

**NIKDY NEVRACEJ trims bez sections!** Pokud z PDF vytáhneš trimy a barvy, MUSÍŠ vytáhnout i features (sections+rows). Ceník bez výbavy je rozbitý.

═══════════════════════════════════════════════════════════════
KLÍČOVÁ PRAVIDLA
═══════════════════════════════════════════════════════════════

1) **TRIMS = SLOUPCE.** Vůz má jeden nebo více výbavových stupňů (CLUB, STYLE, PREMIUM, SELECT, EXCLUSIVE, nebo třeba jen PREMIUM). Pole "trims" má jeden záznam per sloupec. List_price je ceníková cena v Kč jako integer (např. 649900, 669000, ne "649 900 Kč").

2) **SEKCE = NÁZVY Z PDF, NE VLASTNÍ KATEGORIE.** Sekce z PDF (např. "MOTORIZACE/VÝBAVA", "ZAVĚŠENÍ KOL, ŘÍZENÍ, BRZDY", "BEZPEČNOST", "ASISTENT", "INFOTAINMENT", "INTERIÉR", "KOMFORT", "EXTERIÉR") přepiš LITERAL.

3) **CELL VOCABULARY — PRESERVUJ DOSLOVNĚ:**
   - "S" = standardní v daném trimu (zdarma)
   - "-" nebo "" = nedostupné v daném trimu
   - Číslo jako STRING (např. "14900", "49900") = lze dokoupit za cenu v Kč. **BEZ MEZER, BEZ Kč, jen číslice.**
   - Název paketu (např. "CLUB+", "BLACK", "SAFETY", "TECH") = součást daného paketu
   - "S (Hybrid)" / "S (4x4)" = podmínečně standard
   - "volitelné" = lze vybrat (typicky textil/kůže)

4) **CELLS POLE má PŘESNĚ stejnou délku jako trims pole.** trims=[SELECT, EXCLUSIVE] → každý row.cells má 2 hodnoty.

5) **NEKATEGORIZUJ DO PŘEDDEFINOVANÝCH BUCKETŮ.** Drž originální sekce z PDF.

6) **PAKETY jsou separate entita v "packages" poli:**
   - Každý paket má name (např. "CLUB+ paket"), code (např. "CLUB+"), contents (list co obsahuje), cells (cena/dostupnost per trim)
   - Pokud položka v sections.rows má v cells hodnotu "CLUB+", znamená to: tato položka je obsažena v paketu CLUB+ pro daný trim
   - V "contents" paketu uveď VŠECHNY features co paket přidává
   - Pokud ceník nemá pakety (jako JAECOO 5), packages = []

7) **BARVY = samostatné sekce** ("colors_exterior", "colors_interior"):
   - Každá barva má name, code (např. "WAA", "ADE"), type ("základní"/"metalická"/"dvoutónová"), cells (cena per trim)
   - LIST-style ceník: pokud barva má jednu cenu pro všechny trimy, vyplň všechny cells stejně (např. ["14000", "14000"])

8) **TECH DATA** = key-value object. Pokud má hodnota dva sloupce per trim ale jsou stejné, vrať jednou jako string. Pokud se liší per trim, použij formát "SELECT: X / EXCLUSIVE: Y".

9) **PRESERVUJ LITERAL FORMULACE.** Neparafrázuj. Včetně závorek, čárek, podmínek.

10) **KÓD VÝBAVY** — pokud má řádek v PDF kód (např. "PT6/E11", "PCA/TS7", "ISN"), dej ho do "code" pole. Jinak prázdný string.

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

const DIRECTUS_URL = import.meta.env.PUBLIC_DIRECTUS_URL || 'https://directus-production-3e67.up.railway.app';

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

    // Tool use — MATRIX schema preserves PDF structure (sekce + cells per trim)
    const tools: any[] = [{
      name: 'extract_pricelist',
      description: 'Uloží extrahovaná data z ceníku v MATRIX struktuře (sekce × řádky × buňky per trim).',
      input_schema: {
        type: 'object',
        properties: {
          detected: {
            type: 'object',
            properties: {
              model_name: { type: 'string', description: 'Detekovaný název modelu (např. "Torres", "OMODA 9 SHS")' },
              year: { type: 'number', description: 'Detekovaný modelový rok' },
              format: { type: 'string', enum: ['matrix', 'list'], description: '"matrix" pokud má více trimů ve sloupcích, "list" pokud jen jeden trim' },
            },
          },
          trims: {
            type: 'array',
            description: 'Trim levels jako sloupce v ceníku. Pokud má model jediný trim, 1 entry.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Název trimu (např. "CLUB", "STYLE", "PREMIUM"). Preserveruj original case z PDF.' },
                list_price: { type: 'number', description: 'Ceníková cena v Kč jako integer (např. 649900). Pokud ICE/HEV verze, vyber ICE — Hybrid bude v dedikovaném row v sections.' },
              },
              required: ['name'],
            },
          },
          sections: {
            type: 'array',
            description: 'Sekce z PDF s LITERAL názvy (MOTORIZACE/VÝBAVA, ZAVĚŠENÍ KOL, BEZPEČNOST, atd.). NEKATEGORIZUJ do vlastních škatulek.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Název sekce z PDF doslova (např. "MOTORIZACE/VÝBAVA")' },
                rows: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      feature: { type: 'string', description: 'Název položky LITERAL z PDF (i s podmínkami v závorkách)' },
                      code: { type: 'string', description: 'Kód výbavy z PDF (např. "PT6/E11", "PCA/TS7"). Pokud chybí, prázdný string.' },
                      cells: {
                        type: 'array',
                        description: 'Hodnoty buněk per trim. Délka = trims.length. LITERAL: "S" / "-" / "14900" (číslo bez mezer) / "CLUB+" (název paketu) / "S (Hybrid)" / "volitelné". Žádné Kč ani jiné jednotky.',
                        items: { type: 'string' },
                      },
                    },
                    required: ['feature', 'cells'],
                  },
                },
              },
              required: ['name', 'rows'],
            },
          },
          packages: {
            type: 'array',
            description: 'Pakety jako separátní entity. Mají jak vlastní řádek v ceníku (cells = cena/dostupnost per trim), tak obsah (contents).',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Název paketu (např. "CLUB+ paket")' },
                code: { type: 'string', description: 'Kód paketu (např. "CLUB+", "CVG, CGK", "BLACK")' },
                contents: { type: 'array', description: 'Co paket obsahuje (list features)', items: { type: 'string' } },
                cells: { type: 'array', description: 'Cena/dostupnost per trim. Stejná délka jako trims. Hodnoty: "14900", "S", "-".', items: { type: 'string' } },
              },
              required: ['name', 'cells'],
            },
          },
          colors_exterior: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                code: { type: 'string', description: 'Kód barvy (např. "WAA", "ADE", "2DE (E22B)")' },
                type: { type: 'string', description: 'Typ — "základní" / "metalická" / "dvoutónová" / atd.' },
                cells: { type: 'array', items: { type: 'string' } },
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
                cells: { type: 'array', items: { type: 'string' } },
              },
            },
          },
          technical_data: {
            type: 'object',
            description: 'Key-value technické údaje. Klíče preservuj literal z PDF.',
            additionalProperties: { type: 'string' },
          },
        },
        required: ['trims', 'sections'],
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
    // Pokud standard JSON.parse selže (např. unescaped quotes), použij jsonrepair
    debugInfo.parse_errors = [];
    const ensureParsed = (v: any, fieldName?: string) => {
      if (typeof v === 'string') {
        try { return JSON.parse(v); } catch (e1) {
          debugInfo.parse_errors.push(`${fieldName} JSON.parse: ${(e1 as Error).message.substring(0, 200)}`);
          try {
            const fixed = jsonrepair(v);
            const parsed = JSON.parse(fixed);
            debugInfo.parse_errors.push(`${fieldName} → jsonrepair succeeded`);
            return parsed;
          } catch (e2) {
            debugInfo.parse_errors.push(`${fieldName} jsonrepair fail: ${(e2 as Error).message.substring(0, 200)}`);
            return v;
          }
        }
      }
      return v;
    };
    if (extracted && typeof extracted === 'object') {
      for (const key of ['trims', 'sections', 'packages', 'colors_exterior', 'colors_interior', 'technical_data', 'detected']) {
        if (key in extracted) extracted[key] = ensureParsed(extracted[key], key);
      }
    }

    // Po-parsing log
    debugInfo.after_parse_sections_count = Array.isArray(extracted?.sections) ? extracted.sections.length : 'N/A';
    debugInfo.after_parse_trims_count = Array.isArray(extracted?.trims) ? extracted.trims.length : 'N/A';

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
