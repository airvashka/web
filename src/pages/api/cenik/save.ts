/**
 * Cenik save endpoint — accepts matrix-format data, transforms to Directus.
 *
 * POST application/json:
 *   {
 *     model_year_id: string|number,
 *     directus_token: string,
 *     data: {
 *       trims: [{ name, list_price }],
 *       sections: [{ name, rows: [{ feature, code, cells: [...] }] }],
 *       packages: [{ name, code, contents, cells }],
 *       colors_exterior: [...],
 *       colors_interior: [...],
 *       technical_data: { ... }
 *     }
 *   }
 *
 * Transform:
 *   - Cell "S" → patří do trim_levels.features (s sekcí jako category)
 *   - Cell číslo → trim_levels.optional_items
 *   - Cell paket name → option_packages.features (řádky odkazujou na paket)
 *   - Package row → option_packages s pricing_per_trim z cells
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

/** Cell value classifier */
type CellKind = 'standard' | 'optional' | 'package' | 'unavailable' | 'conditional' | 'choice' | 'other';

function classifyCell(cell: string): { kind: CellKind; price?: number; packageCode?: string } {
  const v = String(cell ?? '').trim();
  if (!v || v === '-' || v === '—') return { kind: 'unavailable' };
  if (v === 'S' || /^S$/i.test(v)) return { kind: 'standard' };
  // S (Hybrid), S (4x4) — conditional standard
  if (/^S\s*\(/i.test(v)) return { kind: 'conditional' };
  // Number (with optional space-separated thousands)
  const num = v.replace(/\s/g, '');
  if (/^\d+$/.test(num)) return { kind: 'optional', price: parseInt(num, 10) };
  // "volitelné" — choice (e.g., colors)
  if (/^volitelné/i.test(v)) return { kind: 'choice' };
  // Anything else (CLUB+, BLACK, SAFETY, ...) treat as package reference
  return { kind: 'package', packageCode: v };
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

interface MatrixData {
  trims?: Array<{ name: string; list_price?: number }>;
  sections?: Array<{ name: string; rows: Array<{ feature: string; code?: string; cells: string[] }> }>;
  packages?: Array<{ name: string; code?: string; contents?: string[]; cells: string[] }>;
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

function transformMatrix(data: MatrixData): { trims: DirectusTrim[]; packages: DirectusPackage[] } {
  const trims = (data.trims ?? []).map((t) => ({
    name: t.name,
    list_price: t.list_price,
    features: [] as Array<{ category: string; items: string[] }>,
    optional_items: [] as Array<{ name: string; code?: string; price: number }>,
  }));

  // Per trim, accumulate features by section
  const featuresByTrimSection: Record<number, Record<string, string[]>> = {};
  trims.forEach((_, i) => { featuresByTrimSection[i] = {}; });

  // Walk sections → rows → cells
  for (const section of data.sections ?? []) {
    for (const row of section.rows ?? []) {
      const cells = row.cells ?? [];
      for (let i = 0; i < trims.length; i++) {
        const cell = cells[i] ?? '';
        const { kind, price } = classifyCell(cell);

        if (kind === 'standard' || kind === 'conditional') {
          // Add to trim.features under this section as category
          if (!featuresByTrimSection[i][section.name]) featuresByTrimSection[i][section.name] = [];
          let displayFeature = row.feature;
          if (kind === 'conditional') {
            displayFeature = `${row.feature} (${cell})`;  // např. "ACC (S Hybrid)"
          }
          featuresByTrimSection[i][section.name].push(displayFeature);
        } else if (kind === 'optional' && price !== undefined) {
          trims[i].optional_items.push({
            name: row.feature,
            code: row.code || undefined,
            price,
          });
        }
        // package, unavailable, choice, other — ignored for trim_levels (jsou v packages section samostatně)
      }
    }
  }

  // Convert featuresByTrimSection → trim.features array
  for (let i = 0; i < trims.length; i++) {
    trims[i].features = Object.entries(featuresByTrimSection[i])
      .map(([category, items]) => ({ category, items: items.filter(Boolean) }))
      .filter((f) => f.items.length > 0);
  }

  // Packages
  const packages: DirectusPackage[] = (data.packages ?? []).map((p) => {
    const pricing_per_trim: Record<string, number | string> = {};
    for (let i = 0; i < trims.length; i++) {
      const cell = p.cells?.[i] ?? '';
      const { kind, price } = classifyCell(cell);
      const trimKey = slugify(trims[i].name); // např. "club", "style", "premium"
      if (kind === 'optional' && price !== undefined) {
        pricing_per_trim[trimKey] = price;
      } else if (kind === 'standard' || kind === 'conditional') {
        pricing_per_trim[trimKey] = 'standard';
      } else {
        pricing_per_trim[trimKey] = 'unavailable';
      }
    }
    return {
      name: p.name,
      code: p.code || undefined,
      features: Array.isArray(p.contents) ? p.contents : [],
      pricing_per_trim,
    };
  });

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
    const { trims, packages } = transformMatrix(data as MatrixData);
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
