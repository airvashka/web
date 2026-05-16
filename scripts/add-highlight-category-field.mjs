#!/usr/bin/env node
/**
 * SFR Motor — přidá `category` enum field do model_highlights.
 *
 * Slouží k rozdělení highlights na 3 sekce na model detail stránce:
 *   - technologie (Technologie, max 4)
 *   - bezpecnost  (Bezpečnost, max 4)
 *   - komfort     (Komfort, max 4)
 *
 * Frontend pak renderuje 3 nezávislé pruhy, každý se 4 dark cards.
 *
 * Idempotentní. Pokud již existuje, nic nemění.
 *
 * Použití:
 *   cd "C:\Users\antos\Desktop\Claude\SFR WEB\SFR WEB\web"
 *   node scripts/add-highlight-category-field.mjs
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

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Add model_highlights.category (enum)');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  if (await fieldExists('model_highlights', 'category')) {
    info('model_highlights.category už existuje.');
    rl.close();
    return;
  }

  await api('POST', '/fields/model_highlights', {
    field: 'category',
    type: 'string',
    schema: { is_nullable: true, default_value: 'technologie' },
    meta: {
      interface: 'select-dropdown',
      width: 'half',
      sort: 2,
      note: 'Sekce na model detail stránce. Frontend zobrazí jako 3 oddělené pruhy (Technologie / Bezpečnost / Komfort), každý max 4 položky.',
      options: {
        choices: [
          { text: 'Technologie', value: 'technologie' },
          { text: 'Bezpečnost', value: 'bezpecnost' },
          { text: 'Komfort', value: 'komfort' },
        ],
      },
    },
  });
  ok('model_highlights.category přidán');

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo. V adminu (Ctrl+Shift+R):');
  console.log('    Models → Torres → Highlights → otevři položku → vyber Category');
  console.log('    Doporučeno: max 4 položky per kategorie (na frontendu se víc neukáže).');
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
