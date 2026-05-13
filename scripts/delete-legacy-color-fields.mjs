#!/usr/bin/env node
/**
 * SFR Motor — smazání legacy color_options + interior_options polí.
 *
 * Po refactoru jsme zavedli model_color_exterior + model_color_interior collections
 * s real M2O file pickerem. Starý JSON repeater (color_options / interior_options)
 * je teď duplicitní a admin matou.
 *
 * Mazat z:
 *   - models.color_options
 *   - models.interior_options
 *   - model_years.color_options
 *   - model_years.interior_options
 *
 * Použití:
 *   cd web && node scripts/delete-legacy-color-fields.mjs
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

async function dropField(collection, field) {
  if (!(await fieldExists(collection, field))) {
    info(`${collection}.${field} neexistuje, skipuji`);
    return;
  }
  await api('DELETE', `/fields/${collection}/${field}`);
  ok(`${collection}.${field} smazáno`);
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Delete legacy color/interior_options fields');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  await dropField('models', 'color_options');
  await dropField('models', 'interior_options');
  await dropField('model_years', 'color_options');
  await dropField('model_years', 'interior_options');

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo!');
  console.log('═══════════════════════════════════════════════');
  console.log('');
  console.log('V adminu (Ctrl+Shift+R refresh):');
  console.log('  models → libovolný model → uvidíš JEN:');
  console.log('  • Color Exterior (O2M — funkční file picker)');
  console.log('  • Color Interior (O2M — funkční file picker)');
  console.log('');
  console.log('Staré JSON pole "Color Options" / "Interior Options" zmizely.');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
