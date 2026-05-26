#!/usr/bin/env node
/**
 * Stáhne fotky tří Farizon vozů ze staré WP stránky do tří složek.
 *
 * Spustit z Windows (sandbox na farizon.sfr-motor.cz nedosáhne):
 *   cd "C:\Users\antos\Desktop\Claude\SFR WEB\SFR WEB\web"
 *   node scripts/download-farizon-photos.mjs
 *
 * Výstup: "SFR WEB/farizon-photos/{folder}/01.jpg, 02.jpg, ..."
 *
 * Filtruje loga, duplicity (WP `-1-1024x768` varianty stejného shotu) a
 * stahuje vždy nejvyšší dostupnou kvalitu, kterou nám prohlížeč vrátil.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_ROOT = resolve(__dirname, '..', '..', 'farizon-photos');

// ─── Per-vehicle URL lists (seřazeno chronologicky, dup. skipnuto) ─────────

const VEHICLES = {
  'sv-19-l3h3-106kwh': [
    // hero (2048) + 17 gallery shotů (1024×768)
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/11/20251120_120202-2048x1536.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/11/20251120_120209-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/11/20251120_120215-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/11/20251120_120230-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/11/20251120_120240-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/11/20251120_120243-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/11/20251120_120254-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/11/20251120_120302-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/11/20251120_120324-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/11/20251120_120357-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/11/20251120_120513-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/11/20251120_120518-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/11/20251120_120525-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/11/20251120_120541-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/11/20251120_120610-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/11/20251120_120616-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/11/20251120_120624-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/11/20251120_120636-1024x768.jpg',
  ],
  'v6e': [
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/04/20250417_1302481-2048x1536.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/04/20250417_130255-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/04/20250417_130318-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/04/20250417_130337-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/04/20250417_130355-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/04/20250417_130427-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/04/20250417_130507-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/04/20250417_130645-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/04/20250417_130658-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/04/20250417_130829-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/04/20250417_130853-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/04/20250417_130928-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/04/20250417_131217-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/04/20250417_131327-1024x768.jpg',
  ],
  'sv-825-l2h1-49kwh': [
    // hero (full res original, bez dimensions v URL)
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/02/Farizon-SV-8.25-L2H1-49kWh-galerie-1.jpg',
    // 25 gallery shotů (2-26), pozn.: 15 je portrait
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/02/Farizon-SV-8.25-L2H1-49kWh-galerie-2-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/02/Farizon-SV-8.25-L2H1-49kWh-galerie-3-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/02/Farizon-SV-8.25-L2H1-49kWh-galerie-4-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/02/Farizon-SV-8.25-L2H1-49kWh-galerie-5-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/02/Farizon-SV-8.25-L2H1-49kWh-galerie-6-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/02/Farizon-SV-8.25-L2H1-49kWh-galerie-7-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/02/Farizon-SV-8.25-L2H1-49kWh-galerie-8-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/02/Farizon-SV-8.25-L2H1-49kWh-galerie-9-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/02/Farizon-SV-8.25-L2H1-49kWh-galerie-10-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/02/Farizon-SV-8.25-L2H1-49kWh-galerie-11-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/02/Farizon-SV-8.25-L2H1-49kWh-galerie-12-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/02/Farizon-SV-8.25-L2H1-49kWh-galerie-13-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/02/Farizon-SV-8.25-L2H1-49kWh-galerie-14-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/02/Farizon-SV-8.25-L2H1-49kWh-galerie-15-768x1024.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/02/Farizon-SV-8.25-L2H1-49kWh-galerie-16-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/02/Farizon-SV-8.25-L2H1-49kWh-galerie-17-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/02/Farizon-SV-8.25-L2H1-49kWh-galerie-18-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/02/Farizon-SV-8.25-L2H1-49kWh-galerie-19-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/02/Farizon-SV-8.25-L2H1-49kWh-galerie-20-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/02/Farizon-SV-8.25-L2H1-49kWh-galerie-21-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/02/Farizon-SV-8.25-L2H1-49kWh-galerie-22-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/02/Farizon-SV-8.25-L2H1-49kWh-galerie-23-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/02/Farizon-SV-8.25-L2H1-49kWh-galerie-24-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/02/Farizon-SV-8.25-L2H1-49kWh-galerie-25-1024x768.jpg',
    'https://farizon.sfr-motor.cz/wp-content/uploads/2025/02/Farizon-SV-8.25-L2H1-49kWh-galerie-26-1024x768.jpg',
  ],
};

// ─── Download helper ────────────────────────────────────────────────────────

async function downloadOne(url, destPath) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (SFR-Motor-downloader)' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} → ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  await writeFile(destPath, buf);
  return buf.length;
}

const pad2 = (n) => String(n).padStart(2, '0');

async function processVehicle(folder, urls) {
  const dir = resolve(OUT_ROOT, folder);
  await mkdir(dir, { recursive: true });
  console.log(`\n▶ ${folder}  (${urls.length} fotek)`);
  let totalBytes = 0;
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const ext = (basename(url).match(/\.([a-z0-9]+)$/i)?.[1] ?? 'jpg').toLowerCase();
    const dest = resolve(dir, `${pad2(i + 1)}.${ext}`);
    try {
      const bytes = await downloadOne(url, dest);
      totalBytes += bytes;
      process.stdout.write(`  ${pad2(i + 1)}.${ext}  ${(bytes / 1024).toFixed(0)} KB\n`);
    } catch (e) {
      console.error(`  ✗ ${url}: ${e.message}`);
    }
  }
  console.log(`  Σ ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
}

async function main() {
  console.log(`Output: ${OUT_ROOT}`);
  await mkdir(OUT_ROOT, { recursive: true });
  for (const [folder, urls] of Object.entries(VEHICLES)) {
    await processVehicle(folder, urls);
  }
  console.log('\n✓ Hotovo.');
}

main().catch((e) => { console.error('✗', e); process.exit(1); });
