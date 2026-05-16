#!/usr/bin/env node
/**
 * Stáhne všechny vizuální assety z dané URL stránky do _design-draft-blog/<slug>/.
 *
 * Používá Playwright — renderuje stránku jako reálný prohlížeč, takže funguje i na SPA
 * (Vue/React, např. KGM Tivoli).
 *
 * Co stahuje:
 *   - <img src>, <img data-src>, srcset (všechny varianty)
 *   - <source src> (video/audio/picture)
 *   - <video src>, <video poster>
 *   - inline background-image url(...)
 *   - og:image / twitter:image, link rel=icon/preload
 *   - VŠECHNY image/video requesty které browser udělá při loadu (sledujeme network)
 *
 * Použití:
 *   cd "C:\Users\antos\Desktop\Claude\SFR WEB\SFR WEB\web"
 *
 *   node scripts/download-page-assets.mjs https://en.kg-mobility.com/pr/model/show-room/200000300010004
 *   node scripts/download-page-assets.mjs https://... --videos
 *   node scripts/download-page-assets.mjs https://... --out muj-projekt
 *   node scripts/download-page-assets.mjs https://... --scroll       # auto-scroll pro lazy-loaded assety
 *   node scripts/download-page-assets.mjs https://... --wait 5000    # čekej 5s na renderu
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESIGN_ROOT = path.resolve(__dirname, '..', '..', '_design-draft-blog');

const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.avif', '.bmp', '.ico'];
const VIDEO_EXT = ['.mp4', '.webm', '.mov', '.m4v', '.ogv'];

const argv = process.argv.slice(2);
if (argv.length === 0 || argv[0].startsWith('--')) {
  console.error('Použití: node scripts/download-page-assets.mjs <url> [--videos] [--out folder] [--scroll] [--wait ms]');
  process.exit(1);
}
const pageUrl = argv[0];
const flag = (n) => argv.includes(n);
const argVal = (n) => { const i = argv.indexOf(n); return i > -1 ? argv[i + 1] : null; };
const INCLUDE_VIDEOS = flag('--videos');
const AUTO_SCROLL    = flag('--scroll');
const WAIT_MS        = parseInt(argVal('--wait') || '2500', 10);
const OUT_NAME       = argVal('--out') || autoFolderName(pageUrl);

function autoFolderName(u) {
  try {
    const url = new URL(u);
    const slug = (url.pathname.replace(/\/+$/, '').split('/').pop() || url.hostname).toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    return `${url.hostname.replace(/[^a-z0-9.-]/gi, '-')}-${slug || 'page'}`;
  } catch { return 'page-assets'; }
}

const OUT_DIR = path.join(DESIGN_ROOT, OUT_NAME);
const baseHref = (() => { try { return new URL(pageUrl); } catch { console.error('Neplatná URL.'); process.exit(1); } })();

const ok   = (m) => console.log(`  ✓  ${m}`);
const skip = (m) => console.log(`  -  ${m}`);
const err  = (m) => console.log(`  ✗  ${m}`);
const log  = (m) => console.log(`  ℹ  ${m}`);

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9,cs;q=0.8',
};

function absUrl(src) {
  if (!src) return null;
  src = src.trim();
  if (!src || src.startsWith('data:') || src.startsWith('javascript:') || src.startsWith('mailto:')) return null;
  try { return new URL(src, baseHref).toString(); } catch { return null; }
}

function isAllowedAsset(assetUrl) {
  try {
    const ext = path.extname(new URL(assetUrl).pathname).toLowerCase().split('?')[0];
    if (IMAGE_EXT.includes(ext)) return true;
    if (VIDEO_EXT.includes(ext)) return INCLUDE_VIDEOS;
  } catch { /* ignore */ }
  return false;
}

