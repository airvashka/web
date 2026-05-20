#!/usr/bin/env node
/**
 * SFR Motor — prida presentation-divider "Skladove vozy - spolecne karty"
 * tesne NAD pole site_settings.stock_highlights, aby bylo jasne, ze ty karty
 * patri na detail skladovych vozu (ne globalni web nastaveni).
 *
 * Idempotentni. Pouziti:  cd web && node scripts/add-stock-highlights-divider.mjs
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
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${JSON.stringify(j?.errors ?? j)}`);
  return j;
}
const ok = (m) => console.log(`  [ok]  ${m}`);
const info = (m) => console.log(`  [i]   ${m}`);

const DIVIDER = '_stock_highlights_divider';

async function main() {
  console.log('\n=== Add divider nad stock_highlights (site_settings) ===\n');
  URL = (await prompt('Directus URL [https://sfr-motor-directus.onrender.com]: ')).trim()
    || 'https://sfr-motor-directus.onrender.com';
  const email = (await prompt('Admin email: ')).trim();
  const password = (await prompt('Admin heslo: ')).trim();
  console.log('');
  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  // existuje uz divider?
  try { await api('GET', `/fields/site_settings/${DIVIDER}`); info('Divider uz existuje - nic nedelam.'); rl.close(); return; }
  catch { /* neexistuje, pokracuj */ }

  // zjisti sort u stock_highlights
  const all = await api('GET', '/fields/site_settings');
  const fields = all.data ?? [];
  const sh = fields.find((f) => f.field === 'stock_highlights');
  if (!sh) { console.error('Pole stock_highlights nenalezeno.'); process.exit(1); }
  const S = (sh.meta && typeof sh.meta.sort === 'number') ? sh.meta.sort : 50;

  // udelej misto: posun vse se sort >= S o 1 nahoru
  for (const f of fields) {
    if (f.meta && typeof f.meta.sort === 'number' && f.meta.sort >= S) {
      await api('PATCH', `/fields/site_settings/${f.field}`, { meta: { sort: f.meta.sort + 1 } });
    }
  }

  // vytvor divider na puvodni pozici S
  await api('POST', '/fields/site_settings', {
    field: DIVIDER,
    type: 'alias',
    schema: null,
    meta: {
      interface: 'presentation-divider',
      special: ['alias', 'no-data'],
      width: 'full',
      sort: S,
      options: { title: 'Skladove vozy - spolecne karty', icon: 'directions_car',
        color: '#F25C1B' },
    },
  });
  ok(`Divider pridan nad stock_highlights (sort ${S}).`);
  console.log('\n=== Hotovo. V adminu (Ctrl+Shift+R): Nastaveni webu -> nad "Stock Highlights" je ted nadpis. ===\n');
  rl.close();
}

main().catch((e) => { console.error(`X ${e.message}`); rl.close(); process.exit(1); });
