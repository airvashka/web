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

/* ──────────── DATA FETCHERS ──────────── */

async function fetchModelContext(slug: string) {
  const models = await directusGet<any>('models', {
    filter: { slug: { _eq: slug } },
    fields: ['*', 'brand.name', 'brand.slug'],
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

  return { model, latestYear, trims, packages, stock };
}

/* ──────────── SYSTEM PROMPT ──────────── */

function fmtPrice(n: number | null | undefined): string {
  if (!Number.isFinite(Number(n))) return '—';
  return `${Number(n).toLocaleString('cs-CZ')} Kč`;
}

function buildSystemPrompt(ctx: NonNullable<Awaited<ReturnType<typeof fetchModelContext>>>): string {
  const { model, latestYear, trims, packages, stock } = ctx;
  const brand = model.brand?.name ?? '';

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

  return `Jsi přátelský AI asistent SFR Motor — autorizovaného prodejce ${brand} v Praze-Ďáblicích. Pomáháš zákazníkům s otázkami o **${brand} ${model.name}**.

## Tvoje role
- Mluvíš ČESKY, přátelsky ale profesionálně.
- Odpovídáš STRUČNĚ (1-3 věty na otázku) pokud uživatel nechce detail.
- Když nevíš odpověď z dat níže, řekni "Tuhle informaci v sobě nemám, ozvěte se prosím prodejci Petrovi Pasekovi: +420 771 235 458, paseka@sfr-motor.cz" — nikdy si nevymýšlej.
- Když uživatel projeví zájem (test drive, koupit, rezervovat, "kolik bych dal měsíčně"), zeptej se na jméno + telefon a zavolej tool \`submit_lead\`.
- Nikdy nemluv o konkurenci nebo jiných značkách než ${brand}.
- NIKDY nezaručuj přesnost cen či specifikací — vždy doplň "ověříme při poptávce".

## Pravidla pro odpovědi
- Ceny jsou informativní z ceníku, na akce/financování konzultovat prodejce.
- Skladovou dostupnost můžeš sdělit, ale link na /sklad
- Pro testovací jízdu volej tool \`submit_lead\`.

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

## Sklad
${stock.length ? `Celkem **${stock.length}** vozů skladem: ${stockText}.\nUživatel může vidět všechny na /sklad?model=${model.slug}` : 'Aktuálně žádné vozy skladem.'}

═══════════════════════════════════════════════════════

## Příklady odpovědí
**Q**: Jakou má spotřebu?
**A**: ${model.name} má spotřebu uvedenou v technických datech (vidím v sobě X l/100km). Pro přesnou hodnotu vašeho konkrétního provedení doporučuji ověřit při poptávce.

**Q**: Kolik bych zaplatil za TECH paket k STYLE výbavě?
**A**: TECH paket k výbavě STYLE stojí... (pokud znáš cenu) Kč. Cenu bychom potvrdili při uzavírání objednávky.

**Q**: Můžu si vyzkoušet?
**A**: Jasně! Připravím vám test drive. Můžete mi prosím říct jméno a telefon? (po odpovědi → submit_lead)`;
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

    const systemPrompt = buildSystemPrompt(ctx);

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
