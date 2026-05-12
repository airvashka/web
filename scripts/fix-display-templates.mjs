#!/usr/bin/env node
/**
 * SFR Motor — Opraví display templates v adminu
 *
 * Stock_vehicles měly šablonu "{{model.name}} {{trim_level.name}} — {{color_code}}"
 * Když je trim_level null, zobrazuje "--" → ošklivé.
 * Nahradíme za fallback syntax co Directus podporuje.
 */

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rl = readline.createInterface({ input, output });
const prompt = (q) => rl.question(q);

let DIRECTUS_URL = '';
let TOKEN = '';

async function api(method, path, body) {
  const url = `${DIRECTUS_URL}${path}`;
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) {
    const e = new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json?.errors ?? json)}`);
    e.status = res.status; throw e;
  }
  return json;
}

const DISPLAY_TEMPLATES = {
  stock_vehicles: '{{brand.name}} {{model.name}} — {{vin}}',
  models: '{{name}}',
  brands: '{{name}}',
  sub_brands: '{{name}}',
  branches: '{{name}}',
  employees: '{{full_name}} ({{role}})',
  leads: '{{customer_name}} — {{form_type}}',
  trim_levels: '{{name}}',
  option_packages: '{{name}}',
  model_years: '{{model.name}} {{year}}',
};

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  SFR Motor — Fix display templates v adminu');
  console.log('═══════════════════════════════════════════════');
  console.log('');

  DIRECTUS_URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Admin email: ')).trim();
  const password = (await prompt('Admin heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth?.data?.access_token;
  console.log('✅ Auth OK');
  console.log('');

  for (const [collection, template] of Object.entries(DISPLAY_TEMPLATES)) {
    try {
      await api('PATCH', `/collections/${collection}`, {
        meta: { display_template: template },
      });
      console.log(`✅  ${collection} → "${template}"`);
    } catch (e) {
      console.log(`⚠️   ${collection}: ${e.message}`);
    }
  }

  console.log('');
  console.log('Hotovo. Refresh admin Ctrl+Shift+R.');
  rl.close();
}

main().catch((e) => { console.log(`❌ ${e.message}`); rl.close(); process.exit(1); });
