#!/usr/bin/env node
/**
 * SFR Motor — schema + upload PDF brožur a ceníků.
 *
 * 1) Přidá do `model_years` 2 fieldy (M2O na directus_files):
 *      - brochure_file  (PDF brožura)
 *      - price_list_file (PDF ceník)
 * 2) Uploadne existující PDFka z _downloads-todo/brozury/{slug}/ do Directus
 *    do folderu "brochures".
 * 3) Napojí PDF na nejnovější model_year každého modelu.
 *
 * IDEMPOTENTNÍ: pokud field / soubor / propojení už existuje, skipne.
 *
 * Použití:
 *   cd web && node scripts/seed-pdf-downloads.mjs
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Blob } from 'node:buffer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const BROZURY_DIR = join(ROOT, '_downloads-todo', 'brozury');
const FARIZON_BROZURA = join(ROOT, '_downloads-todo', 'ceniky-farizon', 'V6E-Brozura.pdf');

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

async function ensureFileField(collection, field, label, note) {
  if (await fieldExists(collection, field)) {
    info(`${collection}.${field} už existuje`);
    return;
  }
  // 1) Create the field (m2o relation type = uuid pointing to directus_files)
  await api('POST', `/fields/${collection}`, {
    field,
    type: 'uuid',
    schema: {
      foreign_key_table: 'directus_files',
      is_nullable: true,
    },
    meta: {
      interface: 'file',
      special: ['file'],
      note,
      display: 'file',
      width: 'half',
    },
  });
  // 2) Create the relation
  await api('POST', '/relations', {
    collection,
    field,
    related_collection: 'directus_files',
    schema: {
      on_delete: 'SET NULL',
    },
  });
  ok(`${collection}.${field} field + relation vytvořeno`);
}

async function ensureFolder(name) {
  const existing = await api('GET', `/folders?filter[name][_eq]=${encodeURIComponent(name)}&limit=1`);
  if (existing?.data?.length > 0) return existing.data[0].id;
  const created = await api('POST', '/folders', { name });
  return created?.data?.id;
}

async function uploadPdf(filePath, title, folderId) {
  const existing = await api('GET', `/files?filter[title][_eq]=${encodeURIComponent(title)}&limit=1&fields=id`);
  if (existing?.data?.length > 0) return { id: existing.data[0].id, reused: true };

  const buf = readFileSync(filePath);
  const blob = new Blob([buf], { type: 'application/pdf' });
  const fd = new FormData();
  if (folderId) fd.append('folder', folderId);
  fd.append('title', title);
  fd.append('file', blob, title.replace(/[^a-zA-Z0-9._-]/g, '-') + '.pdf');

  const r = await fetch(`${URL}/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: fd,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Upload ${title}: ${JSON.stringify(j?.errors ?? j)}`);
  return { id: j?.data?.id, reused: false };
}

async function findModelBySlug(slug) {
  const r = await api('GET', `/items/models?filter[slug][_eq]=${encodeURIComponent(slug)}&limit=1&fields=id,slug`);
  return r?.data?.[0] ?? null;
}

async function findLatestModelYear(modelId) {
  const r = await api('GET', `/items/model_years?filter[model][_eq]=${modelId}&sort=-year&limit=1`);
  return r?.data?.[0] ?? null;
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  SFR Motor — Seed PDF brožur a ceníků');
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
  await ensureFileField('model_years', 'brochure_file', 'Brožura PDF', 'Brožura modelu ke stažení (PDF)');
  await ensureFileField('model_years', 'price_list_file', 'Ceník PDF', 'Ceník modelu ke stažení (PDF)');
  console.log('');

  // 2) Folder
  console.log('Krok 2: Folder');
  const folderId = await ensureFolder('brochures');
  ok(`Folder "brochures" → ${folderId}\n`);

  // 3) Upload + napojení brožur
  console.log('Krok 3: Brožury (PDF)');

  // Mapping: brožura folder slug → web model slug
  const BROCHURE_MAP = {};
  if (existsSync(BROZURY_DIR)) {
    for (const slug of readdirSync(BROZURY_DIR)) {
      const sub = join(BROZURY_DIR, slug);
      const pdfs = (existsSync(sub) ? readdirSync(sub) : []).filter((f) => f.toLowerCase().endsWith('.pdf'));
      if (pdfs.length > 0) BROCHURE_MAP[slug] = join(sub, pdfs[0]);
    }
  }
  if (existsSync(FARIZON_BROZURA)) BROCHURE_MAP['farizon-v6e'] = FARIZON_BROZURA;

  let uploaded = 0, reused = 0, linked = 0, skipped = 0;
  for (const [slug, pdfPath] of Object.entries(BROCHURE_MAP)) {
    const model = await findModelBySlug(slug);
    if (!model) { warn(`${slug}: model neexistuje`); skipped++; continue; }
    const my = await findLatestModelYear(model.id);
    if (!my) { warn(`${slug}: žádný model_year`); skipped++; continue; }

    try {
      const result = await uploadPdf(pdfPath, `${slug} — brožura`, folderId);
      if (result.reused) reused++; else uploaded++;
      await api('PATCH', `/items/model_years/${my.id}`, { brochure_file: result.id });
      ok(`${slug} → my${my.year} brochure (${result.reused ? 'reused' : 'uploaded'} ${result.id.substring(0, 8)}…)`);
      linked++;
    } catch (e) {
      warn(`${slug}: ${e.message}`);
    }
  }

  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log(`  Hotovo. Brožury: ${uploaded} uploaded, ${reused} reused, ${linked} napojeno na modelyears.`);
  console.log('═══════════════════════════════════════════════\n');
  console.log('Ceníky:');
  console.log('  → Aktuálně nejsou v _downloads-todo/ jako PDF (jen text v _data/_ceniky-text/).');
  console.log('  → Klient může v adminu ručně nahrát do model_years.price_list_file');
  console.log('    pole — UI tlačítko "Stáhnout ceník" se pak zobrazí.');
  console.log('');
  console.log('Webhook spustí Vercel rebuild ~30 s.');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
