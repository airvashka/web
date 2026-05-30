#!/usr/bin/env node
/**
 * SFR Motor — automatický slug pro články.
 *
 * Co to dělá:
 *   1) Založí Directus Flow „Auto-slug articles" (filter hook na articles.items.create),
 *      který při VYTVOŘENÍ článku vygeneruje slug z titulku, pokud slug není vyplněn.
 *      (malá písmena, pomlčky, bez diakritiky — např. „Nová OMODA 9" → „nova-omoda-9")
 *   2) Doplní slug i u EXISTUJÍCÍCH publikovaných článků, co ho nemají
 *      (to je ten, co shazoval build).
 *
 * Slug se generuje jen když je prázdný — ručně zadaný slug se nepřepisuje,
 * a editace titulku později slug nemění (stabilní URL).
 *
 * Idempotentní — lze spustit opakovaně.
 *
 * Použití:
 *   cd web && node scripts/setup-article-slug-flow.mjs
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rl = readline.createInterface({ input, output });
const prompt = (q) => rl.question(q);

let URL = '', TOKEN = '';

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${URL}${path}`, opts);
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(j?.errors ?? j)}`);
  return j;
}

const ok = (m) => console.log(`  ✓  ${m}`);
const info = (m) => console.log(`  ℹ  ${m}`);

// Stejná logika jako ve webu i ve flow — drž konzistentní.
function slugify(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '');
}

// Kód, co poběží uvnitř Directus Flow (run-script). Slug jen když je prázdný.
const FLOW_CODE = `module.exports = async function (data) {
  const p = (data && data.$trigger && data.$trigger.payload) ? data.$trigger.payload : {};
  if (p.title && (!p.slug || String(p.slug).trim() === '')) {
    const slug = String(p.title)
      .normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-+|-+$)/g, '');
    return Object.assign({}, p, { slug: slug });
  }
  return p;
};`;

const FLOW_NAME = 'Auto-slug articles';

async function flowExists() {
  const res = await api('GET', `/flows?filter[name][_eq]=${encodeURIComponent(FLOW_NAME)}&fields=id&limit=1`);
  return res.data?.[0]?.id ?? null;
}

async function createFlow() {
  const existing = await flowExists();
  if (existing) { info(`Flow „${FLOW_NAME}" už existuje (${existing}), nezakládám znovu.`); return; }

  const flow = await api('POST', '/flows', {
    name: FLOW_NAME,
    icon: 'link',
    color: '#F25C1B',
    description: 'Vygeneruje slug z titulku při vytvoření článku, pokud slug není vyplněn.',
    status: 'active',
    trigger: 'event',
    accountability: 'all',
    options: { type: 'filter', scope: ['items.create'], collections: ['articles'] },
  });
  const flowId = flow.data.id;
  ok(`Flow vytvořen (${flowId})`);

  const op = await api('POST', '/operations', {
    flow: flowId,
    key: 'slugify',
    type: 'exec',
    name: 'Slugify title',
    position_x: 19,
    position_y: 1,
    options: { code: FLOW_CODE },
  });
  await api('PATCH', `/flows/${flowId}`, { operation: op.data.id });
  ok('Operace „Slugify title" připojena k flow');
}

async function backfillExisting() {
  console.log('\nDoplňuji slug existujícím článkům bez slugu…');
  const res = await api('GET', '/items/articles?fields=id,title,slug&limit=500');
  const rows = res.data ?? [];
  let fixed = 0, skipped = 0;
  for (const a of rows) {
    const hasSlug = a.slug && String(a.slug).trim() !== '';
    if (hasSlug) { skipped++; continue; }
    if (!a.title) { info(`#${a.id}: bez titulku, přeskakuji`); skipped++; continue; }
    const slug = slugify(a.title);
    if (!slug) { info(`#${a.id}: titulek „${a.title}" → prázdný slug, přeskakuji`); skipped++; continue; }
    await api('PATCH', `/items/articles/${a.id}`, { slug });
    ok(`#${a.id} „${a.title}" → ${slug}`);
    fixed++;
  }
  return { fixed, skipped };
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Auto-slug pro články (Directus Flow + backfill)');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://admin.sfr-motor.cz]: ')).trim() || 'https://admin.sfr-motor.cz';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  console.log('Krok 1: Doplnění slugů existujícím článkům');
  const res = await backfillExisting();

  console.log('\nKrok 2: Flow pro budoucí články');
  await createFlow();

  console.log('\n═══════════════════════════════════════════════');
  console.log(`  Hotovo. Doplněno slugů: ${res.fixed}, přeskočeno: ${res.skipped}`);
  console.log('═══════════════════════════════════════════════\n');
  console.log('Od teď: vytvoříš článek, vyplníš titulek, ulož — slug se doplní sám.');
  console.log('Ručně zadaný slug se nepřepisuje. Pak npm run build / deploy.\n');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
