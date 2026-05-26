#!/usr/bin/env node
/**
 * SFR Motor — přidá EV / užitkové specifické fieldy na stock_vehicles.
 *
 * Fields:
 *   battery_capacity_kwh  integer  — kapacita baterie v kWh (např. 67, 83, 106)
 *   range_wltp_km         integer  — dojezd WLTP v km (např. 551)
 *   cargo_volume_m3       decimal  — objem nákladového prostoru v m³ (např. 13.0)
 *   body_config           string   — kód karoserie u užitkáčů (např. "L3H3", "L2H1")
 *
 * Všechny pole jsou volitelná (nullable). Vyplňuje se ručně v Directus adminu
 * při přidávání vozidla. Na detailu vozu /sklad/{id} se zobrazí v spec gridu
 * pouze pokud jsou vyplněné — neutralní pro osobáky/ICE/HEV.
 *
 * Hodí se primárně pro Farizon SV a budoucí EV osobáky (Korando EVX, OMODA 5 EV).
 *
 * Idempotentní — když fieldy už existují, přeskočí.
 *
 * Použití:
 *   cd "C:\Users\antos\Desktop\Claude\SFR WEB\SFR WEB\web"
 *   node scripts/add-stock-ev-fields.mjs
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

async function fieldExists(col, field) {
  try { await api('GET', `/fields/${col}/${field}`); return true; } catch { return false; }
}

async function ensureField(field, spec) {
  if (await fieldExists('stock_vehicles', field)) {
    info(`stock_vehicles.${field} uz existuje - preskakuji.`);
    return;
  }
  await api('POST', '/fields/stock_vehicles', { field, ...spec });
  ok(`stock_vehicles.${field} pridan`);
}

async function main() {
  console.log('\n=== Add stock_vehicles EV / utility fields ===\n');

  URL = (await prompt('Directus URL [https://sfr-motor-directus.onrender.com]: ')).trim()
    || 'https://sfr-motor-directus.onrender.com';
  const email = (await prompt('Admin email: ')).trim();
  const password = (await prompt('Admin heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  // Divider pro prehlednost v adminu
  if (!(await fieldExists('stock_vehicles', '_ev_divider'))) {
    await api('POST', '/fields/stock_vehicles', {
      field: '_ev_divider',
      type: 'alias',
      schema: null,
      meta: {
        interface: 'presentation-divider',
        special: ['alias', 'no-data'],
        width: 'full',
        sort: 320,
        options: { title: 'EV / utilitarni specifikace', icon: 'electric_bolt', color: '#1F8A4D' },
      },
    });
    ok('_ev_divider pridan');
  }

  await ensureField('battery_capacity_kwh', {
    type: 'integer',
    schema: { is_nullable: true },
    meta: {
      interface: 'input',
      width: 'half',
      sort: 322,
      note: 'Kapacita baterie v kWh. Vypln u EV / hybrid vozidel. Napr. 49, 67, 83, 106. Zobrazi se v specs na detailu vozu.',
      options: { placeholder: '83', iconLeft: 'battery_full' },
    },
  });

  await ensureField('range_wltp_km', {
    type: 'integer',
    schema: { is_nullable: true },
    meta: {
      interface: 'input',
      width: 'half',
      sort: 324,
      note: 'WLTP dojezd v km (kombinovany). Vypln u EV. Napr. 359, 551. Zobrazi se v specs.',
      options: { placeholder: '551', iconLeft: 'route' },
    },
  });

  await ensureField('cargo_volume_m3', {
    type: 'decimal',
    schema: { is_nullable: true, numeric_precision: 5, numeric_scale: 2 },
    meta: {
      interface: 'input',
      width: 'half',
      sort: 326,
      note: 'Objem nakladoveho prostoru v m3 (jen pro uzitkove vozy / Farizon SV). Napr. 6.95, 8.25, 13.00.',
      options: { placeholder: '13.00', iconLeft: 'inventory_2' },
    },
  });

  await ensureField('body_config', {
    type: 'string',
    schema: { is_nullable: true, max_length: 16 },
    meta: {
      interface: 'input',
      width: 'half',
      sort: 328,
      note: 'Konfigurace karoserie u uzitkacu. Napr. "L1H1", "L2H3", "L3H3". Zobrazi se v specs jako "Konfigurace".',
      options: { placeholder: 'L3H3' },
    },
  });

  console.log('\n=== Hotovo. V adminu (Ctrl+Shift+R): ===');
  console.log('  Stock vehicles -> libovolny Farizon -> sekce "EV / utilitarni specifikace":');
  console.log('    - battery_capacity_kwh: 106');
  console.log('    - range_wltp_km: 551');
  console.log('    - cargo_volume_m3: 13.00');
  console.log('    - body_config: L3H3');
  console.log('  Pak rebuild/deploy -> /sklad/{id} ukaze nove specs v gridu.\n');
  rl.close();
}

main().catch((e) => { console.error(`X ${e.message}`); rl.close(); process.exit(1); });
