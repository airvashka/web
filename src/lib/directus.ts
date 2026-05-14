/**
 * Tenký Directus client.
 * Při buildu Astro stahá data přes REST API (PUBLIC_DIRECTUS_URL).
 *
 * Po nasazení Directus na Railway doplníme PUBLIC_DIRECTUS_URL do .env
 * a tahle vrstva automaticky zafunguje.
 */

const DIRECTUS_URL = import.meta.env.PUBLIC_DIRECTUS_URL ?? '';

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
// Build-time in-memory cache.
// Při SSG buildu se stejný dotaz (např. brands list) opakuje napříč
// desítkami stránek. Tahle cache dedupuje identické dotazy → 1 request
// místo N. Šetří 50–80 % build času.
// V dev módu cache vypnuté (chceme čerstvá data při kódování).
// ──────────────────────────────────────────────────────────────
const BUILD_CACHE = new Map<string, Promise<any>>();
const CACHE_ENABLED = import.meta.env.PROD;

function cacheKey(collection: string, opts: FetchOptions): string {
  return `${collection}::${JSON.stringify(opts)}`;
}

export async function directusGet<T>(
  collection: string,
  opts: FetchOptions = {}
): Promise<T[]> {
  if (!DIRECTUS_URL) {
    console.warn(`[directus] PUBLIC_DIRECTUS_URL není nastavena — collection "${collection}" vrací prázdná data.`);
    return [];
  }

  if (CACHE_ENABLED) {
    const key = cacheKey(collection, opts);
    if (BUILD_CACHE.has(key)) {
      return BUILD_CACHE.get(key) as Promise<T[]>;
    }
    const promise = fetchFromDirectus<T>(collection, opts);
    BUILD_CACHE.set(key, promise);
    return promise;
  }

  return fetchFromDirectus<T>(collection, opts);
}

async function fetchFromDirectus<T>(
  collection: string,
  opts: FetchOptions
): Promise<T[]> {
  const url = `${DIRECTUS_URL}/items/${collection}${buildQuery(opts)}`;
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      console.error(`[directus] ${res.status} při fetchování ${collection}`);
      return [];
    }
    const json = await res.json();
    return json.data ?? [];
  } catch (err) {
    console.error(`[directus] chyba při fetchování ${collection}:`, err);
    return [];
  }
}

export async function directusGetOne<T>(
  collection: string,
  id: string | number,
  fields?: string[]
): Promise<T | null> {
  if (!DIRECTUS_URL) return null;
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
