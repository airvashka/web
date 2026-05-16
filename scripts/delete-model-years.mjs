#!/usr/bin/env node
/**
 * SFR Motor — smaž všechny model_years (a všechny jejich child records) pro model.
 *
 * Pořadí mazání (kvůli FK constraintům):
 *   1) trim_levels      (filter model_year IN <ids>)
 *   2) option_packages  (filter model_year IN <ids>)
 *   3) stock_vehicles   (filter model_year IN <ids>)    ← POZOR! Maže i skladovky!
 *   4) model_years      (samotné záznamy)
 *
 * Stock_vehicles možná NECHCEŠ mazat — proto je defaultně off. --with-stock je zapne.
 *
 * Bezpečnost:
 *   - vyžaduje POTVRZENÍ než cokoli smaže (Y/n prompt)
 *   - --dry jen vypíše co by se stalo
 *   - --force přeskočí potvrzení
 *
 * Použití:
 *   cd "C:\Users\antos\Desktop\Claude\SFR WEB\SFR WEB\web"
 *   node scripts/delete-model-years.mjs korando --dry
 *   node scripts/delete-model-years.mjs korando            # ptá se na potvrzení
 *   node scripts/delete-model-years.mjs korando --force    # bez ptaní
 *   node scripts/delete-model-years.mjs korando --with-stock --force
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith('--'));
const flag = (n) => argv.includes(n);

if (positional.length === 0) {
  console.error('Použití: node scripts/delete-model-years.mjs <model-slug> [--dry] [--force] [--with-stock]');
  process.exit(1);
}

const MODEL_SLUG = positional[0];
const DRY = flag('--dry');
const FORCE = flag('--force');
const WITH_STOCK = flag('--with-stock');

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

async function findModel(slug) {
  const r = await api('GET', `/items/models?filter[slug][_eq]=${encodeURIComponent(slug)}&fields=id,slug,name&limit=1`);
  return (r.data && r.data[0]) || null;
}

async function getYears(modelId) {
  const r = await api('GET', `/items/model_years?filter[model][_eq]=${modelId}&limit=100&fields=id,year,version`);
  return r.data || [];
}

async function countChildren(collection, yearIds) {
  if (yearIds.length === 0) return 0;
  const filter = encodeURIComponent(JSON.stringify({ model_year: { _in: yearIds } }));
  const r = await api('GET', `/items/${collection}?filter=${filter}&aggregate[count]=*`);
  return Number((r.data && r.data[0] && r.data[0].count) || 0);
}

async function deleteByYearIds(collection, yearIds) {
  if (yearIds.length === 0) return 0;
  // Najít všechny child IDs
  const filter = encodeURIComponent(JSON.stringify({ model_year: { _in: yearIds } }));
  const r = await api('GET', `/items/${collection}?filter=${filter}&limit=500&fields=id`);
  const ids = (r.data || []).map((x) => x.id);
  if (ids.length === 0) return 0;
  if (DRY) return ids.length;
  // Bulk delete
  await api('DELETE', `/items/${collection}`, ids);
  return ids.length;
}

async function deleteYears(yearIds) {
  if (yearIds.length === 0) return 0;
  if (DRY) return yearIds.length;
  await api('DELETE', '/items/model_years', yearIds);
  return yearIds.length;
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log(`  Smazání model_years pro "${MODEL_SLUG}"`);
  console.log('═══════════════════════════════════════════════');
  if (DRY) info('DRY-RUN — nic se nezapíše.');
  if (FORCE) info('--force — bez potvrzení.');
  if (WITH_STOCK) warn('--with-stock — smaže i skladovky vázané na tyto roky!');
  console.log('');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK');

  const model = await findModel(MODEL_SLUG);
  if (!model) { console.error(`✗ Model "${MODEL_SLUG}" nenalezen.`); rl.close(); process.exit(1); }
  ok(`Model: ${model.name} (id=${model.id})`);

  const years = await getYears(model.id);
  if (years.length === 0) {
    info('Žádné model_years pro tento model. Nic ke smazání.');
    rl.close();
    return;
  }

  const yearIds = years.map((y) => y.id);
  ok(`Nalezeno ${years.length} model_years: ${years.map((y) => `${y.year}${y.version ? ' ' + y.version : ''} (id=${y.id})`).join(', ')}\n`);

  // Spočítat dopady
  const counts = {
    trim_levels:    await countChildren('trim_levels',    yearIds),
    option_packages: await countChildren('option_packages', yearIds),
    stock_vehicles:  await countChildren('stock_vehicles',  yearIds),
  };

  console.log('  Smaže se:');
  console.log(`    - ${counts.trim_levels} trim_levels`);
  console.log(`    - ${counts.option_packages} option_packages`);
  console.log(`    - ${counts.stock_vehicles} stock_vehicles ${WITH_STOCK ? '(včetně — --with-stock)' : '(POŘÁD! Bez --with-stock se NEsmaze, ale model_year FK se rozbije)'}`);
  console.log(`    - ${years.length} model_years`);
  console.log('');

  // Stock vehicles strategy: defaultně NULL-ujeme jejich model_year (osiřelé, zachované).
  // S --with-stock je smažeme. Bez ničeho by FK constraint zablokoval mazání ročníků.
  if (counts.stock_vehicles > 0) {
    if (WITH_STOCK) {
      warn(`${counts.stock_vehicles} skladovek BUDE SMAZÁNO (--with-stock).`);
    } else {
      info(`${counts.stock_vehicles} skladovek se ZACHOVÁ — jen jim odpojím model_year (bude NULL).`);
      info(`Pak si je v Directus admin (Stock vehicles) přiřaď k novým ročníkům.`);
    }
  }

  if (!FORCE) {
    const ans = (await prompt('Pokračovat se smazáním? (a/n): ')).trim().toLowerCase();
    if (!['a', 'y', 'ano', 'yes'].includes(ans)) { info('Zrušeno.'); rl.close(); return; }
  }

  console.log('');

  // 1) Stock vehicles: NULL nebo DELETE
  if (counts.stock_vehicles > 0) {
    if (WITH_STOCK) {
      const stk = await deleteByYearIds('stock_vehicles', yearIds);
      ok(`Smazáno ${stk} stock_vehicles`);
    } else {
      // Najít skladovky a nastavit jim model_year = null
      const filter = encodeURIComponent(JSON.stringify({ model_year: { _in: yearIds } }));
      const r = await api('GET', `/items/stock_vehicles?filter=${filter}&limit=500&fields=id`);
      const ids = (r.data || []).map((x) => x.id);
      if (!DRY && ids.length > 0) {
        // Bulk PATCH
        await api('PATCH', '/items/stock_vehicles', { keys: ids, data: { model_year: null } });
      }
      ok(`Odpojeno (model_year = NULL) u ${ids.length} skladovek`);
    }
  }

  // 2) Trim levels
  const trims = await deleteByYearIds('trim_levels', yearIds);
  ok(`Smazáno ${trims} trim_levels`);

  // 3) Option packages
  const pkgs = await deleteByYearIds('option_packages', yearIds);
  ok(`Smazáno ${pkgs} option_packages`);

  // 4) Model years
  const yrs = await deleteYears(yearIds);
  ok(`Smazáno ${yrs} model_years`);

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo. Můžeš si v Directus admin (Models → Korando → Model Years)');
  console.log('  vytvořit nové ročníky čistě od nuly přes "+ Create New".');
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
