#!/usr/bin/env node
/**
 * SFR Motor — fix mazání trimů/paketů v inline O2M alias.
 *
 * Problem: V model_year editoru kliknu na delete u trim_level → chyba
 *   "model_year: Value can't be null", protože Directus se snaží nullify FK
 *   (relace je required).
 *
 * Fix: nastavit `meta.one_deselect_action: 'delete'` na M2O relaci
 *   trim_levels.model_year a option_packages.model_year.
 *   Pak místo nullify Directus skutečně smaže trim/package row.
 *
 * Idempotentní — pokud je už nastaveno na 'delete', skript nic nedělá.
 *
 * Použití:
 *   cd web && node scripts/fix-trim-package-cascade.mjs
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

async function fixRelation(collection, field) {
  console.log(`\n▶ Relace ${collection}.${field}`);
  const r = await api('GET', `/relations/${collection}/${field}`);
  const meta = r.data?.meta ?? {};
  if (meta.one_deselect_action === 'delete') {
    info(`Už je 'delete' — nic neměním`);
    return;
  }
  info(`Aktuální one_deselect_action: ${meta.one_deselect_action ?? '(nenastaveno = nullify)'}`);
  await api('PATCH', `/relations/${collection}/${field}`, {
    meta: { ...meta, one_deselect_action: 'delete' },
  });
  ok(`Nastaveno one_deselect_action = 'delete'`);
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Fix mazání trimů/paketů v O2M alias');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK');

  await fixRelation('trim_levels', 'model_year');
  await fixRelation('option_packages', 'model_year');

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo. V adminu (Ctrl+Shift+R):');
  console.log('    Modelové roky → otevři rok → klik delete u trimu/paketu');
  console.log('    Místo errror se trim/package skutečně smaže.');
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
