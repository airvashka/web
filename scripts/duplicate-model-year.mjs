#!/usr/bin/env node
/**
 * SFR Motor — duplicate model_year with all related trim_levels + option_packages.
 *
 * Use case:
 *   Mám Korando 2026 s 4 trimy + 4 paketami. Chci vytvořit Korando 2025 jako
 *   kopii (pak ručně upravím to, co se líší — třeba ceny nebo emisní normu).
 *
 * Co skript dělá:
 *   1) Vypíše dostupné model_years, ty vybereš zdroj (např. "Korando 2026")
 *   2) Zeptá se na cílový rok (např. 2025) a volitelně version (např. "H1")
 *   3) Vytvoří nový model_year (zkopíruje technical_data, brochure, ceník, ...)
 *   4) Pro každý trim_level zdrojového roku → vytvoří kopii v cílovém
 *   5) Pro každý option_package zdrojového roku → vytvoří kopii
 *   6) Hotovo — máš nový rok s plnou výbavou
 *
 * Použití:
 *   cd web && node scripts/duplicate-model-year.mjs
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rl = readline.createInterface({ input, output });
const prompt = (q) => rl.question(q);

let URL = '', TOKEN = '';

async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${URL}${path}`, opts);
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(j?.errors ?? j)}`);
  return j;
}

const ok = (m) => console.log(`  ✓  ${m}`);
const info = (m) => console.log(`  ℹ  ${m}`);

// Statický skip — system fields
const STATIC_SKIP = ['id', 'date_created', 'date_updated', 'user_created', 'user_updated', 'sort', 'status'];

// Dynamický skip pro O2M/M2M aliasy se naplní z /fields/{collection}
let DYNAMIC_SKIP = new Set();

async function loadAliasFields(collection) {
  const r = await api('GET', `/fields/${collection}`);
  const aliases = (r.data ?? []).filter((f) => {
    if (f.type === 'alias') return true;
    const special = f.meta?.special ?? [];
    return special.some((s) => ['o2m', 'm2m', 'm2a', 'no-data', 'alias'].includes(s));
  });
  for (const f of aliases) DYNAMIC_SKIP.add(f.field);
}

function stripFields(obj) {
  const clean = { ...obj };
  for (const f of STATIC_SKIP) delete clean[f];
  for (const f of DYNAMIC_SKIP) delete clean[f];
  return clean;
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Duplicate model_year + trims + packages');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  // Load schema — detekuj O2M aliasy aby se nezapočítaly do payloadu
  // (BUG fix: bez tohoto by Directus přepoint trimy/pakety ze zdroje na cíl)
  await loadAliasFields('model_years');
  info(`Aliasy v model_years (skip při copy): ${[...DYNAMIC_SKIP].join(', ') || 'žádné'}\n`);

  // 1) List dostupných model_years
  console.log('Krok 1: Seznam dostupných modelových roků\n');
  const years = await api('GET', '/items/model_years?limit=200&fields=id,year,version,model.id,model.name,model.slug&sort=model.name,year');

  const list = years.data.map((y, i) => ({
    index: i + 1,
    id: y.id,
    modelId: y.model?.id,
    modelName: y.model?.name ?? '?',
    modelSlug: y.model?.slug ?? '?',
    year: y.year,
    version: y.version ?? '',
    label: `${y.model?.name ?? '?'} ${y.year}${y.version ? ' ' + y.version : ''}`,
  }));

  list.forEach((y) => console.log(`  ${String(y.index).padStart(2)})  ${y.label}`));

  console.log('');
  const srcIndexStr = (await prompt('Vyber zdrojový model_year [číslo]: ')).trim();
  const srcIndex = parseInt(srcIndexStr, 10);
  if (isNaN(srcIndex) || srcIndex < 1 || srcIndex > list.length) {
    console.log('Neplatná volba.');
    rl.close();
    return;
  }
  const src = list[srcIndex - 1];
  console.log(`\n  ✓  Zdroj: ${src.label} (id=${src.id})`);

  // 2) Cílový rok + version
  const targetYearStr = (await prompt(`Cílový rok pro nový ${src.modelName} [např. ${src.year - 1}]: `)).trim();
  const targetYear = parseInt(targetYearStr, 10);
  if (isNaN(targetYear)) {
    console.log('Neplatný rok.');
    rl.close();
    return;
  }
  const targetVersion = (await prompt(`Verze (volitelně, např. "H1", "H2", "v2"; pro prázdné stiskni Enter): `)).trim();

  // Zkontroluj, jestli už neexistuje (robust: empty string version je totéž co null)
  // Načteme VŠECHNY model_years pro daný model+rok a porovnáme v JS — bezpečnější než API filter
  const existingCheck = await api('GET', `/items/model_years?filter[model][_eq]=${src.modelId}&filter[year][_eq]=${targetYear}&limit=50&fields=id,year,version`);
  const verNorm = (v) => (v ?? '').trim();
  const matches = (existingCheck.data ?? []).filter((y) => verNorm(y.version) === verNorm(targetVersion));
  if (matches.length > 0) {
    console.log(`\n  ✗  ${src.modelName} ${targetYear}${targetVersion ? ' ' + targetVersion : ''} už existuje (id=${matches[0].id})`);
    console.log('     Pokud chceš upravit, otevři ho v adminu. Pokud chceš jinou verzi, zkus jiný version label.');
    console.log('     Nebo nejdřív spusť: node scripts/cleanup-duplicate-trims.mjs');
    rl.close();
    return;
  }

  // 3) Fetch full zdroj data
  console.log('\nKrok 2: Načítání zdrojových dat...\n');
  const srcFull = await api('GET', `/items/model_years/${src.id}?fields=*`);
  const srcTrims = await api('GET', `/items/trim_levels?filter[model_year][_eq]=${src.id}&limit=100&fields=*`);
  const srcPackages = await api('GET', `/items/option_packages?filter[model_year][_eq]=${src.id}&limit=100&fields=*`);

  console.log(`  Zdrojový model_year:  ${srcFull.data ? 'OK' : 'CHYBA'}`);
  console.log(`  Zdrojové trim_levels:    ${srcTrims.data.length}`);
  console.log(`  Zdrojové option_packages: ${srcPackages.data.length}`);

  // Potvrzení
  console.log(`\n  Budu kopírovat na: ${src.modelName} ${targetYear}${targetVersion ? ' ' + targetVersion : ''}`);
  const confirm = (await prompt(`Pokračovat? [Y/n]: `)).trim().toLowerCase();
  if (confirm === 'n' || confirm === 'no') {
    console.log('Aborted.');
    rl.close();
    return;
  }

  // 4) Vytvořit nový model_year
  console.log('\nKrok 3: Vytváření cílového model_year...');
  const newYearPayload = stripFields(srcFull.data);
  newYearPayload.year = targetYear;
  newYearPayload.version = targetVersion || null;
  // Pole 'model' zachováme (stejný model)

  const newYearCreated = await api('POST', '/items/model_years', newYearPayload);
  const newYearId = newYearCreated.data.id;
  ok(`Nový model_year vytvořen (id=${newYearId})`);

  // 5) Klonovat trim_levels
  console.log('\nKrok 4: Klonování trim_levels...');
  let clonedTrims = 0;
  for (const trim of srcTrims.data) {
    const trimPayload = stripFields(trim);
    trimPayload.model_year = newYearId;
    await api('POST', '/items/trim_levels', trimPayload);
    clonedTrims++;
    info(`  trim "${trim.name}" → ${src.modelName} ${targetYear}`);
  }
  ok(`${clonedTrims} trim_levels klonováno`);

  // 6) Klonovat option_packages
  console.log('\nKrok 5: Klonování option_packages...');
  let clonedPackages = 0;
  for (const pkg of srcPackages.data) {
    const pkgPayload = stripFields(pkg);
    pkgPayload.model_year = newYearId;
    await api('POST', '/items/option_packages', pkgPayload);
    clonedPackages++;
    info(`  paket "${pkg.name}" → ${src.modelName} ${targetYear}`);
  }
  ok(`${clonedPackages} option_packages klonováno`);

  console.log('\n═══════════════════════════════════════════════');
  console.log(`  ✓ Hotovo!`);
  console.log(`  `);
  console.log(`  Nový model_year: ${src.modelName} ${targetYear}${targetVersion ? ' ' + targetVersion : ''}`);
  console.log(`  ID:              ${newYearId}`);
  console.log(`  Klonováno:       ${clonedTrims} trims, ${clonedPackages} packages`);
  console.log('  ');
  console.log('  V adminu → Modely → ' + src.modelName + ' → Modelové roky');
  console.log('  Klikni na nový rok → uprav co potřebuješ (ceny, výbava, atd.)');
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
