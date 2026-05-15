#!/usr/bin/env node
/**
 * SFR Motor — přidá `code` + `pricing_per_trim` do barev (model_color_exterior + model_color_interior).
 *
 * Field `code` (string)        — kód barvy z ceníku (např. "WAA", "ADE", "2DE (E22B)")
 * Field `pricing_per_trim` (json) — ceny per trim slug, např. { "club": 14900, "style": 14900, "premium": 14900 }
 *                                  Pokud je cena stejná pro všechny trimy, klíče se opakují.
 *
 * Idempotentní.
 *
 * Použití:
 *   cd web && node scripts/add-color-cenik-fields.mjs
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

async function fieldExists(col, field) {
  try { await api('GET', `/fields/${col}/${field}`); return true; } catch { return false; }
}

async function addCode(collection) {
  if (await fieldExists(collection, 'code')) {
    info(`${collection}.code už existuje`);
    return;
  }
  await api('POST', `/fields/${collection}`, {
    field: 'code',
    type: 'string',
    schema: { is_nullable: true },
    meta: {
      interface: 'input',
      width: 'half',
      sort: 5,
      note: 'Kód barvy z ceníku (např. "WAA", "ADE", "2DE (E22B)").',
    },
  });
  ok(`${collection}.code přidán`);
}

async function addPricingPerTrim(collection) {
  if (await fieldExists(collection, 'pricing_per_trim')) {
    info(`${collection}.pricing_per_trim už existuje`);
    return;
  }
  await api('POST', `/fields/${collection}`, {
    field: 'pricing_per_trim',
    type: 'json',
    schema: { is_nullable: true, default_value: null },
    meta: {
      interface: 'list',
      width: 'full',
      sort: 30,
      special: ['cast-json'],
      note: 'Ceny barvy per trim slug. Klíče = lowercase trim names (např. "club", "style", "premium"). Hodnoty = cena v Kč jako integer.',
      options: {
        template: '{{trim_slug}}: {{price}} Kč',
        fields: [
          { field: 'trim_slug', name: 'Trim slug', type: 'string', meta: { interface: 'input', width: 'half', required: true, options: { placeholder: 'club, style, premium, select, exclusive...' } } },
          { field: 'price', name: 'Cena (Kč)', type: 'integer', meta: { interface: 'input', width: 'half', required: true, options: { placeholder: '14900' } } },
        ],
      },
    },
  });
  ok(`${collection}.pricing_per_trim přidán`);
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Add color code + pricing_per_trim fields');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  await addCode('model_color_exterior');
  await addPricingPerTrim('model_color_exterior');
  await addCode('model_color_interior');
  await addPricingPerTrim('model_color_interior');

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo. V adminu (Ctrl+Shift+R):');
  console.log('    Models → Torres → Color exterior → uvidíš code + pricing_per_trim');
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
