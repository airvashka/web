#!/usr/bin/env node
/**
 * Fetch Google Places API → recenze obou poboček → uložit do src/data/google-reviews.json.
 *
 * Spouští se při build-time (nebo manuálně), žádné runtime API volání → free tier stačí.
 *
 * Použití:
 *   cd web && node scripts/fetch-google-reviews.mjs
 *
 * Nebo automaticky před `npm run build`:
 *   "build": "node scripts/fetch-google-reviews.mjs && astro build"
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, '../src/data/google-reviews.json');

// Minimal .env loader (Vercel env vars přijdou už nastavené přes process.env)
const ENV_PATH = resolve(__dirname, '../.env');
if (existsSync(ENV_PATH)) {
  for (const line of readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const PLACE_ID_PRODEJ = process.env.GOOGLE_PLACE_ID_PRODEJ;
const PLACE_ID_SERVIS = process.env.GOOGLE_PLACE_ID_SERVIS;

if (!API_KEY) {
  console.warn('⚠  GOOGLE_PLACES_API_KEY not set — generating empty placeholder');
  writeFileSync(OUT_PATH, JSON.stringify({ generated_at: new Date().toISOString(), prodej: null, servis: null }, null, 2));
  process.exit(0);
}

const FIELDS = 'name,rating,user_ratings_total,reviews,url,formatted_address,formatted_phone_number,opening_hours,current_opening_hours,utc_offset';

async function fetchPlace(placeId, label) {
  if (!placeId) {
    console.warn(`⚠  Place ID for ${label} not set — skipping`);
    return null;
  }
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${FIELDS}&language=cs&key=${API_KEY}`;
  console.log(`▶ Fetching ${label} (${placeId})...`);
  const r = await fetch(url);
  if (!r.ok) { console.error(`✗ ${label}: HTTP ${r.status}`); return null; }
  const data = await r.json();
  if (data.status !== 'OK') {
    console.error(`✗ ${label}: Google status=${data.status} ${data.error_message ?? ''}`);
    return null;
  }
  const result = data.result;
  console.log(`  ✓ ${label}: ${result.rating}⭐ (${result.user_ratings_total} hodnocení), ${result.reviews?.length ?? 0} recenzí v API`);
  return {
    name: result.name,
    rating: result.rating,
    total_ratings: result.user_ratings_total,
    reviews: (result.reviews ?? []).map((r) => ({
      author_name: r.author_name,
      author_photo: r.profile_photo_url,
      rating: r.rating,
      relative_time: r.relative_time_description,
      time: r.time,
      text: r.text,
      lang: r.language,
    })),
    google_url: result.url,
    address: result.formatted_address,
    phone: result.formatted_phone_number,
    opening_hours: result.opening_hours?.weekday_text ?? null,
    // Strukturované periody pro výpočet otevřeno/zavřeno v prohlížeči.
    // Preferujeme current_opening_hours (zohledňuje svátky/výjimky pro aktuální týden),
    // fallback na běžné opening_hours. Tvar: [{ open:{day,time}, close:{day,time} }, ...]
    // day: 0=neděle … 6=sobota, time: "HHMM".
    hours_periods: (result.current_opening_hours ?? result.opening_hours)?.periods ?? null,
  };
}

async function main() {
  console.log('═══ Fetch Google reviews ═══\n');

  const [prodej, servis] = await Promise.all([
    fetchPlace(PLACE_ID_PRODEJ, 'Prodej'),
    fetchPlace(PLACE_ID_SERVIS, 'Servis'),
  ]);

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify({
    generated_at: new Date().toISOString(),
    prodej,
    servis,
  }, null, 2));

  console.log(`\n✓ Uloženo: ${OUT_PATH}`);
  if (prodej) console.log(`  Prodej: ${prodej.rating}⭐ × ${prodej.total_ratings} (${prodej.reviews.length} reviews fetched)`);
  if (servis) console.log(`  Servis: ${servis.rating}⭐ × ${servis.total_ratings} (${servis.reviews.length} reviews fetched)`);
}

main().catch((e) => { console.error('✗', e); process.exit(1); });
