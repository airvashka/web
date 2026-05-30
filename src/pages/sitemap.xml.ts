/**
 * Custom sitemap — zahrnuje i SSR stránky (modely, značky, sklad), které
 * @astrojs/sitemap neumí vyjmenovat. Generuje se na request (vždy čerstvé),
 * 1h edge cache. Jednotlivé skladové vozy /sklad/[id] záměrně NEjsou (volatilní).
 */
import type { APIRoute } from 'astro';
import { directusGet } from '@lib/directus';

export const prerender = false;

const SITE = 'https://sfr-motor.cz';

// Statické + listing stránky
const STATIC_PATHS = [
  '/',
  '/sklad',
  '/servis',
  '/kontakt',
  '/o-nas',
  '/kariera',
  '/partneri',
  '/magazin',
  '/informace/podminky',
  '/informace/ochrana-udaju',
  '/informace/cookies',
];

export const GET: APIRoute = async () => {
  const locs: string[] = STATIC_PATHS.map((p) => SITE + p);

  // Značky → /[slug]
  const brands = await directusGet<any>('brands', { fields: ['slug'], limit: 100 }).catch(() => []);
  for (const b of brands ?? []) if (b?.slug) locs.push(`${SITE}/${b.slug}`);

  // Modely → /model/[slug] + /model/[slug]/vybavy
  const models = await directusGet<any>('models', {
    filter: { status: { _eq: 'published' } },
    fields: ['slug'],
    limit: 200,
  }).catch(() => []);
  for (const m of models ?? []) {
    if (!m?.slug) continue;
    locs.push(`${SITE}/model/${m.slug}`);
    locs.push(`${SITE}/model/${m.slug}/vybavy`);
  }

  // Články → /magazin/[slug]
  const articles = await directusGet<any>('articles', {
    filter: { status: { _eq: 'published' } },
    fields: ['slug'],
    limit: 500,
  }).catch(() => []);
  for (const a of articles ?? []) if (a?.slug) locs.push(`${SITE}/magazin/${a.slug}`);

  // Dedup
  const unique = Array.from(new Set(locs));

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${unique.map((loc) => `  <url><loc>${loc}</loc></url>`).join('\n')}
</urlset>`;

  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
};
