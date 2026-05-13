#!/usr/bin/env node
/**
 * SFR Motor — migrace brochure_file + price_list_file z model_years na models.
 *
 * Brožura + ceník jsou marketing dokumenty, ne rok-specifická data.
 * Admin si chce najít upload přímo u modelu, ne za rok.
 *
 * Kroky:
 *   1) Vytvoří models.brochure_file (M2O directus_files)
 *   2) Vytvoří models.price_list_file (M2O directus_files)
 *   3) Pro každý model: zkopíruje hodnoty z latest model_year
 *   4) Astro priorita: models.{brochure,price_list}_file > latestYear.* (legacy fallback)
 *
 * NEMAŽE staré fieldy na model_years — slouží jako legacy fallback (a year-archive).
 *
 * Použití:
 *   cd web && node scripts/migrate-pdfs-to-models.mjs
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
const warn = (m) => console.log(`  ⚠  ${m}`);

async function fieldExists(collection, field) {
  try { await api('GET', `/fields/${collection}/${field}`); return true; } catch { return false; }
}

async function ensureFileField(collection, field, label, note) {
  if (await fieldExists(collection, field)) {
    info(`${collection}.${field} už existuje`);
    return;
  }
  await api('POST', `/fields/${collection}`, {
    field,
    type: 'uuid',
    schema: { foreign_key_table: 'directus_files', is_nullable: true },
    meta: {
      interface: 'file',
      special: ['file'],
      note,
      display: 'file',
      width: 'half',
      sort: 250,
    },
  });
  await api('POST', '/relations', {
    collection,
    field,
    related_collection: 'directus_files',
    schema: { on_delete: 'SET NULL' },
  });
  ok(`${collection}.${field} field + relation vytvořeno`);
}

async function findAllModels() {
  const r = await api('GET', '/items/models?limit=200&fields=id,slug,name,brochure_file,price_list_file');
  return r?.data ?? [];
}

async function findLatestModelYear(modelId) {
  const r = await api('GET', `/items/model_years?filter[model][_eq]=${modelId}&sort=-year&limit=1&fields=id,year,brochure_file,price_list_file`);
  return r?.data?.[0] ?? null;
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Migrace PDF: model_years → models');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  // 1) Schema
  console.log('Krok 1: Schema');
  await ensureFileField('models', 'brochure_file', 'Brožura PDF', 'Brožura modelu ke stažení. Nahraj PDF, na webu se zobrazí tlačítko "Stáhnout brožuru".');
  await ensureFileField('models', 'price_list_file', 'Ceník PDF', 'Aktuální ceník modelu. Nahraj PDF, na webu se zobrazí tlačítko "Stáhnout ceník".');
  console.log('');

  // 2) Copy z latest model_year
  console.log('Krok 2: Kopírování dat z latest model_year');
  const models = await findAllModels();
  let copied = 0, skipped = 0;

  for (const m of models) {
    const my = await findLatestModelYear(m.id);
    if (!my) { warn(`${m.slug}: žádný model_year`); skipped++; continue; }

    const patch = {};
    if (!m.brochure_file && my.brochure_file) patch.brochure_file = my.brochure_file;
    if (!m.price_list_file && my.price_list_file) patch.price_list_file = my.price_list_file;

    if (Object.keys(patch).length === 0) {
      info(`${m.slug}: nic ke zkopírování (model už má svoje, nebo latest year nemá)`);
      skipped++;
      continue;
    }

    try {
      await api('PATCH', `/items/models/${m.id}`, patch);
      const fields = Object.keys(patch).join(', ');
      ok(`${m.slug}: ${fields} zkopírováno z my${my.year}`);
      copied++;
    } catch (e) {
      warn(`${m.slug}: PATCH selhal — ${e.message}`);
    }
  }
  console.log('');

  console.log('═══════════════════════════════════════════════');
  console.log(`  Hotovo. Copied: ${copied}, Skipped: ${skipped}`);
  console.log('═══════════════════════════════════════════════');
  console.log('');
  console.log('V adminu Directus (Ctrl+Shift+R refresh):');
  console.log('  models → otevři libovolný model →');
  console.log('  • "Brochure File" — file picker (PDF brožura)');
  console.log('  • "Price List File" — file picker (PDF ceník)');
  console.log('');
  console.log('Klient si v adminu rovnou nahraje aktuální verzi.');
  console.log('Webhook + Vercel rebuild → tlačítka "Stáhnout brožuru/ceník"');
  console.log('na /model/{slug} se hned objeví.\n');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
