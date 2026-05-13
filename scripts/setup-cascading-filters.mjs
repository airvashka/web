#!/usr/bin/env node
/**
 * SFR Motor — Cascading dropdown filtry na stock_vehicles.
 *
 * Když admin přidá skladový vůz a vybere model_year (např. Korando 2024),
 * dropdown pro trim_level + option_packages se sám filtruje a ukáže
 * JEN trimy/pakety vázané na ten model_year.
 *
 * Bez tohohle filtru admin vidí všechny trimy všech modelů a roků dohromady
 * a musí trefovat ručně — což je matoucí a vedlo by k chybnému párování.
 *
 * Implementace: PATCH meta.options.filter na fields:
 *   - stock_vehicles.trim_level    (M2O)
 *   - stock_vehicles.option_packages (M2M alias)
 *
 * Filtr: { model_year: { _eq: "$FIELDS.model_year" } }
 *   "$FIELDS.model_year" = reference na sourozeneckou hodnotu v editovaném itemu
 *
 * Použití:
 *   cd web && node scripts/setup-cascading-filters.mjs
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

const CASCADE_FILTER = {
  model_year: { _eq: '$FIELDS.model_year' },
};

async function patchFieldFilter(collection, field, opts = {}) {
  const current = await api('GET', `/fields/${collection}/${field}`);
  const meta = current.data?.meta ?? {};
  const currentOptions = meta.options ?? {};

  // Merge — neztratíme existující options jako template, enableSelect atd.
  const newOptions = {
    ...currentOptions,
    filter: CASCADE_FILTER,
    ...opts,
  };

  // Skip pokud už je nastavené správně
  if (JSON.stringify(currentOptions.filter ?? null) === JSON.stringify(CASCADE_FILTER)) {
    info(`${collection}.${field} už má cascading filter`);
    return;
  }

  await api('PATCH', `/fields/${collection}/${field}`, {
    meta: { ...meta, options: newOptions },
  });
  ok(`${collection}.${field} → filter podle model_year`);
}

async function patchFieldNote(collection, field, note) {
  const current = await api('GET', `/fields/${collection}/${field}`);
  const meta = current.data?.meta ?? {};
  if (meta.note === note) return;
  await api('PATCH', `/fields/${collection}/${field}`, {
    meta: { ...meta, note },
  });
  ok(`${collection}.${field} → note updated`);
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Setup cascading dropdown filtry');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  console.log('Krok 1: stock_vehicles.trim_level (M2O)');
  await patchFieldFilter('stock_vehicles', 'trim_level');
  await patchFieldNote('stock_vehicles', 'trim_level',
    'Výbavový stupeň. Filtr se napojí na vybraný "Model year" výše — vyber napřed rok.');

  console.log('\nKrok 2: stock_vehicles.option_packages (M2M alias)');
  await patchFieldFilter('stock_vehicles', 'option_packages');
  await patchFieldNote('stock_vehicles', 'option_packages',
    'Volitelné balíčky. Filtruje se podle "Model year" — vyber napřed rok.');

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo. V adminu (Ctrl+Shift+R):');
  console.log('  stock_vehicles → editor:');
  console.log('    1) Vyber Model year (např. Korando 2026 H1)');
  console.log('    2) Dropdown "Trim level" ukáže jen trimy toho roku');
  console.log('    3) Dropdown "Option packages" také');
  console.log('');
  console.log('  POZOR: Pokud změníš Model year POTOM, co už máš vybraný trim,');
  console.log('  trim se sám neresetuje. Musíš si ho překliknout ručně.');
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
