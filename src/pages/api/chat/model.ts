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
import { createRateLimiter, getClientIp } from '@lib/rateLimit';
import { directusGet } from '@lib/directus';
import { getGroupedFeatures } from '@lib/features';

export const prerender = false;

const MODEL_ID = 'claude-haiku-4-5-20251001';
const DIRECTUS_URL = import.meta.env.PUBLIC_DIRECTUS_URL || import.meta.env.DIRECTUS_URL;

/* ──────────── RATE LIMITING ──────────── */
/**
 * Jednoduchý per-IP rate limiter v paměti.
 * Limity: 20 zpráv / hod / IP. Po překročení → 429 Too Many Requests.
 *
 * POZN: paměť per-function-instance. Vercel serverless = krátké životy → ne
 * 100% efektivní, ale stačí na běžné script-kiddie attacky.
 * Pro vážnější ochranu použít @upstash/ratelimit (Redis-based, sdílený).
 */
// Rate limit (sdílený helper) — 20 / hod
const checkRateLimit = createRateLimiter(20, 60 * 60 * 1000);

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

/** Strip diacritics + lowercase pro porovnání s `content_normalized` v Directus. */
function stripDiacritics(s: string): string {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function extractKeywords(question) {
  return stripDiacritics(question)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w))
    .slice(0, 10); // max 10 keywords (už strip diakritika)
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

  // Filter podle režimu:
  //  - Model mode (modelSlug nastaven): primárně chunky pro tento model + base variant,
  //    fallback na brand-wide a universal.
  //  - Brand mode (modelSlug prázdný): VŠECHNY chunky této značky + universal.
  const slugFilter = modelSlug
    ? {
        _or: [
          ...slugVariants.map((s) => ({ model_slug: { _eq: s } })),
          { _and: [{ model_slug: { _empty: true } }, { brand_slug: { _eq: brandSlug } }] },
          { _and: [{ model_slug: { _empty: true } }, { brand_slug: { _empty: true } }] },
        ],
      }
    : {
        _or: [
          { brand_slug: { _eq: brandSlug } },
          { _and: [{ model_slug: { _empty: true } }, { brand_slug: { _empty: true } }] },
        ],
      };

  // Multi-keyword search: chunky kde `content_normalized` obsahuje JAKÝKOLIV
  // ze top 6 keywords. Keywords i field jsou stripped diakritika + lowercase →
  // user může psát "spotreba" i "spotřeba", oboje matchne.
  const searchKeywords = keywords.slice(0, 6);
  const contentFilter = {
    _or: searchKeywords.map((k) => ({ content_normalized: { _contains: k } })),
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
      fields: ['id', 'title', 'content', 'content_normalized', 'page_number', 'tag', 'source_filename'],
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
    // Použij content_normalized pokud existuje (po backfillu), fallback na content
    const lc = c.content_normalized || stripDiacritics(c.content || '');
    let score = 0;
    let matchedKeywords = [];
    for (const k of searchKeywords) {
      if (lc.includes(k)) {
        score += k.length;
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

async function fetchBrandContext(brandSlug: string) {
  const brands = await directusGet<any>('brands', {
    filter: { slug: { _eq: brandSlug }, status: { _eq: 'published' } },
    fields: ['*'],
    limit: 1,
  });
  const brand = brands[0];
  if (!brand) return null;

  // Všechny modely této značky
  const models = await directusGet<any>('models', {
    filter: { brand: { _eq: brand.id }, status: { _eq: 'published' } },
    fields: ['id', 'name', 'slug', 'tagline', 'fuel_type', 'body_type', 'price_from', 'promo_active', 'promo_label', 'promo_discount_amount', 'description'],
    sort: ['sort'],
  });

  // Sklad této značky
  const stock = await directusGet<any>('stock_vehicles', {
    filter: { brand: { _eq: brand.id }, status: { _eq: 'published' } },
    fields: ['id', 'condition', 'list_price', 'km', 'model.name', 'trim_level_snapshot'],
  });

  // Zaměstnanci
  const employees = await directusGet<any>('employees', {
    sort: ['sort', 'full_name'],
    fields: ['id', 'full_name', 'role', 'department', 'email', 'phone'],
  });

  // Všechny brandy
  const allBrands = await directusGet<any>('brands', {
    filter: { status: { _eq: 'published' } },
    fields: ['id', 'name', 'slug', 'tagline'],
    sort: ['sort'],
  });

  return { mode: 'brand', brand, models, stock, employees, allBrands };
}

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
    mode: 'model',
    model, latestYear, trims, packages, stock,
    siblingModels, allBrands, allStock, employees,
  };
}

/* ──────────── SYSTEM PROMPT — BRAND MODE ──────────── */

function buildBrandSystemPrompt(ctx: any, knowledgeChunks: any[] = []): string {
  const { brand, models, stock, employees, allBrands } = ctx;

  const modelsBlock = models.length
    ? models.map((m: any) => {
        const promo = m.promo_active && m.promo_label ? ` 🔥 AKCE: ${m.promo_label}` : '';
        return `### ${m.name} (slug: ${m.slug})
- Tagline: ${m.tagline ?? '—'}
- Typ: ${m.body_type ?? '—'}, palivo: ${m.fuel_type ?? '—'}
- Cena od: ${fmtPrice(m.price_from)}${promo}
- Popis: ${(m.description ?? '').slice(0, 200)}${(m.description ?? '').length > 200 ? '…' : ''}
- Detail: /model/${m.slug}`;
      }).join('\n\n')
    : '(žádné modely)';

  const stockByModel = stock.reduce((acc: any, v: any) => {
    const k = v.model?.name ?? 'Ostatní';
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const stockText = Object.entries(stockByModel).map(([k, n]) => `${n}× ${k}`).join(', ');

  const empByDept = employees.reduce((acc: any, e: any) => {
    const k = e.department ?? 'other';
    if (!acc[k]) acc[k] = [];
    acc[k].push(e);
    return acc;
  }, {} as Record<string, any[]>);
  const fmtEmp = (e: any) => `  - **${e.full_name}** — ${e.role}${e.phone ? `, 📞 ${e.phone}` : ''}${e.email ? `, ✉ ${e.email}` : ''}`;
  const empBlock = [
    empByDept.management?.length ? `### Vedení\n${empByDept.management.map(fmtEmp).join('\n')}` : '',
    empByDept.sales?.length ? `### Prodej (nákup, test drive, financování)\n${empByDept.sales.map(fmtEmp).join('\n')}` : '',
    empByDept.service?.length ? `### Servis (údržba, opravy, STK)\n${empByDept.service.map(fmtEmp).join('\n')}` : '',
    empByDept.parts?.length ? `### Náhradní díly\n${empByDept.parts.map(fmtEmp).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');

  const knowledgeBlock = knowledgeChunks.length
    ? knowledgeChunks.map((k, i) => {
        const src = `${k.title}${k.page_number ? ` (str. ${k.page_number})` : ''}`;
        return `### Zdroj ${i + 1}: ${src} [tag: ${k.tag ?? '—'}]\n${k.content}`;
      }).join('\n\n---\n\n')
    : '';

  return `Jsi SFR asistent pro značku **${brand.name}** — autorizovaný dealer v Praze-Ďáblicích. Aktuálně jsi na brand stránce ${brand.name}, můžeš odpovídat na otázky o JAKÉMKOLIV modelu této značky.

## STYL ODPOVĚDÍ — DŮLEŽITÉ

✅ DĚLEJ:
- Krátké přirozené odpovědi (2-4 věty). Mluv jako kolega na chatu, ne robot.
- Cituj zdroj inline: "Manuál Torres (str. 64): ..." — ne extra řádky.
- Odpověď rovnou, bez paddingu "To je dobrá otázka" / "Bohužel...".
- Když nemáš odpověď, řekni KONKRÉTNĚ co tam je / není: "V brožurách o Korando vidím obecné, ale konkrétní hodnotu tam nemám."
- Zeptej se "Chcete kontakt?" jen když to dává smysl. Casual chat → nezeptat.
- Když dáš kontakt: **JEDEN**. Servis: rotuj Hertl/Mařík/Záruba. Prodej: Paseka.

❌ NEDĚLEJ:
- "Ahoj! 👋" v každé zprávě (jen welcome).
- "To je dobrá otázka", "Skvělé...", "Bohužel..." padding.
- Bullet listy pro krátké odpovědi.
- Vypisovat tři kontakty najednou.
- Vždy končit nabídkou kontaktu.
- Vymýšlet — radši přiznej že nevíš.

## RAG — TVŮJ HLAVNÍ ZDROJ

Když máš sekci "RELEVANTNÍ ÚRYVKY" níže:
1. Pročti všechny úryvky — jsou ze skutečných brožur/manuálů ${brand.name}.
2. Najdi odpověď, i částečnou. Cituj inline: "Manuál Torres (str. 64): ...".
3. Text z PDF má artefakty (rozsekané věty, divné mezery) — čerpej smysl.
4. Když úryvky nemají konkrétní odpověď, řekni přesně co tam je / není.

## Obecná pravidla
- Česky, vy/vám.
- Cenu nikdy nezaručuj — "ověříme při poptávce" pro závaznou nabídku.
- Buying intent → jméno+telefon → tool \`submit_lead\`.
- Můžeš poradit i o jiných modelech a značkách SFR Motor.
- Emoji max 1 na zprávu, často 0.

═══════════════════════════════════════════════════════
DATA O ZNAČCE ${brand.name.toUpperCase()}
═══════════════════════════════════════════════════════

## Základní info
- **Značka**: ${brand.name}
- **Tagline**: ${brand.tagline ?? '—'}
- **Popis**: ${brand.description ?? '—'}

## Modely ${brand.name}
${modelsBlock}

## Sklad ${brand.name}
Celkem ${stock.length} vozů skladem${stockText ? `: ${stockText}` : ''}. Vše na /sklad?znacka=${brand.slug}.

## NÁŠ TÝM — komu doporučit
${empBlock}

## Další značky kterým SFR Motor také prodává
${allBrands.filter((b: any) => b.slug !== brand.slug).map((b: any) => `  - ${b.name} — /${b.slug}`).join('\n')}

${knowledgeBlock ? `═══════════════════════════════════════════════════════
RELEVANTNÍ ÚRYVKY Z BROŽUR/MANUÁLŮ (RAG) — TVŮJ PRIMÁRNÍ ZDROJ
═══════════════════════════════════════════════════════

⚠ Tyto úryvky jsou z oficiálních brožur a manuálů ${brand.name}.
PRIMÁRNĚ čerpej z nich. Cituj zdroj.

${knowledgeBlock}

═══════════════════════════════════════════════════════
` : ''}`;
}

/* ──────────── SYSTEM PROMPT — MODEL MODE ──────────── */

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

## STYL ODPOVĚDÍ — DŮLEŽITÉ

✅ **DĚLEJ:**
- Krátké, přirozené odpovědi (2-4 věty default). Mluv jako kolega na chatu.
- Cituj zdroj inline: "Manuál Korando (str. 187) uvádí: olej a filtr po 20 000 km." — ne extra řádky.
- Když máš odpověď, dej ji rovnou. Bez paddingu typu "To je dobrá otázka" nebo "Bohužel...".
- Když nemáš odpověď, řekni TO KONKRÉTNĚ: "Tohle v manuálech k Torres EVX nevidím — chcete propojit s servisem?" — ne obecné výmluvy.
- Zeptej se "Chcete kontakt?" jen když dává smysl (technická otázka beze závěru, koupě, test drive). Pro casual chat se neptej.
- Když dáš kontakt, dej **JEDEN**. Servis: rotuj mezi Hertl / Mařík / Záruba. Prodej: Paseka. Náhradní díly: Patzelt.

❌ **NEDĚLEJ:**
- Začínat každou zprávu "Ahoj! 👋" (jen první welcome je oslavné).
- Padding fráze: "To je dobrá otázka", "Skvělé, podívám se", "Bohužel...".
- Bullet listy pro krátké odpovědi. Bullets jen když user chce výpis/srovnání.
- Vypisovat 3 kontakty najednou.
- Vždy končit nabídkou kontaktu — někdy stačí odpověď.
- Vymýšlet si — radši přiznej že nevíš.

## RAG — TVŮJ HLAVNÍ ZDROJ

Když máš sekci "RELEVANTNÍ ÚRYVKY" níže:
1. Pročti všechny úryvky — jsou ze skutečných brožur/manuálů.
2. Najdi odpověď. I částečnou. Cituj zdroj: "Manuál Korando (str. 187): ...".
3. Text z PDF extrakce může mít artefakty (rozsekané věty, divné mezery) — čerpej smysl, ne formátování.
4. Pokud úryvky neobsahují konkrétní odpověď, řekni přesně CO TAM JE (ne obecně "nemám info"): "V úryvcích vidím obecné info o údržbě, ale konkrétní interval pro váš motor tam není."

## Obecná pravidla
- Mluvíš česky, oslovuj vy/vám.
- Cenu nikdy nezaručuj — vždy "ověříme při poptávce" pokud user chce závaznou nabídku.
- Buying intent (test drive, koupit, rezervovat, financování) → zeptej se jméno+telefon → tool \`submit_lead\`.
- Můžeš poradit i o jiných modelech SFR Motor (KGM Korando, Torres, Rexton... + OMODA + Farizon). Nikdy konkurence.
- Emoji max 1 na zprávu. Často 0.

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
## Příklady DOBRÝCH odpovědí (krátké, bez bombardování kontakty)

**Q**: Jakou má spotřebu?
**A**: ${model.name} má spotřebu cca [hodnota]. Pro přesnou hodnotu vašeho provedení ověříme při poptávce.

**Q**: Kdy se mění olej?
**A**: Podle manuálu Korando každých 20 000 km nebo 12 měsíců. V těžkých podmínkách (krátké jízdy, prach, tažení) interval zkrátit. Chcete si rezervovat termín v servisu?

**Q**: Svítí mi kontrolka motoru.
**A**: Manuál říká: zastavit, zkontrolovat víčko nádrže, pak co nejdříve do servisu na diagnostiku. Není to nutně havarijní, ale neignorovat. Mám vám dát kontakt na servis?

**Q**: Můžu se přijít podívat?
**A**: Jasně! Showroom Praha-Ďáblice, Prodej Po–Pá 8–18 (Čt do 20), víkend zavřeno; servis Po–Pá 8–17. Domluvím vám čas s prodejcem? Stačí mi jméno + telefon.

**Q**: Máte něco větší než Korando?
**A**: Z KGM Rexton (větší SUV) nebo Musso (pickup). Nebo OMODA 9 prémiové SUV. Co je priorita — velikost, výkon, terén?

**Q**: Chci si vyzkoušet ${model.name}.
**A**: Test drive připravím rád. Jméno a telefon prosím? (po odpovědi → submit_lead)`;
}

/* ──────────── HANDLER ──────────── */

// Chatbot dočasně vypnutý (30.5.2026) — endpoint neaktivní, ať negeneruje náklady na AI.
// Pro zapnutí: smaž tenhle guard + přepni CHAT_ENABLED na true v model/[slug].astro a [brand].astro.
const CHAT_ENABLED = false;

export const POST: APIRoute = async ({ request }) => {
  if (!CHAT_ENABLED) {
    return new Response(JSON.stringify({ error: 'Chat je dočasně nedostupný.' }), {
      status: 503, headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    // ── Rate limit ──
    const ip = getClientIp(request);
    const rl = checkRateLimit(ip);
    if (!rl.allowed) {
      const minutes = Math.ceil(rl.resetIn / 60000);
      return new Response(
        JSON.stringify({
          error: `Příliš mnoho zpráv. Zkuste za ${minutes} min. nebo nás kontaktujte přímo na +420 771 235 458.`,
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'X-RateLimit-Limit': String(RATE_LIMIT_REQUESTS),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.ceil(rl.resetIn / 1000)),
            'Retry-After': String(Math.ceil(rl.resetIn / 1000)),
          },
        },
      );
    }

    const body = await request.json();
    // Backwards compat: `slug` = model slug (model mode)
    // Nově: `modelSlug` (model mode) NEBO `brandSlug` bez modelSlug (brand mode)
    const modelSlug = String(body?.modelSlug ?? body?.slug ?? '').trim();
    const brandSlug = String(body?.brandSlug ?? '').trim();
    const messages = Array.isArray(body?.messages) ? body.messages : [];

    if (!modelSlug && !brandSlug) {
      return new Response(JSON.stringify({ error: 'Missing modelSlug or brandSlug' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (!messages.length) {
      return new Response(JSON.stringify({ error: 'No messages' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // ── Context fetch — model mode má prioritu (specifičtější) ──
    let ctx: any = null;
    let resolvedBrandSlug = brandSlug;
    let resolvedModelSlug = modelSlug;
    let mode: 'model' | 'brand' = 'model';

    if (modelSlug) {
      ctx = await fetchModelContext(modelSlug);
      if (ctx) {
        mode = 'model';
        resolvedBrandSlug = ctx.model.brand?.slug ?? brandSlug;
      }
    }
    if (!ctx && brandSlug) {
      ctx = await fetchBrandContext(brandSlug);
      if (ctx) {
        mode = 'brand';
        resolvedModelSlug = ''; // v brand modu žádný konkrétní model
      }
    }
    if (!ctx) {
      return new Response(
        JSON.stringify({ error: `Context not found (modelSlug=${modelSlug}, brandSlug=${brandSlug})` }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // RAG: search v knowledge base
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    const question = lastUserMsg?.content ?? '';
    const knowledgeChunks = await searchKnowledgeBase(question, resolvedBrandSlug, resolvedModelSlug);

    const systemPrompt = mode === 'brand'
      ? buildBrandSystemPrompt(ctx, knowledgeChunks)
      : buildSystemPrompt(ctx, knowledgeChunks);

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
            // Validate input (proti AI fabulaci + záměrnému spamu)
            const nameOk = typeof input.name === 'string' && input.name.length >= 2 && input.name.length <= 100;
            const phoneClean = String(input.phone ?? '').replace(/\s/g, '');
            const phoneOk = /^(\+?420)?\d{9}$/.test(phoneClean) || /^\+?\d{9,15}$/.test(phoneClean);
            const emailOk = !input.email || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(input.email);
            if (!nameOk || !phoneOk || !emailOk) {
              toolResults.push({
                type: 'tool_result',
                tool_use_id: tu.id,
                content: 'Lead validation failed: name 2-100 znaků, telefon 9-15 číslic, email validní formát.',
                is_error: true,
              });
              continue;
            }
            const modelName = mode === 'model' ? ctx.model.name : '';
            const brandName = mode === 'model' ? (ctx.model.brand?.name ?? '') : (ctx.brand?.name ?? '');
            const leadPayload = {
              form_type: 'ai_chat',
              customer_name: input.name.slice(0, 100),
              customer_email: input.email ? input.email.slice(0, 200) : null,
              customer_phone: phoneClean,
              message: `[AI chat — ${brandName} ${modelName}]\n${String(input.message ?? '').slice(0, 1000)}`,
              source_page: mode === 'model' ? `/model/${resolvedModelSlug}` : `/${resolvedBrandSlug}`,
            };
            // Server-side static token — Directus má zakázaný anonymous write.
            // Preferujeme omezený Lead Writer token (jen leads create), fallback na admin token.
            const directusToken = (import.meta as any).env?.DIRECTUS_LEAD_TOKEN
              ?? (import.meta as any).env?.DIRECTUS_STATIC_TOKEN;
            const leadHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
            if (directusToken) leadHeaders.Authorization = `Bearer ${directusToken}`;
            const r = await fetch(`${DIRECTUS_URL}/items/leads`, {
              method: 'POST',
              headers: leadHeaders,
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
