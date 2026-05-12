#!/usr/bin/env node
/**
 * SFR Motor — Fix Photos field na stock_vehicles
 *
 * Problém: V setup-directus.mjs byl photos field deklarovaný jako json + interface "files".
 * To v Directus 11 nesedí — files vyžaduje type "alias" + M2M junction tabulku.
 *
 * Tento skript:
 *  1. Smaže všechny existující "photos" fields na stock_vehicles (může jich být víc)
 *  2. Smaže junction collection stock_vehicles_files pokud existuje
 *  3. Vytvoří photos jako alias type s M2M files (Directus auto-vytvoří junction)
 *  4. To samé pro models.gallery (pokud potřebuje)
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
    e.status = res.status; e.body = json;
    throw e;
  }
  return json;
}

const ok   = (m) => console.log(`✅  ${m}`);
const skip = (m) => console.log(`⏭️   ${m}`);
const warn = (m) => console.log(`⚠️   ${m}`);
const err  = (m) => console.log(`❌  ${m}`);
const info = (m) => console.log(`ℹ️   ${m}`);

async function deleteFieldIfExists(collection, field) {
  try {
    await api('DELETE', `/fields/${collection}/${field}`);
    ok(`  smazáno ${collection}.${field}`);
    return true;
  } catch (e) {
    if (e.status === 404 || e.status === 403) {
      skip(`  ${collection}.${field} neexistuje`);
      return false;
    }
    warn(`  delete ${collection}.${field}: ${e.message}`);
    return false;
  }
}

async function deleteCollectionIfExists(collection) {
  try {
    await api('DELETE', `/collections/${collection}`);
    ok(`  smazána junction kolekce ${collection}`);
    return true;
  } catch (e) {
    if (e.status === 404 || e.status === 403) {
      skip(`  ${collection} neexistuje`);
      return false;
    }
    warn(`  delete collection ${collection}: ${e.message}`);
    return false;
  }
}

async function createFilesM2M(collection, fieldName, note = '') {
  // V Directus 11 M2M files se vytvoří jako alias field se special ["files"]
  // Directus pak auto-vytvoří junction collection {collection}_files
  try {
    await api('POST', `/fields/${collection}`, {
      field: fieldName,
      type: 'alias',
      meta: {
        interface: 'files',
        special: ['files'],
        options: { enableCreate: true, enableSelect: true },
        note: note || 'Drag & drop fotky',
        width: 'full',
      },
      schema: null, // alias = žádná DB kolona
    });
    ok(`  ${collection}.${fieldName} (M2M files) vytvořeno`);
    return true;
  } catch (e) {
    err(`  ${collection}.${fieldName}: ${e.message}`);
    return false;
  }
}

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('  SFR Motor — Fix Photos field on stock_vehicles');
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

  // 1) Smaž starý photos field (může být duplikát) — zkus 2× pro jistotu
  info('Mažu rozbité photos pole na stock_vehicles...');
  await deleteFieldIfExists('stock_vehicles', 'photos');
  await deleteFieldIfExists('stock_vehicles', 'photos');  // pro jistotu kdyby byly 2
  console.log('');

  // 2) Smaž junction tabulku pokud existuje
  info('Mažu junction kolekci stock_vehicles_files (pokud existuje)...');
  await deleteCollectionIfExists('stock_vehicles_files');
  console.log('');

  // 3) Smaž starý gallery field na models
  info('Mažu starý gallery field na models (taky byl json)...');
  await deleteFieldIfExists('models', 'gallery');
  await deleteCollectionIfExists('models_files');
  console.log('');

  // 4) Vytvoř správný M2M files field
  info('Vytvářím nový photos jako M2M files na stock_vehicles...');
  await createFilesM2M('stock_vehicles', 'photos', 'Drag & drop fotky vozu');
  console.log('');

  info('Vytvářím gallery jako M2M files na models...');
  await createFilesM2M('models', 'gallery', 'Drag & drop fotky modelu (galerie)');
  console.log('');

  // 5) Nastav permissions pro nově vytvořené junction tabulky
  info('Nastavuju Public READ pro junction tabulky a directus_files...');
  let policies;
  try {
    policies = await api('GET', '/policies?filter[name][_eq]=$t:public_label&limit=1');
    if (!policies?.data?.length) {
      policies = await api('GET', '/policies?filter[name][_eq]=Public&limit=1');
    }
  } catch { policies = null; }

  const policy = policies?.data?.[0];
  if (policy) {
    for (const coll of ['stock_vehicles_files', 'models_files']) {
      try {
        await api('POST', '/permissions', {
          policy: policy.id,
          collection: coll,
          action: 'read',
          fields: ['*'],
        });
        ok(`  ${coll} — public READ`);
      } catch (e) {
        if (e.status === 400) skip(`  ${coll} — permission už existuje`);
        else warn(`  ${coll}: ${e.message}`);
      }
    }
  } else {
    warn('Public policy nenalezena, permissions nastav ručně');
  }
  console.log('');

  console.log('═══════════════════════════════════════════════');
  console.log('  Hotovo! ✅');
  console.log('═══════════════════════════════════════════════');
  console.log('');
  console.log('Test:');
  console.log('  1. Otevři Directus → Content → Stock Vehicles → + Vytvořit');
  console.log('  2. Najdi Photos field — měl bys vidět "Drag & Drop area"');
  console.log('  3. Přetáhni fotky → automatický upload');
  console.log('');
  console.log('Stejně tak Models → otevři libovolný model → najdi Gallery field.');
  console.log('');

  rl.close();
}

main().catch((e) => { err(e.message); rl.close(); process.exit(1); });
