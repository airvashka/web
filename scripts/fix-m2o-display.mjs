#!/usr/bin/env node
/**
 * SFR Motor — Fix M2O field display v list view
 *
 * V seznamech (např. Stock Vehicles) ukazují M2O fieldy holé číslo (FK ID)
 * místo jména související entity. Defaultní `display: 'raw'` nahradíme za
 * `display: 'related-values'` s template ukazujícím relevantní pole.
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

// [collection, field, related_template]
const FIXES = [
  ['stock_vehicles', 'brand',          '{{name}}'],
  ['stock_vehicles', 'model',          '{{name}}'],
  ['stock_vehicles', 'model_year',     '{{year}}'],
  ['stock_vehicles', 'trim_level',     '{{name}}'],
  ['stock_vehicles', 'branch',         '{{name}}'],

  ['models',         'brand',          '{{name}}'],
  ['models',         'sub_brand',      '{{name}}'],

  ['sub_brands',     'brand',          '{{name}}'],

  ['employees',      'branch',         '{{name}}'],

  ['model_years',    'model',          '{{name}}'],
  ['trim_levels',    'model_year',     '{{model.name}} {{year}}'],
  ['option_packages','model_year',     '{{model.name}} {{year}}'],

  ['leads',          'source_model',   '{{name}}'],
  ['leads',          'source_vehicle', '{{brand.name}} {{model.name}}'],
  ['leads',          'assignee',       '{{full_name}}'],
];

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('  SFR Motor — Fix M2O display v list view');
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

  for (const [collection, field, template] of FIXES) {
    try {
      // Načti aktuální meta (abychom nevymázli existující konfiguraci)
      const current = await api('GET', `/fields/${collection}/${field}`);
      const meta = current?.data?.meta ?? {};

      const patched = {
        ...meta,
        display: 'related-values',
        display_options: { template },
      };

      await api('PATCH', `/fields/${collection}/${field}`, {
        meta: patched,
      });
      console.log(`✅  ${collection}.${field} → "${template}"`);
    } catch (e) {
      if (e.status === 404) console.log(`⏭️   ${collection}.${field} (neexistuje)`);
      else console.log(`⚠️   ${collection}.${field}: ${e.message}`);
    }
  }

  console.log('');
  console.log('Hotovo. Hard refresh admin (Ctrl+Shift+R).');
  console.log('V Stock Vehicles list teď uvidíš "KGM" místo "1" a "Korando" místo "1".');
  rl.close();
}

main().catch((e) => { console.log(`❌ ${e.message}`); rl.close(); process.exit(1); });
