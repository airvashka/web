#!/usr/bin/env node
/**
 * SFR Motor — Přidá option_packages M2M relation na stock_vehicles
 *
 * V původním setup-directus.mjs jsem to opomněl. Bez tohoto fieldu admin
 * nemůže přiřadit packety k vozu.
 *
 * Vytvoří:
 *   • junction kolekci stock_vehicles_option_packages
 *   • FK pole na junction
 *   • alias field option_packages na stock_vehicles
 *   • 2 relations propojující junction
 *   • Permissions
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
  if (!r.ok) {
    const e = new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(j?.errors ?? j)}`);
    e.status = r.status; throw e;
  }
  return j;
}

const ok = (m) => console.log(`✅  ${m}`);
const info = (m) => console.log(`ℹ️   ${m}`);
const warn = (m) => console.log(`⚠️   ${m}`);

const JUNCTION = 'stock_vehicles_option_packages';
const PARENT = 'stock_vehicles';
const RELATED = 'option_packages';
const FIELD_NAME = 'option_packages';
const PARENT_FK = 'stock_vehicles_id';
const RELATED_FK = 'option_packages_id';

async function safeDelete(method, path, label) {
  try { await api(method, path); ok(`smazáno ${label}`); }
  catch (e) {
    if (e.status === 404 || e.status === 403) info(`${label} neexistuje (OK)`);
    else warn(`${label}: ${e.message}`);
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  SFR Motor — Add option_packages M2M to stock_vehicles');
  console.log('═══════════════════════════════════════════════\n');

  DIRECTUS_URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim() || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Admin email: ')).trim();
  const password = (await prompt('Admin heslo: ')).trim();

  const auth = await fetch(`${DIRECTUS_URL}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }).then(r => r.json());
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  // Cleanup if already exists (in case re-run)
  info('Cleanup případných starých záznamů...');
  await safeDelete('DELETE', `/fields/${PARENT}/${FIELD_NAME}`, `${PARENT}.${FIELD_NAME}`);
  await safeDelete('DELETE', `/collections/${JUNCTION}`, JUNCTION);
  console.log('');

  // Step 1: Junction kolekce
  info(`Vytvářím junction ${JUNCTION}...`);
  await api('POST', '/collections', {
    collection: JUNCTION,
    meta: { hidden: true, icon: 'import_export' },
    schema: { name: JUNCTION },
    fields: [
      {
        field: 'id', type: 'integer',
        meta: { hidden: true, interface: 'input', readonly: true },
        schema: { is_primary_key: true, has_auto_increment: true },
      },
    ],
  });
  ok(`junction ${JUNCTION}`);

  // Step 2: FK fields on junction
  await api('POST', `/fields/${JUNCTION}`, {
    field: PARENT_FK, type: 'integer',
    meta: { hidden: true, interface: 'input' },
    schema: { is_nullable: true },
  });
  ok(`${JUNCTION}.${PARENT_FK}`);

  await api('POST', `/fields/${JUNCTION}`, {
    field: RELATED_FK, type: 'integer',
    meta: { hidden: true, interface: 'input' },
    schema: { is_nullable: true },
  });
  ok(`${JUNCTION}.${RELATED_FK}\n`);

  // Step 3: Alias field na stock_vehicles
  info(`Vytvářím alias ${PARENT}.${FIELD_NAME}...`);
  await api('POST', `/fields/${PARENT}`, {
    field: FIELD_NAME,
    type: 'alias',
    meta: {
      interface: 'list-m2m',
      special: ['m2m'],
      options: {
        template: '{{option_packages_id.name}}',
        enableCreate: false,
        enableSelect: true,
      },
      note: 'Doplňkové balíčky — vyber z dostupných pro daný model',
      width: 'full',
    },
    schema: null,
  });
  ok(`alias ${PARENT}.${FIELD_NAME}\n`);

  // Step 4: Relations
  info('Vytvářím relations...');
  await api('POST', '/relations', {
    collection: JUNCTION,
    field: PARENT_FK,
    related_collection: PARENT,
    meta: {
      junction_field: RELATED_FK,
      one_field: FIELD_NAME,
      one_collection: PARENT,
    },
    schema: { on_delete: 'CASCADE' },
  });
  ok(`${JUNCTION}.${PARENT_FK} → ${PARENT}`);

  await api('POST', '/relations', {
    collection: JUNCTION,
    field: RELATED_FK,
    related_collection: RELATED,
    meta: {
      junction_field: PARENT_FK,
    },
    schema: { on_delete: 'SET NULL' },
  });
  ok(`${JUNCTION}.${RELATED_FK} → ${RELATED}\n`);

  // Step 5: Permissions
  info('Public READ permission pro junction...');
  try {
    const policies = await api('GET', '/policies?filter[name][_eq]=$t:public_label&limit=1');
    const policy = policies?.data?.[0];
    if (policy) {
      await api('POST', '/permissions', {
        policy: policy.id,
        collection: JUNCTION,
        action: 'read',
        fields: ['*'],
      });
      ok(`Public READ na ${JUNCTION}`);
    } else warn('Public policy nenalezena');
  } catch (e) {
    if (e.status === 400) info('Permission už existuje');
    else warn(`Permissions: ${e.message}`);
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo! ✅');
  console.log('═══════════════════════════════════════════════\n');
  console.log('Test:');
  console.log('  1. Hard refresh admin (Ctrl+Shift+R)');
  console.log('  2. Stock Vehicles → otevři Korando vůz');
  console.log('  3. Najdi pole "Option Packages" (dole)');
  console.log('  4. Klikni "Add Existing" → vyber TECH paket nebo BLACK paket');
  console.log('  5. Save');
  console.log('');
  console.log('V picker dialogu vidíš všech 35 packetů — použij search ("Korando" filtruje na Korando packety).');
  rl.close();
}
main().catch(e => { console.log(`❌ ${e.message}`); rl.close(); });
