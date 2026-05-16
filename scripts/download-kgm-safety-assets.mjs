#!/usr/bin/env node
/**
 * Stáhne všechny obrázky (+ volitelně videa) ze sekce SAFETY na
 * https://en.kg-mobility.com/pr/model/show-room/200000300010004
 *
 * Soubory půjdou do: _design-draft-blog/kgm-tivoli-safety/
 *
 * Použití:
 *   cd "C:\Users\antos\Desktop\Claude\SFR WEB\SFR WEB\web"
 *   node scripts/download-kgm-safety-assets.mjs            # jen obrázky
 *   node scripts/download-kgm-safety-assets.mjs --videos   # i .mp4 videa
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// scripts/ → web/ → SFR WEB/_design-draft-blog/kgm-tivoli-safety/
const OUT_DIR = path.resolve(__dirname, '..', '..', '_design-draft-blog', 'kgm-tivoli-safety');
const INCLUDE_VIDEOS = process.argv.includes('--videos');

const BASE = 'https://en.kg-mobility.com/attached/contents/display/video/2000003000100040004';

// ─── Mapování: slug → URL ──────────────────────────────────────
// Slug = lidsky čitelný název souboru, URL = origin path z KGM
const ASSETS = [
  // ADAS / Active safety (slide 1, sub-slider)
  ['01-aeb-autonomous-emergency-braking',          '20250124180916235_9yM4WE.jpg'],
  ['01-aeb-autonomous-emergency-braking',          '20250124180916340_R2wnLR.mp4'],
  ['02-sew-safety-exit-warning',                    '20250124180934330_REPts3.jpg'],
  ['02-sew-safety-exit-warning',                    '20250124180934455_58Nn2V.mp4'],
  ['03-fvsw-front-vehicle-start-warning',           '20250124180952552_jQStFO.jpg'],
  ['03-fvsw-front-vehicle-start-warning',           '20250124180952730_zzOyQd.mp4'],
  ['04-sdw-safety-distance-warning',                '20250124181010766_O64ibR.jpg'],
  ['04-sdw-safety-distance-warning',                '20250124181010900_tmIOkJ.mp4'],
  ['05-shb-smart-high-beam',                        '20250124181028931_Y1yCqP.jpg'],
  ['05-shb-smart-high-beam',                        '20250124181029026_erBQaT.mp4'],
  ['06-isa-intelligent-speed-assist',               '20250124181047123_S1Y5Rp.jpg'],
  ['06-isa-intelligent-speed-assist',               '20250124181047236_GfnwTv.mp4'],
  ['07-rctw-rcta-rear-cross-traffic',               '20250124181108588_LgHDeD.jpg'],
  ['07-rctw-rcta-rear-cross-traffic',               '20250124181108697_365LK6.mp4'],
  ['08-bsw-bsa-blind-spot',                         '20250124181126828_lOzzHL.jpg'],
  ['08-bsw-bsa-blind-spot',                         '20250124181126915_y3kkhQ.mp4'],
  ['09-ddaw-driver-drowsiness',                     '20250124181145054_numy8F.jpg'],
  ['09-ddaw-driver-drowsiness',                     '20250124181145173_pdhRWb.mp4'],
  ['10-ldw-clka-lane-departure',                    '20250124181203264_n5enJD.jpg'],
  ['10-ldw-clka-lane-departure',                    '20250124181203385_w35SS7.mp4'],

  // Slide 2 — Safety-prioritized design
  ['11-high-strength-steel-79percent',              '20250124181354421_c7CWxL.jpg'],

  // Slide 3 — Airbags
  ['12-airbags-7',                                  '20250124181514169_NgMIlk.jpg'],

  // Slide 4 — ESC + sub-slider
  ['13-esc-electronic-stability-control',           '20250124181633932_pQLoY4.jpg'],
  ['14-hdc-hill-descent-control',                   '20250124181652124_WLGMX8.jpg'],
  ['14-hdc-hill-descent-control',                   '20250124181652230_rrJWLs.mp4'],
  ['15-bas-brake-assist-system',                    '20250124181710259_oTaMdO.jpg'],
  ['15-bas-brake-assist-system',                    '20250124181710381_VoJhYK.mp4'],
  ['16-arp-active-rollover-protection',             '20250124181728328_vdRdly.jpg'],
  ['16-arp-active-rollover-protection',             '20250124181728473_WsNO6d.mp4'],
  ['17-hsa-hill-start-assist',                      '20250124181746376_8wtefL.jpg'],
  ['17-hsa-hill-start-assist',                      '20250124181746488_xXlDRM.mp4'],
  ['18-ess-emergency-stop-signal',                  '20250124181804506_3CT8BY.jpg'],
  ['18-ess-emergency-stop-signal',                  '20250124181804634_3D6o2Z.mp4'],

  // Slide 5 — Additional safety features
  ['19-additional-safety-features-overview',        '20250124181924579_ONlTRn.jpg'],
  ['20-tpms-tyre-pressure-monitoring',              '20250124181939893_kUQPiJ.jpg'],
  ['21-isofix-child-seat-anchorage',                '20250124181955376_EBDbd5.jpg'],
];

const ok   = (m) => console.log(`  ✓  ${m}`);
const skip = (m) => console.log(`  -  ${m}`);
const err  = (m) => console.log(`  ✗  ${m}`);

async function downloadOne(slug, filename) {
  const ext = path.extname(filename); // .jpg / .mp4
  if (ext === '.mp4' && !INCLUDE_VIDEOS) return 'skip-video';

  // unique output name: slug + extension (collisions OK protože jpg + mp4 jsou různé)
  const outName = `${slug}${ext}`;
  const outPath = path.join(OUT_DIR, outName);
  if (existsSync(outPath)) return 'exists';

  const url = `${BASE}/${filename}`;
  const r = await fetch(url, {
    headers: {
      // Některé CDN vyžadují User-Agent + Referer
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://en.kg-mobility.com/',
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  await writeFile(outPath, buf);
  return `${(buf.byteLength / 1024).toFixed(0)} KB`;
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Download KGM Tivoli — SAFETY assets');
  console.log('═══════════════════════════════════════════════');
  console.log(`  Cíl: ${OUT_DIR}`);
  console.log(`  Videa: ${INCLUDE_VIDEOS ? 'ANO (.mp4 stahuje)' : 'NE (jen .jpg — použij --videos pro mp4)'}\n`);

  if (!existsSync(OUT_DIR)) await mkdir(OUT_DIR, { recursive: true });

  let downloaded = 0, skipped = 0, errors = 0;
  for (const [slug, filename] of ASSETS) {
    try {
      const result = await downloadOne(slug, filename);
      if (result === 'skip-video') { /* silent */ skipped++; }
      else if (result === 'exists') { skip(`${slug}${path.extname(filename)} (už existuje)`); skipped++; }
      else { ok(`${slug}${path.extname(filename)} — ${result}`); downloaded++; }
    } catch (e) {
      err(`${slug} (${filename}): ${e.message}`);
      errors++;
    }
  }

  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`  Hotovo: ${downloaded} staženo, ${skipped} přeskočeno, ${errors} chyb`);
  console.log(`  Soubory: ${OUT_DIR}`);
  console.log(`═══════════════════════════════════════════════`);
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
