/**
 * Tenký Directus client s build-time prefetch optimalizací.
 *
 * Při buildu Astro stahá data přes REST API (PUBLIC_DIRECTUS_URL).
 *
 * STRATEGIE:
 *   1) Na první volání `directusGet()` se v paralelně **prefetchnou celé collections**
 *      (10-15 requestů místo 700 individuálních per-page dotazů).
 *   2) Následující volání `directusGet()` aplikuje filtr/sort/limit **v paměti**
 *      na predfetchovaná data. Žádný další network request.
 *   3) Pro queries s deep field expansion (např. `option_packages.option_packages_id.*`)
 *      se fallback udělá live fetch s vlastní dedup cache.
 *
 * V dev módu (npm run dev) prefetch i cache vypnuté → vždy čerstvá data.
 */

const DIRECTUS_URL = import.meta.env.PUBLIC_DIRECTUS_URL ?? '';
const IS_BUILD = import.meta.env.PROD;

interface FetchOptions {
  filter?: Record<string, unknown>;
  sort?: string[];
  limit?: number;
  fields?: string[];
}

function buildQuery(opts: FetchOptions = {}): string {
  const params = new URLSearchParams();
  if (opts.filter) params.set('filter', JSON.stringify(opts.filter));
  if (opts.sort) params.set('sort', opts.sort.join(','));
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.fields) params.set('fields', opts.fields.join(','));
  const q = params.toString();
  return q ? `?${q}` : '';
}

// ──────────────────────────────────────────────────────────────
// Prefetch — fetch all collections in parallel on first use
// ──────────────────────────────────────────────────────────────

/**
 * Collections to prefetch. Top-level fields only (no deep expansion).
 * Deep field queries fall through to live fetch.
 */
const PREFETCH_COLLECTIONS = [
  'brands',
  'sub_brands',
  'models',
  'model_years',
  'trim_levels',
  'option_packages',
  'stock_vehicles',
  'branches',
  'employees',
  'articles',
  'pages',
  'site_settings',
  'model_color_exterior',
  'model_color_interior',
  'model_documents',
  'model_highlights',
  // Junction tables
  'stock_vehicles_option_packages',
  'stock_vehicles_files',
  'models_files',
] as const;

const collectionData = new Map<string, any[]>();
let prefetchPromise: Promise<void> | null = null;

