#!/usr/bin/env node
/**
 * SFR Motor — PROPER M2M files fix (verze 2 — bere v úvahu junction collection + relations)
 *
 * Předchozí fix-stock-photos.mjs vytvořil jen alias field bez junction.
 * Důsledek: SQL kolony `models.gallery` a `stock_vehicles.photos` byly smazány,
 * ale Directus si myslí, že field existuje → SELECT na model nebo vůz hází chybu
 * "column does not exist" → admin "Page Not Found".
 *
 * Tento skript:
 *  1. Smaže rozbité alias fieldy z metadata
 *  2. Vytvoří junction kolekce stock_vehicles_files a models_files
 *  3. Vytvoří v junction tabulkách správné FK
 *  4. Vytvoří alias field photos/gallery se správnými meta
 *  5. Vytvoří relations propojující junction s parent collection a directus_files
 *  6. Nastaví permissions
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
const skip = (m) => console.log(`⏭️   ${m}`);
const warn = (m) => console.log(`⚠️   ${m}`);
const err  = (m) => console.log(`❌  ${m}`);
const info = (m) => console.log(`ℹ️   ${m}`);

async function deleteIfExists(method, path, label) {
  try {
    await api(method, path);
    ok(`  smazáno: ${label}`);
  } catch (e) {
    if (e.status === 404 || e.status === 403) skip(`  ${label} neexistuje`);
    else warn(`  ${label}: ${e.message}`);
  }
}

/**
 * Vytvoří kompletní M2M files setup pro daný parent collection + field.
 *
 * Příklad: parentCollection='stock_vehicles', aliasField='photos'
 * Vytvoří:
 *   • junction collection 'stock_vehicles_files' (skrytá)
 *   • field 'id' (PK auto-increment)
 *   • field 'stock_vehicles_id' (FK na parent)
 *   • field 'directus_files_id' (FK na soubory)
 *   • alias field 'photos' na parent
 *   • relation stock_vehicles_files.stock_vehicles_id → stock_vehicles (one_field=photos)
 *   • relation stock_vehicles_files.directus_files_id → directus_files
 */
async function createM2MFiles(parentCollection, aliasField, note = '') {
  const junctionCollection = `${parentCollection}_files`;
  const parentFkField = `${parentCollection}_id`;

  // 1) Smaž rozbitý alias field (pokud existuje, ale jen z metadata — DB kolona už nejspíš neexistuje)
  info(`Krok 1/6: Smazání rozbitého ${parentCollection}.${aliasField} ze schématu...`);
  await deleteIfExists('DELETE', `/fields/${parentCollection}/${aliasField}`, `${parentCollection}.${aliasField}`);

  // 2) Smaž existující junction (pokud byla)
  info(`Krok 2/6: Smazání staré junction ${junctionCollection}...`);
  await deleteIfExists('DELETE', `/collections/${junctionCollection}`, junctionCollection);

  // 3) Vytvoř novou junction kolekci
  info(`Krok 3/6: Vytvářím junction kolekci ${junctionCollection}...`);
  try {
    await api('POST', '/collections', {
      collection: junctionCollection,
      meta: {
        hidden: true,
        icon: 'import_export',
        sort: 100,
      },
      schema: { name: junctionCollection },
      fields: [
        {
          field: 'id',
          type: 'integer',
          meta: { hidden: true, interface: 'input', readonly: true },
          schema: { is_primary_key: true, has_auto_increment: true },
        },
      ],
    });
    ok(`  junction ${junctionCollection} vytvořena`);
  } catch (e) {
    err(`  collection: ${e.message}`);
    return false;
  }

  // 4) FK pole na junction tabulce
  info(`Krok 4/6: FK pole na junction...`);
  try {
    await api('POST', `/fields/${junctionCollection}`, {
      field: parentFkField,
      type: 'integer',
      meta: { hidden: true, interface: 'input' },
      schema: { is_nullable: true },
    });
    ok(`  ${junctionCollection}.${parentFkField}`);

    await api('POST', `/fields/${junctionCollection}`, {
      field: 'directus_files_id',
      type: 'uuid',
      meta: { hidden: true, interface: 'file-image' },
      schema: { is_nullable: true },
    });
    ok(`  ${junctionCollection}.directus_files_id`);
  } catch (e) {
    err(`  junction fields: ${e.message}`);
    return false;
  }

  // 5) Alias field na parent collection
  info(`Krok 5/6: Alias field ${parentCollection}.${aliasField}...`);
  try {
    await api('POST', `/fields/${parentCollection}`, {
      field: aliasField,
      type: 'alias',
      meta: {
        interface: 'files',
        special: ['files'],
        options: {
          enableCreate: true,
          enableSelect: true,
          folder: null,
        },
        note: note || 'Drag & drop více fotek',
        width: 'full',
      },
      schema: null,
    });
    ok(`  alias ${parentCollection}.${aliasField} vytvořeno`);
  } catch (e) {
    err(`  alias field: ${e.message}`);
    return false;
  }

  // 6) Relations
  info(`Krok 6/6: Relations...`);
  try {
    // junction.parent_id → parent
    await api('POST', '/relations', {
      collection: junctionCollection,
      field: parentFkField,
      related_collection: parentCollection,
      meta: {
        junction_field: 'directus_files_id',
        one_field: aliasField,
        one_collection: parentCollection,
        one_collection_field: null,
        sort_field: null,
      },
      schema: { on_delete: 'CASCADE' },
    });
    ok(`  relation ${junctionCollection}.${parentFkField} → ${parentCollection}`);

    // junction.directus_files_id → directus_files
    await api('POST', '/relations', {
      collection: junctionCollection,
      field: 'directus_files_id',
      related_collection: 'directus_files',
      meta: {
        junction_field: parentFkField,
        one_collection_field: null,
        sort_field: null,
      },
      schema: { on_delete: 'SET NULL' },
    });
    ok(`  relation ${junctionCollection}.directus_files_id → directus_files`);
  } catch (e) {
    err(`  relations: ${e.message}`);
    return false;
  }

  ok(`✨ M2M files ${parentCollection}.${aliasField} kompletně vytvořeno`);
  return true;
}

