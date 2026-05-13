/**
 * SFR Motor — slug builder pro skladové vozy.
 *
 * Format: {brand-slug}-{model-slug}-{trim}-{color}-{id}
 *   např. "kgm-tivoli-style-bila-3"
 *
 * ID je vždy na konci pro stabilitu — kdyby se změnil trim/barva,
 * stránka by se přebuildila s novým slugem ale id zůstává parsovatelné.
 *
 * Použití:
 *   build: buildStockSlug(vehicle, brand, model, trim) → "kgm-tivoli-style-bila-3"
 *   parse: parseStockId("kgm-tivoli-style-bila-3") → 3
 */

const DIACRITICS_MAP: Record<string, string> = {
  á: 'a', č: 'c', ď: 'd', é: 'e', ě: 'e', í: 'i', ň: 'n',
  ó: 'o', ř: 'r', š: 's', ť: 't', ú: 'u', ů: 'u', ý: 'y', ž: 'z',
  Á: 'a', Č: 'c', Ď: 'd', É: 'e', Ě: 'e', Í: 'i', Ň: 'n',
  Ó: 'o', Ř: 'r', Š: 's', Ť: 't', Ú: 'u', Ů: 'u', Ý: 'y', Ž: 'z',
};

export function slugify(input: string | null | undefined): string {
  if (!input) return '';
  let s = String(input);
  // Odstraň diakritiku
  s = s.split('').map((ch) => DIACRITICS_MAP[ch] ?? ch).join('');
  s = s
    .toLowerCase()
    .replace(/&/g, ' a ')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return s;
}

interface VehicleLike {
  id: number | string;
  color_name?: string | null;
  color_code?: string | null;
  color_category?: string | null;
}

interface BrandLike { slug?: string | null; name?: string | null; }
interface ModelLike { slug?: string | null; name?: string | null; }
interface TrimLike { name?: string | null; }

// Mapování enum color_category → český slug
const COLOR_CATEGORY_SLUGS: Record<string, string> = {
  white: 'bila', black: 'cerna', gray: 'seda', silver: 'stribrna',
  blue: 'modra', red: 'cervena', green: 'zelena', yellow: 'zluta',
  orange: 'oranzova', brown: 'hneda', other: '',
};

/**
 * Sestaví URL slug pro skladový vůz.
 * Vždy končí číselným ID — to je single source of truth.
 *
 * Color: priorita color_name > color_code > color_category (mapped na CZ slug)
 */
export function buildStockSlug(
  vehicle: VehicleLike,
  brand?: BrandLike | null,
  model?: ModelLike | null,
  trim?: TrimLike | null,
): string {
  const parts: string[] = [];
  if (brand?.slug) parts.push(slugify(brand.slug));
  else if (brand?.name) parts.push(slugify(brand.name));
  if (model?.slug) parts.push(slugify(model.slug));
  else if (model?.name) parts.push(slugify(model.name));
  if (trim?.name) parts.push(slugify(trim.name));

  // Color — preferuj čitelný název, jinak fallback na category enum slug
  let colorPart = '';
  if (vehicle.color_name) colorPart = slugify(vehicle.color_name);
  else if (vehicle.color_code) colorPart = slugify(vehicle.color_code);
  else if (vehicle.color_category && COLOR_CATEGORY_SLUGS[vehicle.color_category]) {
    colorPart = COLOR_CATEGORY_SLUGS[vehicle.color_category];
  }
  if (colorPart) parts.push(colorPart);

  parts.push(String(vehicle.id));
  return parts.filter(Boolean).join('-');
}

/**
 * Vytáhne číselné ID z URL slugu.
 * "kgm-tivoli-style-bila-3" → 3
 * "3" → 3
 * "neco-divneho-bez-cisla" → NaN
 */
export function parseStockId(slug: string): number {
  const m = String(slug).match(/(\d+)$/);
  return m ? Number(m[1]) : NaN;
}
