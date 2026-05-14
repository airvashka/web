#!/usr/bin/env node
/**
 * SFR Motor — SMAŽE legacy single-file PDF fieldy na `model_years` collection.
 *
 * Co skript dělá (DESTRUKTIVNÍ):
 *   Smaže (DELETE) v Directus schema:
 *     - model_years.brochure_pdf      — single-file legacy
 *     - model_years.price_list_pdf    — single-file legacy
 *
 *   Kanonické místo pro brožury + ceníky = `models.documents` O2M
 *   (multi-document, každý záznam: title + file + type).
 *
 *   `model_years.technical_data` se NEMAŽE — tam patří per-rok specs.
 *
 * Kontrola frontendu (provedeno):
 *   - Žádná stránka v src/pages nečte model_year.brochure_pdf
 *   - Žádná stránka v src/pages nečte model_year.price_list_pdf
 *   - types.ts má _url varianty (legacy typové definice, neškodí)
 *
 * BEZPEČNOST:
 *   - Vyžaduje "yes" potvrzení
 *   - Při chybě (pole neexistuje) jen warn, nepřerušuje
 *
 * Použití:
 *   cd web && node scripts/delete-legacy-year-fields.mjs
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
const warn = (m) => console.log(`  ⚠  ${m}`);

const FIELDS_TO_DELETE = [
  { field: 'brochure_pdf', reason: 'Použij model.documents O2M (multi PDF per model)' },
  { field: 'price_list_pdf', reason: 'Použij model.documents O2M (multi PDF per model)' },
];

async function deleteField(field, reason) {
  try {
    await api('GET', `/fields/model_years/${field}`);
  } catch {
    warn(`Field model_years.${field} neexistuje. Skip.`);
    return false;
  }
  try {
    await api('DELETE', `/fields/model_years/${field}`);
    ok(`model_years.${field} SMAZÁNO — ${reason}`);
    return true;
  } catch (e) {
    warn(`Selhalo: ${e.message}`);
    return false;
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  SMAZAT legacy PDF fieldy na model_years');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  console.log('Pole, která budou SMAZÁNA z "model_years":\n');
  for (const { field, reason } of FIELDS_TO_DELETE) {
    console.log(`  ✗  model_years.${field}`);
    console.log(`     → ${reason}`);
  }
  console.log('\n  ✓  Zachováno: model_years.technical_data (per-rok specs)');
  console.log('\n  ⚠  DROP COLUMN — pokud bys měl/a v tomto poli nějaká data, ztratí se.\n');

  const confirm = (await prompt('Potvrď smazání [yes/no]: ')).trim().toLowerCase();
  if (confirm !== 'yes' && confirm !== 'y') {
    console.log('Aborted.');
    rl.close();
    return;
  }

  console.log('');
  let deleted = 0;
  for (const { field, reason } of FIELDS_TO_DELETE) {
    if (await deleteField(field, reason)) deleted++;
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log(`  Hotovo. Smazáno ${deleted}/${FIELDS_TO_DELETE.length} polí.`);
  console.log('');
  console.log('  V adminu (Ctrl+Shift+R):');
  console.log('    Modelové roky → editor:');
  console.log('      - Brochure PDF — PRYČ');
  console.log('      - Price List PDF — PRYČ');
  console.log('    Zůstává: Technical Data (per-rok)');
  console.log('');
  console.log('    Dokumenty (brožury + ceníky) řeš v: Modely → konkrétní model → Documents');
  console.log('═══════════════════════════════════════════════');

  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
