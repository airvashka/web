#!/usr/bin/env node
/**
 * SFR Motor — upload fotek z brožur a napojení na modely.
 *
 * Pro každý model v `_seed-content.json`:
 *   1) Upload hero_photo + gallery filenames z `_data/brozury-extracted/{slug}/`
 *      do Directus /files (multipart, folder "brochure-seed").
 *   2) PATCH model.hero_image = první file UUID
 *   3) Vytvoří M2M junction records pro model.gallery
 *
 * Skript je IDEMPOTENTNÍ: pokud foto s daným title už existuje, přeskočí upload.
 * Pokud model už má hero_image, NEPŘEPÍŠE ho (aby admin mohl ručně nahrát lepší).
 * Spustit znovu = doplní jen chybějící.
 *
 * Použití:
 *   cd web && node scripts/seed-brochure-photos.mjs
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Blob } from 'node:buffer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const SEED_PATH = join(ROOT, '_data', 'brozury-extracted', '_seed-content.json');
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

// Najdi nebo vytvoř folder "brochure-seed"
async function ensureFolder(name) {
  const existing = await api('GET', `/folders?filter[name][_eq]=${encodeURIComponent(name)}&limit=1`);
  if (existing?.data?.length > 0) return existing.data[0].id;
  const created = await api('POST', '/folders', { name });
  return created?.data?.id;
}

// Upload jeden file — vrátí jeho UUID
async function uploadFile(filename, slug, folderId) {
  // Najdi existující file se stejným title (idempotence)
  const title = `${slug}__${filename}`;
  const existing = await api('GET', `/files?filter[title][_eq]=${encodeURIComponent(title)}&limit=1&fields=id`);
  if (existing?.data?.length > 0) {
    return { id: existing.data[0].id, reused: true };
  }

  // Najdi reálný soubor (může mít .jpg nebo .jpeg příponu)
  const candidates = [
    join(BROZURY_DIR, slug, filename),
    join(BROZURY_DIR, slug, filename.replace('.jpeg', '.jpg')),
    join(BROZURY_DIR, slug, filename.replace('.jpg', '.jpeg')),
    join(BROZURY_DIR, slug, filename.replace('.jpg', '.png')),
  ];
  const filePath = candidates.find((p) => existsSync(p));
  if (!filePath) {
    throw new Error(`File neexistuje: ${filename} v ${slug}/`);
  }

  // Skip pokud je menší než 30 kB (placeholder ikony / lišty)
  const size = statSync(filePath).size;
  if (size < 30_000) {
    throw new Error(`File je moc malý (${size} B), pravděpodobně ikona: ${filename}`);
  }

  const fileBuf = readFileSync(filePath);
  const blob = new Blob([fileBuf], { type: filePath.endsWith('.png') ? 'image/png' : 'image/jpeg' });

  const formData = new FormData();
  if (folderId) formData.append('folder', folderId);
  formData.append('title', title);
  formData.append('file', blob, filename);

  const r = await fetch(`${URL}/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: formData,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Upload ${filename}: ${JSON.stringify(j?.errors ?? j)}`);
  return { id: j?.data?.id, reused: false };
}

async function findModelBySlug(slug) {
  const r = await api('GET', `/items/models?filter[slug][_eq]=${encodeURIComponent(slug)}&limit=1&fields=id,slug,name,hero_image`);
  return r?.data?.[0] ?? null;
}

// Sestaví M2M junction items {directus_files_id: UUID}[]
function buildGalleryPayload(fileIds) {
  return fileIds.map((id) => ({ directus_files_id: id }));
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  SFR Motor — Upload fotek z brožur');
  console.log('═══════════════════════════════════════════════\n');

  const data = JSON.parse(readFileSync(SEED_PATH, 'utf-8'));
  info(`Načteno ${Object.keys(data.models).length} modelů\n`);

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');
  const overwriteHero = (await prompt('Přepsat existující hero_image fotky? [n]: ')).trim().toLowerCase() === 'y';
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  // Folder
  console.log('Krok 1: Folder');
  const folderId = await ensureFolder('brochure-seed');
  ok(`Folder "brochure-seed" → ${folderId}\n`);

  // Per model
  console.log('Krok 2: Upload + napojení');
  let totalUploaded = 0, totalReused = 0, totalErrors = 0;

  for (const [slug, content] of Object.entries(data.models)) {
    console.log(`\n▸ ${slug}`);
    const model = await findModelBySlug(slug);
    if (!model) { warn(`  Model neexistuje, skipuji`); continue; }

    const filenames = [content.hero_photo, ...(content.gallery ?? [])].filter(Boolean);
    if (filenames.length === 0) { warn(`  Žádné foto filenames v JSON`); continue; }

    const uploaded = [];
    for (const fname of filenames) {
      try {
        const result = await uploadFile(fname, slug, folderId);
        uploaded.push(result.id);
        if (result.reused) {
          totalReused++;
        } else {
          totalUploaded++;
          ok(`  ${fname} → ${result.id.substring(0, 8)}…`);
        }
      } catch (e) {
        totalErrors++;
        warn(`  ${fname}: ${e.message}`);
      }
    }

    if (uploaded.length === 0) {
      warn(`  Žádné foto neuploadnuté, skipuji PATCH`);
      continue;
    }

    // PATCH model.hero_image (pokud chybí nebo overwrite)
    const heroId = uploaded[0];
    if (!model.hero_image || overwriteHero) {
      try {
        await api('PATCH', `/items/models/${model.id}`, { hero_image: heroId });
        ok(`  hero_image → ${heroId.substring(0, 8)}…`);
      } catch (e) {
        warn(`  hero_image PATCH: ${e.message}`);
      }
    } else {
      info(`  hero_image už nastavené, ponechávám`);
    }

    // M2M gallery — nahradíme celé pole (overwrite by default je OK pro seed)
    const galleryItems = buildGalleryPayload(uploaded.slice(1));
    if (galleryItems.length > 0) {
      try {
        await api('PATCH', `/items/models/${model.id}`, { gallery: galleryItems });
        ok(`  gallery: ${galleryItems.length} fotek napojeno`);
      } catch (e) {
        warn(`  gallery PATCH: ${e.message}`);
      }
    }
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log(`  Hotovo. Uploaded: ${totalUploaded}, Reused: ${totalReused}, Errors: ${totalErrors}`);
  console.log('═══════════════════════════════════════════════\n');
  console.log('Webhook spustí Vercel rebuild ~30 s.');
  console.log('Pak otevři /model/{slug} — uvidíš oficiální fotky z brožur.');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
