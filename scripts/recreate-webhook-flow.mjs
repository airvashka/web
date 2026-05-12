#!/usr/bin/env node
/**
 * Smaže a znovu vytvoří Flow "Rebuild Vercel on content change".
 * Použij když Flow vypadá v admin OK, ale fakticky nestřílí webhooky.
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

const FLOW_NAME = 'Rebuild Vercel on content change';
const COLLECTIONS = [
  'brands', 'sub_brands', 'models', 'model_years', 'trim_levels',
  'option_packages', 'stock_vehicles', 'branches', 'employees',
  'stock_vehicles_option_packages', 'stock_vehicles_files', 'models_files',
];

async function main() {
  DIRECTUS_URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim() || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  const hookUrl = (await prompt('Vercel Deploy Hook URL [https://api.vercel.com/v1/integrations/deploy/prj_Ke3n3oavHZpNMsb3W9HG76g8zdxJ/xoHCw08okC]: ')).trim() || 'https://api.vercel.com/v1/integrations/deploy/prj_Ke3n3oavHZpNMsb3W9HG76g8zdxJ/xoHCw08okC';

  const auth = await fetch(`${DIRECTUS_URL}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }).then(r => r.json());
  TOKEN = auth.data.access_token;
  console.log('✅ Auth OK\n');

  // Smaž existující Flow
  const existing = await api('GET', `/flows?filter[name][_eq]=${encodeURIComponent(FLOW_NAME)}&limit=1`);
  const oldFlow = existing?.data?.[0];
  if (oldFlow) {
    console.log(`Mažu starý Flow ${oldFlow.id}...`);
    await api('DELETE', `/flows/${oldFlow.id}`);
    console.log('✅ Smazán\n');
  }

  // Vytvoř nový
  console.log('Vytvářím nový Flow...');
  const flowRes = await api('POST', '/flows', {
    name: FLOW_NAME,
    icon: 'rocket_launch',
    color: '#1976D2',
    description: 'Auto-rebuild Vercel webu při změně obsahu',
    status: 'active',
    trigger: 'event',
    accountability: 'all',
    options: {
      type: 'action',
      scope: ['items.create', 'items.update', 'items.delete'],
      collections: COLLECTIONS,
    },
  });
  const flow = flowRes.data;
  console.log(`✅ Flow ${flow.id}\n`);

  // Operation
  console.log('Vytvářím Operation...');
  const opRes = await api('POST', '/operations', {
    name: 'Vercel rebuild',
    key: 'vercel_rebuild',
    type: 'request',
    position_x: 19,
    position_y: 1,
    options: { url: hookUrl, method: 'POST', headers: [], body: '' },
    flow: flow.id,
  });
  const operation = opRes.data;
  console.log(`✅ Operation ${operation.id}\n`);

  await api('PATCH', `/flows/${flow.id}`, { operation: operation.id });
  console.log('✅ Flow ↔ Operation propojeno\n');

  console.log('Hotovo. Otestuj — uprav cokoliv v adminu a Save, Vercel by měl rebuilden.');
  rl.close();
}
main().catch(e => { console.log(`❌ ${e.message}`); rl.close(); });
