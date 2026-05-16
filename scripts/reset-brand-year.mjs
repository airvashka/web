#!/usr/bin/env node
/**
 * SFR Motor — Reset všech model_years dané značky pro konkrétní rok.
 *
 * Co dělá:
 *   1) Najde značku podle slugu (např. "kgm")
 *   2) Najde všechny published modely v té značce
 *   3) Pro každý model najde model_year odpovídající danému roku (např. 2026)
 *   4) U skladovek vázaných na tyto roky nastaví `model_year = NULL` (zachová záznamy)
 *   5) Smaže trim_levels + option_packages pro tyto roky
 *   6) Smaže model_years samotné
 *
 * Hodí se když chceš začít celý rok od nuly a znovu nahrát ceníky.
 *
 * Bezpečnost: ptá se na potvrzení (Y/n), --dry jen vypíše, --force přeskočí dotaz.
 *
 * Použití:
 *   cd "C:\Users\antos\Desktop\Claude\SFR WEB\SFR WEB\web"
 *   node scripts/reset-brand-year.mjs kgm 2026 --dry
 *   node scripts/reset-brand-year.mjs kgm 2026
 *   node scripts/reset-brand-year.mjs omoda-jaecoo 2026 --force
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith('--'));
const flag = (n) => argv.includes(n);

if (positional.length < 2) {
  console.error('Použití: node scripts/reset-brand-year.mjs <brand-slug> <year> [--dry] [--force]');
  console.error('Příklad: node scripts/reset-brand-year.mjs kgm 2026');
  process.exit(1);
}

const BRAND_SLUG = positional[0];
const YEAR = parseInt(positional[1], 10);
const DRY = flag('--dry');
const FORCE = flag('--force');

if (!Number.isFinite(YEAR)) {
  console.error(`✗ "${positional[1]}" není platný rok (číslo).`);
  process.exit(1);
}

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

const ok   = (m) => console.log(`  ✓  ${m}`);
const info = (m) => console.log(`  ℹ  ${m}`);
const warn = (m) => console.log(`  ⚠  ${m}`);

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log(`  Reset značky "${BRAND_SLUG}" pro rok ${YEAR}`);
  console.log('═══════════════════════════════════════════════');
  if (DRY) info('DRY-RUN — nic se nezapíše.');
  if (FORCE) info('--force — bez potvrzení.');
  console.log('');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK');

  // 1) Najít značku
  const brandResp = await api('GET', `/items/brands?filter[slug][_eq]=${encodeURIComponent(BRAND_SLUG)}&fields=id,name,slug&limit=1`);
  const brand = brandResp.data?.[0];
  if (!brand) { console.error(`✗ Značka "${BRAND_SLUG}" nenalezena.`); rl.close(); process.exit(1); }
  ok(`Značka: ${brand.name} (id=${brand.id})`);

  // 2) Modely té značky
  const modelsResp = await api('GET', `/items/models?filter[brand][_eq]=${brand.id}&filter[status][_eq]=published&limit=200&fields=id,slug,name`);
  const models = modelsResp.data || [];
  if (models.length === 0) {
    info('Žádné modely.');
    rl.close();
    return;
  }
  ok(`Modelů: ${models.length} (${models.map((m) => m.slug).join(', ')})`);

  // 3) Najít model_years pro tento rok napříč všemi modely značky
  const modelIds = models.map((m) => m.id);
  const filter = encodeURIComponent(JSON.stringify({
    model: { _in: modelIds },
    year: { _eq: YEAR },
  }));
  const yearsResp = await api('GET', `/items/model_years?filter=${filter}&limit=200&fields=id,year,version,model`);
  const years = yearsResp.data || [];

  if (years.length === 0) {
    info(`Žádné model_years pro rok ${YEAR} u značky ${brand.name}.`);
    rl.close();
    return;
  }

  const modelById = Object.fromEntries(models.map((m) => [m.id, m]));
  console.log(`\n  Nalezeno ${years.length} model_years pro rok ${YEAR}:`);
  for (const y of years) {
    const m = modelById[y.model];
    console.log(`    - ${m?.name ?? 'unknown'} (slug=${m?.slug ?? '?'}) year=${y.year}${y.version ? ' ' + y.version : ''} (id=${y.id})`);
  }
  console.log('');

  const yearIds = years.map((y) => y.id);

  // 4) Spočítat dopady
  async function countByYears(collection) {
    const f = encodeURIComponent(JSON.stringify({ model_year: { _in: yearIds } }));
    const r = await api('GET', `/items/${collection}?filter=${f}&aggregate[count]=*`);
    return Number(r.data?.[0]?.count ?? 0);
  }
  const counts = {
    trims:  await countByYears('trim_levels'),
    pkgs:   await countByYears('option_packages'),
    stocks: await countByYears('stock_vehicles'),
  };

  console.log('  Operace:');
  console.log(`    - ${counts.stocks} skladovek → model_year nastaven NULL (záznamy zůstanou)`);
  console.log(`    - ${counts.trims} trim_levels → smazat`);
  console.log(`    - ${counts.pkgs} option_packages → smazat`);
  console.log(`    - ${years.length} model_years → smazat`);
  console.log('');

  if (!FORCE) {
    const ans = (await prompt(`Pokračovat? Tohle SMAŽE výbavy a pakety pro rok ${YEAR} u celého ${brand.name}. (a/n): `)).trim().toLowerCase();
    if (!['a', 'y', 'ano', 'yes'].includes(ans)) { info('Zrušeno.'); rl.close(); return; }
  }

  console.log('');

  // 5) Skladovky → model_year = NULL
  if (counts.stocks > 0) {
    const f = encodeURIComponent(JSON.stringify({ model_year: { _in: yearIds } }));
    const r = await api('GET', `/items/stock_vehicles?filter=${f}&limit=500&fields=id`);
    const ids = (r.data || []).map((x) => x.id);
    if (!DRY && ids.length > 0) {
      await api('PATCH', '/items/stock_vehicles', { keys: ids, data: { model_year: null } });
    }
    ok(`Skladovky: ${ids.length} odpojeno (model_year = NULL)`);
  }

  // 6) Smazat child records
  async function deleteByYears(collection) {
    const f = encodeURIComponent(JSON.stringify({ model_year: { _in: yearIds } }));
    const r = await api('GET', `/items/${collection}?filter=${f}&limit=500&fields=id`);
    const ids = (r.data || []).map((x) => x.id);
    if (ids.length === 0) return 0;
    if (!DRY) await api('DELETE', `/items/${collection}`, ids);
    return ids.length;
  }

  const tr = await deleteByYears('trim_levels');
  ok(`Smazáno ${tr} trim_levels`);
  const pk = await deleteByYears('option_packages');
  ok(`Smazáno ${pk} option_packages`);

  // 7) Smazat model_years samotné
  if (!DRY) await api('DELETE', '/items/model_years', yearIds);
  ok(`Smazáno ${yearIds.length} model_years`);

  console.log('\n═══════════════════════════════════════════════');
  console.log(`  Hotovo. Rok ${YEAR} pro značku ${brand.name} resetován.`);
  console.log('');
  console.log('  Další kroky:');
  console.log(`    1) V Directus admin: Models → každý model → Model Years → "+ Create New" → rok ${YEAR}`);
  console.log(`       (nebo přes scripts/duplicate-model-year.mjs pokud máš jiný rok jako šablonu)`);
  console.log(`    2) V /admin/cenik nahraj PDF ceník pro každý model_year`);
  console.log(`    3) V Directus → Stock vehicles → každé skladovce přiřaď nový model_year`);
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