async function fetchFullCollection(collection: string, attempt = 1): Promise<any[]> {
  const MAX_RETRIES = 3;
  const url = `${DIRECTUS_URL}/items/${collection}?limit=-1&fields=*`;
  try {
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
    if (!res.ok) {
      // Collection nemusí existovat — to je OK, vrátíme prázdné
      if (res.status === 403 || res.status === 404) return [];
      // 5xx / 429 = přetížený nebo probouzející se Directus (Render cold start, nával
      // paralelních prefetch dotazů) → retry s backoffem, ať build nepadá na prázdná data.
      if ((res.status >= 500 || res.status === 429) && attempt <= MAX_RETRIES) {
        const delay = 400 * attempt; // 400ms, 800ms, 1200ms
        console.warn(`[directus] prefetch ${collection} → ${res.status}, retry ${attempt}/${MAX_RETRIES} za ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
        return fetchFullCollection(collection, attempt + 1);
      }
      console.warn(`[directus] prefetch ${collection} → ${res.status}`);
      return [];
    }
    const json = await res.json();
    return Array.isArray(json.data) ? json.data : json.data ? [json.data] : [];
  } catch (err: any) {
    if (attempt <= MAX_RETRIES) {
      const delay = 400 * attempt;
      console.warn(`[directus] prefetch ${collection} error (${err?.message}), retry ${attempt}/${MAX_RETRIES} za ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
      return fetchFullCollection(collection, attempt + 1);
    }
    console.warn(`[directus] prefetch ${collection} error: ${err?.message}`);
    return [];
  }
}

async function ensurePrefetched(): Promise<void> {
  if (prefetchPromise) return prefetchPromise;
  if (!DIRECTUS_URL) return;

  const start = Date.now();
  console.log(`[directus] Prefetching ${PREFETCH_COLLECTIONS.length} collections in parallel...`);

  prefetchPromise = Promise.all(
    PREFETCH_COLLECTIONS.map(async (col) => {
      const data = await fetchFullCollection(col);
      collectionData.set(col, data);
    })
  ).then(() => {
    const elapsed = Date.now() - start;
    const total = Array.from(collectionData.values()).reduce((s, arr) => s + arr.length, 0);
    console.log(`[directus] Prefetched ${total} records across ${collectionData.size} collections in ${elapsed}ms`);
  });

  return prefetchPromise;
}

// ──────────────────────────────────────────────────────────────
// In-memory filter / sort / limit
// ──────────────────────────────────────────────────────────────

function getNested(obj: any, path: string): any {
  if (!obj) return undefined;
  if (!path.includes('.')) return obj[path];
  return path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

function matchesCondition(value: any, op: string, opVal: any): boolean {
  switch (op) {
    case '_eq': return value === opVal || String(value) === String(opVal);
    case '_neq': return value !== opVal && String(value) !== String(opVal);
    case '_in': return Array.isArray(opVal) && opVal.some((v) => v === value || String(v) === String(value));
    case '_nin': return Array.isArray(opVal) && !opVal.some((v) => v === value || String(v) === String(value));
    case '_null': return opVal ? value == null : value != null;
    case '_nnull': return opVal ? value != null : value == null;
    case '_empty': return opVal ? !value : !!value;
    case '_nempty': return opVal ? !!value : !value;
    case '_gt': return Number(value) > Number(opVal);
    case '_gte': return Number(value) >= Number(opVal);
    case '_lt': return Number(value) < Number(opVal);
    case '_lte': return Number(value) <= Number(opVal);
    case '_contains': return String(value ?? '').toLowerCase().includes(String(opVal).toLowerCase());
    case '_starts_with': return String(value ?? '').toLowerCase().startsWith(String(opVal).toLowerCase());
    case '_ends_with': return String(value ?? '').toLowerCase().endsWith(String(opVal).toLowerCase());
    default:
      // Neznámý operátor — bezpečně pustíme přes (lepší než false-negative)
      return true;
  }
}

function matchesFilter(record: any, filter: any): boolean {
  if (!filter || typeof filter !== 'object') return true;

  for (const [key, value] of Object.entries(filter)) {
    if (key === '_and') {
      if (!Array.isArray(value)) continue;
      if (!value.every((f) => matchesFilter(record, f))) return false;
      continue;
    }
    if (key === '_or') {
      if (!Array.isArray(value)) continue;
      if (!value.some((f) => matchesFilter(record, f))) return false;
      continue;
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      // { _eq, _in, _null, ... } or nested relation filter
      const ops = Object.keys(value);
      const isOperatorObj = ops.every((k) => k.startsWith('_'));
      if (isOperatorObj) {
        const recordValue = getNested(record, key);
        for (const [op, opVal] of Object.entries(value as Record<string, unknown>)) {
          if (!matchesCondition(recordValue, op, opVal)) return false;
        }
      } else {
        // Nested filter (jen flat — `model.id._eq` form se taky podporuje výše přes getNested)
        // Bezpečně skip — pokud se přejde sem, neumíme to dnes
      }
    }
  }
  return true;
}

function buildSorter(sort: string[]) {
  return (a: any, b: any) => {
    for (const s of sort) {
      let key = s;
      let dir: 1 | -1 = 1;
      if (key.startsWith('-')) {
        key = key.slice(1);
        dir = -1;
      }
      const va = getNested(a, key);
      const vb = getNested(b, key);
      if (va == null && vb == null) continue;
      if (va == null) return -1 * dir;
      if (vb == null) return 1 * dir;
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
    }
    return 0;
  };
}

function applyOpts<T>(records: T[], opts: FetchOptions): T[] {
  let out: T[] = records;
  if (opts.filter) {
    out = out.filter((r) => matchesFilter(r, opts.filter));
  }
  if (opts.sort && opts.sort.length > 0) {
    out = [...out].sort(buildSorter(opts.sort));
  }
  if (opts.limit && opts.limit > 0) {
    out = out.slice(0, opts.limit);
  }
  return out;
}

// ──────────────────────────────────────────────────────────────
// Live fetch (fallback) + dedup cache
// ──────────────────────────────────────────────────────────────

const liveFetchCache = new Map<string, Promise<any[]>>();

async function liveFetch<T>(collection: string, opts: FetchOptions): Promise<T[]> {
  if (IS_BUILD) {
    const key = `${collection}::${JSON.stringify(opts)}`;
    if (liveFetchCache.has(key)) return liveFetchCache.get(key) as Promise<T[]>;
    const p = doLiveFetch<T>(collection, opts);
    liveFetchCache.set(key, p);
    return p;
  }
  return doLiveFetch<T>(collection, opts);
}

async function doLiveFetch<T>(collection: string, opts: FetchOptions, attempt = 1): Promise<T[]> {
  const url = `${DIRECTUS_URL}/items/${collection}${buildQuery(opts)}`;
  const MAX_RETRIES = 2;
  try {
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
    if (!res.ok) {
      console.error(`[directus] ${res.status} při fetchování ${collection}`);
      return [];
    }
    const json = await res.json();
    return json.data ?? [];
  } catch (err: any) {
    // ECONNRESET / TimeoutError / undici "terminated" → retry s exponential backoff
    const transient = err?.cause?.code === 'ECONNRESET'
      || err?.code === 'ECONNRESET'
      || err?.message?.includes('terminated')
      || err?.name === 'TimeoutError';
    if (transient && attempt <= MAX_RETRIES) {
      const delay = 200 * attempt; // 200ms, 400ms
      console.warn(`[directus] transient error pro ${collection} (attempt ${attempt}/${MAX_RETRIES}), retry za ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
      return doLiveFetch<T>(collection, opts, attempt + 1);
    }
    console.error(`[directus] chyba při fetchování ${collection}:`, err);
    return [];
  }
}

/**
 * Zjistí, jestli query potřebuje deep field expansion (např. "model.brand.name")
 * nebo M2M expansion (např. "option_packages.option_packages_id.*"), což prefetch
 * neumí — v takovém případě se použije live fetch.
 */
function needsLiveFetch(opts: FetchOptions): boolean {
  if (!opts.fields) return false;
  for (const f of opts.fields) {
    if (f === '*' || !f.includes('.')) continue;
    // Field obsahuje tečku → relation expansion
    // Pokud je to filter-only path (např. "model.brand"), je to OK
    // ale pokud chce konkrétní data z relace, potřebuje to live fetch
    return true;
  }
  return false;
}

// ──────────────────────────────────────────────────────────────
// PUBLIC API
// ──────────────────────────────────────────────────────────────

export async function directusGet<T>(
  collection: string,
  opts: FetchOptions = {}
): Promise<T[]> {
  if (!DIRECTUS_URL) {
    console.warn(`[directus] PUBLIC_DIRECTUS_URL není nastavena — collection "${collection}" vrací prázdná data.`);
    return [];
  }

  // Dev mode → vždy live fetch, žádný cache
  if (!IS_BUILD) {
    return doLiveFetch<T>(collection, opts);
  }

  // Build mode + collection je prefetched + query nepotřebuje deep expansion
  if (PREFETCH_COLLECTIONS.includes(collection as any) && !needsLiveFetch(opts)) {
    await ensurePrefetched();
    const data = collectionData.get(collection) ?? [];
    return applyOpts(data, opts) as T[];
  }

  // Build mode + custom/deep query → live fetch s dedup cache
  return liveFetch<T>(collection, opts);
}

export async function directusGetOne<T>(
  collection: string,
  id: string | number,
  fields?: string[]
): Promise<T | null> {
  if (!DIRECTUS_URL) return null;

  if (IS_BUILD && PREFETCH_COLLECTIONS.includes(collection as any) && !(fields && fields.some((f) => f.includes('.')))) {
    await ensurePrefetched();
    const data = collectionData.get(collection) ?? [];
    const found = data.find((r: any) => String(r.id) === String(id));
    return (found as T) ?? null;
  }

  const url = `${DIRECTUS_URL}/items/${collection}/${id}${buildQuery({ fields })}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    return json.data ?? null;
  } catch {
    return null;
  }
}

/**
 * Helper pro asset URL (fotky, PDF) — Directus má vlastní /assets/ endpoint
 * který umí transformace (resize, format).
 */
export function directusAsset(
  fileId: string,
  opts: { width?: number; height?: number; quality?: number; format?: 'webp' | 'avif' | 'jpg' } = {}
): string {
  if (!DIRECTUS_URL || !fileId) return '';
  const params = new URLSearchParams();
  if (opts.width) params.set('width', String(opts.width));
  if (opts.height) params.set('height', String(opts.height));
  if (opts.quality) params.set('quality', String(opts.quality));
  if (opts.format) params.set('format', opts.format);
  const q = params.toString();
  return `${DIRECTUS_URL}/assets/${fileId}${q ? `?${q}` : ''}`;
}
