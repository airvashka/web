#!/usr/bin/env node
/**
 * SFR Motor — přidá `package_items` JSON pole do trim_levels.
 *
 * Co skript dělá:
 *   Vytvoří field trim_levels.package_items typu json.
 *   Struktura: [{ name, package_code, package_name }, ...]
 *
 *   Příklad obsahu:
 *   [
 *     { "name": "Vyhřívaný volant", "package_code": "CLUB+", "package_name": "CLUB+ paket" },
 *     { "name": "Adaptivní LED světlomety", "package_code": "BLACK", "package_name": "BLACK paket" }
 *   ]
 *
 *   Tyto položky NEJSOU součástí výbavy daného trimu zdarma, ani je nejde
 *   dokoupit samostatně — jsou dostupné JEN jako součást uvedeného paketu.
 *   V matrici výbav se buňka pro tento trim vykreslí jako odznak s názvem paketu.
 *
 *   Vztah ke stávajícím polím trim_levels:
 *     features        → co je v ceně (✓)
 *     optional_items  → co lze dokoupit samostatně (cena)
 *     package_items   → co je dostupné jen v paketu (název paketu)  ← NOVÉ
 *
 * Idempotentní — pokud field existuje, jen info, nic nemění.
 *
 * Použití:
 *   cd web && node scripts/add-package-items-field.mjs
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
  console.log('  Add trim_levels.package_items (JSON)');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://sfr-motor-directus.onrender.com]: ')).trim()
    || 'https://sfr-motor-directus.onrender.com';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  if (await fieldExists('package_items')) {
    info('Field trim_levels.package_items už existuje. Nic neměním.');
    rl.close();
    return;
  }

  await api('POST', '/fields/trim_levels', {
    field: 'package_items',
    type: 'json',
    schema: { is_nullable: true, default_value: null },
    meta: {
      interface: 'list',
      width: 'full',
      sort: 51,
      special: ['cast-json'],
      note: 'Prvky dostupné pro tento trim JEN jako součást paketu (ne v ceně, ne samostatně dokoupitelné). Každá položka má `name`, `package_code` a `package_name`. V matrici výbav se zobrazí jako odznak s názvem paketu.',
      options: {
        template: '{{name}} → {{package_name}}',
        fields: [
          { field: 'name',         name: 'Prvek výbavy',  type: 'string', meta: { interface: 'input', width: 'full', required: true } },
          { field: 'package_code', name: 'Kód paketu',    type: 'string', meta: { interface: 'input', width: 'half' } },
          { field: 'package_name', name: 'Název paketu',  type: 'string', meta: { interface: 'input', width: 'half' } },
        ],
      },
    },
  });
  ok('Field trim_levels.package_items přidán');

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo. V adminu (Ctrl+Shift+R):');
  console.log('    Trim Levels → otevři libovolný trim → uvidíš nové pole "Package items"');
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