function filenameFor(assetUrl) {
  try {
    const u = new URL(assetUrl);
    let name = decodeURIComponent(u.pathname.split('/').pop() || '');
    name = name.split('?')[0];
    if (!name || name === '/') name = `asset-${Math.random().toString(36).slice(2, 8)}`;
    return name.replace(/[\\/:*?"<>|]/g, '_');
  } catch { return `asset-${Math.random().toString(36).slice(2, 8)}`; }
}

async function downloadOne(assetUrl) {
  const outPath = path.join(OUT_DIR, filenameFor(assetUrl));
  if (existsSync(outPath)) return 'exists';
  const r = await fetch(assetUrl, { headers: { ...HEADERS, 'Referer': baseHref.origin + '/' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.byteLength === 0) throw new Error('prázdná odpověď');
  await writeFile(outPath, buf);
  return `${(buf.byteLength / 1024).toFixed(0)} KB`;
}

// ─── Render via Playwright ────────────────────────────────────
async function renderAndCollect(url) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: HEADERS['User-Agent'],
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
  });
  const page = await ctx.newPage();

  const seen = new Set();

  // Hook: capture every image/media URL the browser requests
  page.on('request', (req) => {
    const type = req.resourceType();
    if (type === 'image' || type === 'media' || type === 'fetch' || type === 'xhr') {
      const u = req.url();
      if (isAllowedAsset(u)) seen.add(u);
    }
  });
  page.on('response', (res) => {
    const u = res.url();
    if (isAllowedAsset(u)) seen.add(u);
    // Některé KGM image URL mají jiný extension v URL → check Content-Type
    const ct = (res.headers()['content-type'] || '').toLowerCase();
    if (ct.startsWith('image/') || (INCLUDE_VIDEOS && ct.startsWith('video/'))) {
      seen.add(u);
    }
  });

  log(`Otevírám: ${url}`);
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  } catch (e) {
    log(`(networkidle timeout — pokračuji s tím co se stihlo načíst)`);
  }
  await page.waitForTimeout(WAIT_MS);

  // Volitelný auto-scroll — donutí lazy-loaded obrázky se načíst
  if (AUTO_SCROLL) {
    log('Auto-scrolling pro lazy-loaded assety...');
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let total = 0;
        const step = 500;
        const timer = setInterval(() => {
          window.scrollBy(0, step);
          total += step;
          if (total >= document.body.scrollHeight + 1000) {
            clearInterval(timer);
            window.scrollTo(0, 0);
            resolve();
          }
        }, 250);
      });
    });
    await page.waitForTimeout(2000);
  }

  // Extra extract: rendered DOM — img/source/video URLs + inline backgrounds + computed styles
  const domAssets = await page.evaluate(() => {
    const out = new Set();

    // <img>
    document.querySelectorAll('img').forEach((el) => {
      ['src', 'currentSrc', 'data-src', 'data-lazy-src'].forEach((a) => {
        const v = el[a] || el.getAttribute(a);
        if (v) out.add(v);
      });
      const srcset = el.getAttribute('srcset');
      if (srcset) srcset.split(',').forEach((p) => out.add(p.trim().split(/\s+/)[0]));
    });
    // <source srcset/src>
    document.querySelectorAll('source').forEach((el) => {
      ['src', 'data-src'].forEach((a) => { const v = el.getAttribute(a); if (v) out.add(v); });
      const srcset = el.getAttribute('srcset');
      if (srcset) srcset.split(',').forEach((p) => out.add(p.trim().split(/\s+/)[0]));
    });
    // <video src/poster>
    document.querySelectorAll('video').forEach((el) => {
      const s = el.getAttribute('src'); if (s) out.add(s);
      const p = el.getAttribute('poster'); if (p) out.add(p);
    });
    // <link rel="icon|preload|apple-touch-icon">
    document.querySelectorAll('link[rel]').forEach((el) => {
      const rel = el.getAttribute('rel') || '';
      if (/icon|preload|prefetch|apple-touch/i.test(rel)) {
        const h = el.getAttribute('href'); if (h) out.add(h);
      }
    });
    // meta og:image, twitter:image
    document.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"]').forEach((el) => {
      const c = el.getAttribute('content'); if (c) out.add(c);
    });
    // Inline style background-image
    document.querySelectorAll('[style*="url("]').forEach((el) => {
      const style = el.getAttribute('style') || '';
      for (const m of style.matchAll(/url\(\s*(?:&quot;|"|')?([^)"'&]+)(?:&quot;|"|')?\s*\)/gi)) {
        out.add(m[1]);
      }
    });
    // <style> blocks
    document.querySelectorAll('style').forEach((el) => {
      const css = el.textContent || '';
      for (const m of css.matchAll(/url\(\s*(?:&quot;|"|')?([^)"'&]+)(?:&quot;|"|')?\s*\)/gi)) {
        out.add(m[1]);
      }
    });
    return [...out];
  });

  for (const u of domAssets) {
    const abs = absUrl(u);
    if (abs && isAllowedAsset(abs)) seen.add(abs);
  }

  await browser.close();
  return [...seen];
}

// ─── Main ──────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Download page assets (Playwright)');
  console.log('═══════════════════════════════════════════════');
  console.log(`  URL: ${pageUrl}`);
  console.log(`  Cíl: ${OUT_DIR}`);
  console.log(`  Videa: ${INCLUDE_VIDEOS ? 'ANO' : 'NE (--videos pro mp4)'}`);
  console.log(`  Auto-scroll: ${AUTO_SCROLL ? 'ANO' : 'NE (--scroll pro lazy assets)'}`);
  console.log(`  Wait: ${WAIT_MS}ms\n`);

  const assets = await renderAndCollect(pageUrl);
  console.log(`\n  Nalezeno ${assets.length} unique assetů.\n`);

  if (!existsSync(OUT_DIR)) await mkdir(OUT_DIR, { recursive: true });

  let downloaded = 0, skipped = 0, errors = 0;
  for (let i = 0; i < assets.length; i++) {
    const url = assets[i];
    const name = filenameFor(url);
    try {
      const res = await downloadOne(url);
      if (res === 'exists') { skip(`[${i + 1}/${assets.length}] ${name} (už existuje)`); skipped++; }
      else { ok(`[${i + 1}/${assets.length}] ${name} — ${res}`); downloaded++; }
    } catch (e) {
      err(`[${i + 1}/${assets.length}] ${name}: ${e.message}`);
      errors++;
    }
  }

  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`  Hotovo: ${downloaded} staženo, ${skipped} přeskočeno, ${errors} chyb`);
  console.log(`  Soubory: ${OUT_DIR}`);
  if (errors > 0) log('Některé selhání → spusť znovu (idempotentní).');
  console.log(`═══════════════════════════════════════════════`);
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
