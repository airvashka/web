/**
 * AI chat asistent pro konkrétní model — endpoint Úroveň 1.
 *
 * POST /api/chat/model
 * Body: {
 *   slug: 'torres' | 'korando' | ...,          // model slug
 *   messages: [{ role: 'user' | 'assistant', content: string }, ...]
 * }
 *
 * Response: streaming SSE s tokens nebo {role, content} JSON.
 *
 * Co dělá:
 *   1) Fetchne model data z Directusu (model + trim_levels + technical_data + sklad count)
 *   2) Postaví system prompt
 *   3) Zavolá Claude Haiku 4.5 s tools (submit_lead)
 *   4) Tool call → uloží do leads (form_type='ai_chat')
 *   5) Streamuje text odpověď zpět clientovi
 *
 * Disclaimer: AI smí odpovídat jen z context. Pro neznámé info říká "ověřte u prodejce".
 */
import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';
import { directusGet } from '@lib/directus';
import { getGroupedFeatures } from '@lib/features';

export const prerender = false;

const MODEL_ID = 'claude-haiku-4-5-20251001';
const DIRECTUS_URL = import.meta.env.PUBLIC_DIRECTUS_URL || import.meta.env.DIRECTUS_URL;

/* ──────────── RAG: KNOWLEDGE SEARCH ──────────── */

/**
 * Extrahuje klíčová slova z otázky pro full-text search.
 * Filtruje stop words, zachovává jen 2+ znakových slov.
 */
const STOP_WORDS = new Set([
  'a', 'i', 'o', 'u', 'k', 'v', 's', 'z', 'na', 'do', 'po', 'za', 'od', 'pro', 'ze',
  'je', 'jsou', 'byl', 'byla', 'bylo', 'byli', 'byly',
  'to', 'ten', 'ta', 'ti', 'ty', 'tato', 'tito', 'tato', 'toto',
  'jak', 'kdo', 'co', 'kde', 'kdy', 'proč', 'který', 'která', 'které',
  'mám', 'máte', 'máš', 'mít', 'mohu', 'můžu', 'může',
  'ale', 'nebo', 'nebo', 'a', 'i', 'pak', 'pak',
  'no', 'tak', 'už', 'jen', 'jen', 'asi', 'snad',
]);

function extractKeywords(question) {
  return question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w))
    .slice(0, 10); // max 10 keywords
}

/**
 * Z variant slugu vrátí base slug (např. "actyon-hev" → "actyon", "torres-evx" → "torres").
 * Pokud slug nemá známý variant suffix, vrátí ho beze změny.
 */
function getBaseSlug(slug) {
  if (!slug) return null;
  return slug.replace(/-(hev|evx|ice|hybrid|electric)$/i, '');
}

/**
 * Vyhledá nejrelevantnější chunky v `knowledge_documents` pro otázku uživatele.
 * Filtruje podle brand_slug a model_slug. Když je uživatel na variantě (např. actyon-hev),
 * hledá i chunky pro base slug (actyon) — protože brožury často pokrývají celou řadu.
 */
