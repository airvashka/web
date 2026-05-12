#!/usr/bin/env node
/**
 * Workaround: vypne cascading filters (pro případ že syntax filteru nefunguje).
 * Po vypnutí admin ukáže všechny modely / všechny ModelYears / všechny Trims
 * ve všech dropdownech — funguje (ale chce pozornost při výběru).
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

const FIELDS = [
  ['stock_vehicles', 'model'],
  ['stock_vehicles', 'model_year'],
  ['stock_vehicles', 'trim_level'],
  ['models', 'sub_brand'],
];

async function main() {
  DIRECTUS_URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim() || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  const auth = await fetch(`${DIRECTUS_URL}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }).then(r => r.json());
  TOKEN = auth.data.access_token;

  for (const [coll, field] of FIELDS) {
    try {
      const cur = await api('GET', `/fields/${coll}/${field}`);
      const oldMeta = cur?.data?.meta ?? {};
      const oldOptions = { ...(oldMeta.options ?? {}) };
      delete oldOptions.filter;
      await api('PATCH', `/fields/${coll}/${field}`, { meta: { ...oldMeta, options: oldOptions } });
      console.log(`✅  ${coll}.${field} — filter odstraněn`);
    } catch (e) { console.log(`⚠️   ${coll}.${field}: ${e.message}`); }
  }
  rl.close();
}
main().catch(e => { console.log(`❌ ${e.message}`); rl.close(); });
