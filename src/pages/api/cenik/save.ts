/**
 * Cenik save endpoint.
 *
 * POST application/json:
 *   {
 *     model_year_id: string|number,
 *     directus_token: string,
 *     data: {
 *       trim_levels?: [...],
 *       option_packages?: [...],
 *       technical_data?: {...}
 *     }
 *   }
 *
 * Operace:
 *   1) PATCH model_years.technical_data
 *   2) Pro každý trim: upsert podle (model_year, name) case-insensitive
 *   3) Pro každý package: upsert podle (model_year, name)
 *
 * Expanduje "viz X" reference (z Farizon ceníku) — pokud features = ["viz X"],
 * zkopíruje features z trim s name=X.
 *
 * Response: { ok: true, summary: {...} }
 */
import type { APIRoute } from 'astro';

export const prerender = false;

const DIRECTUS_URL = import.meta.env.PUBLIC_DIRECTUS_URL || 'https://directus-production-3e67.up.railway.app';

/** Convert features z {pohon: [items]} na [{category, items}] (Directus repeater) */
function convertFeatures(features: any): Array<{ category: string; items: string[] }> {
  if (Array.isArray(features)) return features;
  if (features && typeof features === 'object') {
    return Object.entries(features)
      .map(([category, items]) => ({
        category,
        items: Array.isArray(items) ? items.filter(Boolean) : [],
      }))
      .filter((f) => f.items.length > 0);
  }
  return [];
}

/** Convert tech data z {Motor: "1.5"} na [{label, value}] (Directus repeater) */
function convertTechData(td: any): Array<{ label: string; value: string }> {
  if (Array.isArray(td)) return td;
  if (td && typeof td === 'object') {
    return Object.entries(td).map(([label, value]) => ({ label, value: String(value) }));
  }
  return [];
}

/** Slugify pro povinné slug field v trim_levels / option_packages */
function slugify(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .trim()
    .replace(/\+/g, '-plus')
    .replace(/&/g, '-and')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // strip diacritics (Štýl → Styl)
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

/** Pokud features = ["viz X"], expanduj z trim s name=X. */
function expandReferences(trims: any[]): any[] {
  const byName = new Map<string, any>();
  for (const t of trims) byName.set(String(t.name ?? '').trim().toLowerCase(), t);

  for (const t of trims) {
    if (!t.features || typeof t.features !== 'object') continue;
    for (const cat of Object.keys(t.features)) {
      const items = t.features[cat];
      if (Array.isArray(items) && items.length === 1 && typeof items[0] === 'string' && /^viz\s+/i.test(items[0])) {
        const refName = items[0].replace(/^viz\s+/i, '').trim().toLowerCase();
        const ref = byName.get(refName);
        if (ref?.features?.[cat]) {
          t.features[cat] = [...ref.features[cat]];
        }
      }
    }
  }
  return trims;
}

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

    // 1) Technical data → PATCH model_years (konverze na [{label, value}] repeater)
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

    // 2) Trim levels — expand references → upsert
    if (Array.isArray(data.trim_levels) && data.trim_levels.length > 0) {
      const expanded = expandReferences(JSON.parse(JSON.stringify(data.trim_levels)));

      // Načti existující trims pro case-insensitive match
      const existingResp = await dapi(directus_token, 'GET', `/items/trim_levels?filter[model_year][_eq]=${model_year_id}&limit=200&fields=id,name`);
      const existingByName = new Map<string, any>();
      for (const t of (existingResp as any).data) {
        existingByName.set(String(t.name ?? '').trim().toLowerCase(), t);
      }

      for (const t of expanded) {
        try {
          const payload: any = {
            name: t.name,
            slug: slugify(t.name),
            model_year: model_year_id,
            status: 'published',
          };
          if (t.list_price !== undefined && t.list_price !== null) payload.list_price = t.list_price;
          if (t.features) payload.features = convertFeatures(t.features);

          const existing = existingByName.get(String(t.name ?? '').trim().toLowerCase());
          if (existing) {
            await dapi(directus_token, 'PATCH', `/items/trim_levels/${existing.id}`, payload);
            summary.trims_updated++;
            summary.details.push(`Trim "${t.name}" → updated (id=${existing.id})`);
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
    if (Array.isArray(data.option_packages) && data.option_packages.length > 0) {
      const existingResp = await dapi(directus_token, 'GET', `/items/option_packages?filter[model_year][_eq]=${model_year_id}&limit=200&fields=id,name`);
      const existingByName = new Map<string, any>();
      for (const p of (existingResp as any).data) {
        existingByName.set(String(p.name ?? '').trim().toLowerCase(), p);
      }

      for (const p of data.option_packages) {
        try {
          const payload: any = {
            name: p.name,
            slug: slugify(p.name),
            model_year: model_year_id,
          };
          if (p.features) payload.features = p.features;
          if (p.pricing_per_trim) payload.pricing_per_trim = p.pricing_per_trim;

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
