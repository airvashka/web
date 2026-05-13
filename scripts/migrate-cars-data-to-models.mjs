#!/usr/bin/env node
/**
 * SFR Motor — finální cleanup: vše marketingové na `models`.
 *
 * Co se migruje (z model_years na models):
 *   - color_options (barvy karoserie)
 *   - interior_options (barvy interiéru)
 *   - technical_data (specifikace motoru, rozměry, ...)
 *
 * Co ZŮSTÁVÁ na model_years:
 *   - trim_levels (relace) — výbavy a ceny per rok
 *   - brochure_file / price_list_file (legacy, primární je teď models)
 *   - year (samotný rok)
 *
 * Astro priorita po migraci: models.* > latestYear.* (legacy fallback) > {}
 *
 * Použití:
 *   cd web && node scripts/migrate-cars-data-to-models.mjs
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
const warn = (m) => console.log(`  ⚠  ${m}`);

async function fieldExists(collection, field) {
  try { await api('GET', `/fields/${collection}/${field}`); return true; } catch { return false; }
}

// ===== Field definitions =====

const COLOR_FIELDS = [
  {
    field: 'photo_file',
    type: 'uuid',
    name: 'Foto barvy',
    meta: {
      interface: 'file-image',
      special: ['file'],
      width: 'half',
      note: 'Foto karoserie v dané barvě nebo barevný swatch.',
    },
  },
  { field: 'name', type: 'string', name: 'Popisek', meta: { interface: 'input', width: 'half', note: 'Např. "Bílá perleťová"' } },
  { field: 'hex', type: 'string', name: 'Hex (fallback)', meta: { interface: 'input', width: 'half', note: 'Volitelně, fallback když foto chybí.' } },
  {
    field: 'type',
    type: 'string',
    name: 'Typ',
    meta: {
      interface: 'select-dropdown',
      width: 'half',
      options: {
        choices: [
          { text: 'V ceně (základní)', value: 'základní' },
          { text: 'Metalíza (příplatek)', value: 'metalíza' },
          { text: 'Perleť (příplatek)', value: 'perleť' },
        ],
      },
    },
  },
];

const INTERIOR_FIELDS = [
  {
    field: 'photo_file',
    type: 'uuid',
    name: 'Foto interiéru',
    meta: {
      interface: 'file-image',
      special: ['file'],
      width: 'half',
      note: 'Velká fotka interiéru (16:9 landscape).',
    },
  },
  { field: 'name', type: 'string', name: 'Popisek', meta: { interface: 'input', width: 'half', note: 'Např. "Černá kůže standardní"' } },
  { field: 'material', type: 'string', name: 'Materiál', meta: { interface: 'input', width: 'half', note: 'Volitelně, např. "pravá kůže"' } },
  { field: 'hex', type: 'string', name: 'Hex (fallback)', meta: { interface: 'input', width: 'half' } },
];

async function ensureRepeaterField(collection, field, fields, note) {
  if (await fieldExists(collection, field)) {
    info(`${collection}.${field} už existuje — PATCH meta na novou strukturu`);
    await api('PATCH', `/fields/${collection}/${field}`, {
      field,
      type: 'json',
      schema: { is_nullable: true },
      meta: {
        interface: 'list',
        special: ['cast-json'],
        hidden: false,
        readonly: false,
        width: 'full',
        note,
        options: {
          template: '{{name}}',
          addLabel: 'Přidat barvu',
          fields,
        },
      },
    });
    return;
  }
  await api('POST', `/fields/${collection}`, {
    field,
    type: 'json',
    schema: { is_nullable: true },
    meta: {
      interface: 'list',
      special: ['cast-json'],
      hidden: false,
      readonly: false,
      width: 'full',
      note,
      options: {
        template: '{{name}}',
        addLabel: 'Přidat barvu',
        fields,
      },
    },
  });
  ok(`${collection}.${field} vytvořen`);
}

async function ensureTechnicalDataField() {
  const collection = 'models';
  const field = 'technical_data';
  if (await fieldExists(collection, field)) {
    info(`models.technical_data už existuje`);
    return;
  }
  await api('POST', `/fields/${collection}`, {
    field,
    type: 'json',
    schema: { is_nullable: true },
    meta: {
      interface: 'list',
      special: ['cast-json'],
      width: 'full',
      hidden: false,
      sort: 300,
      note: 'Technické specifikace modelu. Změní se např. po faceliftu s novým motorem.',
      options: {
        template: '{{label}}: {{value}}',
        addLabel: 'Přidat položku',
        fields: [
          { field: 'label', type: 'string', name: 'Popisek', meta: { interface: 'input', width: 'half', note: 'Např. "Maximální výkon"' } },
          { field: 'value', type: 'string', name: 'Hodnota', meta: { interface: 'input', width: 'half', note: 'Např. "120 kW (163 k)"' } },
        ],
      },
    },
  });
  ok(`models.technical_data vytvořen (jako repeater {label, value})`);
}

async function findAllModels() {
  const r = await api('GET', '/items/models?limit=200&fields=id,slug,name,color_options,interior_options,technical_data');
  return r?.data ?? [];
}

async function findLatestModelYear(modelId) {
  const r = await api('GET', `/items/model_years?filter[model][_eq]=${modelId}&sort=-year&limit=1&fields=id,year,color_options,interior_options,technical_data`);
  return r?.data?.[0] ?? null;
}

// technical_data v modelyears je object {key: value}. V models chceme array [{label, value}].
function convertTdata(td) {
  if (!td) return null;
  if (Array.isArray(td)) {
    // Už je v správném formátu (array of {label, value})
    return td.filter((r) => r && r.label && r.value !== undefined);
  }
  if (typeof td === 'object') {
    return Object.entries(td).map(([label, value]) => ({ label, value: String(value) }));
  }
  return null;
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Finální migrace: model_years → models');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  // 1) Schema
  console.log('Krok 1: Schema');
  await ensureRepeaterField(
    'models',
    'color_options',
    COLOR_FIELDS,
    'Barvy karoserie. Foto + popisek → zobrazí se jako kolečka v sekci Konfigurátor.'
  );
  await ensureRepeaterField(
    'models',
    'interior_options',
    INTERIOR_FIELDS,
    'Barvy / typy interiéru. Foto + popisek → zobrazí se jako velké karty v Konfigurátoru.'
  );
  await ensureTechnicalDataField();
  console.log('');

  // 2) Kopírování z model_years na models
  console.log('Krok 2: Kopírování dat');
  const models = await findAllModels();
  let copied = 0, skipped = 0;

  for (const m of models) {
    const my = await findLatestModelYear(m.id);
    if (!my) { warn(`${m.slug}: žádný model_year`); skipped++; continue; }

    const patch = {};

    // color_options
    if ((!Array.isArray(m.color_options) || m.color_options.length === 0) && Array.isArray(my.color_options) && my.color_options.length > 0) {
      patch.color_options = my.color_options;
    }

    // interior_options
    if ((!Array.isArray(m.interior_options) || m.interior_options.length === 0) && Array.isArray(my.interior_options) && my.interior_options.length > 0) {
      patch.interior_options = my.interior_options;
    }

    // technical_data — convert z object na array
    if ((!Array.isArray(m.technical_data) || m.technical_data.length === 0) && my.technical_data) {
      const converted = convertTdata(my.technical_data);
      if (converted && converted.length > 0) {
        patch.technical_data = converted;
      }
    }

    if (Object.keys(patch).length === 0) {
      info(`${m.slug}: model už má vše vyplněné, nebo year nemá data — skipuji`);
      skipped++;
      continue;
    }

    try {
      await api('PATCH', `/items/models/${m.id}`, patch);
      const fields = Object.keys(patch).join(' + ');
      ok(`${m.slug}: ${fields} zkopírováno z my${my.year}`);
      copied++;
    } catch (e) {
      warn(`${m.slug}: ${e.message}`);
    }
  }
  console.log('');

  console.log('═══════════════════════════════════════════════');
  console.log(`  Hotovo. Copied: ${copied}, Skipped: ${skipped}`);
  console.log('═══════════════════════════════════════════════');
  console.log('');
  console.log('V adminu Directus (Ctrl+Shift+R refresh):');
  console.log('  models → vyber libovolný model →');
  console.log('  • Color Options — barvy karoserie (foto + popisek)');
  console.log('  • Interior Options — barvy interiéru (foto + popisek)');
  console.log('  • Technical Data — specifikace (label + hodnota)');
  console.log('  • Brochure File / Price List File — PDF');
  console.log('  • Hero Stats — co se zobrazí v tmavém pruhu pod hero');
  console.log('  • Highlights — tech karty se sekcí "Technologie"');
  console.log('');
  console.log('model_years už obsahuje JEN:');
  console.log('  • year');
  console.log('  • trim_levels (relace) — výbavy a ceny per rok');
  console.log('  • brochure_file / price_list_file (legacy/archiv)');
  console.log('');
  console.log('Pak npm run build a uvidíš změny na /model/{slug}.\n');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
