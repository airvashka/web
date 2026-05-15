/**
 * Cenik save endpoint — přijímá PER-TRIM data, zapisuje do Directus.
 *
 * POST application/json:
 *   {
 *     model_year_id: string|number,
 *     directus_token: string,
 *     data: {
 *       trims: [{
 *         name, list_price,
 *         features: [{ section, items[] }],
 *         optional_items: [{ name, code?, price }],
 *         packages_available: [...]
 *       }],
 *       packages: [{ name, code, contents[], pricing_per_trim: { trim_slug: number|"standard"|"unavailable" } }],
 *       colors_exterior: [...],
 *       colors_interior: [...],
 *       technical_data: { ... }
 *     }
 *   }
 *
 * Zapíše:
 *   - trim_levels (features grouped, optional_items)
 *   - option_packages (features, pricing_per_trim)
 *   - model_years.technical_data
 *
 * Response: { ok: true, summary: {...} }
 */
import type { APIRoute } from 'astro';

export const prerender = false;

const DIRECTUS_URL = import.meta.env.PUBLIC_DIRECTUS_URL || 'https://directus-production-3e67.up.railway.app';

// ─── Helpers ─────────────────────────────────────────────

function slugify(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .trim()
    .replace(/\+/g, '-plus')
    .replace(/&/g, '-and')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'untitled';
}

async function dapi(token: string, method: string, path: string, body?: any) {
  const r = await fetch(`${DIRECTUS_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { j = text; }
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${JSON.stringify((j as any)?.errors ?? j)}`);
  return j;
}

/** Convert tech data {key: value} → Directus repeater [{label, value}] */
function convertTechData(td: any): Array<{ label: string; value: string }> {
  if (Array.isArray(td)) return td;
  if (td && typeof td === 'object') {
    return Object.entries(td)
      .filter(([k, v]) => k && v !== undefined && v !== null && String(v).trim() !== '')
      .map(([label, value]) => ({ label, value: String(value) }));
  }
  return [];
}

// ─── Matrix → Directus transform ─────────────────────────

/* Nová PER-TRIM struktura (z analyze.ts):
 *   trims[i] = { name, list_price, features: [{section, items}], optional_items: [{name, code, price}], packages_available }
 *   packages[i] = { name, code, contents, pricing_per_trim }
 */
interface CenikData {
  trims?: Array<{
    name: string;
    list_price?: number;
    features?: Array<{ section: string; items: string[] }>;
    optional_items?: Array<{ name: string; code?: string; price: number }>;
    packages_available?: string[];
  }>;
  packages?: Array<{
    name: string;
    code?: string;
    contents?: string[];
    pricing_per_trim?: Record<string, number | string>;
  }>;
  colors_exterior?: any[];
  colors_interior?: any[];
  technical_data?: Record<string, string>;
}

interface DirectusTrim {
  name: string;
  list_price?: number;
  features: Array<{ category: string; items: string[] }>;
  optional_items: Array<{ name: string; code?: string; price: number }>;
}

interface DirectusPackage {
  name: string;
  code?: string;
  features: string[];
  pricing_per_trim: Record<string, number | string>;
}

/* AI dává `features: [{section, items}]`, Directus chce `features: [{category, items}]`.
 * Jediný rename. Plus filtrace prázdných sekcí. */
function normalizeFeatures(features: Array<{ section: string; items: string[] }> = []): Array<{ category: string; items: string[] }> {
  return features
    .map((f) => ({
      category: String(f.section ?? '').trim(),
      items: Array.isArray(f.items) ? f.items.map((s) => String(s).trim()).filter(Boolean) : [],
    }))
    .filter((f) => f.category && f.items.length > 0);
}

function normalizeOptionalItems(items: Array<{ name: string; code?: string; price: number }> = []): Array<{ name: string; code?: string; price: number }> {
  return items
    .filter((it) => it && it.name && Number.isFinite(it.price))
    .map((it) => ({
      name: String(it.name).trim(),
      code: it.code ? String(it.code).trim() : undefined,
      price: Math.round(Number(it.price)),
    }));
}

