#!/usr/bin/env node
/**
 * SFR Motor — KGM stock sync (stock.sfrmotor.kgmcars.cz → Directus stock_vehicles).
 *
 * Co skript dělá:
 *   1) Scrape listing (4 stránek, ~42 vozů)
 *   2) Pro každý detail: parse spec table + ceny + fotky + features
 *   3) Mapping: KGM labels → Directus enums (fuel, drivetrain, transmission, color_category)
 *   4) Resolve FK: brand (KGM), model (přes slug), model_year (nejbližší rok), trim_level (fuzzy)
 *   5) Upsert podle (external_source='kgm', external_id) — Mode B (sync core, preserve local enrichment)
 *   6) Upload fotek do Directus folder "Import — KGM" (volitelné)
 *   7) Sold detection: vozy v Directusu chybějící v feedu → availability=sold
 *
 * Mode B — fields chování:
 *   PŘEPISUJEME při sync:
 *     list_price, km, condition, availability, transmission, drivetrain,
 *     color_code, color_category, trim_level_snapshot, synced_at, external_url
 *   NIKDY NEPŘEPISUJEME (lokální obohacení):
 *     highlight_label, highlighted, color_ref (M2O), interior_color_ref (M2O),
 *     option_packages (M2M), extra_features, description
 *
 * CLI:
 *   --dry-run         neukládá do Directus, jen vypíše co by udělal
 *   --limit=N         zpracuje jen prvních N vozů (pro test)
 *   --no-photos       přeskočí upload fotek (rychlejší test)
 *   --skip-sold       přeskočí sold detection (jen import nových/update existujících)
 *
 * Předpoklady:
 *   - npm install cheerio (na HTML parsing)
 *   - Schema additions hotové (status=imported, external_source/id/url, synced_at)
 *   - Folder "Import — KGM" exists (id v KGM_IMPORT_FOLDER_ID)
 *
 * Použití:
 *   cd web && node scripts/sync-stock-kgm.mjs --dry-run --limit=3
 *   cd web && node scripts/sync-stock-kgm.mjs --limit=5         # malý import
 *   cd web && node scripts/sync-stock-kgm.mjs                   # plný import
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { Buffer } from 'node:buffer';

// Cheerio — HTML parser. Pokud chybí: npm install cheerio
let load;
try {
  ({ load } = await import('cheerio'));
} catch {
  console.error('✗ Chybí cheerio. Spusť: npm install cheerio');
  process.exit(1);
}

// ─── CLI args ─────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const NO_PHOTOS = args.includes('--no-photos');
const SKIP_SOLD = args.includes('--skip-sold');
const LIMIT = parseInt(args.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? '0', 10);

// ─── Config ───────────────────────────────────────────────
const KGM_BASE = 'https://stock.sfrmotor.kgmcars.cz';
const KGM_IMPORT_FOLDER_ID = 'cbb47ab0-5a42-4bf3-ba6d-7cfb1c6fd3ee'; // viz setup-file-folders.mjs output
const REQUEST_DELAY_MS = 500; // mezi requesty na KGM
const USER_AGENT = 'Mozilla/5.0 (compatible; sfr-motor-sync/1.0; +https://sfr-motor.cz)';

// ─── Globals ──────────────────────────────────────────────
let DIRECTUS_URL = '', TOKEN = '', EMAIL = '', PASSWORD = '';
const rl = readline.createInterface({ input, output });
const prompt = (q) => rl.question(q);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ok = (m) => console.log(`  ✓  ${m}`);
const info = (m) => console.log(`  ℹ  ${m}`);
const warn = (m) => console.log(`  ⚠  ${m}`);
const err = (m) => console.log(`  ✗  ${m}`);

// ─── Mappings ─────────────────────────────────────────────
const CONDITION_MAP = {
  'nové': 'new',
  'předváděcí': 'demo',
  'ojeté': 'used',
};
const DRIVETRAIN_MAP = {
  'přední': 'fwd',
  'zadní': 'rwd',
  '4x4': '4wd',
  'awd': 'awd',
};
const TRANSMISSION_MAP = {
  'manuální': 'manual',
  'automatická': 'automatic',
};
const AVAILABILITY_MAP = {
  'je skladem': 'in_stock',
  'na cestě': 'on_the_way',
  'rezervováno': 'reserved',
};
const FUEL_MAP = {
  'benzín': 'petrol',
  'diesel': 'diesel',
  'hybrid': 'hybrid',
  'phev': 'phev',
  'plug-in': 'phev',
  'elektro': 'ev',
  'ev': 'ev',
};

function mapByPrefix(label, map) {
  if (!label) return null;
  const l = label.trim().toLowerCase();
  for (const [k, v] of Object.entries(map)) {
    if (l.startsWith(k) || l.includes(k)) return v;
  }
  return null;
}

// KGM URL používá jiné slugy než náš Directus — mapování model-code → models.slug
const KGM_MODEL_CODE_MAP = {
  'actyon':         'actyon',
  'actyon-hybrid':  'actyon-hev',
  'torres':         'torres',
  'torres-evx':     'torres-evx',
  'torres-hybrid':  'torres-hev',
  'rexton':         'rexton',
  'rexton-new':     'rexton',  // KGM nová generace Rextonu — my máme jeden Rexton
  'korando':        'korando',
  'musso-grand':    'musso-grand',
  'tivoli':         'tivoli',
  'tivoli-grand':   'tivoli',  // Tivoli Grand v Directus chybí — fallback na tivoli
};

function mapKgmModelCode(code) {
  if (!code) return null;
  return KGM_MODEL_CODE_MAP[code] ?? code;
}

function colorCategory(name) {
  const n = (name ?? '').toLowerCase();
  if (/bíl/.test(n)) return 'white';
  if (/čern/.test(n)) return 'black';
  if (/stříbr|silver/.test(n)) return 'silver';
  if (/šed|grey|gray|iron|space/.test(n)) return 'grey';
  if (/modr|blue|dandy|sky/.test(n)) return 'blue';
  if (/červen|red/.test(n)) return 'red';
  if (/zelen|green/.test(n)) return 'green';
  if (/žlut|yellow/.test(n)) return 'yellow';
  if (/hněd|brown|latté|latte/.test(n)) return 'brown';
  if (/oranž|orange/.test(n)) return 'orange';
  if (/fialov|purple/.test(n)) return 'purple';
  if (/béž|beige/.test(n)) return 'beige';
  return null;
}

// ─── Parsers ──────────────────────────────────────────────
function parsePrice(text) {
  if (!text) return null;
  const m = String(text).match(/([\d\s.]+)\s*Kč/);
  if (!m) return null;
  return parseInt(m[1].replace(/[\s.]/g, ''), 10);
}

function parseKm(text) {
  if (!text) return null;
  const m = String(text).match(/([\d\s.]+)\s*km/i);
  if (!m) return null;
  return parseInt(m[1].replace(/[\s.]/g, ''), 10);
}

function parseColor(text) {
  if (!text) return { name: null, code: null };
  const m = text.match(/^(.+?)\s*\[(\w+)\]\s*$/);
  if (m) return { name: m[1].trim(), code: m[2].trim() };
  return { name: text.trim(), code: null };
}

function parseExternalId(detailUrl) {
  // /skladove-vozy/tivoli-15turbo-mt-style-bilacerny-308?model-code=tivoli → "308"
  const noQuery = detailUrl.split('?')[0];
  // Primární: -číslo na konci slugu
  let m = noQuery.match(/-(\d+)$/);
  if (m) return m[1];
  // Fallback: jakýkoli koncový číselný blok bez pomlčky (např. "...vozu369")
  m = noQuery.match(/(\d+)$/);
  return m ? m[1] : null;
}

function parseModelCode(detailUrl) {
  // Primary: ?model-code= query param (přítomné na listing linky)
  const m = detailUrl.match(/[?&]model-code=([^&]+)/);
  if (m) return decodeURIComponent(m[1]);
  // Fallback: derivuj z prefixu slugu (sitemap URLs query param nemají)
  return deriveModelCodeFromSlug(detailUrl);
}

// ─── Directus API ─────────────────────────────────────────
async function login() {
  const r = await fetch(`${DIRECTUS_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!r.ok) throw new Error(`Login failed ${r.status}: ${await r.text()}`);
  const j = await r.json();
  TOKEN = j.data.access_token;
}

function isTokenExpired(jsonResp) {
  return jsonResp?.errors?.[0]?.extensions?.code === 'TOKEN_EXPIRED';
}

async function api(method, path, body, _retried = false) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${DIRECTUS_URL}${path}`, opts);
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) {
    if (r.status === 401 && !_retried && isTokenExpired(j)) {
      info('Token expired — re-login + retry');
      await login();
      return api(method, path, body, true);
    }
    throw new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(j?.errors ?? j)}`);
  }
  return j;
}

// ─── KGM fetcher ──────────────────────────────────────────
async function kgmFetch(url) {
  const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!r.ok) throw new Error(`KGM ${url} → ${r.status}`);
  return r.text();
}

async function fetchListingUrls() {
  console.log('\nKrok 1: Načítání listing přes headless Chromium (Playwright)...');
  console.log('  (KGM má JS-only pagination + broken sitemap, plain fetch vidí jen 5 vozů)\n');

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error('Chybí playwright. Spusť:\n    cd web && npm install playwright && npx playwright install chromium');
  }

  const urls = new Set();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (e) {
    throw new Error(`Playwright launch failed: ${e.message}\nMožná chybí Chromium binary — spusť: npx playwright install chromium`);
  }

  try {
    const context = await browser.newContext({ userAgent: USER_AGENT });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);

    await page.goto(`${KGM_BASE}/`, { waitUntil: 'networkidle' });

    // Sběr URLs z aktuálního DOM
    async function collectFromPage(label) {
      const links = await page.$$eval('a[href*="/skladove-vozy/"]', (els) =>
        els.map((a) => a.href).filter((h, i, arr) => arr.indexOf(h) === i)
      );
      const before = urls.size;
      links.forEach((u) => urls.add(u));
      info(`${label}: ${links.length} linků v DOM (přidáno ${urls.size - before} nových, celkem ${urls.size})`);
      return links.length;
    }

    await collectFromPage('Page 1');

    // Iterace: dynamicky re-detect pagination po každé page
    // (Nette často zobrazí jen 4 čísla — po kliku na 4 se objeví 5, 6, 7, 8, 9)
    const visitedPages = new Set([1]);
    const MAX_TOTAL_PAGES = 20; // safety

    while (visitedPages.size < MAX_TOTAL_PAGES) {
      // Najdi jakoukoli page > 1, kterou jsme ještě nenavštívili
      const allPageNums = await page.$$eval('a[href*="carList-page="]', (els) =>
        els.map((a) => {
          const m = a.href.match(/carList-page=(\d+)/);
          return m ? parseInt(m[1], 10) : 0;
        }).filter((n) => n > 1)
      );
      const unique = [...new Set(allPageNums)].sort((a, b) => a - b);
      const next = unique.find((n) => !visitedPages.has(n));

      if (!next) {
        info(`Pagination: žádné další unvisited pages. Navštíveno: [${[...visitedPages].sort((a, b) => a - b).join(',')}]`);
        break;
      }

      const sel = `a[href*="carList-page=${next}"]`;
      const link = await page.$(sel);
      if (!link) {
        warn(`Page ${next}: link nenalezen, končím`);
        break;
      }

      try {
        await Promise.all([
          page.waitForResponse((r) => r.url().includes('carList-page') && r.status() === 200, { timeout: 10000 }).catch(() => null),
          link.click(),
        ]);
        await page.waitForLoadState('networkidle').catch(() => null);
        await sleep(500);
        const added = await collectFromPage(`Page ${next}`);
        visitedPages.add(next);
        if (added === 0) {
          info('Žádné nové linky na této stránce — zastavuji');
          break;
        }
      } catch (e) {
        warn(`Page ${next}: ${e.message}`);
        visitedPages.add(next); // mark even on error, ať se nezacyklí
      }
    }
  } finally {
    await browser.close();
  }

  return [...urls];
}

// Pokud sitemap URL nemá ?model-code= (často nemá), derivuj z prefixu slugu
function deriveModelCodeFromSlug(detailUrl) {
  const m = detailUrl.match(/\/skladove-vozy\/([^/?]+)/);
  if (!m) return null;
  const slug = m[1];
  // Sort longest first aby "tivoli-grand" zachytil dříve než "tivoli"
  const known = Object.keys(KGM_MODEL_CODE_MAP).sort((a, b) => b.length - a.length);
  for (const code of known) {
    if (slug.startsWith(code + '-') || slug === code) return code;
  }
  return null;
}

// ─── Detail parser ────────────────────────────────────────
async function parseDetail(detailUrl) {
  const html = await kgmFetch(detailUrl);
  const $ = load(html);

  // 1) Spec table — KGM používá <table class="profile__table"> s <th>label</th><td>value</td>
  const spec = {};
  $('table.profile__table tr, table tr').each((_, tr) => {
    const th = $(tr).find('th').first();
    const td = $(tr).find('td').first();
    if (th.length && td.length) {
      // th obsahuje <i class="icon"> + text label — bere se .text() který je čistý
      const k = th.text().replace(/\s+/g, ' ').trim();
      const v = td.text().replace(/\s+/g, ' ').trim();
      if (k && v && !spec[k]) spec[k] = v;
    }
  });

  // 2) Cena — "409.900 Kč s DPH" — najdi první výskyt v textu stránky
  const priceVAT = parsePrice($('body').text().match(/([\d\s.]+\s*Kč\s*s\s*DPH)/i)?.[1] ?? '');
  const priceNoVAT = parsePrice($('body').text().match(/([\d\s.]+\s*Kč\s*bez\s*DPH)/i)?.[1] ?? '');

  // 3) Fotky — sdff-get URLs. Bereme jen <a href="..."> (full-size), ne <img src=...> (thumb)
  const photoUrls = new Set();
  $('a[href*="sdff-get"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const abs = href.startsWith('http') ? href : KGM_BASE + href;
    photoUrls.add(abs);
  });
  // Fallback: <img src> pokud nemáme dost full-size
  if (photoUrls.size < 3) {
    $('img[src*="sdff-get"]').each((_, el) => {
      const src = $(el).attr('src');
      if (!src) return;
      const abs = src.startsWith('http') ? src : KGM_BASE + src;
      photoUrls.add(abs);
    });
  }

  // 4) Optional packages — sekce "Příplatková výbava".
  // KGM ji renderuje jako akordeon: <div class="accordion__button">Příplatková výbava</div>
  // + sousedni <div class="accordion__collapse"><ul class="profile__list"><li>...</li></ul></div>.
  // (Drive hledano jako h2/h3 + nasledujici ul -> mineno, proto bylo prazdne.)
  const optionalPackages = [];
  $('.accordion__button').each((_, el) => {
    if (!/příplatková\s+výbava/i.test($(el).text())) return;
    const collapse = $(el).next('.accordion__collapse').length
      ? $(el).next('.accordion__collapse')
      : $(el).closest('.accordion__item').find('.accordion__collapse').first();
    collapse.find('li').each((__, li) => {
      const txt = $(li).text().trim();
      if (txt) optionalPackages.push(txt);
    });
  });
  // Fallback pro pripadnou starsi/jinou strukturu (h2/h3 + nasledujici ul)
  if (optionalPackages.length === 0) {
    $('h2, h3').each((_, el) => {
      if (/příplatková\s+výbava/i.test($(el).text())) {
        $(el).nextUntil('h2, h3', 'ul').find('li').each((__, li) => {
          const txt = $(li).text().trim();
          if (txt) optionalPackages.push(txt);
        });
      }
    });
  }

  // 5) Standardní výbava grouped — H2 nadpisy + UL po nich
  const features = {};
  const featureSections = ['Výbava', 'Zavěšení kol, řízení, brzdy', 'Asistenční systémy',
    'Bezpečnost', 'Interiér / komfort', 'Multimedia', 'Exteriér', 'Barvy exteriéru'];

  $('h2').each((_, h2) => {
    const heading = $(h2).text().trim();
    if (!featureSections.some((s) => heading === s)) return;
    const items = [];
    $(h2).nextUntil('h2', 'ul').find('li').each((__, li) => {
      const t = $(li).text().trim();
      if (t) items.push(t);
    });
    if (items.length) features[heading] = items;
  });

  return {
    detailUrl,
    externalId: parseExternalId(detailUrl),
    modelCode: parseModelCode(detailUrl),
    spec,
    priceVAT,
    priceNoVAT,
    photoUrls: [...photoUrls],
    optionalPackages,
    features,
  };
}

// ─── FK resolution ────────────────────────────────────────
const cache = { brands: new Map(), models: new Map(), years: new Map(), trims: new Map() };

async function resolveBrandId(slug) {
  if (cache.brands.has(slug)) return cache.brands.get(slug);
  const r = await api('GET', `/items/brands?filter[slug][_eq]=${slug}&limit=1&fields=id`);
  const id = r.data?.[0]?.id ?? null;
  cache.brands.set(slug, id);
  return id;
}

async function resolveModelId(slug) {
  if (cache.models.has(slug)) return cache.models.get(slug);
  const r = await api('GET', `/items/models?filter[slug][_eq]=${slug}&limit=1&fields=id`);
  const id = r.data?.[0]?.id ?? null;
  cache.models.set(slug, id);
  return id;
}

async function resolveModelYear(modelId, year) {
  const key = `${modelId}:${year}`;
  if (cache.years.has(key)) return cache.years.get(key);
  // Try exact year
  let r = await api('GET', `/items/model_years?filter[model][_eq]=${modelId}&filter[year][_eq]=${year}&sort=-version&limit=1&fields=id,year,version`);
  let result = r.data?.[0] ?? null;
  if (!result) {
    // Fallback: jakýkoli rok, nejnovější první
    r = await api('GET', `/items/model_years?filter[model][_eq]=${modelId}&sort=-year&limit=1&fields=id,year,version`);
    result = r.data?.[0] ?? null;
  }
  cache.years.set(key, result);
  return result;
}

async function resolveTrim(modelYearId, trimName) {
  const key = `${modelYearId}:${trimName?.toLowerCase()}`;
  if (cache.trims.has(key)) return cache.trims.get(key);
  if (!trimName) { cache.trims.set(key, null); return null; }
  // Fuzzy: ignore case, allow "+ paket" being stripped
  const r = await api('GET', `/items/trim_levels?filter[model_year][_eq]=${modelYearId}&limit=50&fields=id,name`);
  const lc = trimName.trim().toLowerCase();
  const found = (r.data ?? []).find((t) => (t.name ?? '').trim().toLowerCase() === lc) ?? null;
  cache.trims.set(key, found);
  return found;
}

// ─── Photo upload ─────────────────────────────────────────
async function uploadPhoto(photoUrl, vehicleLabel, index, _retried = false) {
  const r = await fetch(photoUrl, { headers: { 'User-Agent': USER_AGENT } });
  if (!r.ok) throw new Error(`Photo ${photoUrl} → ${r.status}`);
  const ab = await r.arrayBuffer();
  const buf = Buffer.from(ab);

  // Generate filename — KGM URL nemá pěkný název
  const ext = r.headers.get('content-type')?.includes('png') ? '.png' : '.jpg';
  const filename = `kgm-${vehicleLabel}-${index}${ext}`;

  // Multipart upload
  const formData = new FormData();
  formData.append('folder', KGM_IMPORT_FOLDER_ID);
  formData.append('file', new Blob([buf], { type: r.headers.get('content-type') ?? 'image/jpeg' }), filename);

  const upload = await fetch(`${DIRECTUS_URL}/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: formData,
  });
  if (!upload.ok) {
    const text = await upload.text();
    let j; try { j = JSON.parse(text); } catch { j = text; }
    if (upload.status === 401 && !_retried && isTokenExpired(j)) {
      info('  Token expired při photo upload — re-login + retry');
      await login();
      return uploadPhoto(photoUrl, vehicleLabel, index, true);
    }
    throw new Error(`Directus upload ${upload.status}: ${text}`);
  }
  const result = await upload.json();
  return result.data?.id ?? null;
}

// ─── Upsert logika ────────────────────────────────────────
function buildSyncFields(parsed, fkIds, trimLevelSnapshot) {
  // Fields se vždy přepíšou při sync (i u existujících)
  return {
    list_price: parsed.priceVAT ?? null,
    km: parseKm(parsed.spec['Stav tachometru']),
    condition: mapByPrefix(parsed.spec['Stav vozu'], CONDITION_MAP),
    availability: mapByPrefix(parsed.spec['Dostupnost'], AVAILABILITY_MAP) ?? 'in_stock',
    transmission: mapByPrefix(parsed.spec['Převodovka'], TRANSMISSION_MAP),
    drivetrain: mapByPrefix(parsed.spec['Pohon'], DRIVETRAIN_MAP),
    color_code: parseColor(parsed.spec['Barva']).code,
    color_category: colorCategory(parseColor(parsed.spec['Barva']).name),
    interior_code: parseColor(parsed.spec['Barva interiéru']).code,
    trim_level_snapshot: trimLevelSnapshot,
    synced_at: new Date().toISOString(),
    external_url: parsed.detailUrl,
  };
}

function buildCreateFields(parsed, fkIds, trimLevelSnapshot) {
  return {
    ...buildSyncFields(parsed, fkIds, trimLevelSnapshot),
    status: 'published',
    external_source: 'kgm',
    external_id: parsed.externalId,
    brand: fkIds.brandId,
    model: fkIds.modelId,
    model_year: fkIds.modelYearId,
    trim_level: fkIds.trimLevelId,
    listed_at: new Date().toISOString(),
  };
}

async function findExisting(externalId) {
  const r = await api('GET', `/items/stock_vehicles?filter[external_source][_eq]=kgm&filter[external_id][_eq]=${externalId}&limit=1&fields=id,external_id,photos`);
  return r.data?.[0] ?? null;
}

// ─── Main process ─────────────────────────────────────────
async function processVehicle(detailUrl, index, total) {
  const label = `[${index + 1}/${total}]`;
  console.log(`\n${label} ${detailUrl}`);

  let parsed;
  try {
    parsed = await parseDetail(detailUrl);
  } catch (e) {
    err(`Parse selhal: ${e.message}`);
    return { status: 'error', externalId: null };
  }

  if (!parsed.externalId) {
    warn('Chybí external_id — skip');
    return { status: 'skip', externalId: null };
  }
  if (!parsed.modelCode) {
    warn('Chybí model-code — skip');
    return { status: 'skip', externalId: parsed.externalId };
  }

  // Resolve FKs
  const brandId = await resolveBrandId('kgm');
  if (!brandId) {
    err('Brand "kgm" nenalezen v Directus — abort');
    return { status: 'error', externalId: parsed.externalId };
  }

  // KGM používá jiné slugy ("actyon-hybrid") než my ("actyon-hev") — mapujeme
  const directusModelSlug = mapKgmModelCode(parsed.modelCode);
  const modelId = await resolveModelId(directusModelSlug);
  if (!modelId) {
    warn(`Model "${parsed.modelCode}" → "${directusModelSlug}" nenalezen v Directus — skip vůz`);
    return { status: 'skip', externalId: parsed.externalId };
  }

  const yearStr = parsed.spec['Rok výroby'];
  const year = yearStr ? parseInt(yearStr, 10) : null;
  const modelYear = year ? await resolveModelYear(modelId, year) : null;
  if (!modelYear) {
    warn(`Model year pro ${parsed.modelCode} ${year} nenalezen — vůz pojede bez model_year FK`);
  }

  const trim = modelYear ? await resolveTrim(modelYear.id, parsed.spec['Výbavový stupeň']) : null;
  if (!trim) {
    info(`Trim "${parsed.spec['Výbavový stupeň']}" nenalezen v ${parsed.modelCode} ${modelYear?.year ?? '?'} — pojede s trim_snapshot`);
  }

  const fkIds = {
    brandId,
    modelId,
    modelYearId: modelYear?.id ?? null,
    trimLevelId: trim?.id ?? null,
  };

  const trimLevelSnapshot = {
    raw_name: parsed.spec['Výbavový stupeň'] ?? null,
    motorization: parsed.spec['Motorizace'] ?? null,
    color: parsed.spec['Barva'] ?? null,
    interior_color: parsed.spec['Barva interiéru'] ?? null,
    seats: parsed.spec['Počet míst'] ?? null,
    optional_packages: parsed.optionalPackages,
    features: parsed.features,
    source: 'kgm',
    source_url: parsed.detailUrl,
  };

  // Existing?
  const existing = await findExisting(parsed.externalId);

  if (DRY_RUN) {
    console.log(`  Brand=${brandId}  Model=${modelId} (KGM "${parsed.modelCode}" → "${directusModelSlug}")`);
    console.log(`  Year=${modelYear?.year ?? '?'} (id=${modelYear?.id ?? '-'})  Trim=${trim?.name ?? '(nenalezen)'} (id=${trim?.id ?? '-'})`);
    console.log(`  Cena: ${parsed.priceVAT} Kč  km: ${parseKm(parsed.spec['Stav tachometru'])}  cond: ${mapByPrefix(parsed.spec['Stav vozu'], CONDITION_MAP)}`);
    console.log(`  Barva: ${parsed.spec['Barva']} → ${parseColor(parsed.spec['Barva']).code} / ${colorCategory(parseColor(parsed.spec['Barva']).name)}`);
    console.log(`  Pohon: ${parsed.spec['Pohon']} → ${mapByPrefix(parsed.spec['Pohon'], DRIVETRAIN_MAP)}  Převod: ${parsed.spec['Převodovka']} → ${mapByPrefix(parsed.spec['Převodovka'], TRANSMISSION_MAP)}`);
    console.log(`  Fotek: ${parsed.photoUrls.length}  Pakety: ${parsed.optionalPackages.length}  Feature groups: ${Object.keys(parsed.features).length}`);
    if (existing) console.log(`  → Upsert PATCH existující id=${existing.id}`);
    else console.log(`  → CREATE nový (status=imported)`);
    return { status: 'dry-run', externalId: parsed.externalId };
  }

  let vehicleId;
  if (existing) {
    // Mode B: jen sync fields
    const patch = buildSyncFields(parsed, fkIds, trimLevelSnapshot);
    // Doplň FK jen pokud chybí v existujícím (nemažeme manuální vazby)
    if (fkIds.modelYearId) patch.model_year = fkIds.modelYearId;
    if (fkIds.trimLevelId) patch.trim_level = fkIds.trimLevelId;
    await api('PATCH', `/items/stock_vehicles/${existing.id}`, patch);
    vehicleId = existing.id;
    ok(`Updated id=${vehicleId}`);
  } else {
    const payload = buildCreateFields(parsed, fkIds, trimLevelSnapshot);
    const created = await api('POST', '/items/stock_vehicles', payload);
    vehicleId = created.data?.id;
    ok(`Created id=${vehicleId} (status=imported)`);
  }

  // Upload fotek — jen pro NOVÉ (vyhneme se duplikování při re-sync)
  if (!existing && !NO_PHOTOS && parsed.photoUrls.length > 0) {
    console.log(`  Uploaduji ${parsed.photoUrls.length} fotek...`);
    const fileIds = [];
    for (let i = 0; i < parsed.photoUrls.length; i++) {
      try {
        const fileId = await uploadPhoto(parsed.photoUrls[i], `${parsed.modelCode}-${parsed.externalId}`, i + 1);
        if (fileId) fileIds.push(fileId);
        await sleep(200);
      } catch (e) {
        warn(`  Fotka ${i + 1}: ${e.message}`);
      }
    }
    if (fileIds.length > 0) {
      // M2M link — formát: [{ directus_files_id: fileId }, ...]
      const photosPayload = fileIds.map((fid) => ({ directus_files_id: fid }));
      try {
        await api('PATCH', `/items/stock_vehicles/${vehicleId}`, { photos: photosPayload });
        ok(`  ${fileIds.length} fotek nahráno`);
      } catch (e) {
        warn(`  Photo M2M link selhal: ${e.message}`);
      }
    }
  } else if (existing && !NO_PHOTOS) {
    info(`  Fotky skip (vůz už existuje — fotky se neresyncují, smaž v adminu pokud chceš nové)`);
  }

  return { status: existing ? 'updated' : 'created', externalId: parsed.externalId, id: vehicleId };
}

// ─── Sold detection ───────────────────────────────────────
async function markMissingAsSold(seenIds) {
  console.log('\nKrok 4: Sold detection — vozy z Directus chybějící v KGM feedu...');
  const r = await api('GET', `/items/stock_vehicles?filter[external_source][_eq]=kgm&filter[availability][_neq]=sold&limit=500&fields=id,external_id`);
  const candidates = r.data ?? [];
  let marked = 0;
  for (const v of candidates) {
    if (!seenIds.has(String(v.external_id))) {
      if (DRY_RUN) {
        info(`  [DRY] Mark sold id=${v.id} external_id=${v.external_id}`);
      } else {
        try {
          await api('PATCH', `/items/stock_vehicles/${v.id}`, { availability: 'sold', sold_at: new Date().toISOString() });
          info(`  Marked sold id=${v.id} (external_id=${v.external_id})`);
        } catch (e) {
          warn(`  Sold patch selhal id=${v.id}: ${e.message}`);
        }
      }
      marked++;
    }
  }
  if (marked === 0) info('  Žádné chybějící vozy.');
  return marked;
}

// ─── Main ─────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  KGM stock sync → Directus stock_vehicles');
  console.log('═══════════════════════════════════════════════');
  if (DRY_RUN) console.log('  ⚠  DRY-RUN — nic se nezapíše do Directusu');
  if (LIMIT > 0) console.log(`  ⚠  LIMIT=${LIMIT} — zpracuji jen prvních ${LIMIT} vozů`);
  if (NO_PHOTOS) console.log('  ⚠  NO-PHOTOS — neuploaduju fotky');
  if (SKIP_SOLD) console.log('  ⚠  SKIP-SOLD — neoznačuji prodané');
  console.log('');

  DIRECTUS_URL = (await prompt('Directus URL [https://sfr-motor-directus.onrender.com]: ')).trim()
    || 'https://sfr-motor-directus.onrender.com';
  EMAIL = (await prompt('Email: ')).trim();
  PASSWORD = (await prompt('Heslo: ')).trim();
  console.log('');

  await login();
  ok('Auth OK (s auto-refresh při token expiry)');

  // Krok 1: Listing
  const allUrls = await fetchListingUrls();
  ok(`Celkem nalezeno ${allUrls.length} detail URLs`);

  const toProcess = LIMIT > 0 ? allUrls.slice(0, LIMIT) : allUrls;

  // Krok 2: Process každého vozu
  console.log(`\nKrok 2: Zpracování ${toProcess.length} vozů...`);
  const stats = { created: 0, updated: 0, skip: 0, error: 0, dryRun: 0 };
  const seenIds = new Set();

  for (let i = 0; i < toProcess.length; i++) {
    const result = await processVehicle(toProcess[i], i, toProcess.length);
    if (result.externalId) seenIds.add(result.externalId);
    if (result.status === 'created') stats.created++;
    else if (result.status === 'updated') stats.updated++;
    else if (result.status === 'skip') stats.skip++;
    else if (result.status === 'error') stats.error++;
    else if (result.status === 'dry-run') stats.dryRun++;
    await sleep(REQUEST_DELAY_MS);
  }

  // Krok 3: Sold detection
  let marked = 0;
  if (!SKIP_SOLD && LIMIT === 0) {
    marked = await markMissingAsSold(seenIds);
  } else if (LIMIT > 0) {
    info('\nSkip sold detection (--limit aktivní, neúplný feed)');
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════');
  console.log('  Sync hotový.');
  console.log(`  Vytvořeno:    ${stats.created}`);
  console.log(`  Aktualizováno: ${stats.updated}`);
  console.log(`  Skip (model/data missing): ${stats.skip}`);
  console.log(`  Error:        ${stats.error}`);
  if (DRY_RUN) console.log(`  Dry-run preview: ${stats.dryRun}`);
  if (!SKIP_SOLD && LIMIT === 0) console.log(`  Marked sold:  ${marked}`);
  console.log('');
  console.log('  V adminu (Ctrl+Shift+R):');
  console.log('    Skladovka → filtruj status=Importováno → projdi vozy, schvalej (přepni na Publikováno).');
  console.log('═══════════════════════════════════════════════');

  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
