#!/usr/bin/env node
/**
 * SFR Motor — smazat legacy fieldy models.brochure_file + models.price_list_file
 *
 * Po migraci do model_documents O2M collection jsou tyto staré single-file
 * fieldy nepotřebné, ale stále zaclání v adminu.
 *
 * Skript:
 *   1) Ověří, že každý model má documents records (nebo žádné PDF nebyly)
 *   2) Smaže pole models.brochure_file
 *   3) Smaže pole models.price_list_file
 *   4) Stejné na model_years (pro jistotu)
 *
 * Použití:
 *   cd web && node scripts/delete-legacy-document-fields.mjs
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
  if (!r.ok) {
    const err = new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(j?.errors ?? j)}`);
    err.status = r.status;
    throw err;
  }
  return j;
}

const ok = (m) => console.log(`  ✓  ${m}`);
const info = (m) => console.log(`  ℹ  ${m}`);
const warn = (m) => console.log(`  ⚠  ${m}`);

async function fieldExists(collection, field) {
  try { await api('GET', `/fields/${collection}/${field}`); return true; } catch { return false; }
}

async function deleteFieldSafe(collection, field) {
  if (!(await fieldExists(collection, field))) {
    info(`${collection}.${field} už neexistuje, skip`);
    return;
  }
  try {
    await api('DELETE', `/fields/${collection}/${field}`);
    ok(`${collection}.${field} smazáno`);
  } catch (e) {
    warn(`${collection}.${field} smazání selhalo: ${e.message}`);
  }
}

async function safetyCheck() {
  console.log('Krok 1: Safety check — kolik modelů má staré brochure_file/price_list_file,');
  console.log('         a kolik z nich už má nové documents records:\n');

  const models = await api('GET', '/items/models?limit=200&fields=id,slug,name,brochure_file,price_list_file');

  let withLegacy = 0, withDocs = 0, orphan = 0;
  const orphanModels = [];

  for (const m of models.data) {
    if (!m.brochure_file && !m.price_list_file) continue;
    withLegacy++;

    const docs = await api('GET', `/items/model_documents?filter[model][_eq]=${m.id}&limit=1&fields=id`);
    if (docs.data?.length > 0) {
      withDocs++;
    } else {
      orphan++;
      orphanModels.push(`${m.slug} (id=${m.id})`);
    }
  }

  console.log(`  Modelů se starými fieldy:           ${withLegacy}`);
  console.log(`  Z toho už mají documents records:   ${withDocs}`);
  console.log(`  Orphan (mají starý ale ne nový):    ${orphan}`);
  if (orphanModels.length > 0) {
    console.log(`\n  ⚠  ORPHAN modely:`);
    orphanModels.forEach((m) => console.log(`     - ${m}`));
    console.log(`\n  Tyto modely PŘIJDOU O brožuru/ceník po smazání fieldů.`);
    console.log(`  Doporučuju nejdřív znovu spustit setup-model-documents.mjs (idempotentní migrace).`);
  }
  console.log('');
  return { withLegacy, orphan };
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Smazat legacy brochure_file + price_list_file');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  const check = await safetyCheck();

  if (check.orphan > 0) {
    const ans = (await prompt(`Pokračovat i s ${check.orphan} orphan modely? [y/N]: `)).trim().toLowerCase();
    if (ans !== 'y' && ans !== 'yes') {
      console.log('Aborted.');
      rl.close();
      return;
    }
  } else {
    const ans = (await prompt(`Smazat fieldy ${check.withLegacy === 0 ? '(nic ke kontrole, jen čistka)' : ''}? [Y/n]: `)).trim().toLowerCase();
    if (ans === 'n' || ans === 'no') {
      console.log('Aborted.');
      rl.close();
      return;
    }
  }

  console.log('\nKrok 2: Mazání fieldů\n');
  await deleteFieldSafe('models', 'brochure_file');
  await deleteFieldSafe('models', 'price_list_file');
  await deleteFieldSafe('model_years', 'brochure_file');
  await deleteFieldSafe('model_years', 'price_list_file');

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo. V adminu (Ctrl+Shift+R):');
  console.log('  models → editor — staré "Brochure File" + "Price List File" pole pryč');
  console.log('  Zůstává jen "Documents" O2M list.');
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
