#!/usr/bin/env node
/**
 * SFR Motor — Cascading dropdown filtry + display templates na stock_vehicles.
 *
 * Full cascade: brand → model → model_year → (trim_level + option_packages)
 *
 * Co skript dělá:
 *   1) stock_vehicles.model       — filtr podle brand
 *   2) stock_vehicles.model_year  — filtr podle model + správný display template
 *   3) stock_vehicles.trim_level  — filtr podle model_year
 *   4) stock_vehicles.option_packages — filtr podle model_year
 *
 * Plus si volitelně sám aktualizuje meta.options.template aby ve výběru
 * a chip byla čitelná informace (např. "Korando 2026 H1" místo UUID).
 *
 * Použití:
 *   cd web && node scripts/setup-cascading-filters.mjs
 *
 * Idempotentní — můžeš spustit opakovaně.
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

async function patchField(collection, field, { filter, template, note } = {}) {
  const current = await api('GET', `/fields/${collection}/${field}`);
  const meta = current.data?.meta ?? {};
  const currentOptions = meta.options ?? {};

  const newOptions = { ...currentOptions };
  if (filter !== undefined) newOptions.filter = filter;
  if (template !== undefined) newOptions.template = template;

  const newMeta = { ...meta, options: newOptions };
  if (note !== undefined) newMeta.note = note;

  // Skip jen pokud nic se nemění
  const sameOptions = JSON.stringify(currentOptions) === JSON.stringify(newOptions);
  const sameNote = note === undefined || meta.note === note;
  if (sameOptions && sameNote) {
    info(`${collection}.${field} už správně nastaveno`);
    return;
  }

  await api('PATCH', `/fields/${collection}/${field}`, { meta: newMeta });
  ok(`${collection}.${field} updated`);
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Setup cascading filtry + display templates');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  // ============================================================
  // Pozn.: Directus 11 chce Mustache syntaxi {{field}} pro reference
  // na sourozenecké hodnoty ve formuláři (NIKOLIV $FIELDS.field — to je
  // legacy syntaxe, která se nevyhodnotí a vrátí prázdnou množinu).
  // Viz https://ctdevltd.com/directus-conditional-dropdowns/
  // ============================================================

  // ============================================================
  // 1) stock_vehicles.model — filtr podle brand
  // ============================================================
  console.log('Krok 1: stock_vehicles.model (filtr brand → model)');
  await patchField('stock_vehicles', 'model', {
    filter: { brand: { _eq: '{{brand}}' } },
    template: '{{name}} ({{brand.name}})',
    note: 'Model auta. Filtruje se podle vybrané značky — vyber nejdřív Brand.',
  });

  // ============================================================
  // 2) stock_vehicles.model_year — filtr podle model + display template
  // ============================================================
  console.log('\nKrok 2: stock_vehicles.model_year (filtr model → year)');
  await patchField('stock_vehicles', 'model_year', {
    filter: { model: { _eq: '{{model}}' } },
    template: '{{model.name}} {{year}} {{version}}',
    note: 'Modelový rok / verze ceníku. Filtruje se podle vybraného modelu — vyber nejdřív Model.',
  });

  // ============================================================
  // 3) stock_vehicles.trim_level — filtr podle model_year
  // ============================================================
  console.log('\nKrok 3: stock_vehicles.trim_level (filtr year → trim)');
  await patchField('stock_vehicles', 'trim_level', {
    filter: { model_year: { _eq: '{{model_year}}' } },
    template: '{{name}} ({{model_year.year}}{{model_year.version}})',
    note: 'Výbavový stupeň. Filtruje se podle vybraného Model year — vyber nejdřív rok.',
  });

  // ============================================================
  // 4) stock_vehicles.option_packages — filtr podle model_year (M2M alias)
  // ============================================================
  console.log('\nKrok 4: stock_vehicles.option_packages (filtr year → packages)');
  await patchField('stock_vehicles', 'option_packages', {
    filter: { model_year: { _eq: '{{model_year}}' } },
    template: '{{option_packages_id.name}}',
    note: 'Volitelné balíčky. Filtruje se podle Model year — vyber nejdřív rok.',
  });

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo. Postup v adminu:');
  console.log('  ───────────────────────────────────────────');
  console.log('  1) Ctrl+Shift+R (refresh, ať se schema cachuje)');
  console.log('  2) Stock Vehicles → Create item');
  console.log('  3) Vyber Brand (povinné, je to první v dropdownech)');
  console.log('  4) Model dropdown — ukáže jen modely té značky');
  console.log('  5) Vyber Model year (filtr podle modelu)');
  console.log('  6) Vyber Trim level + Option packages (filtr podle roku)');
  console.log('');
  console.log('  POZOR: Když změníš výběr výše, dolní hodnoty se NEresetují.');
  console.log('  Pokud např. změníš Model, musíš si Model year přepnout ručně.');
  console.log('');
  console.log('  POZN. k pickeru: Pokud se v dropdownu Model year stále zobrazují');
  console.log('  rozházené sloupce (Brochure PDF, Technical Data atd.), je to');
  console.log('  per-user uložená Layout preference. Klikni v draweru na Layout');
  console.log('  Options (ikona vlevo dole) → změň visible columns na "model",');
  console.log('  "year", "version". Uloží se to v user prefs.');
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
