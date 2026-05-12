#!/usr/bin/env node
/**
 * Doplní junction tabulky do watched scope Flow "Rebuild Vercel on content change".
 * Bez tohoto se neaktivuje rebuild při změně M2M (přiřazení packetu k vozu, upload fotky).
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
const rl = readline.createInterface({ input, output });
const prompt = (q) => rl.question(q);

let DIRECTUS_URL = '', TOKEN = '';
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${DIRECTUS_URL}${path}`, opts);
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(j?.errors ?? j)}`);
  return j;
}

const WATCH_COLLECTIONS = [
  'brands', 'sub_brands', 'models', 'model_years', 'trim_levels',
  'option_packages', 'stock_vehicles', 'branches', 'employees',
  // Junction tabulky (M2M)
  'stock_vehicles_option_packages',
  'stock_vehicles_files',
  'models_files',
];

async function main() {
  DIRECTUS_URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim() || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  const auth = await fetch(`${DIRECTUS_URL}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }).then(r => r.json());
  TOKEN = auth.data.access_token;
  console.log('✅ Auth OK\n');

  const flows = await api('GET', '/flows?filter[name][_eq]=Rebuild Vercel on content change&limit=1');
  const flow = flows?.data?.[0];
  if (!flow) {
    console.log('❌ Flow nenalezen. Spusť nejdřív setup-directus-webhook.mjs.');
    rl.close(); return;
  }

  await api('PATCH', `/flows/${flow.id}`, {
    options: {
      type: 'action',
      scope: ['items.create', 'items.update', 'items.delete'],
      collections: WATCH_COLLECTIONS,
    },
  });
  console.log(`✅  Flow ${flow.id} aktualizován — sleduje ${WATCH_COLLECTIONS.length} kolekcí včetně junctions.`);
  rl.close();
}
main().catch(e => { console.log(`❌ ${e.message}`); rl.close(); });