function transformCenik(data: CenikData): { trims: DirectusTrim[]; packages: DirectusPackage[] } {
  const trims: DirectusTrim[] = (data.trims ?? []).map((t) => ({
    name: String(t.name ?? '').trim(),
    list_price: t.list_price,
    features: normalizeFeatures(t.features),
    optional_items: normalizeOptionalItems(t.optional_items),
  }));

  const packages: DirectusPackage[] = (data.packages ?? []).map((p) => ({
    name: String(p.name ?? '').trim(),
    code: p.code ? String(p.code).trim() : undefined,
    features: Array.isArray(p.contents) ? p.contents.map((s) => String(s).trim()).filter(Boolean) : [],
    pricing_per_trim: (p.pricing_per_trim && typeof p.pricing_per_trim === 'object')
      ? Object.fromEntries(
          Object.entries(p.pricing_per_trim).map(([k, v]) => [
            slugify(k),
            (typeof v === 'number' || v === 'standard' || v === 'unavailable') ? v : String(v),
          ])
        )
      : {},
  }));

  return { trims, packages };
}

// ─── Save endpoint ───────────────────────────────────────

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { model_year_id, directus_token, data } = body as any;

    if (!model_year_id || !directus_token || !data) {
      return new Response(JSON.stringify({ error: 'Chybí model_year_id, directus_token nebo data' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const summary = {
      trims_created: 0,
      trims_updated: 0,
      packages_created: 0,
      packages_updated: 0,
      tech_data_updated: false,
      details: [] as string[],
      errors: [] as string[],
    };

    // Transform matrix → Directus shapes
    const { trims, packages } = transformCenik(data as CenikData);
    summary.details.push(`Transform: ${trims.length} trims, ${packages.length} packages`);

    // 1) Technical data → PATCH model_years
    if (data.technical_data && typeof data.technical_data === 'object' && Object.keys(data.technical_data).length > 0) {
      try {
        const tdArray = convertTechData(data.technical_data);
        await dapi(directus_token, 'PATCH', `/items/model_years/${model_year_id}`, { technical_data: tdArray });
        summary.tech_data_updated = true;
        summary.details.push(`Tech data: ${tdArray.length} klíčů uloženo`);
      } catch (e) {
        summary.errors.push(`Tech data: ${(e as Error).message}`);
      }
    }

    // 2) Trim levels — case-insensitive upsert
    if (trims.length > 0) {
      const existingResp = await dapi(directus_token, 'GET', `/items/trim_levels?filter[model_year][_eq]=${model_year_id}&limit=200&fields=id,name`);
      const existingByName = new Map<string, any>();
      for (const t of (existingResp as any).data) {
        existingByName.set(String(t.name ?? '').trim().toLowerCase(), t);
      }

      for (const t of trims) {
        try {
          const payload: any = {
            name: t.name,
            slug: slugify(t.name),
            model_year: model_year_id,
            status: 'published',
            features: t.features,
            optional_items: t.optional_items,
          };
          if (t.list_price !== undefined && t.list_price !== null) payload.list_price = t.list_price;

          const existing = existingByName.get(String(t.name ?? '').trim().toLowerCase());
          if (existing) {
            await dapi(directus_token, 'PATCH', `/items/trim_levels/${existing.id}`, payload);
            summary.trims_updated++;
            summary.details.push(`Trim "${t.name}" → updated (id=${existing.id}, ${t.features.length} sekcí, ${t.optional_items.length} optional)`);
          } else {
            const created = await dapi(directus_token, 'POST', '/items/trim_levels', payload);
            summary.trims_created++;
            summary.details.push(`Trim "${t.name}" → created (id=${(created as any).data?.id})`);
          }
        } catch (e) {
          summary.errors.push(`Trim "${t.name}": ${(e as Error).message}`);
        }
      }
    }

    // 3) Option packages — upsert
    if (packages.length > 0) {
      const existingResp = await dapi(directus_token, 'GET', `/items/option_packages?filter[model_year][_eq]=${model_year_id}&limit=200&fields=id,name`);
      const existingByName = new Map<string, any>();
      for (const p of (existingResp as any).data) {
        existingByName.set(String(p.name ?? '').trim().toLowerCase(), p);
      }

      for (const p of packages) {
        try {
          const payload: any = {
            name: p.name,
            slug: slugify(p.name),
            model_year: model_year_id,
            features: p.features,
            pricing_per_trim: p.pricing_per_trim,
          };

          const existing = existingByName.get(String(p.name ?? '').trim().toLowerCase());
          if (existing) {
            await dapi(directus_token, 'PATCH', `/items/option_packages/${existing.id}`, payload);
            summary.packages_updated++;
            summary.details.push(`Package "${p.name}" → updated (id=${existing.id})`);
          } else {
            const created = await dapi(directus_token, 'POST', '/items/option_packages', payload);
            summary.packages_created++;
            summary.details.push(`Package "${p.name}" → created (id=${(created as any).data?.id})`);
          }
        } catch (e) {
          summary.errors.push(`Package "${p.name}": ${(e as Error).message}`);
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, summary }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('Cenik save error:', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
