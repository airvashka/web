#!/usr/bin/env node
/**
 * SFR Motor — upload barevných swatch fotek z brožur.
 *
 * Pro každou barvu v `_barvy.json` (per model):
 *   1) Najde swatch_image filename v `_data/brozury-extracted/{slug}/`
 *   2) Upload do Directus do folderu "color-swatches"
 *   3) Updatuje color_options[i].swatch_file = UUID
 *      (a stejně pro interior_options[i])
 *
 * Frontend pak renderuje <DirectusImage> místo CSS background:#hex.
 *
 * IDEMPOTENTNÍ: pokud file s daným title už existuje, reuse.
 *
 * Použití:
 *   cd web && node scripts/upload-color-swatches.mjs
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Blob } from 'node:buffer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const BARVY_PATH = join(ROOT, '_data', 'brozury-extracted', '_barvy.json');
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

async function ensureFolder(name) {
  const existing = await api('GET', `/folders?filter[name][_eq]=${encodeURIComponent(name)}&limit=1`);
  if (existing?.data?.length > 0) return existing.data[0].id;
  const created = await api('POST', '/folders', { name });
  return created?.data?.id;
}

async function uploadSwatch(filename, slug, kind, folderId) {
  const title = `${slug}__swatch__${kind}__${filename}`;
  const existing = await api('GET', `/files?filter[title][_eq]=${encodeURIComponent(title)}&limit=1&fields=id`);
  if (existing?.data?.length > 0) return { id: existing.data[0].id, reused: true };

  const candidates = [
    join(BROZURY_DIR, slug, filename),
    join(BROZURY_DIR, slug, filename.replace('.jpeg', '.jpg')),
    join(BROZURY_DIR, slug, filename.replace('.jpg', '.jpeg')),
    join(BROZURY_DIR, slug, filename.replace('.jpg', '.png')),
  ];
  const filePath = candidates.find((p) => existsSync(p));
  if (!filePath) throw new Error(`Soubor neexistuje: ${filename}`);

  const size = statSync(filePath).size;
  if (size < 200) throw new Error(`Soubor je moc malý (${size} B), pravděpodobně 1×1 placeholder`);

  const buf = readFileSync(filePath);
  const blob = new Blob([buf], { type: filePath.endsWith('.png') ? 'image/png' : 'image/jpeg' });
  const fd = new FormData();
  if (folderId) fd.append('folder', folderId);
  fd.append('title', title);
  fd.append('file', blob, filename);

  const r = await fetch(`${URL}/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: fd,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Upload ${filename}: ${JSON.stringify(j?.errors ?? j)}`);
  return { id: j?.data?.id, reused: false };
}

async function findModelBySlug(slug) {
  const r = await api('GET', `/items/models?filter[slug][_eq]=${encodeURIComponent(slug)}&limit=1&fields=id`);
  return r?.data?.[0] ?? null;
}

async function findLatestModelYear(modelId) {
  const r = await api('GET', `/items/model_years?filter[model][_eq]=${modelId}&sort=-year&limit=1&fields=id,year,color_options,interior_options`);
  return r?.data?.[0] ?? null;
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Upload barevných swatchů z brožur');
  console.log('═══════════════════════════════════════════════\n');

  const data = JSON.parse(readFileSync(BARVY_PATH, 'utf-8'));
  info(`Načteno ${Object.keys(data.models).length} modelů z _barvy.json\n`);

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  const folderId = await ensureFolder('color-swatches');
  ok(`Folder "color-swatches" → ${folderId}\n`);

  let uploaded = 0, reused = 0, errors = 0, models = 0;

  for (const [slug, colors] of Object.entries(data.models)) {
    console.log(`\n▸ ${slug}`);
    const model = await findModelBySlug(slug);
    if (!model) { warn('  model neexistuje'); continue; }
    const my = await findLatestModelYear(model.id);
    if (!my) { warn('  žádný model_year'); continue; }

    // Exteriér: pro každou barvu upload swatch + uložit UUID
    const newExterior = [];
    for (const c of colors.exterior_colors ?? []) {
      if (!c.swatch_image) { newExterior.push(c); continue; }
      try {
        const r = await uploadSwatch(c.swatch_image, slug, 'exterior', folderId);
        if (r.reused) reused++; else uploaded++;
        newExterior.push({ ...c, swatch_file: r.id });
      } catch (e) {
        errors++;
        warn(`  ext ${c.swatch_image}: ${e.message}`);
        newExterior.push(c); // zachovat bez swatch_file
      }
    }

    // Interiér
    const newInterior = [];
    for (const c of colors.interior_colors ?? []) {
      if (!c.swatch_image) { newInterior.push(c); continue; }
      try {
        const r = await uploadSwatch(c.swatch_image, slug, 'interior', folderId);
        if (r.reused) reused++; else uploaded++;
        newInterior.push({ ...c, swatch_file: r.id });
      } catch (e) {
        errors++;
        warn(`  int ${c.swatch_image}: ${e.message}`);
        newInterior.push(c);
      }
    }

    // Transform do formátu co je v Directus (zachovat strukturu kompatibilní s předchozím seedem)
    const colorOptions = newExterior.map((c) => ({
      code: c.code ?? null,
      name: c.name_cs ?? c.name ?? '',
      name_en: c.name_en ?? null,
      hex: c.hex ?? null,
      type: c.type ?? null,
      swatch_image: c.swatch_image ?? null,
      swatch_file: c.swatch_file ?? null,
      monotone_only: c.monotone_only ?? false,
    }));
    const interiorOptions = newInterior.map((c) => ({
      code: c.code ?? null,
      name: c.name_cs ?? c.name ?? '',
      material: c.material ?? null,
      hex: c.hex ?? null,
      swatch_image: c.swatch_image ?? null,
      swatch_file: c.swatch_file ?? null,
    }));

    try {
      await api('PATCH', `/items/model_years/${my.id}`, {
        color_options: colorOptions,
        interior_options: interiorOptions,
      });
      ok(`  model_year ${my.year} updated: ${colorOptions.length} ext + ${interiorOptions.length} int`);
      models++;
    } catch (e) {
      warn(`  PATCH selhalo: ${e.message}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log(`  Hotovo. Models: ${models}/10, Uploaded: ${uploaded}, Reused: ${reused}, Errors: ${errors}`);
  console.log('═══════════════════════════════════════════════\n');
  console.log('Webhook spustí Vercel rebuild ~30 s.');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
