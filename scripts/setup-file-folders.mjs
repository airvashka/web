#!/usr/bin/env node
/**
 * SFR Motor — Directus file folder struktura pro Skladové vozy.
 *
 * Vytvoří:
 *
 *   📁 Skladové vozy/
 *      ├── 📁 Import — KGM           (sync sem ukládá KGM fotky)
 *      ├── 📁 Import — OMODA & JAECOO (sync sem ukládá OMODA fotky)
 *      └── 📁 Ručně přidané          (manuální uploady)
 *
 * Idempotentní — existující folder ('modely', 'magazin' atd.) nemění.
 * Pokud target folder už existuje, jen ho najde a vrátí ID.
 *
 * Použití:
 *   cd web && node scripts/setup-file-folders.mjs
 *
 * Po dokončení vypíše folder IDs — ty budeme používat v sync skriptech.
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

async function findFolder(name, parentId = null) {
  const filter = parentId
    ? `filter[name][_eq]=${encodeURIComponent(name)}&filter[parent][_eq]=${parentId}`
    : `filter[name][_eq]=${encodeURIComponent(name)}&filter[parent][_null]=true`;
  const r = await api('GET', `/folders?${filter}&limit=1`);
  return r.data?.[0] ?? null;
}

async function ensureFolder(name, parentId = null) {
  const existing = await findFolder(name, parentId);
  if (existing) {
    info(`Folder "${name}" už existuje (id=${existing.id})`);
    return existing;
  }
  const created = await api('POST', '/folders', { name, parent: parentId });
  ok(`Folder "${name}" vytvořen (id=${created.data.id})`);
  return created.data;
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Directus file folders pro Skladové vozy');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  console.log('Krok 1: Root folder "Skladové vozy"');
  const skladovkaRoot = await ensureFolder('Skladové vozy');

  console.log('\nKrok 2: Sub-foldery pro import');
  const kgmImport = await ensureFolder('Import — KGM', skladovkaRoot.id);
  const omodaImport = await ensureFolder('Import — OMODA & JAECOO', skladovkaRoot.id);
  const manual = await ensureFolder('Ručně přidané', skladovkaRoot.id);

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo. Folder IDs:');
  console.log(`    Skladové vozy:        ${skladovkaRoot.id}`);
  console.log(`    Import — KGM:         ${kgmImport.id}`);
  console.log(`    Import — OMODA:       ${omodaImport.id}`);
  console.log(`    Ručně přidané:        ${manual.id}`);
  console.log('═══════════════════════════════════════════════');
  console.log('');
  console.log('V adminu: Files (vlevo v sidebar) → uvidíš strukturu');
  console.log('Tvoje existující "modely/kgm/actyon/barvy" zůstává netknuté.');
  console.log('');
  console.log('Sync skript pak bude používat folder ID pro automatický upload');
  console.log('do správné složky. Manuální uploady můžeš dát do "Ručně přidané".');
  console.log('');
  console.log('UULOŽ SI tyto IDs — budou se hodit pro KGM import skript:');
  console.log(`  KGM_IMPORT_FOLDER_ID = '${kgmImport.id}'`);
  console.log(`  OMODA_IMPORT_FOLDER_ID = '${omodaImport.id}'`);
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
