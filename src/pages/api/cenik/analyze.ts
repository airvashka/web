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

export const prerender = false;

const SYSTEM_PROMPT = `Jsi expert na extrakci strukturovaných dat z českých ceníků automobilů (značky KGM, OMODA & JAECOO, Farizon).

ÚKOL: Z PDF ceníku extrahuj:
1. Trim levels (výbavové stupně, např. Style, Style+, Elegant, Premium, CLUB, CLEVER)
2. Option packages (paketové výbavy, např. TECH paket, BLACK paket, STYLE+ paket)
3. Technical data (motor, výkon, převodovka, rozměry, atd.)

DETEKCE: Pokud PDF obsahuje jen některé z nich, ostatní vrať jako prázdná pole/objekt. Označ v "detected" co jsi našel.

FEATURES KATEGORIE: Při zařazování standardní výbavy do trim_levels.features, použij tyto kategorie (vždy přesně tato jména klíčů):
- pohon (Pohon, převodovka)
- podvozek (Zavěšení kol, řízení, brzdy)
- bezpecnost (Bezpečnost, airbagy)
- asistent (Asistenční systémy)
- komfort (Interiér, klimatizace, sedadla)
- multimedia (Audio, navigace, displej)
- exterier (Světla, kola, exteriérové prvky)
- ostatni (Co se nevejde jinam)

⚡ DEDUPLIKACE — DŮLEŽITÉ: Pokud má trim B v kategorii (např. "podvozek") **EXAKTNĚ stejné features jako trim A**, vrať pro tu kategorii jen jeden prvek: ["viz A"]. Příklad:
  trim_levels: [
    { "name": "SELECT", "features": { "podvozek": ["Brzdy ABS", "ESP", "..."] } },
    { "name": "EXCLUSIVE", "features": { "podvozek": ["viz SELECT"] } }
  ]
Save logika to automaticky expanduje. Šetří to tisíce tokenů u modelů s mnoha trimy. Použij to vždy, když trim B kompletně dědí features kategorie z trim A.

CENY:
- list_price: integer v Kč, bez mezer (např. 549900, ne "549 900")
- pricing_per_trim u option_packages: object kde klíč = trim name (lowercase: "style", "premium"), hodnota = number Kč | "standard" (pokud je v standardní výbavě toho trim) | "unavailable" (pokud paket není dostupný v tom trimu)

VRAŤ POUZE VALIDNÍ JSON, žádný markdown wrapper, žádný komentář.`;

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

    // JSON body s PDF jako base64 (FormData/multipart upload může být blokované Vercel security)
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const pdf_base64: string | undefined = (body as any).pdf_base64;
    const context: { brand?: string; model?: string; year?: number } = (body as any).context ?? {};

    if (!pdf_base64 || typeof pdf_base64 !== 'string') {
      return new Response(JSON.stringify({ error: 'Chybí pdf_base64 v JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    // Base64 → binary size approx (base64 je ~33% větší)
    const decodedSize = Math.floor(pdf_base64.length * 0.75);
    if (decodedSize > 30 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: 'PDF příliš velké (>30MB)' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const base64 = pdf_base64;

    const userPrompt = `Extrahuj data z přiloženého ceníku.

${context.brand ? `Brand: ${context.brand}` : ''}
${context.model ? `Model: ${context.model}` : ''}
${context.year ? `Modelový rok: ${context.year}` : ''}

Použij tool extract_pricelist a předej strukturovaná data. Vyplň co najdeš, neexistující sekce nech prázdné.`;

    const anthropic = new Anthropic({ apiKey: import.meta.env.ANTHROPIC_API_KEY });

    // Tool use — vrátí strukturovaný objekt, ne text JSON (žádné parsing chyby)
    const featureCategories = ['pohon', 'podvozek', 'bezpecnost', 'asistent', 'komfort', 'multimedia', 'exterier', 'ostatni'];
    const featuresSchema: any = { type: 'object', properties: {} };
    for (const cat of featureCategories) {
      featuresSchema.properties[cat] = { type: 'array', items: { type: 'string' }, description: `Items v kategorii ${cat}. Pokud trim B má stejné jako trim A, použij ["viz A"]` };
    }

    const tools: any[] = [{
      name: 'extract_pricelist',
      description: 'Uloží extrahovaná data ze ceníku do strukturovaného formátu.',
      input_schema: {
        type: 'object',
        properties: {
          detected: {
            type: 'object',
            properties: {
              has_trim_levels: { type: 'boolean' },
              has_option_packages: { type: 'boolean' },
              has_technical_data: { type: 'boolean' },
              model_name_guess: { type: 'string', description: 'Detekovaný název modelu (např. "Korando" nebo "OMODA 9 SHS")' },
              year_guess: { type: 'number', description: 'Detekovaný rok' },
            },
          },
          trim_levels: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Název trimu (např. "Style+", "PREMIUM")' },
                list_price: { type: 'number', description: 'Cena v Kč (integer, např. 549900)' },
                features: featuresSchema,
              },
              required: ['name'],
            },
          },
          option_packages: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                features: { type: 'array', items: { type: 'string' } },
                pricing_per_trim: {
                  type: 'object',
                  description: 'Klíče = trim names (lowercase), hodnoty = cena v Kč nebo "standard" nebo "unavailable"',
                  additionalProperties: true,
                },
              },
              required: ['name'],
            },
          },
          technical_data: {
            type: 'object',
            description: 'Key-value technické údaje (motor, rozměry, atd.)',
            additionalProperties: { type: 'string' },
          },
        },
        required: ['trim_levels', 'option_packages', 'technical_data'],
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
    const extracted = toolUse.input as any;

    return new Response(JSON.stringify({
      ...extracted,
      meta: {
        usage: message.usage,
        model: message.model,
        stop_reason: message.stop_reason,
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (e) {
    console.error('Cenik analyze error:', e);
    return new Response(JSON.stringify({ error: (e as Error).message, stack: (e as Error).stack }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
