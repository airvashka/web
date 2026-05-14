#!/usr/bin/env node
/**
 * SFR Motor — SMAŽE legacy fieldy na `models` collection.
 *
 * Co skript dělá (DESTRUKTIVNÍ):
 *   Smaže (DELETE) v Directus schema tato pole:
 *     - models.technical_data    — kanonické místo je model_years.technical_data
 *     - models.brochure_pdf      — nepoužívané v kódu (multi přes model_documents)
 *     - models.price_list_pdf    — nepoužívané v kódu (multi přes model_documents)
 *
 *   Data v těchto sloupcích jsou ZTRACENA — Directus DROP COLUMN.
 *   Kontrola frontendu před spuštěním (provedeno):
 *     - models.technical_data: code má fallback na model_year.technical_data ✓
 *     - models.brochure_pdf:   nepoužívané v src/pages, jen v types.ts (cleanup později) ✓
 *     - models.price_list_pdf: nepoužívané v src/pages, jen v types.ts (cleanup později) ✓
 *
 * BEZPEČNOST:
 *   - Před každým DELETE skript ukáže preview a počká na "yes"
 *   - Při chybě (např. pole už neexistuje) jen warn, ne abort
 *
 * Použití:
 *   cd web && node scripts/hide-legacy-model-fields.mjs
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
const warn = (m) => console.log(`  ⚠  ${m}`);

const FIELDS_TO_DELETE = [
  {
    field: 'technical_data',
    reason: 'Kanonické místo: model_years.technical_data',
  },
  {
    field: 'brochure_pdf',
    reason: 'Legacy single-file, nepoužívané. Použij model_documents O2M.',
  },
  {
    field: 'price_list_pdf',
    reason: 'Legacy single-file, nepoužívané. Použij model_documents O2M.',
  },
];

async function deleteField(field, reason) {
  try {
    await api('GET', `/fields/models/${field}`);
  } catch (e) {
    warn(`Field models.${field} neexistuje (možná už smazaný). Skip.`);
    return false;
  }

  try {
    await api('DELETE', `/fields/models/${field}`);
    ok(`models.${field} SMAZÁNO — ${reason}`);
    return true;
  } catch (e) {
    warn(`Selhalo mazání models.${field}: ${e.message}`);
    return false;
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  SMAZAT legacy fieldy na models  (DESTRUKTIVNÍ)');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  console.log('Pole, která budou SMAZÁNA z collection "models":\n');
  for (const { field, reason } of FIELDS_TO_DELETE) {
    console.log(`  ✗  models.${field}`);
    console.log(`     → ${reason}`);
  }
  console.log('\n  ⚠  Data v těchto sloupcích budou ZTRACENA (DROP COLUMN).\n');

  const confirm = (await prompt('Potvrď smazání [yes/no]: ')).trim().toLowerCase();
  if (confirm !== 'yes' && confirm !== 'y') {
    console.log('Aborted. Nic se nesmazalo.');
    rl.close();
    return;
  }

  console.log('');
  let deleted = 0;
  for (const { field, reason } of FIELDS_TO_DELETE) {
    const did = await deleteField(field, reason);
    if (did) deleted++;
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log(`  Hotovo. Smazáno ${deleted}/${FIELDS_TO_DELETE.length} polí.`);
  console.log('');
  console.log('  V adminu (Ctrl+Shift+R):');
  console.log('    Modely → otevři libovolný model:');
  console.log('      - Technical Data — PRYČ');
  console.log('      - Brochure PDF — PRYČ');
  console.log('      - Price List PDF — PRYČ');
  console.log('');
  console.log('  Zůstává:');
  console.log('    - Documents O2M (multi-doc: brožury + ceníky)');
  console.log('    - Model Years inline (tam je per-rok Technical Data)');
  console.log('    - Color Exterior / Interior, Highlights, Akční nabídka');
  console.log('');
  console.log('  Doporučení: spusť `npm run build` — ověř, že web stále buildí.');
  console.log('═══════════════════════════════════════════════');

  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
