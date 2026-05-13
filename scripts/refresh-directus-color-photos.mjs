#!/usr/bin/env node
/**
 * SFR Motor — refresh photo UUIDs v Directus color collections.
 *
 * Po `fix-color-mapping.py` máme na disku soubory s opravenými názvy:
 *   actyon-barva-iron-kovova.jpeg  (obsahuje skutečně Iron kovovou)
 *   actyon-barva-grand-bila.jpeg   (obsahuje skutečně bílou)
 *   ...
 *
 * Ale Directus records v `model_color_exterior` / `model_color_interior`
 * mají photo UUIDs na PŮVODNÍ špatně uploadované soubory.
 *
 * Tento skript:
 *   1) Pro každý record najde model.slug + name
 *   2) Najde soubor na disku: {slug}-{barva|interier}-{slugify(name)}.{ext}
 *   3) Uploadne / reuse v Directus s title="<slug>__<filename>"
 *   4) Update record.photo = new UUID
 *
 * Použití:
 *   cd web && node scripts/refresh-directus-color-photos.mjs
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Blob } from 'node:buffer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const BROZURY_DIR = join(ROOT, '_data', 'brozury-extracted');

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

function slugify(text) {
  if (!text) return '';
  const norm = text.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  return norm.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
}

async function ensureFolder(name) {
  const existing = await api('GET', `/folders?filter[name][_eq]=${encodeURIComponent(name)}&limit=1`);
  if (existing?.data?.length > 0) return existing.data[0].id;
  const created = await api('POST', '/folders', { name });
  return created?.data?.id;
}

async function uploadFile(filePath, title, folderId) {
  // Find existing
  const existing = await api('GET', `/files?filter[title][_eq]=${encodeURIComponent(title)}&limit=1&fields=id`);
  if (existing?.data?.length > 0) return { id: existing.data[0].id, reused: true };

  const buf = readFileSync(filePath);
  const ext = filePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
  const blob = new Blob([buf], { type: ext });
  const fd = new FormData();
  if (folderId) fd.append('folder', folderId);
  fd.append('title', title);
  fd.append('file', blob, filePath.split(/[\\/]/).pop());

  const r = await fetch(`${URL}/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: fd,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(j?.errors ?? j));
  return { id: j?.data?.id, reused: false };
}

function findFileOnDisk(slug, kind, nameSlug) {
  const candidates = [
    join(BROZURY_DIR, slug, `${slug}-${kind}-${nameSlug}.jpeg`),
    join(BROZURY_DIR, slug, `${slug}-${kind}-${nameSlug}.jpg`),
    join(BROZURY_DIR, slug, `${slug}-${kind}-${nameSlug}.png`),
  ];
  return candidates.find((p) => existsSync(p)) || null;
}

async function processCollection(collectionName, kind, folderId) {
  console.log(`\n═══ ${collectionName} (${kind}) ═══`);
  // Get all records s expanded model
  const records = await api(
    'GET',
    `/items/${collectionName}?limit=500&fields=id,name,photo,model.id,model.slug,model.name`
  );

  let updated = 0, reused = 0, uploaded = 0, missing = 0, skipped = 0;
  for (const r of records.data) {
    const slug = r.model?.slug;
    const name = r.name;
    if (!slug || !name) {
      warn(`record ${r.id}: chybí slug nebo name`);
      skipped++;
      continue;
    }

    const nameSlug = slugify(name);
    const filePath = findFileOnDisk(slug, kind, nameSlug);
    if (!filePath) {
      warn(`${slug}: ${name} (${nameSlug}) → soubor neexistuje na disku`);
      missing++;
      continue;
    }

    const size = statSync(filePath).size;
    if (size < 200) {
      warn(`${slug}: ${name} → file moc malý (${size} B)`);
      missing++;
      continue;
    }

    const title = `${slug}__${filePath.split(/[\\/]/).pop()}`;
    try {
      const result = await uploadFile(filePath, title, folderId);
      if (result.reused) reused++;
      else uploaded++;

      // Update record.photo = new UUID
      if (r.photo !== result.id) {
        await api('PATCH', `/items/${collectionName}/${r.id}`, { photo: result.id });
        ok(`${slug}: ${name} → photo UUID updated`);
        updated++;
      } else {
        info(`${slug}: ${name} → photo už správně`);
      }
    } catch (e) {
      warn(`${slug}: ${name} → ${e.message}`);
    }
  }

  console.log(`  Updated: ${updated}, Reused: ${reused}, Uploaded: ${uploaded}, Missing: ${missing}, Skipped: ${skipped}`);
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Refresh Directus color photos podle disku');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  const folderId = await ensureFolder('color-swatches');
  ok(`Folder color-swatches → ${folderId}`);

  await processCollection('model_color_exterior', 'barva', folderId);
  await processCollection('model_color_interior', 'interier', folderId);

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo. Spusť npm run build a Vercel rebuild.');
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
