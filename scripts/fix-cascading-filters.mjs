#!/usr/bin/env node
/**
 * SFR Motor — Cascading filters v adminu
 *
 * Když admin přidává skladový vůz:
 *   1. Vybere Brand (např. KGM)
 *   2. Model dropdown ukáže JEN KGM modely (filtruje podle Brand)
 *   3. ModelYear dropdown ukáže JEN Korando years (filtruje podle Model)
 *   4. TrimLevel dropdown ukáže JEN Korando 2026 trims (filtruje podle ModelYear)
 *
 * Directus to umí přes meta.options.filter s referencí $FIELDS.x — odkazuje na
 * hodnotu jiného fieldu v aktuálním formu.
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

const ok = (m) => console.log(`✅  ${m}`);
const warn = (m) => console.log(`⚠️   ${m}`);

// [collection, field, options]
const CASCADES = [
  // ─── stock_vehicles ────────────────────────────────
  {
    collection: 'stock_vehicles',
    field: 'model',
    template: '{{name}}',
    filter: { brand: { _eq: '$CURRENT_ITEM.brand' } },
    note: 'Filtruje podle vybrané značky',
  },
  {
    collection: 'stock_vehicles',
    field: 'model_year',
    template: '{{model.name}} — {{year}}',
    filter: { model: { _eq: '$FIELDS.model' } },
    note: 'Filtruje podle vybraného modelu',
  },
  {
    collection: 'stock_vehicles',
    field: 'trim_level',
    template: '{{name}} — {{list_price}} Kč',
    filter: { model_year: { _eq: '$FIELDS.model_year' } },
    note: 'Filtruje podle vybraného modelového roku',
  },

  // ─── models ────────────────────────────────────────
  {
    collection: 'models',
    field: 'sub_brand',
    template: '{{name}}',
    filter: { brand: { _eq: '$CURRENT_ITEM.brand' } },
    note: 'Sub-brand patří k brandu (jen pro OMODA & JAECOO)',
  },

  // ─── trim_levels ───────────────────────────────────
  // model_year je FK na ModelYears — žádný cascade potřeba
  // (ModelYears samo zobrazí "{{model.name}} {{year}}" díky display template)

  // ─── option_packages ───────────────────────────────
  // model_year FK — žádný cascade

  // ─── leads ─────────────────────────────────────────
  {
    collection: 'leads',
    field: 'source_vehicle',
    template: '{{brand.name}} {{model.name}} ({{vin}})',
    note: 'Zdrojový vůz lead-u',
  },
];

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('  SFR Motor — Cascading filters v adminu');
  console.log('═══════════════════════════════════════════════');
  console.log('');

  DIRECTUS_URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Admin email: ')).trim();
  const password = (await prompt('Admin heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth?.data?.access_token;
  ok('Auth OK');
  console.log('');

  for (const c of CASCADES) {
    try {
      // Načti aktuální meta, abychom nepřepsali existující config
      const current = await api('GET', `/fields/${c.collection}/${c.field}`);
      const oldMeta = current?.data?.meta ?? {};
      const oldOptions = oldMeta.options ?? {};

      const newOptions = {
        ...oldOptions,
        template: c.template,
      };
      if (c.filter) {
        newOptions.filter = c.filter;
      }

      await api('PATCH', `/fields/${c.collection}/${c.field}`, {
        meta: {
          ...oldMeta,
          options: newOptions,
          note: c.note ?? oldMeta.note,
        },
      });
      ok(`${c.collection}.${c.field} → ${c.filter ? 'filter + ' : ''}template`);
    } catch (e) {
      if (e.status === 404) warn(`${c.collection}.${c.field} neexistuje`);
      else warn(`${c.collection}.${c.field}: ${e.message}`);
    }
  }

  console.log('');
  console.log('Hotovo. Test:');
  console.log('  Hard refresh admin (Ctrl+Shift+R) → Stock Vehicles → + Vytvořit');
  console.log('  1. Vyber Brand=KGM');
  console.log('  2. Model dropdown ukáže JEN KGM modely (Tivoli, Korando, Torres...)');
  console.log('  3. Vyber Model=Korando → ModelYear ukáže "Korando — 2026"');
  console.log('  4. Vyber ModelYear → TrimLevel ukáže "Style — 549900 Kč", "Style+ — 549900 Kč", "Elegant — 629900 Kč", "Premium — 719900 Kč"');

  rl.close();
}

main().catch((e) => { console.log(`❌ ${e.message}`); rl.close(); process.exit(1); });
