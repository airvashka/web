#!/usr/bin/env node
/**
 * SFR Motor — polish admin formu pro stock_vehicles.
 *
 * Co skript dělá:
 *   1) Přidá field `highlight_label` (string) — custom text pro NOVINKA badge.
 *      Když je vyplněn + highlighted=true, použije se místo "Novinka".
 *   2) Přejmenuje label `highlighted` na "Zvýraznit (zobrazí badge)" + lepší note.
 *   3) Přidá field `color_ref` (M2O → model_color_exterior) s cascading filtrem
 *      podle vybraného modelu. Uživatel vidí dropdown skutečných barev modelu.
 *      Plus template "{{name}} ({{hex}})".
 *   4) Přidá presentation-divider s informací "Technical data se přebírají z modelu".
 *   5) Patchne sort + width pro logické řazení fieldů:
 *        ── Sekce 1: Vůz (brand → model → year → trim) — sort 10–40
 *        ── Sekce 2: Identifikace + tech (vin, color_ref, transmission,
 *           drivetrain, color_category) — sort 50–90
 *        ── Sekce 3: Ceny (list, promo, lowest_30d, monthly_from) — sort 100–130
 *        ── Sekce 4: Stav (km, condition, availability, first_reg) — sort 140–170
 *        ── Sekce 5: Foto + content (photos, gallery_360, description, extra_features) — sort 180–220
 *        ── Sekce 6: Zvýraznění (highlighted, highlight_label) — sort 230–240
 *        ── Sekce 7: Meta (branch, listed_at, sold_at) — sort 250+
 *        ── Skryté (trim_level_snapshot, sort, status)
 *
 * Použití:
 *   cd web && node scripts/improve-stock-vehicle-admin.mjs
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rl = readline.createInterface({ input, output });
const prompt = (q) => rl.question(q);

let URL = '', TOKEN = '';

async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${URL}${path}`, opts);
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(j?.errors ?? j)}`);
  return j;
}

const ok = (m) => console.log(`  ✓  ${m}`);
const info = (m) => console.log(`  ℹ  ${m}`);

async function fieldExists(field) {
  try { await api('GET', `/fields/stock_vehicles/${field}`); return true; } catch { return false; }
}

async function relationExists(field) {
  try { await api('GET', `/relations/stock_vehicles/${field}`); return true; } catch { return false; }
}

// ─── 1) highlight_label ─────────────────────────────────────
async function ensureHighlightLabel() {
  if (await fieldExists('highlight_label')) {
    info('highlight_label už existuje');
    return;
  }
  await api('POST', '/fields/stock_vehicles', {
    field: 'highlight_label',
    type: 'string',
    schema: { is_nullable: true, max_length: 40 },
    meta: {
      interface: 'input',
      width: 'half',
      note: 'Volitelný text pro badge (defaultně "NOVINKA" pokud necháš prázdné). Např. "AKCE", "ROZBALENÉ", "SLEVA -50 000".',
      sort: 235,
      options: { placeholder: 'např. NOVINKA, AKCE, SLEVA' },
    },
  });
  ok('highlight_label field přidán');
}

// ─── 2) update highlighted note ─────────────────────────────
async function patchHighlighted() {
  const cur = await api('GET', '/fields/stock_vehicles/highlighted');
  const meta = cur.data?.meta ?? {};
  await api('PATCH', '/fields/stock_vehicles/highlighted', {
    meta: {
      ...meta,
      width: 'half',
      sort: 230,
      note: 'Zaškrtni pro zobrazení barevného badge v hero (na webu i v listu skladovky). Text badge řídí pole "Highlight label" — když je prázdné, ukáže se "NOVINKA".',
      options: {
        ...(meta.options ?? {}),
        label: 'Zvýraznit',
      },
    },
  });
  ok('highlighted patched (label + note)');
}

// ─── 3) color_ref M2O s cascading (exterior) ─────────────────
async function ensureColorRef() {
  if (await fieldExists('color_ref')) {
    info('color_ref už existuje, jen patchnu meta');
  } else {
    await api('POST', '/fields/stock_vehicles', {
      field: 'color_ref',
      type: 'integer',
      schema: { foreign_key_table: 'model_color_exterior', is_nullable: true },
      meta: {
        interface: 'select-dropdown-m2o',
        special: ['m2o'],
        width: 'half',
        sort: 55,
        note: 'Barva karoserie — vyber z barev tohoto modelu. (Dropdown se filtruje podle vybraného Modelu nahoře.)',
      },
    });
    ok('color_ref field přidán');
  }

  await api('PATCH', '/fields/stock_vehicles/color_ref', {
    meta: {
      interface: 'select-dropdown-m2o',
      special: ['m2o'],
      width: 'half',
      sort: 55,
      note: 'Barva karoserie — vyber z barev tohoto modelu. (Dropdown se filtruje podle vybraného Modelu nahoře.)',
      options: {
        template: '{{name}} ({{hex}})',
        filter: { model: { _eq: '{{model}}' } },
      },
    },
  });
  ok('color_ref meta updated (cascade filter)');

  if (!(await relationExists('color_ref'))) {
    await api('POST', '/relations', {
      collection: 'stock_vehicles',
      field: 'color_ref',
      related_collection: 'model_color_exterior',
      schema: { on_delete: 'SET NULL' },
    });
    ok('relation stock_vehicles.color_ref → model_color_exterior');
  }
}

// ─── 3b) interior_color_ref M2O s cascading ──────────────────
async function ensureInteriorColorRef() {
  if (await fieldExists('interior_color_ref')) {
    info('interior_color_ref už existuje, jen patchnu meta');
  } else {
    await api('POST', '/fields/stock_vehicles', {
      field: 'interior_color_ref',
      type: 'integer',
      schema: { foreign_key_table: 'model_color_interior', is_nullable: true },
      meta: {
        interface: 'select-dropdown-m2o',
        special: ['m2o'],
        width: 'half',
        sort: 57,
        note: 'Barva interiéru — vyber z čalounění tohoto modelu. (Filtr podle Modelu nahoře.)',
      },
    });
    ok('interior_color_ref field přidán');
  }

  await api('PATCH', '/fields/stock_vehicles/interior_color_ref', {
    meta: {
      interface: 'select-dropdown-m2o',
      special: ['m2o'],
      width: 'half',
      sort: 57,
      note: 'Barva interiéru — vyber z čalounění tohoto modelu. (Filtr podle Modelu nahoře.)',
      options: {
        // Directus template engine NEUMÍ Mustache sekce {{#x}}...{{/x}}.
        // Jen plain references. Holé "{{material}}" by ukazovalo "null" když je prázdné.
        template: '{{name}}',
        filter: { model: { _eq: '{{model}}' } },
      },
    },
  });
  ok('interior_color_ref meta updated (cascade filter)');

  if (!(await relationExists('interior_color_ref'))) {
    await api('POST', '/relations', {
      collection: 'stock_vehicles',
      field: 'interior_color_ref',
      related_collection: 'model_color_interior',
      schema: { on_delete: 'SET NULL' },
    });
    ok('relation stock_vehicles.interior_color_ref → model_color_interior');
  }
}

// ─── 4) presentation-divider ─────────────────────────────────
async function ensureTechDataNote() {
  if (await fieldExists('_tech_data_note')) {
    info('_tech_data_note divider už existuje');
    return;
  }
  await api('POST', '/fields/stock_vehicles', {
    field: '_tech_data_note',
    type: 'alias',
    schema: null,
    meta: {
      interface: 'presentation-notice',
      special: ['alias', 'no-data'],
      width: 'full',
      sort: 95,
      options: {
        color: 'normal',
        icon: 'info',
        text: 'Technická data (motor, výkon, spotřeba, emise…) se přebírají z **Modelu** (Models → vyber model → Technical Data) nebo z **Modelového roku** (pro rok-specifické přepsání). Edituj tam, ne tady.',
      },
    },
  });
  ok('_tech_data_note presentation-notice přidán');
}

// ─── 5) Sort + width ─────────────────────────────────────────
const SORT_PLAN = [
  // Sekce 1: Vůz
  { field: 'brand', sort: 10, width: 'half' },
  { field: 'model', sort: 20, width: 'half' },
  { field: 'model_year', sort: 30, width: 'half' },
  { field: 'trim_level', sort: 40, width: 'half' },

  // Sekce 2: Identifikace + tech specs
  { field: 'vin', sort: 50, width: 'half' },
  { field: 'color_ref', sort: 55, width: 'half' },
  { field: 'interior_color_ref', sort: 57, width: 'half' },
  { field: 'color_code', sort: 60, width: 'half' },
  { field: 'color_category', sort: 65, width: 'half' },
  { field: 'transmission', sort: 70, width: 'half' },
  { field: 'drivetrain', sort: 75, width: 'half' },

  // Tech data info
  { field: '_tech_data_note', sort: 95, width: 'full' },

  // Sekce 3: Ceny
  { field: 'list_price', sort: 100, width: 'half' },
  { field: 'promo_price', sort: 110, width: 'half' },
  { field: 'lowest_price_30d', sort: 120, width: 'half' },
  { field: 'monthly_payment_from', sort: 130, width: 'half' },

  // Sekce 4: Stav vozu
  { field: 'km', sort: 140, width: 'half' },
  { field: 'first_registration', sort: 145, width: 'half' },
  { field: 'condition', sort: 150, width: 'half' },
  { field: 'availability', sort: 160, width: 'half' },

  // Sekce 5: Foto + content
  { field: 'photos', sort: 180, width: 'full' },
  { field: 'gallery_360_url', sort: 185, width: 'full' },
  { field: 'description', sort: 200, width: 'full' },
  { field: 'extra_features', sort: 220, width: 'full' },

  // Sekce 6: Zvýraznění
  { field: 'highlighted', sort: 230, width: 'half' },
  { field: 'highlight_label', sort: 235, width: 'half' },

  // Sekce 7: Meta
  { field: 'branch', sort: 250, width: 'half' },
  { field: 'option_packages', sort: 260, width: 'full' },
  { field: 'listed_at', sort: 270, width: 'half' },
  { field: 'sold_at', sort: 280, width: 'half' },
];

async function patchSort() {
  for (const item of SORT_PLAN) {
    if (!(await fieldExists(item.field))) {
      info(`${item.field}: neexistuje, skipuji sort`);
      continue;
    }
    const cur = await api('GET', `/fields/stock_vehicles/${item.field}`);
    const meta = cur.data?.meta ?? {};
    await api('PATCH', `/fields/stock_vehicles/${item.field}`, {
      meta: { ...meta, sort: item.sort, width: item.width },
    });
    ok(`${item.field} → sort ${item.sort}, width ${item.width}`);
  }
}

// ─── extra_features note ─────────────────────────────────────
async function patchExtraFeaturesNote() {
  if (!(await fieldExists('extra_features'))) return;
  const cur = await api('GET', '/fields/stock_vehicles/extra_features');
  const meta = cur.data?.meta ?? {};
  await api('PATCH', '/fields/stock_vehicles/extra_features', {
    meta: {
      ...meta,
      note: 'Volitelná extra výbava NAVÍC k trimu — co konkrétní vůz má, ale není to v základu trimu ani v žádném paketu. Např. "tažné zařízení", "zimní kola navíc", "tónovaná skla". Zobrazí se na webu pod hlavní výbavou jako "Extra výbava tohoto vozu".',
    },
  });
  ok('extra_features note updated');
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Stock vehicles — admin polish');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  console.log('Krok 1: highlight_label field');
  await ensureHighlightLabel();

  console.log('\nKrok 2: patch highlighted (note + label)');
  await patchHighlighted();

  console.log('\nKrok 3: color_ref M2O s cascade (karoserie)');
  await ensureColorRef();

  console.log('\nKrok 3b: interior_color_ref M2O s cascade (interiér)');
  await ensureInteriorColorRef();

  console.log('\nKrok 4: tech data info notice');
  await ensureTechDataNote();

  console.log('\nKrok 5: sort + width fieldů');
  await patchSort();

  console.log('\nKrok 6: extra_features note');
  await patchExtraFeaturesNote();

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo. Ctrl+Shift+R v adminu. Editor skladovky:');
  console.log('  1) Vůz: Brand · Model · Year · Trim');
  console.log('  2) Identifikace: VIN · Barva (cascading!) · Transmission · …');
  console.log('  3) Info: technická data jsou v Models');
  console.log('  4) Ceny: List · Promo · Lowest30 · Monthly from');
  console.log('  5) Stav: KM · First reg · Condition · Availability');
  console.log('  6) Foto · Popis · Extra výbava');
  console.log('  7) Zvýraznění: highlighted ✓ + custom badge text');
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
