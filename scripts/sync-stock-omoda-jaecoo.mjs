#!/usr/bin/env node
/**
 * SFR Motor — OMODA & JAECOO stock sync (JSON feed -> Directus stock_vehicles).
 *
 * Zdroj: https://omodajaecoo.app/feed/sfr-motor.json  (cisty JSON, zadny scraping)
 *
 * Co dela:
 *   1) Stahne feed (cely, bez limitu)
 *   2) Mapuje kazdy vuz na stock_vehicles (vin = external_id)
 *   3) Resolve FK: brand (omoda-jaecoo), model (pres MODEL_MAP -> slug)
 *   4) Upsert podle external_source='omoda-jaecoo' + external_id=VIN (Mode B)
 *   5) Fotky: stahne z img.omodajaecoo.app do Directus slozky "Import - OMODA & JAECOO"
 *   6) Sold detection: vozy v Directusu chybejici ve feedu -> availability=sold
 *
 * Mode B: prepisuje list_price/promo_price/km/condition/availability/transmission/
 *   drivetrain/color_category/trim_level_snapshot/synced_at/external_url.
 *   Nikdy neprepisuje highlight_label, highlighted, option_packages, description.
 *
 * CLI:  --dry-run  --limit=N  --no-photos  --skip-sold
 * Pouziti:  cd web && node scripts/sync-stock-omoda-jaecoo.mjs --dry-run
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { Buffer } from 'node:buffer';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const NO_PHOTOS = args.includes('--no-photos');
const SKIP_SOLD = args.includes('--skip-sold');
const LIMIT = parseInt(args.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? '0', 10);
const LIST_MODELS = args.includes('--list-models');

const FEED_URL = 'https://omodajaecoo.app/feed/sfr-motor.json';
const IMPORT_FOLDER_NAME = 'Import - OMODA & JAECOO';
const USER_AGENT = 'Mozilla/5.0 (compatible; sfr-motor-sync/1.0; +https://sfr-motor.cz)';

let DIRECTUS_URL = '', TOKEN = '', EMAIL = '', PASSWORD = '', FOLDER_ID = null;
const rl = readline.createInterface({ input, output });
const prompt = (q) => rl.question(q);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (m) => console.log(`  [ok]  ${m}`);
const info = (m) => console.log(`  [i]   ${m}`);
const warn = (m) => console.log(`  [!]   ${m}`);
const err = (m) => console.log(`  [x]   ${m}`);

// ─── Mapping feed.model (kod) -> nas models.slug + fuel ───
// Doplnis/opravis podle toho, co rekne --dry-run (ktere modely se netrefily).
const MODEL_MAP = {
  // Skutecne slugy z DB (--list-models). PHEV = SHS. Co v DB neni, se skipne.
  // V DB existuji: omoda-5, omoda-5-ev, omoda-5-shs-h, omoda-9-shs,
  //               jaecoo-5, jaecoo-7, jaecoo-7-shs.
  omoda5:        { slug: 'omoda-5',        fuel: 'petrol' },
  omoda5ev:      { slug: 'omoda-5-ev',     fuel: 'ev' },
  omoda5shs:     { slug: 'omoda-5-shs-h',  fuel: 'phev' },
  omoda5phev:    { slug: 'omoda-5-shs-h',  fuel: 'phev' },
  omoda5shsh:    { slug: 'omoda-5-shs-h',  fuel: 'phev' },
  'omoda5shs-h': { slug: 'omoda-5-shs-h',  fuel: 'phev' },
  omoda9shs:     { slug: 'omoda-9-shs',    fuel: 'phev' },
  jaecoo5:       { slug: 'jaecoo-5',       fuel: 'petrol' },
  jaecooj7:      { slug: 'jaecoo-7',       fuel: 'petrol' },
  jaecooj7phev:  { slug: 'jaecoo-7-shs',   fuel: 'phev' },
  jaecooj7shs:   { slug: 'jaecoo-7-shs',   fuel: 'phev' },
  // nize: modely zatim v DB NEJSOU -> tyto vozy se preskoci (dokud je nezalozis)
  omoda7:        { slug: 'omoda-7',        fuel: 'petrol' },
  omoda7shs:     { slug: 'omoda-7-shs',    fuel: 'phev' },
  jaecoo5ev:     { slug: 'jaecoo-5-ev',    fuel: 'ev' },
  jaecoo5shs:    { slug: 'jaecoo-5-shs',   fuel: 'phev' },
  jaecooj8shs:   { slug: 'jaecoo-8-shs',   fuel: 'phev' },
};

const CONDITION_MAP = {
  'skladový vůz': 'new',
  'předváděcí vůz': 'demo',
  'ojetý vůz': 'used',
  'ojeté': 'used',
};

function colorCategory(name) {
  const n = (name ?? '').toLowerCase();
  if (/bíl/.test(n)) return 'white';
  if (/čern/.test(n)) return 'black';
  if (/stříbr|silver/.test(n)) return 'silver';
  if (/šed|grey|gray/.test(n)) return 'grey';
  if (/modr|blue/.test(n)) return 'blue';
  if (/červen|red/.test(n)) return 'red';
  if (/zelen|green/.test(n)) return 'green';
  if (/hněd|brown/.test(n)) return 'brown';
  if (/oranž|orange/.test(n)) return 'orange';
  if (/béž|beige/.test(n)) return 'beige';
  return null;
}

function specVal(specs, title) {
  if (!Array.isArray(specs)) return null;
  const row = specs.find((s) => (s.title ?? '').trim().toLowerCase().startsWith(title.toLowerCase()));
  return row ? String(row.value ?? '').trim() : null;
}

function mapDrivetrain(v) {
  const s = (v ?? '').toLowerCase();
  if (s.includes('awd')) return 'awd';
  if (s.includes('4wd') || s.includes('4x4')) return '4wd';
  if (s.includes('rwd')) return 'rwd';
  if (s.includes('fwd')) return 'fwd';
  return null;
}
function mapTransmission(v) {
  const s = (v ?? '').toLowerCase();
  if (s.includes('mt') || s.includes('manu')) return 'manual';
  return 'automatic'; // DHT/DCT/CVT/AT
}

// ─── Directus API ───
async function login() {
  const r = await fetch(`${DIRECTUS_URL}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!r.ok) throw new Error(`Login failed ${r.status}: ${await r.text()}`);
  TOKEN = (await r.json()).data.access_token;
}
function isTokenExpired(j) { return j?.errors?.[0]?.extensions?.code === 'TOKEN_EXPIRED'; }
async function api(method, path, body, _retried = false) {
  const opts = { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${DIRECTUS_URL}${path}`, opts);
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) {
    if (r.status === 401 && !_retried && isTokenExpired(j)) { await login(); return api(method, path, body, true); }
    throw new Error(`${method} ${path} -> ${r.status}: ${JSON.stringify(j?.errors ?? j)}`);
  }
  return j;
}

async function ensureFolder() {
  const r = await api('GET', `/folders?filter[name][_eq]=${encodeURIComponent(IMPORT_FOLDER_NAME)}&limit=1&fields=id`);
  if (r.data?.[0]?.id) { FOLDER_ID = r.data[0].id; return; }
  const c = await api('POST', '/folders', { name: IMPORT_FOLDER_NAME });
  FOLDER_ID = c.data?.id ?? null;
  info(`Folder "${IMPORT_FOLDER_NAME}" vytvoren (${FOLDER_ID})`);
}

// ─── FK cache ───
const cache = { brand: new Map(), model: new Map(), year: new Map() };
async function resolveBrandId(slug) {
  if (cache.brand.has(slug)) return cache.brand.get(slug);
  const r = await api('GET', `/items/brands?filter[slug][_eq]=${slug}&limit=1&fields=id`);
  const id = r.data?.[0]?.id ?? null; cache.brand.set(slug, id); return id;
}
async function resolveModelId(slug) {
  if (cache.model.has(slug)) return cache.model.get(slug);
  const r = await api('GET', `/items/models?filter[slug][_eq]=${slug}&limit=1&fields=id`);
  const id = r.data?.[0]?.id ?? null; cache.model.set(slug, id); return id;
}
async function resolveNearestYear(modelId) {
  if (cache.year.has(modelId)) return cache.year.get(modelId);
  const r = await api('GET', `/items/model_years?filter[model][_eq]=${modelId}&sort=-year&limit=1&fields=id,year`);
  const y = r.data?.[0] ?? null; cache.year.set(modelId, y); return y;
}

// ─── Photo upload (hotlink download -> Directus) ───
async function uploadPhoto(url, label, idx, _retried = false) {
  const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!r.ok) throw new Error(`Photo ${url} -> ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const ct = r.headers.get('content-type') ?? 'image/jpeg';
  const ext = ct.includes('png') ? '.png' : ct.includes('webp') ? '.webp' : '.jpg';
  const fd = new FormData();
  if (FOLDER_ID) fd.append('folder', FOLDER_ID);
  fd.append('file', new Blob([buf], { type: ct }), `oj-${label}-${idx}${ext}`);
  const up = await fetch(`${DIRECTUS_URL}/files`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: fd });
  if (!up.ok) {
    const tx = await up.text(); let j; try { j = JSON.parse(tx); } catch { j = tx; }
    if (up.status === 401 && !_retried && isTokenExpired(j)) { await login(); return uploadPhoto(url, label, idx, true); }
    throw new Error(`Upload ${up.status}: ${tx}`);
  }
  return (await up.json()).data?.id ?? null;
}

// ─── Mapování jednoho vozu z feedu ───
function mapVehicle(v) {
  const code = String(v.model ?? '').toLowerCase();
  const mm = MODEL_MAP[code] ?? null;
  const colorName = v.color_value ?? null;
  const list = v.book_price ?? null;
  const price = v.price ?? null;
  const promo = (price && list && price < list) ? price : null;
  return {
    code, modelSlug: mm?.slug ?? null, fuel: mm?.fuel ?? null,
    vin: v.vin,
    sync: {
      list_price: list,
      promo_price: promo,
      km: v.tachometr ?? null,
      condition: CONDITION_MAP[(v.category_value ?? '').trim().toLowerCase()] ?? 'new',
      availability: 'in_stock',
      transmission: mapTransmission(specVal(v.specs, 'Převodovka')),
      drivetrain: mapDrivetrain(specVal(v.specs, 'Poháněná náprava')),
      color_category: colorCategory(colorName),
      trim_level_snapshot: {
        raw_name: v.model_version_value ?? null,
        powertrain: code, fuel_guess: mm?.fuel ?? null,
        color: colorName, color_type: v.color_type_value ?? null, color_tone: v.color_tone_value ?? null,
        motorization: specVal(v.specs, 'Pohon'),
        seats: specVal(v.specs, 'Počet sedadel'),
        specs: v.specs ?? [],
        equip: v.equip ?? [],
        note: v.note ?? null,
        source: 'omoda-jaecoo', source_url: v.pdf ?? null,
      },
      synced_at: new Date().toISOString(),
      external_url: v.pdf ?? null,
    },
    gallery: Array.isArray(v.gallery) ? v.gallery.map((g) => g?.img?.path).filter(Boolean) : [],
  };
}

async function findExisting(vin) {
  const r = await api('GET', `/items/stock_vehicles?filter[external_source][_eq]=omoda-jaecoo&filter[external_id][_eq]=${vin}&limit=1&fields=id,external_id`);
  return r.data?.[0] ?? null;
}

async function processVehicle(v, i, total, brandId) {
  const m = mapVehicle(v);
  const label = `[${i + 1}/${total}] ${m.code} ${m.vin}`;
  if (!m.vin) { warn(`${label} chybi VIN — skip`); return { status: 'skip' }; }
  if (!m.modelSlug) { warn(`${label} model "${m.code}" neni v MODEL_MAP — skip`); return { status: 'skip', vin: m.vin }; }

  const modelId = await resolveModelId(m.modelSlug);
  if (!modelId) { warn(`${label} model slug "${m.modelSlug}" nenalezen v Directus — skip`); return { status: 'skip', vin: m.vin }; }
  const year = await resolveNearestYear(modelId);

  const existing = await findExisting(m.vin);

  if (DRY_RUN) {
    console.log(`\n${label}`);
    console.log(`  model -> ${m.modelSlug} (id=${modelId}) rok=${year?.year ?? '?'} fuel=${m.fuel}`);
    console.log(`  cena ${m.sync.list_price} -> promo ${m.sync.promo_price}  km=${m.sync.km}  cond=${m.sync.condition}`);
    console.log(`  prevod=${m.sync.transmission} pohon=${m.sync.drivetrain} barva=${m.sync.color_category} fotek=${m.gallery.length}`);
    console.log(`  ${existing ? `UPDATE id=${existing.id}` : 'CREATE (status=imported)'}`);
    return { status: 'dry-run', vin: m.vin };
  }

  let id;
  if (existing) {
    const patch = { ...m.sync, model_year: year?.id ?? undefined };
    await api('PATCH', `/items/stock_vehicles/${existing.id}`, patch);
    id = existing.id; ok(`${label} updated id=${id}`);
  } else {
    const payload = {
      ...m.sync, status: 'published', external_source: 'omoda-jaecoo', external_id: m.vin,
      brand: brandId, model: modelId, model_year: year?.id ?? null, listed_at: new Date().toISOString(),
    };
    id = (await api('POST', '/items/stock_vehicles', payload)).data?.id;
    ok(`${label} created id=${id}`);
  }

  // Fotky jen pro nove (vyhneme se duplikaci pri re-sync)
  if (!existing && !NO_PHOTOS && m.gallery.length) {
    const fileIds = [];
    for (let k = 0; k < m.gallery.length; k++) {
      try { const fid = await uploadPhoto(m.gallery[k], `${m.code}-${m.vin}`, k + 1); if (fid) fileIds.push(fid); await sleep(150); }
      catch (e) { warn(`  fotka ${k + 1}: ${e.message}`); }
    }
    if (fileIds.length) {
      try { await api('PATCH', `/items/stock_vehicles/${id}`, { photos: fileIds.map((f) => ({ directus_files_id: f })) }); ok(`  ${fileIds.length} fotek nahrano`); }
      catch (e) { warn(`  photo M2M selhal: ${e.message}`); }
    }
  }
  return { status: existing ? 'updated' : 'created', vin: m.vin, id };
}

async function markMissingAsSold(seen) {
  console.log('\nKrok 3: Sold detection...');
  const r = await api('GET', `/items/stock_vehicles?filter[external_source][_eq]=omoda-jaecoo&filter[availability][_neq]=sold&limit=500&fields=id,external_id`);
  let marked = 0;
  for (const v of (r.data ?? [])) {
    if (!seen.has(String(v.external_id))) {
      if (DRY_RUN) info(`  [DRY] sold id=${v.id} vin=${v.external_id}`);
      else { try { await api('PATCH', `/items/stock_vehicles/${v.id}`, { availability: 'sold', sold_at: new Date().toISOString() }); info(`  sold id=${v.id}`); } catch (e) { warn(`  sold selhal id=${v.id}: ${e.message}`); } }
      marked++;
    }
  }
  if (!marked) info('  Zadne chybejici vozy.');
  return marked;
}

async function main() {
  console.log('\n=== OMODA & JAECOO stock sync -> Directus ===');
  if (DRY_RUN) console.log('  [DRY-RUN] nic se nezapise');
  if (LIMIT) console.log(`  [LIMIT=${LIMIT}]`);
  console.log('');
  DIRECTUS_URL = (await prompt('Directus URL [https://sfr-motor-directus.onrender.com]: ')).trim() || 'https://sfr-motor-directus.onrender.com';
  EMAIL = (await prompt('Admin email: ')).trim();
  PASSWORD = (await prompt('Admin heslo: ')).trim();
  console.log('');
  await login(); ok('Auth OK');
  if (!DRY_RUN && !NO_PHOTOS) await ensureFolder();

  const brandId = await resolveBrandId('omoda-jaecoo');
  if (!brandId) { err('Brand "omoda-jaecoo" nenalezen — abort'); process.exit(1); }

  if (LIST_MODELS) {
    const r = await api('GET', `/items/models?filter[brand][_eq]=${brandId}&sort=slug&limit=200&fields=id,slug,name`);
    console.log('\n=== Modely znacky omoda-jaecoo v DB ===');
    for (const m of (r.data ?? [])) console.log(`  id=${m.id}  ${m.slug}   (${m.name})`);
    console.log('');
    rl.close(); return;
  }

  console.log('\nKrok 1: Stahuji feed...');
  const fr = await fetch(FEED_URL, { headers: { 'User-Agent': USER_AGENT } });
  if (!fr.ok) { err(`Feed ${fr.status}`); process.exit(1); }
  const feed = await fr.json();
  ok(`Feed: ${feed.length} vozu`);

  const toDo = LIMIT > 0 ? feed.slice(0, LIMIT) : feed;
  const stats = { created: 0, updated: 0, skip: 0, dryRun: 0 };
  const seen = new Set();
  console.log(`\nKrok 2: Zpracovani ${toDo.length} vozu...`);
  for (let i = 0; i < toDo.length; i++) {
    const res = await processVehicle(toDo[i], i, toDo.length, brandId);
    if (res.vin) seen.add(String(res.vin));
    if (res.status === 'created') stats.created++;
    else if (res.status === 'updated') stats.updated++;
    else if (res.status === 'skip') stats.skip++;
    else if (res.status === 'dry-run') stats.dryRun++;
  }

  let sold = 0;
  if (!SKIP_SOLD && LIMIT === 0) sold = await markMissingAsSold(seen);

  console.log('\n=== Hotovo ===');
  console.log(`  Vytvoreno: ${stats.created}  Aktualizovano: ${stats.updated}  Skip: ${stats.skip}` + (DRY_RUN ? `  Dry: ${stats.dryRun}` : ''));
  if (!SKIP_SOLD && LIMIT === 0) console.log(`  Sold: ${sold}`);
  console.log('  V adminu: Skladovka -> filtr status=Importovano -> zkontroluj a publikuj.\n');
  rl.close();
}

main().catch((e) => { console.error(`X ${e.message}`); rl.close(); process.exit(1); });