async function setupPermissions(junctionCollections) {
  info('Nastavuju Public READ permissions pro junction tabulky...');
  let policies;
  try {
    policies = await api('GET', '/policies?filter[name][_eq]=$t:public_label&limit=1');
    if (!policies?.data?.length) {
      policies = await api('GET', '/policies?filter[name][_eq]=Public&limit=1');
    }
  } catch { policies = null; }

  const policy = policies?.data?.[0];
  if (!policy) {
    warn('Public policy nenalezena, permissions nastav ručně.');
    return;
  }

  for (const coll of junctionCollections) {
    try {
      await api('POST', '/permissions', {
        policy: policy.id,
        collection: coll,
        action: 'read',
        fields: ['*'],
      });
      ok(`  ${coll} — READ`);
    } catch (e) {
      if (e.status === 400) skip(`  ${coll} — už existuje`);
      else warn(`  ${coll}: ${e.message}`);
    }
  }
}

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('  SFR Motor — PROPER M2M files fix');
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
  if (!TOKEN) { err('Auth selhal'); process.exit(1); }
  ok('Auth OK');
  console.log('');

  // 1) stock_vehicles.photos
  console.log('━━━ stock_vehicles.photos ━━━');
  await createM2MFiles('stock_vehicles', 'photos', 'Fotky vozu — drag & drop');
  console.log('');

  // 2) models.gallery
  console.log('━━━ models.gallery ━━━');
  await createM2MFiles('models', 'gallery', 'Galerie modelu — drag & drop');
  console.log('');

  // 3) Permissions
  await setupPermissions(['stock_vehicles_files', 'models_files']);
  console.log('');

  console.log('═══════════════════════════════════════════════');
  console.log('  Hotovo! ✅');
  console.log('═══════════════════════════════════════════════');
  console.log('');
  console.log('Test:');
  console.log('  1. Refresh Directus admin (Ctrl+Shift+R)');
  console.log('  2. Otevři Models → klikni na libovolný model');
  console.log('     Mělo by se otevřít detail (žádné Page Not Found)');
  console.log('  3. Najdi Gallery field → drag & drop fotky');
  console.log('  4. Stejně Stock Vehicles → Photos field');
  console.log('');

  rl.close();
}

main().catch((e) => { err(e.message); rl.close(); process.exit(1); });
