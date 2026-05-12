#!/usr/bin/env node
/**
 * SFR Motor — Set field order v admin formech
 *
 * Po fix skriptech se field order ve formech rozhodil (brand/model na konci místo nahoře).
 * Tento skript nastaví logické pořadí pro:
 *  • stock_vehicles — značka → model → trim → VIN → ceny → fotky
 *  • models — značka → sub-brand → slug → name → ostatní
 *  • leads — form_type → kontakt → zdroj → status
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
    headers: {
      'Content-Type': 'application/json',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
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

const ok   = (m) => console.log(`✅  ${m}`);
const warn = (m) => console.log(`⚠️   ${m}`);
const info = (m) => console.log(`ℹ️   ${m}`);

// Pořadí fields per collection — index = sort order (nižší = výš v formuláři)
const FIELD_ORDER = {
  stock_vehicles: [
    'brand',          // 1. Vyber značku
    'model',          // 2. Vyber model
    'model_year',     // 3. Modelový rok
    'trim_level',     // 4. Výbavová úroveň
    'vin',            // 5. VIN
    'color_code',     // 6. Barva
    'condition',      // 7. Stav
    'availability',   // 8. Dostupnost
    'branch',         // 9. Pobočka
    'photos',         // 10. Fotky
    'list_price',     // 11. Ceníková
    'promo_price',    // 12. Akční
    'lowest_price_30d',// 13. EU Omnibus
    'monthly_payment_from', // 14. Splátka
    'km',             // 15. Najeto
    'first_registration', // 16. 1. registrace
    'description',    // 17. Popis
    'extra_features', // 18. Extra výbava
    'trim_level_snapshot', // 19. Snapshot (read-only)
    'highlighted',    // 20. Doporučujeme
    'gallery_360_url',// 21. 360 galerie
    'listed_at',      // 22. Listed at
    'sold_at',        // 23. Sold at
    'status',         // 24. Status
    'sort',           // 25. Sort
  ],
  models: [
    'brand',
    'sub_brand',
    'slug',
    'name',
    'tagline',
    'description',
    'body_type',
    'fuel_type',
    'price_from',
    'hero_image',
    'gallery',
    'status',
    'sort',
  ],
  leads: [
    'form_type',
    'customer_name',
    'customer_email',
    'customer_phone',
    'message',
    'source_model',
    'source_vehicle',
    'source_page',
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'status',
    'assignee',
    'note',
    'contacted_at',
    'sort',
  ],
};

async function setFieldSort(collection, field, sort) {
  try {
    await api('PATCH', `/fields/${collection}/${field}`, {
      meta: { sort },
    });
    ok(`  ${collection}.${field} → sort=${sort}`);
  } catch (e) {
    if (e.status === 404) {
      warn(`  ${collection}.${field} neexistuje (přeskočeno)`);
    } else {
      warn(`  ${collection}.${field}: ${e.message}`);
    }
  }
}

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('  SFR Motor — Fix field order v admin formech');
  console.log('═══════════════════════════════════════════════');
  console.log('');

  DIRECTUS_URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Admin email: ')).trim();
  const password = (await prompt('Admin heslo: ')).trim();
  console.log('');

  info(`Auth → ${DIRECTUS_URL}`);
  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth?.data?.access_token;
  if (!TOKEN) { console.log('❌ Auth selhal'); process.exit(1); }
  ok('Auth OK');
  console.log('');

  for (const [collection, fields] of Object.entries(FIELD_ORDER)) {
    info(`Nastavuju pořadí na ${collection}...`);
    for (let i = 0; i < fields.length; i++) {
      await setFieldSort(collection, fields[i], i + 1);
    }
    console.log('');
  }

  console.log('═══════════════════════════════════════════════');
  console.log('  Hotovo! ✅');
  console.log('═══════════════════════════════════════════════');
  console.log('');
  console.log('Refresh admin (Ctrl+R) a otevři Stock Vehicles → + Vytvořit.');
  console.log('Form by měl začínat: Brand → Model → Trim Level → VIN → Photos → Ceny...');

  rl.close();
}

main().catch((e) => { console.log(`❌ ${e.message}`); rl.close(); process.exit(1); });
