#!/usr/bin/env node
/**
 * SFR Motor — schema additions pro stock auto-sync workflow.
 *
 * Co skript dělá:
 *
 *   1) Přidá hodnotu **`imported`** do enum `stock_vehicles.status`:
 *        - Publikováno (existující)
 *        - Importováno  ← NOVÉ
 *        - Koncept (existující)
 *        - Archivováno (existující)
 *      Workflow: auto-sync vytvoří vůz se status=imported → admin schválí
 *      → změní na published → vůz se zobrazí na webu.
 *
 *   2) Přidá fields pro tracking external zdroje:
 *        - external_source enum (manual / kgm / omoda)
 *        - external_id     string (numerické ID z KGM, slug z OMODA)
 *        - external_url    string (původní URL pro audit)
 *        - synced_at       timestamp (poslední úspěšný sync)
 *
 *   3) Stávající ručně přidané vozy se NEZMĚNÍ — zůstanou published
 *      bez external_source (= manual).
 *
 * Použití:
 *   cd web && node scripts/add-stock-import-fields.mjs
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

// ─── 1) Status enum — přidat "imported" ────────────────────
const NEW_STATUS_CHOICES = [
  { text: 'Publikováno', value: 'published' },
  { text: 'Importováno', value: 'imported' },
  { text: 'Koncept',     value: 'draft' },
  { text: 'Archivováno', value: 'archived' },
];

const NEW_STATUS_DISPLAY_CHOICES = [
  { text: 'Publikováno', value: 'published', foreground: '#FFFFFF', background: '#1E7B5F' },
  { text: 'Importováno', value: 'imported',  foreground: '#FFFFFF', background: '#1F6FEB' },
  { text: 'Koncept',     value: 'draft',     foreground: '#FFFFFF', background: '#B27516' },
  { text: 'Archivováno', value: 'archived',  foreground: '#FFFFFF', background: '#B43A2C' },
];

async function patchStatusEnum() {
  const cur = await api('GET', '/fields/stock_vehicles/status');
  const meta = cur.data?.meta ?? {};

  // Zkontroluj jestli imported už není
  const existingChoices = meta.options?.choices ?? [];
  if (existingChoices.some((c) => c.value === 'imported')) {
    info('status.imported už v enum existuje');
    return;
  }

  await api('PATCH', '/fields/stock_vehicles/status', {
    meta: {
      ...meta,
      options: {
        ...(meta.options ?? {}),
        choices: NEW_STATUS_CHOICES,
      },
      display_options: {
        ...(meta.display_options ?? {}),
        choices: NEW_STATUS_DISPLAY_CHOICES,
      },
      note: 'Stav vozu. **Importováno** = automaticky synced z KGM/OMODA feedu — zkontroluj data a publikuj. **Publikováno** = viditelné na webu. **Koncept** = rozpracované. **Archivováno** = pryč z webu.',
    },
  });
  ok('status enum updated: přidáno "imported" (modré)');
}

// ─── 2) external_source ─────────────────────────────────────
async function ensureExternalSource() {
  if (await fieldExists('external_source')) {
    info('external_source už existuje');
    return;
  }
  await api('POST', '/fields/stock_vehicles', {
    field: 'external_source',
    type: 'string',
    schema: { is_nullable: true, default_value: 'manual', max_length: 20 },
    meta: {
      interface: 'select-dropdown',
      width: 'half',
      sort: 290,
      note: 'Odkud byl vůz importován. **manual** = přidal admin ručně. **kgm** = auto-sync ze stock.sfrmotor.kgmcars.cz. **omoda** = auto-sync z omoda-jaecoo.sfr-motor.cz.',
      options: {
        choices: [
          { text: '✋ Ručně (admin)', value: 'manual' },
          { text: '🔄 KGM auto-sync', value: 'kgm' },
          { text: '🔄 OMODA & JAECOO auto-sync', value: 'omoda' },
        ],
      },
      display: 'labels',
      display_options: {
        choices: [
          { text: 'Ručně', value: 'manual', foreground: '#FFFFFF', background: '#6B6B72' },
          { text: 'KGM', value: 'kgm', foreground: '#FFFFFF', background: '#1E3A66' },
          { text: 'OMODA', value: 'omoda', foreground: '#FFFFFF', background: '#7A1F22' },
        ],
      },
    },
  });
  ok('external_source field přidán (default: manual)');
}

// ─── 3) external_id ─────────────────────────────────────────
async function ensureExternalId() {
  if (await fieldExists('external_id')) {
    info('external_id už existuje');
    return;
  }
  await api('POST', '/fields/stock_vehicles', {
    field: 'external_id',
    type: 'string',
    schema: { is_nullable: true, max_length: 100 },
    meta: {
      interface: 'input',
      width: 'half',
      sort: 295,
      readonly: true,
      note: 'ID v původním zdroji (numerické u KGM, slug u OMODA). Read-only — nastavuje sync skript.',
      options: { placeholder: 'auto-fill při sync' },
    },
  });
  ok('external_id field přidán (readonly)');
}

// ─── 4) external_url ────────────────────────────────────────
async function ensureExternalUrl() {
  if (await fieldExists('external_url')) {
    info('external_url už existuje');
    return;
  }
  await api('POST', '/fields/stock_vehicles', {
    field: 'external_url',
    type: 'string',
    schema: { is_nullable: true, max_length: 500 },
    meta: {
      interface: 'input',
      width: 'full',
      sort: 297,
      readonly: true,
      note: 'URL původního detailu vozu na zdroji. Pro audit / debug. Read-only.',
      display: 'formatted-value',
      display_options: { format: false },
    },
  });
  ok('external_url field přidán (readonly)');
}

// ─── 5) synced_at ───────────────────────────────────────────
async function ensureSyncedAt() {
  if (await fieldExists('synced_at')) {
    info('synced_at už existuje');
    return;
  }
  await api('POST', '/fields/stock_vehicles', {
    field: 'synced_at',
    type: 'timestamp',
    schema: { is_nullable: true },
    meta: {
      interface: 'datetime',
      width: 'half',
      sort: 299,
      readonly: true,
      note: 'Kdy proběhl poslední úspěšný sync z externího zdroje. Read-only.',
    },
  });
  ok('synced_at field přidán (readonly)');
}

// ─── 6) Info divider (visual section v adminu) ──────────────
async function ensureImportDivider() {
  if (await fieldExists('_import_divider')) {
    info('_import_divider už existuje');
    return;
  }
  await api('POST', '/fields/stock_vehicles', {
    field: '_import_divider',
    type: 'alias',
    schema: null,
    meta: {
      interface: 'presentation-divider',
      special: ['alias', 'no-data'],
      width: 'full',
      sort: 285,
      options: {
        title: 'Auto-sync info (read-only)',
        icon: 'sync',
        color: '#1F6FEB',
      },
    },
  });
  ok('_import_divider přidán (nadpis sekce v adminu)');
}

// ─── 7) Backfill existing — set external_source=manual ─────
async function backfillExternalSource() {
  console.log('\nKrok 7: Backfill — existující vozy bez external_source dostanou "manual"');
  const vehicles = await api('GET', '/items/stock_vehicles?limit=500&fields=id,external_source');
  let updated = 0;
  for (const v of vehicles.data) {
    if (!v.external_source) {
      await api('PATCH', `/items/stock_vehicles/${v.id}`, { external_source: 'manual' });
      updated++;
    }
  }
  ok(`Backfill: ${updated} vozů nastavených na external_source=manual`);
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Stock auto-sync schema additions');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  console.log('Krok 1: Status enum — přidat "Importováno"');
  await patchStatusEnum();

  console.log('\nKrok 2: external_source field');
  await ensureExternalSource();

  console.log('\nKrok 3: external_id field');
  await ensureExternalId();

  console.log('\nKrok 4: external_url field');
  await ensureExternalUrl();

  console.log('\nKrok 5: synced_at field');
  await ensureSyncedAt();

  console.log('\nKrok 6: Visual divider v adminu');
  await ensureImportDivider();

  await backfillExternalSource();

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo. V adminu (Ctrl+Shift+R):');
  console.log('  ');
  console.log('  Stock Vehicles → list view:');
  console.log('    Status sloupec ukáže 4 barvy:');
  console.log('    🟢 Publikováno · 🔵 Importováno · 🟡 Koncept · 🔴 Archivováno');
  console.log('  ');
  console.log('  Stock Vehicles → editor:');
  console.log('    Nová sekce "Auto-sync info (read-only)" s:');
  console.log('      - External source (Ručně / KGM / OMODA)');
  console.log('      - External ID, External URL, Synced at');
  console.log('  ');
  console.log('  Workflow po sync:');
  console.log('    1. Sync skript vytvoří vůz se status=imported');
  console.log('    2. Admin zkontroluje data + fotky');
  console.log('    3. Klik na status → změní na "Publikováno"');
  console.log('    4. Po npm run build se vůz objeví na webu');
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