async function searchKnowledgeBase(question, brandSlug, modelSlug) {
  if (!question || question.length < 5) return [];
  const keywords = extractKeywords(question);
  if (!keywords.length) return [];

  const baseSlug = getBaseSlug(modelSlug);
  const slugVariants = baseSlug && baseSlug !== modelSlug
    ? [modelSlug, baseSlug]
    : [modelSlug].filter(Boolean);

  // Filter: chunky pro tento model NEBO base variantu, NEBO značku obecně, NEBO univerzální.
  const slugFilter = {
    _or: [
      ...slugVariants.map((s) => ({ model_slug: { _eq: s } })),
      { _and: [{ model_slug: { _empty: true } }, { brand_slug: { _eq: brandSlug } }] },
      { _and: [{ model_slug: { _empty: true } }, { brand_slug: { _empty: true } }] },
    ],
  };

  // Multi-keyword search: chunky obsahující JAKÝKOLIV ze top 6 keywords.
  // Pak score v paměti dle počtu match keywords.
  const searchKeywords = keywords.slice(0, 6);
  const contentFilter = {
    _or: searchKeywords.map((k) => ({ content: { _icontains: k } })),
  };

  let chunks = [];
  try {
    const filter = {
      _and: [
        { status: { _eq: 'active' } },
        slugFilter,
        contentFilter,
      ],
    };
    const res = await directusGet('knowledge_documents', {
      filter,
      fields: ['id', 'title', 'content', 'page_number', 'tag', 'source_filename'],
      limit: 100,
    });
    if (Array.isArray(res)) chunks = res;
  } catch (e) {
    console.warn('[chat] knowledge search failed:', e?.message);
    return [];
  }

  console.log(`[chat] RAG search: model="${modelSlug}", base="${baseSlug}", keywords=[${searchKeywords.join(', ')}] → ${chunks.length} chunks found`);

  if (!chunks.length) return [];

  // Skórování — kolik keywords se v chunku objevuje + délka match (delší = relevantnější)
  const scored = chunks.map((c) => {
    const lc = (c.content || '').toLowerCase();
    let score = 0;
    let matchedKeywords = [];
    for (const k of searchKeywords) {
      if (lc.includes(k)) {
        score += k.length; // dlouhá keyword = víc bodů
        matchedKeywords.push(k);
      }
    }
    return { ...c, score, matchedKeywords };
  }).sort((a, b) => b.score - a.score);

  const topChunks = scored.slice(0, 5);
  console.log(`[chat] top chunks: ${topChunks.map((c) => `${c.source_filename}#${c.page_number}(score=${c.score})`).join(', ')}`);

  return topChunks;
}

/* ──────────── DATA FETCHERS ──────────── */

async function fetchModelContext(slug: string) {
  const models = await directusGet<any>('models', {
    filter: { slug: { _eq: slug } },
    fields: ['*', 'brand.name', 'brand.slug', 'brand.id'],
    limit: 1,
  });
  const model = models[0];
  if (!model) return null;

  // Najdi nejnovější model_year + jeho trims/packages/tech_data
  const years = await directusGet<any>('model_years', {
    filter: { model: { _eq: model.id }, status: { _eq: 'published' } },
    sort: ['-year'],
    fields: ['*'],
    limit: 1,
  });
  const latestYear = years[0];

  const trims = latestYear
    ? await directusGet<any>('trim_levels', {
        filter: { model_year: { _eq: latestYear.id }, status: { _eq: 'published' } },
        sort: ['sort', 'list_price'],
        fields: ['*'],
      })
    : [];

  const packages = latestYear
    ? await directusGet<any>('option_packages', {
        filter: { model_year: { _eq: latestYear.id } },
        fields: ['*'],
      })
    : [];

  // Sklad count (jen tento model, status published, available)
  const stock = await directusGet<any>('stock_vehicles', {
    filter: { model: { _eq: model.id }, status: { _eq: 'published' } },
    fields: ['id', 'condition', 'list_price', 'promo_price', 'km', 'color_name', 'trim_level_snapshot'],
  });

  // ── ROZŠÍŘENÝ KONTEXT ──
  // Ostatní modely téže značky (alternativy)
  const siblingModels = model.brand?.id
    ? await directusGet<any>('models', {
        filter: {
          brand: { _eq: model.brand.id },
          status: { _eq: 'published' },
          id: { _neq: model.id },
        },
        fields: ['id', 'name', 'slug', 'tagline', 'fuel_type', 'body_type', 'price_from', 'promo_active', 'promo_label', 'promo_discount_amount'],
        sort: ['sort'],
      })
    : [];

  // Všechny brandy které dealer prodává (přehled)
  const allBrands = await directusGet<any>('brands', {
    filter: { status: { _eq: 'published' } },
    fields: ['id', 'name', 'slug', 'tagline'],
    sort: ['sort'],
  });

  // Sklad počty napříč brandy (pro general "kolik máte vozů")
  const allStock = await directusGet<any>('stock_vehicles', {
    filter: { status: { _eq: 'published' } },
    fields: ['id', 'condition', 'brand.name', 'model.name'],
  });

  // Zaměstnanci — sales + service + parts + management
  const employees = await directusGet<any>('employees', {
    sort: ['sort', 'full_name'],
    fields: ['id', 'full_name', 'role', 'department', 'email', 'phone'],
  });

  return {
    model, latestYear, trims, packages, stock,
    siblingModels, allBrands, allStock, employees,
  };
}

/* ──────────── SYSTEM PROMPT ──────────── */

function fmtPrice(n: number | null | undefined): string {
  if (!Number.isFinite(Number(n))) return '—';
  return `${Number(n).toLocaleString('cs-CZ')} Kč`;
}

function buildSystemPrompt(
  ctx: NonNullable<Awaited<ReturnType<typeof fetchModelContext>>>,
  knowledgeChunks: any[] = [],
): string {
  const { model, latestYear, trims, packages, stock, siblingModels, allBrands, allStock, employees } = ctx;
  const brand = model.brand?.name ?? '';

  // ── Knowledge base chunks (RAG) ──
  const knowledgeBlock = knowledgeChunks.length
    ? knowledgeChunks.map((k, i) => {
        const src = `${k.title}${k.page_number ? ` (str. ${k.page_number})` : ''}`;
        return `### Zdroj ${i + 1}: ${src} [tag: ${k.tag ?? '—'}]\n${k.content}`;
      }).join('\n\n---\n\n')
    : '';

  // ── Sibling models (alternativy v rámci značky) ──
  const siblingsBlock = siblingModels.length
    ? siblingModels.map((m: any) => {
        const promo = m.promo_active && m.promo_label
          ? ` 🔥 AKCE: ${m.promo_label}${m.promo_discount_amount ? ` (sleva ${fmtPrice(m.promo_discount_amount)})` : ''}`
          : '';
        return `  - **${m.name}** (${m.body_type ?? '—'}, ${m.fuel_type ?? '—'}, od ${fmtPrice(m.price_from)})${promo} — /model/${m.slug}`;
      }).join('\n')
    : '  (žádné jiné modely této značky)';

  // ── Všechny brandy které prodáváme ──
  const brandsBlock = allBrands
    .map((b: any) => `  - **${b.name}** — ${b.tagline ?? ''} — /${b.slug}`)
    .join('\n');

  // ── Sklad summary ──
  const allStockByBrand = allStock.reduce((acc: any, v: any) => {
    const k = v.brand?.name ?? 'Ostatní';
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const allStockText = Object.entries(allStockByBrand)
    .map(([k, n]) => `${n}× ${k}`)
    .join(', ');

  // ── Zaměstnanci dle department ──
  const empByDept = employees.reduce((acc: any, e: any) => {
    const k = e.department ?? 'other';
    if (!acc[k]) acc[k] = [];
    acc[k].push(e);
    return acc;
  }, {} as Record<string, any[]>);

  const fmtEmp = (e: any) => `  - **${e.full_name}** — ${e.role}${e.phone ? `, 📞 ${e.phone}` : ''}${e.email ? `, ✉ ${e.email}` : ''}`;
  const empBlock = [
    empByDept.management?.length ? `### Vedení společnosti\n${empByDept.management.map(fmtEmp).join('\n')}` : '',
    empByDept.sales?.length ? `### Prodej nových vozů (kontaktujte pro: nákup, test drive, financování, předvedení)\n${empByDept.sales.map(fmtEmp).join('\n')}` : '',
    empByDept.service?.length ? `### Servis (kontaktujte pro: údržbu, opravy, pneuservis, STK)\n${empByDept.service.map(fmtEmp).join('\n')}` : '',
    empByDept.parts?.length ? `### Náhradní díly (kontaktujte pro: díly, příslušenství)\n${empByDept.parts.map(fmtEmp).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');

  // Trims se cenami a features
  const trimsBlock = trims.length
    ? trims
        .map((t: any) => {
          const price = fmtPrice(t.promo_price ?? t.list_price);
          const groups = getGroupedFeatures(t.features);
          const featList = groups
            .map((g: any) => `  ${g.label}:\n${g.items.map((f: string) => `    - ${f}`).join('\n')}`)
            .join('\n');
          const optList = Array.isArray(t.optional_items)
            ? t.optional_items.map((o: any) => `  - ${o.name} (${o.code || 'kód neznámý'}): ${fmtPrice(o.price)}`).join('\n')
            : '';
          return `### ${t.name} — ${price}\n**Co dostane zákazník:**\n${featList || '  (nedoplněno)'}${optList ? `\n**Co si může dokoupit:**\n${optList}` : ''}`;
        })
        .join('\n\n')
    : '(žádné trim_levels nejsou definované)';

  // Pakety
  const packagesBlock = packages.length
    ? packages
        .map((p: any) => {
          const feats = Array.isArray(p.features)
            ? p.features.map((f: string) => `  - ${f}`).join('\n')
            : '';
          return `### ${p.name} (kód ${p.code || '—'})\n${feats}`;
        })
        .join('\n\n')
    : '';

  // Technical data
  const techRows = Array.isArray(latestYear?.technical_data)
    ? latestYear.technical_data
        .filter((r: any) => r && r.key)
        .map((r: any) => `  - ${r.key}: ${r.value}`)
        .join('\n')
    : '';

  // Sklad summary
  const stockByCondition = stock.reduce((acc: any, v: any) => {
    const k = v.condition ?? 'unknown';
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const stockText = Object.entries(stockByCondition)
    .map(([k, n]) => `${n}× ${k}`)
    .join(', ');

  // Promo
  const promoActive = model.promo_active && model.promo_valid_to
    ? new Date(model.promo_valid_to) > new Date()
    : !!model.promo_active;
  const promoBlock = promoActive && model.promo_label
    ? `**AKTUÁLNÍ AKCE**: ${model.promo_label}${model.promo_discount_amount ? ` (sleva ${fmtPrice(model.promo_discount_amount)})` : ''}${model.promo_valid_to ? `, platí do ${model.promo_valid_to}` : ''}\n${model.promo_description || ''}`
    : '';

  return `Jsi přátelský SFR asistent — pomáháš zákazníkům SFR Motor (autorizovaný dealer KGM, OMODA & JAECOO a Farizon v Praze-Ďáblicích). Aktuálně jsi na stránce modelu **${brand} ${model.name}** a primárně odpovídáš na otázky o něm.

## DŮLEŽITÉ — POSTUP ODPOVĚDI

**Když máš sekci "RELEVANTNÍ ÚRYVKY Z BROŽUR/MANUÁLŮ" níže (RAG kontext):**
1. PEČLIVĚ si přečti všechny úryvky — jsou to skutečné kousky z brožur a manuálů KGM/SFR.
2. **NEJDŘÍV se snaž odpovědět z těchto úryvků.** I když jsou útržky textu nebo částečné, často obsahují odpověď.
3. Cituj zdroj: "Podle manuálu (str. 187): ..." nebo "Brožura uvádí: ...".
4. Pokud úryvky odpovídají JEN ČÁSTEČNĚ, napiš co víš + uznej omezení: "Mám v manuálu pokyn k…, ale specifický typ oleje pro váš motor by potvrdil servis."
5. AŽ když úryvky opravdu neodpovídají, řekni "v dostupné dokumentaci jsem to nenašel" a navrhni servis.

**Když NEMÁŠ RAG úryvky** (sekce chybí):
- Odpovídej jen z dat o modelu (ceny, výbavy, technika) níže.
- Pokud nejde odpovědět ani z toho, řekni "Tuhle konkrétní informaci v sobě nemám" + doporuč konkrétního člověka z týmu.

## Tvoje role obecně
- Mluvíš ČESKY, přátelsky ale profesionálně.
- Odpovídáš STRUČNĚ (1-3 věty), pokud uživatel nechce detail.
- Text z brožury může obsahovat artefakty z PDF extrakce (rozsekané věty, divné mezery, zlomená diakritika) — ignoruj formátování, čerpej smysl.
- Když uživatel projeví zájem (test drive, koupit, rezervovat, "kolik bych dal měsíčně", financování), zeptej se na jméno + telefon a zavolej tool \`submit_lead\`.
- NIKDY nezaručuj přesnost cen či specifikací — vždy doplň "ověříme při poptávce".
- Můžeš poradit i o JINÝCH modelech a značkách SFR Motor. Pokud uživatel hledá něco co model ${model.name} nemá, navrhni alternativu.
- Nikdy si nic NEVYMÝŠLEJ. Pokud info chybí v datech i v RAG úryvcích, řekni to a odkaž na člověka.

## Pravidla pro odpovědi
- Ceny jsou informativní z ceníku, na akce/financování konzultovat prodejce.
- Skladovou dostupnost můžeš sdělit, link na /sklad.
- Pro testovací jízdu volej tool \`submit_lead\` (po obdržení jména + telefonu).
- Při dotazu na servis odkaž na servisní tým (Hertl/Mařík/Záruba) NEBO formulář /servis.
- Při dotazu na náhradní díly odkaž na Patzelta nebo Zelenku.

═══════════════════════════════════════════════════════
DATA O TOMTO MODELU (${brand} ${model.name})
═══════════════════════════════════════════════════════

## Základní info
- **Značka**: ${brand}
- **Model**: ${model.name}
- **Tagline**: ${model.tagline || '—'}
- **Typ paliva**: ${model.fuel_type || '—'}
- **Karoserie**: ${model.body_type || '—'}
- **Cena od**: ${fmtPrice(model.price_from)}
- **Modelový rok**: ${latestYear?.year || '—'}

## Popis
${model.description || '(nedoplněno)'}

${promoBlock ? '\n## Aktuální akce\n' + promoBlock + '\n' : ''}

## Výbavové stupně a ceny
${trimsBlock}

${packagesBlock ? '\n## Volitelné pakety\n' + packagesBlock : ''}

${techRows ? '\n## Technické údaje\n' + techRows : ''}

## Sklad tohoto modelu
${stock.length ? `Celkem **${stock.length}** vozů skladem: ${stockText}.\nUživatel může vidět všechny na /sklad?model=${model.slug}` : 'Aktuálně žádné vozy tohoto modelu skladem.'}

═══════════════════════════════════════════════════════
DALŠÍ KONTEXT — SFR MOTOR JAKO CELEK
═══════════════════════════════════════════════════════

## Další modely ${brand}
${siblingsBlock}

## Všechny značky které SFR Motor prodává
${brandsBlock}

## Sklad celkem (napříč značkami)
${allStock.length} vozů skladem: ${allStockText}. Vše na /sklad.

## NÁŠ TÝM — komu konkrétně doporučit
${empBlock}

${knowledgeBlock ? `═══════════════════════════════════════════════════════
RELEVANTNÍ ÚRYVKY Z BROŽUR / MANUÁLŮ (RAG) — TVŮJ PRIMÁRNÍ ZDROJ PRO TUTO OTÁZKU
═══════════════════════════════════════════════════════

⚠ POZOR: Tyto úryvky jsou ze skutečných oficiálních brožur a manuálů KGM/SFR.
Když odpovídáš na otázku uživatele, PRIMÁRNĚ čerpej z nich (před obecným věděním).

POSTUP:
1. Přečti všechny úryvky níže.
2. Vyber ty které jsou relevantní k otázce uživatele.
3. Odpověz na základě toho co tam je. Cituj zdroj (např. "Podle manuálu Korando (str. 64): ...").
4. Pokud úryvky odpovídají jen částečně, řekni co víš + uznej co je třeba ověřit v servisu.
5. Pokud úryvky vůbec neodpovídají na otázku, teprve pak řekni "v dostupné dokumentaci jsem to k tomu nenašel" a navrhni kontakt.

NEIGNORUJ TYTO ÚRYVKY. Uživatel ti zaplatil za to abys je použil.

${knowledgeBlock}

═══════════════════════════════════════════════════════
` : ''}
## Příklady odpovědí

**Q**: Jakou má spotřebu?
**A**: Z technických dat ${model.name}: [hodnota]. Pro přesnou hodnotu konkrétního provedení doporučuji ověřit při poptávce.

**Q**: Můžu se přijít podívat?
**A**: Jasně! Showroom v Praze-Ďáblicích, Po-Pá 8-18, So 9-13. Můžu vám rezervovat čas s prodejcem — dejte mi prosím jméno a telefon.

**Q**: Chci servis na své staré auto.
**A**: Servisní tým rád pomůže — pro Vás bude nejlepší Karel Mařík (servisní poradce, +420 771 259 323) nebo můžete vyplnit /servis. Co s vozem řešíte?

**Q**: Máte něco větší než Korando?
**A**: Z KGM máme ${siblingModels.find((s: any) => /rexton|musso/i.test(s.name))?.name ?? 'Rexton'} — větší a robustnější. Také nabízíme OMODA 9, pokud chcete prémiové SUV. Co je pro vás priorita — velikost, výkon, terén?

**Q**: Chci si vyzkoušet ${model.name}.
**A**: Skvělé! Připravím vám test drive. Jméno a telefon prosím? (po odpovědi → submit_lead)`;
}

/* ──────────── HANDLER ──────────── */

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const slug = String(body?.slug ?? '');
    const messages = Array.isArray(body?.messages) ? body.messages : [];

    if (!slug) {
      return new Response(JSON.stringify({ error: 'Missing slug' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (!messages.length) {
      return new Response(JSON.stringify({ error: 'No messages' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const ctx = await fetchModelContext(slug);
    if (!ctx) {
      return new Response(JSON.stringify({ error: `Model "${slug}" not found` }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    // RAG: pokud je v poslední user zprávě otázka, najdi relevantní chunky z knowledge base
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    const question = lastUserMsg?.content ?? '';
    const knowledgeChunks = await searchKnowledgeBase(question, ctx.model.brand?.slug, slug);

    const systemPrompt = buildSystemPrompt(ctx, knowledgeChunks);

    const anthropic = new Anthropic({ apiKey: import.meta.env.ANTHROPIC_API_KEY });

    const tools: any[] = [{
      name: 'submit_lead',
      description: 'Uloží lead (zájemce) do databáze SFR Motor. Volej, když uživatel poskytl jméno + telefon a projevil zájem (test drive, koupit, rezervovat, financování). Po úspěšném zavolání odpověz uživateli potvrzením "Děkujeme! Petr Paseka se vám brzy ozve.".',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Jméno zájemce (povinné)' },
          phone: { type: 'string', description: 'Telefon zájemce (povinné, formát +420...)' },
          email: { type: 'string', description: 'E-mail (pokud uvedl)' },
          message: { type: 'string', description: 'Krátký souhrn co chce — např. "Test drive Torres EVX", "Zájem o Korando STYLE, financování"' },
        },
        required: ['name', 'phone', 'message'],
      },
    }];

    // Multi-turn loop: pokud Claude vrátí tool_use, zpracujeme a pošleme tool_result zpět
    const messagesForClaude = messages.map((m: any) => ({
      role: m.role,
      content: m.content,
    }));

    let finalText = '';
    let leadCreated = false;

    for (let iter = 0; iter < 3; iter++) {
      const resp = await anthropic.messages.create({
        model: MODEL_ID,
        max_tokens: 1024,
        system: systemPrompt,
        messages: messagesForClaude,
        tools,
      });

      const toolUses = resp.content.filter((b: any) => b.type === 'tool_use');
      const textBlocks = resp.content.filter((b: any) => b.type === 'text');
      finalText = textBlocks.map((b: any) => b.text).join('\n').trim();

      if (toolUses.length === 0) break;

      // Process tool calls
      const toolResults: any[] = [];
      for (const tu of toolUses as any[]) {
        if (tu.name === 'submit_lead') {
          try {
            const input = tu.input || {};
            const leadPayload = {
              form_type: 'ai_chat',
              customer_name: input.name,
              customer_email: input.email || null,
              customer_phone: input.phone,
              message: `[AI chat — ${ctx.model.brand?.name ?? ''} ${ctx.model.name}]\n${input.message}`,
              source_page: `/model/${slug}`,
            };
            const r = await fetch(`${DIRECTUS_URL}/items/leads`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(leadPayload),
            });
            if (r.ok) {
              leadCreated = true;
              toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: 'Lead saved.' });
            } else {
              toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: 'Save failed.', is_error: true });
            }
          } catch (e: any) {
            toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: `Error: ${e.message}`, is_error: true });
          }
        }
      }

      // Push assistant message + tool_result follow-up
      messagesForClaude.push({ role: 'assistant', content: resp.content });
      messagesForClaude.push({ role: 'user', content: toolResults });
    }

    return new Response(
      JSON.stringify({
        role: 'assistant',
        content: finalText,
        lead_created: leadCreated,
        // Debug info — co RAG našel
        debug: {
          rag_chunks_count: knowledgeChunks.length,
          rag_chunks: knowledgeChunks.map((c) => ({
            source: c.source_filename,
            title: c.title,
            page: c.page_number,
            score: c.score,
            matched: c.matchedKeywords,
          })),
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (e: any) {
    console.error('Chat error:', e);
    return new Response(
      JSON.stringify({ error: e.message ?? 'Server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};
