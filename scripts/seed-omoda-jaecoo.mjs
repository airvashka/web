#!/usr/bin/env node
/**
 * SFR Motor — seed OMODA & JAECOO obsahu z scrapnuté struktury.
 *
 * Načte _data/omoda-jaecoo-scraped/{slug}/pages.json a:
 *   1) PATCH models[slug] s tagline, description, technical_data, hero_stats, price_from
 *   2) Upload fotek do Directus:
 *      - hero_photo → models.hero_image
 *      - gallery[] → models.gallery (M2M)
 *      - colors_exterior[].photo → model_color_exterior.photo
 *      - colors_interior[].photo → model_color_interior.photo
 *   3) Vytvoří records v model_color_exterior + model_color_interior
 *   4) Vytvoří 4 highlights v model_highlights
 *
 * IDEMPOTENTNÍ: skipne pokud už content existuje.
 *
 * Použití:
 *   cd web && node scripts/seed-omoda-jaecoo.mjs
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Blob } from 'node:buffer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const SCRAPED_DIR = join(ROOT, '_data', 'omoda-jaecoo-scraped');

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

// ===== Folders =====
async function ensureFolder(name) {
  const existing = await api('GET', `/folders?filter[name][_eq]=${encodeURIComponent(name)}&limit=1`);
  if (existing?.data?.length > 0) return existing.data[0].id;
  const created = await api('POST', '/folders', { name });
  return created?.data?.id;
}

// ===== Upload file =====
async function uploadFile(filePath, title, folderId) {
  // Idempotence — reuse existing
  const existing = await api('GET', `/files?filter[title][_eq]=${encodeURIComponent(title)}&limit=1&fields=id`);
  if (existing?.data?.length > 0) return { id: existing.data[0].id, reused: true };

  if (!existsSync(filePath)) throw new Error(`File neexistuje: ${filePath}`);
  const size = statSync(filePath).size;
  if (size < 1000) throw new Error(`Příliš malý (${size} B)`);

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

// ===== Helpers =====
async function findModel(slug) {
  const r = await api('GET', `/items/models?filter[slug][_eq]=${encodeURIComponent(slug)}&limit=1&fields=id,slug,hero_image,gallery`);
  return r?.data?.[0] ?? null;
}

// Převod technical_data object → array [{label, value}]
function tdataToArray(td) {
  if (!td || typeof td !== 'object') return [];
  return Object.entries(td).map(([label, value]) => ({ label, value: String(value) }));
}

// Hero stats per fuel type — 4 řádky pro tmavý pruh pod hero
function buildHeroStats(td, brand) {
  const get = (...keys) => {
    for (const k of keys) {
      const found = Object.entries(td ?? {}).find(([key]) => key.toLowerCase().includes(k.toLowerCase()));
      if (found) return String(found[1]).split('/')[0].trim();
    }
    return null;
  };
  const stats = [];
  const vykon = get('Čistý výkon motoru', 'výkon');
  if (vykon) stats.push({ label: 'Výkon', value: `${vykon} kW` });
  const moment = get('Maximální točivý moment', 'točivý moment');
  if (moment) stats.push({ label: 'Točivý moment', value: `${moment} Nm` });
  const dojezd = get('Dojezd');
  if (dojezd) stats.push({ label: 'Dojezd', value: `${dojezd} km` });
  const spotreba = get('Průměrná spotřeba', 'Spotřeba');
  if (spotreba) stats.push({ label: 'Spotřeba (komb.)', value: `${spotreba} l/100 km` });
  // Záruka per brand
  const warrantyMap = { omoda: '7 let / 150 000 km', jaecoo: '7 let / 150 000 km' };
  stats.push({ label: 'Záruka', value: warrantyMap[brand] ?? '7 let / 150 000 km' });
  return stats.slice(0, 4);
}

// ===== Main per-model processing =====
async function processModel(slug, content, folderId, slugDir) {
  console.log(`\n▸ ${slug}`);
  const model = await findModel(slug);
  if (!model) {
    warn(`  Model ${slug} neexistuje v Directus`);
    return { skipped: true };
  }

  // 1) PATCH model základní fields
  const modelPatch = {};
  if (content.tagline) modelPatch.tagline = content.tagline;
  if (content.description) modelPatch.description = content.description;
  if (content.price_from_czk) modelPatch.price_from = content.price_from_czk;
  const tdataArr = tdataToArray(content.technical_data);
  if (tdataArr.length > 0) modelPatch.technical_data = tdataArr;
  const heroStats = buildHeroStats(content.technical_data, content.brand);
  if (heroStats.length > 0) modelPatch.hero_stats = heroStats;

  await api('PATCH', `/items/models/${model.id}`, modelPatch);
  ok(`  model PATCH (${Object.keys(modelPatch).length} fields)`);

  // 2) Hero photo
  if (content.hero_photo) {
    const heroPath = join(slugDir, content.hero_photo);
    try {
      const r = await uploadFile(heroPath, `${slug}__hero`, folderId);
      if (!model.hero_image) {
        await api('PATCH', `/items/models/${model.id}`, { hero_image: r.id });
        ok(`  hero_image uploaded${r.reused ? ' (reused)' : ''}`);
      } else {
        info(`  hero_image už nastaveno, ponecháno`);
      }
    } catch (e) {
      warn(`  hero: ${e.message}`);
    }
  }

  // 3) Gallery (M2M)
  if (Array.isArray(content.gallery) && content.gallery.length > 0) {
    const galleryIds = [];
    for (const filename of content.gallery) {
      const galPath = join(slugDir, filename);
      try {
        const r = await uploadFile(galPath, `${slug}__${filename}`, folderId);
        galleryIds.push(r.id);
      } catch (e) {
        warn(`  gallery ${filename}: ${e.message}`);
      }
    }
    if (galleryIds.length > 0) {
      // M2M gallery — overwrite (idempotent na úrovni files, junction records se přepíšou)
      const galleryItems = galleryIds.map((id) => ({ directus_files_id: id }));
      await api('PATCH', `/items/models/${model.id}`, { gallery: galleryItems });
      ok(`  gallery: ${galleryIds.length} fotek napojeno`);
    }
  }

  // 4) Colors exterior — vytvořit records v model_color_exterior
  if (Array.isArray(content.colors_exterior) && content.colors_exterior.length > 0) {
    // Check existing — pokud má records, ponech
    const existing = await api('GET', `/items/model_color_exterior?filter[model][_eq]=${model.id}&limit=1&fields=id`);
    if (existing.data?.length > 0) {
      info(`  color_exterior už má records, skipuji (smaž ručně v adminu pokud chceš přepsat)`);
    } else {
      let created = 0;
      for (let i = 0; i < content.colors_exterior.length; i++) {
        const c = content.colors_exterior[i];
        let photoId = null;
        if (c.photo) {
          const p = join(slugDir, c.photo);
          try {
            const r = await uploadFile(p, `${slug}__color__${c.photo}`, folderId);
            photoId = r.id;
          } catch (e) {
            warn(`    ext color ${c.photo}: ${e.message}`);
          }
        }
        try {
          await api('POST', '/items/model_color_exterior', {
            model: model.id,
            name: c.name,
            photo: photoId,
            sort: i + 1,
          });
          created++;
        } catch (e) {
          warn(`    ext color "${c.name}": ${e.message}`);
        }
      }
      ok(`  color_exterior: ${created} records vytvořeno`);
    }
  }

  // 5) Colors interior
  if (Array.isArray(content.colors_interior) && content.colors_interior.length > 0) {
    const existing = await api('GET', `/items/model_color_interior?filter[model][_eq]=${model.id}&limit=1&fields=id`);
    if (existing.data?.length > 0) {
      info(`  color_interior už má records, skipuji`);
    } else {
      let created = 0;
      for (let i = 0; i < content.colors_interior.length; i++) {
        const c = content.colors_interior[i];
        let photoId = null;
        if (c.photo) {
          const p = join(slugDir, c.photo);
          try {
            const r = await uploadFile(p, `${slug}__interior__${c.photo}`, folderId);
            photoId = r.id;
          } catch (e) {
            warn(`    int color ${c.photo}: ${e.message}`);
          }
        }
        try {
          await api('POST', '/items/model_color_interior', {
            model: model.id,
            name: c.name,
            photo: photoId,
            sort: i + 1,
          });
          created++;
        } catch (e) {
          warn(`    int color "${c.name}": ${e.message}`);
        }
      }
      ok(`  color_interior: ${created} records vytvořeno`);
    }
  }

  // 6) Highlights — vytvořit records v model_highlights
  if (Array.isArray(content.highlights) && content.highlights.length > 0) {
    const existing = await api('GET', `/items/model_highlights?filter[model][_eq]=${model.id}&limit=1&fields=id`);
    if (existing.data?.length > 0) {
      info(`  highlights už má records, skipuji`);
    } else {
      let created = 0;
      for (let i = 0; i < content.highlights.length; i++) {
        const h = content.highlights[i];
        try {
          await api('POST', '/items/model_highlights', {
            model: model.id,
            title: typeof h === 'string' ? h : h.title ?? '',
            subtitle: typeof h === 'string' ? '' : h.subtitle ?? '',
            photo: null, // OJ neměla fotky highlightů, klient doplní v adminu
            sort: i + 1,
          });
          created++;
        } catch (e) {
          warn(`    highlight [${i}]: ${e.message}`);
        }
      }
      ok(`  highlights: ${created} records vytvořeno`);
    }
  }

  return { updated: true };
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Seed OMODA & JAECOO obsah do Directus');
  console.log('═══════════════════════════════════════════════\n');

  if (!existsSync(SCRAPED_DIR)) {
    console.error(`✗ Scraped directory neexistuje: ${SCRAPED_DIR}`);
    process.exit(1);
  }

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  // Folder
  const folderId = await ensureFolder('omoda-jaecoo-import');
  ok(`Folder "omoda-jaecoo-import" → ${folderId}\n`);

  // Najdi všechny slugy (subfoldery)
  const slugs = readdirSync(SCRAPED_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  let updated = 0, skipped = 0;
  for (const slug of slugs) {
    const slugDir = join(SCRAPED_DIR, slug);
    const pagesPath = join(slugDir, 'pages.json');
    if (!existsSync(pagesPath)) {
      warn(`${slug}: chybí pages.json, skipuji`);
      skipped++;
      continue;
    }
    const content = JSON.parse(readFileSync(pagesPath, 'utf-8'));
    try {
      const r = await processModel(slug, content, folderId, slugDir);
      if (r.updated) updated++;
      else skipped++;
    } catch (e) {
      console.error(`✗ ${slug}: ${e.message}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log(`  Hotovo. Updated: ${updated}, Skipped: ${skipped}`);
  console.log('═══════════════════════════════════════════════\n');
  console.log('Webhook spustí Vercel rebuild ~30 s.');
  console.log('Pak otevři /omoda-jaecoo nebo /model/omoda-5 — uvidíš nahraný content.');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
