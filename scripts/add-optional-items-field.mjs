#!/usr/bin/env node
/**
 * SFR Motor — přidá `optional_items` JSON pole do trim_levels.
 *
 * Co skript dělá:
 *   Vytvoří field trim_levels.optional_items typu json.
 *   Struktura: [{ name, code?, price }, ...]
 *
 *   Příklad obsahu:
 *   [
 *     { "name": "Pohon všech kol (AWD)", "code": "PCA/TS7", "price": 49900 },
 *     { "name": "6st. AT AISIN převodovka", "code": "PT6/E11", "price": 52900 },
 *     { "name": "Panoramatická střecha", "code": "ISN", "price": 29900 }
 *   ]
 *
 *   Tyto položky jsou dokoupitelné k danému trimu. Cena v Kč.
 *   Pakety zůstávají v option_packages (separátní).
 *
 * Idempotentní — pokud field existuje, jen info, nic nemění.
 *
 * Použití:
 *   cd web && node scripts/add-optional-items-field.mjs
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

async function fieldExists(field) {
  try { await api('GET', `/fields/trim_levels/${field}`); return true; } catch { return false; }
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Add trim_levels.optional_items (JSON)');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  if (await fieldExists('optional_items')) {
    info('Field trim_levels.optional_items už existuje. Nic neměním.');
    rl.close();
    return;
  }

  await api('POST', '/fields/trim_levels', {
    field: 'optional_items',
    type: 'json',
    schema: { is_nullable: true, default_value: null },
    meta: {
      interface: 'list',
      width: 'full',
      sort: 50,
      special: ['cast-json'],
      note: 'Dokoupitelné položky k tomuto trimu. Každá položka má `name`, volitelně `code`, a `price` v Kč. Generuje se z ceníku (řádky kde je v sloupci tohoto trimu cena místo S).',
      options: {
        template: '{{name}} — {{price}} Kč',
        fields: [
          { field: 'name',  name: 'Název', type: 'string', meta: { interface: 'input', width: 'full', required: true } },
          { field: 'code',  name: 'Kód (volitelně)', type: 'string', meta: { interface: 'input', width: 'half' } },
          { field: 'price', name: 'Cena (Kč)', type: 'integer', meta: { interface: 'input', width: 'half', required: true } },
        ],
      },
    },
  });
  ok('Field trim_levels.optional_items přidán');

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo. V adminu (Ctrl+Shift+R):');
  console.log('    Trim Levels → otevři libovolný trim → uvidíš nové pole "Optional items"');
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
