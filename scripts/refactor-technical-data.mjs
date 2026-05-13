#!/usr/bin/env node
/**
 * SFR Motor — Refactor technical_data na key-value repeater.
 *
 * STARÝ raw JSON (matoucí v adminu, vyžaduje znalost JSON syntaxe):
 *   {
 *     "Motor": "1.5 GDI Turbo",
 *     "Výkon (kW)": "120"
 *   }
 *
 * NOVÝ list repeater (klikat, vyplňovat):
 *   [
 *     { "label": "Motor", "value": "1.5 GDI Turbo" },
 *     { "label": "Výkon (kW)", "value": "120" }
 *   ]
 *
 * Co skript dělá pro každou z kolekcí (models, model_years):
 *   1) Ujistí se, že field `technical_data` existuje (vytvoří pokud chybí)
 *   2) Patchne interface na `list` repeater s {label, value} sub-fields
 *   3) Migrace dat: prochází všechny records a převede flat object → array
 *      (skipne records co už mají array shape)
 *
 * Astro helper `tdToMap` zvládá oba shape, takže web během migrace nepadne.
 *
 * Použití:
 *   cd web && node scripts/refactor-technical-data.mjs
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

async function fieldExists(collection, field) {
  try { await api('GET', `/fields/${collection}/${field}`); return true; } catch { return false; }
}

function isRepeaterShape(td) {
  return Array.isArray(td) && td.length > 0
    && typeof td[0] === 'object' && td[0] !== null
    && ('label' in td[0] || 'value' in td[0]);
}

function flatObjectToRepeater(obj) {
  if (!obj || typeof obj !== 'object') return [];
  return Object.entries(obj)
    .filter(([k, v]) => k && v !== null && v !== undefined && v !== '')
    .map(([k, v]) => ({ label: String(k), value: String(v) }));
}

const FIELD_META = {
  interface: 'list',
  width: 'full',
  note: 'Technická data jako klikací seznam. Klikni "+ Add", vyplň Label (např. "Motor") a Value (např. "1.5 GDI Turbo"). Můžeš mít libovolný počet řádků a klást je v libovolném pořadí.',
  options: {
    template: '{{label}}: {{value}}',
    addLabel: 'Přidat řádek',
    fields: [
      {
        field: 'label',
        name: 'Label',
        type: 'string',
        meta: {
          interface: 'input',
          width: 'half',
          options: { placeholder: 'např. Motor, Výkon (kW), Spotřeba…' },
        },
      },
      {
        field: 'value',
        name: 'Value',
        type: 'string',
        meta: {
          interface: 'input',
          width: 'half',
          options: { placeholder: 'např. 1.5 GDI Turbo, 120, 6.5 l/100km' },
        },
      },
    ],
  },
};

async function ensureFieldOnCollection(collection) {
  const exists = await fieldExists(collection, 'technical_data');
  if (!exists) {
    await api('POST', `/fields/${collection}`, {
      field: 'technical_data',
      type: 'json',
      schema: { is_nullable: true },
      meta: { ...FIELD_META, sort: 200 },
    });
    ok(`${collection}.technical_data field vytvořen`);
    return;
  }

  // Field existuje — patchni meta na nový interface
  const current = await api('GET', `/fields/${collection}/technical_data`);
  const meta = current.data?.meta ?? {};
  await api('PATCH', `/fields/${collection}/technical_data`, {
    meta: {
      ...meta,
      ...FIELD_META,
    },
  });
  ok(`${collection}.technical_data → list repeater interface`);
}

async function migrateRecords(collection) {
  const limit = 200;
  const records = await api('GET', `/items/${collection}?limit=${limit}&fields=id,technical_data${collection === 'models' ? ',name' : ',year,model.name'}`);

  let migrated = 0, skipped = 0, empty = 0;

  for (const r of records.data) {
    const td = r.technical_data;
    const label = collection === 'models'
      ? `${r.name ?? '?'} (id=${r.id})`
      : `${r.model?.name ?? '?'} ${r.year ?? '?'} (id=${r.id})`;

    if (!td || (typeof td === 'object' && !Array.isArray(td) && Object.keys(td).length === 0)) {
      empty++;
      continue;
    }

    if (isRepeaterShape(td)) {
      info(`${label}: už repeater, skipuji`);
      skipped++;
      continue;
    }

    if (typeof td === 'object' && !Array.isArray(td)) {
      const repeater = flatObjectToRepeater(td);
      await api('PATCH', `/items/${collection}/${r.id}`, { technical_data: repeater });
      ok(`${label}: ${Object.keys(td).length} polí → repeater`);
      migrated++;
    } else {
      info(`${label}: neznámý shape, skipuji`);
      skipped++;
    }
  }

  console.log(`\n  ${collection}: ✓ ${migrated} migrated · → ${skipped} skipped · ○ ${empty} empty\n`);
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Refactor technical_data na key-value repeater');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  console.log('Krok 1: Schema — fields');
  await ensureFieldOnCollection('models');
  await ensureFieldOnCollection('model_years');

  console.log('\nKrok 2: Migrace dat\n');
  await migrateRecords('models');
  await migrateRecords('model_years');

  console.log('═══════════════════════════════════════════════');
  console.log('  Hotovo. V adminu (Ctrl+Shift+R):');
  console.log('  models / model_years → libovolný record → "Technical Data".');
  console.log('  Uvidíš seznam řádků [Label | Value] místo raw JSON.');
  console.log('  Klikni "+ Add" pro přidání další specifikace.');
  console.log('');
  console.log('  Pozn: web čte z OBOU shapes přes lib/technicalData.ts → tdToMap,');
  console.log('  takže během migrace nic nepadne.');
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
