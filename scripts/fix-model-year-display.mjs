#!/usr/bin/env node
/**
 * Patch display templates aby model_year a trim_level v admin dropdownu
 * ukazovaly čitelné jméno místo holého roku / názvu trimu.
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

async function patchField(coll, field, template) {
  const cur = await api('GET', `/fields/${coll}/${field}`);
  const oldMeta = cur?.data?.meta ?? {};
  const oldOptions = oldMeta.options ?? {};
  await api('PATCH', `/fields/${coll}/${field}`, {
    meta: {
      ...oldMeta,
      display: 'related-values',
      display_options: { template },
      options: { ...oldOptions, template },
    },
  });
  console.log(`✅  ${coll}.${field} → "${template}"`);
}

async function patchCollection(coll, displayTemplate) {
  try {
    await api('PATCH', `/collections/${coll}`, {
      meta: { display_template: displayTemplate },
    });
    console.log(`✅  collection ${coll} → display_template "${displayTemplate}"`);
  } catch (e) { console.log(`⚠️   ${coll}: ${e.message}`); }
}

async function main() {
  DIRECTUS_URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim() || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  const auth = await fetch(`${DIRECTUS_URL}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }).then(r => r.json());
  TOKEN = auth.data.access_token;
  console.log('✅ Auth OK\n');

  // Collection display templates (jak se zobrazuje název položky v list i picker)
  await patchCollection('model_years', '{{model.name}} {{year}}');
  await patchCollection('trim_levels', '{{model_year.model.name}} {{model_year.year}} — {{name}}');
  await patchCollection('option_packages', '{{model_year.model.name}} {{model_year.year}} — {{name}}');

  // Field display + options template (jak se zobrazuje hodnota M2O po výběru)
  await patchField('stock_vehicles', 'model_year', '{{model.name}} {{year}}');
  await patchField('stock_vehicles', 'trim_level', '{{name}} — {{list_price}} Kč');

  console.log('\nHotovo. Hard refresh adminu.');
  rl.close();
}
main().catch(e => { console.log(`❌ ${e.message}`); rl.close(); });
