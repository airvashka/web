#!/usr/bin/env node
/**
 * SFR Motor — cleanup orphaned records v model_color_exterior/interior/highlights.
 *
 * Problém: po migraci některé records mají model = null. Directus pak při save
 * jakéhokoliv modelu validuje O2M children a hlásí "model: Value can't be null".
 *
 * Tento skript:
 *   1) Najde records kde model = null
 *   2) Vypíše je
 *   3) Nabídne smazání (potvrzení)
 *
 * Použití:
 *   cd web && node scripts/cleanup-orphaned-color-records.mjs
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

async function findOrphans(collection) {
  // Pro highlights je label "title", pro barvy "name"
  const labelField = collection === 'model_highlights' ? 'title' : 'name';
  const r = await api(
    'GET',
    `/items/${collection}?filter[model][_null]=true&limit=500&fields=id,${labelField}`
  );
  // Normalizuj label do "name" pro výpis
  return (r?.data ?? []).map((o) => ({ id: o.id, name: o[labelField] }));
}

async function deleteRecords(collection, ids) {
  if (ids.length === 0) return;
  // Bulk delete via DELETE /items/{collection} s body = array of ids
  await api('DELETE', `/items/${collection}`, ids);
  ok(`Smazáno ${ids.length} records z ${collection}`);
}

async function processCollection(collection) {
  console.log(`\n▸ ${collection}`);
  const orphans = await findOrphans(collection);
  if (orphans.length === 0) {
    info(`  Žádné orphans — clean`);
    return;
  }
  warn(`  Nalezeno ${orphans.length} orphaned records (model=null):`);
  for (const o of orphans) {
    console.log(`    id=${o.id}  name="${o.name ?? '(prázdné)'}"`);
  }

  const ids = orphans.map((o) => o.id);
  await deleteRecords(collection, ids);
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Cleanup orphaned color/highlight records');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK');

  // 1. Nejdřív scan a vypiš (ne mazat)
  console.log('\nKrok 1: Scan orphaned records');
  const exterior = await findOrphans('model_color_exterior');
  const interior = await findOrphans('model_color_interior');
  const highlights = await findOrphans('model_highlights');

  const total = exterior.length + interior.length + highlights.length;
  console.log(`\nNalezeno celkem ${total} orphaned records:`);
  console.log(`  model_color_exterior: ${exterior.length}`);
  console.log(`  model_color_interior: ${interior.length}`);
  console.log(`  model_highlights: ${highlights.length}`);

  if (total === 0) {
    ok('\nNic ke smazání — všechny records mají model nastaveno správně.');
    rl.close();
    return;
  }

  const confirm = (await prompt(`\nSmazat těchto ${total} orphaned records? [a/n]: `)).trim().toLowerCase();
  if (confirm !== 'a') {
    info('Zrušeno, nic nesmazáno.');
    rl.close();
    return;
  }

  console.log('\nKrok 2: Smazání');
  await processCollection('model_color_exterior');
  await processCollection('model_color_interior');
  await processCollection('model_highlights');

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo!');
  console.log('═══════════════════════════════════════════════');
  console.log('');
  console.log('V adminu Ctrl+Shift+R refresh. Pak Save modelu by měl projít.');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
