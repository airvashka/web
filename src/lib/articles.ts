/**
 * Article helpers — výpočet čtení času z body textu.
 *
 * Použití:
 *   const readTime = article.read_time || computeReadTime(article.body);
 *
 * Pokud má článek explicitní `read_time` (user override v adminu), použij ho.
 * Jinak spočítej automaticky z body markdown textu.
 *
 * Algoritmus: 200 slov/min (běžný odhad pro česky/anglicky čtené texty).
 * Min 1 min, žádné desetiny.
 */

const WORDS_PER_MINUTE = 200;

/**
 * Spočítá odhadovaný čas čtení z markdown body.
 * Strip-uje markdown syntax (heading hash, bold/italic markery, links, images, html tags).
 *
 * @param body — markdown text článku
 * @returns string ve formátu "X min" (např. "5 min", "12 min")
 */
export function computeReadTime(body: string | null | undefined): string {
  if (!body || typeof body !== 'string') return '1 min čtení';

  const plain = body
    // strip image syntax: ![alt](url)
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    // strip link syntax: [text](url) → text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // strip code blocks (```lang ... ```)
    .replace(/```[\s\S]*?```/g, '')
    // strip inline code
    .replace(/`[^`]+`/g, '')
    // strip HTML tags (table cells, custom html)
    .replace(/<[^>]+>/g, ' ')
    // strip markdown syntax chars
    .replace(/[#*_>|~`-]/g, ' ')
    // collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();

  const wordCount = plain.split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE));
  return `${minutes} min čtení`;
}

/**
 * Wrapper — vrátí explicit read_time z DB, nebo auto-spočítaný.
 */
export function getReadTime(article: { read_time?: string | null; body?: string | null }): string {
  const explicit = (article.read_time ?? '').trim();
  if (explicit) {
    // Pokud user napsal jen '1 min' bez 'čtení', auto-doplnit suffix
    return /\bčten[ií]/i.test(explicit) ? explicit : `${explicit} čtení`;
  }
  return computeReadTime(article.body);
}


/**
 * Vrátí perex (excerpt) pro článek.
 * - Pokud má `excerpt` field vyplněný, použije ho.
 * - Jinak vezme prvních `maxLen` znaků z `body` (po stripu markdown/HTML),
 *   ukončí na konec slova a přidá "…".
 *
 * @param article — objekt s `excerpt` a `body` fields
 * @param maxLen — max délka auto-generovaného excerpt (default 160)
 */
export function getArticleExcerpt(
  article: { excerpt?: string | null; body?: string | null },
  maxLen: number = 160
): string {
  const ex = (article.excerpt ?? '').trim();
  if (ex) return ex;

  const body = (article.body ?? '').toString();
  if (!body) return '';

  const plain = body
    // images
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    // links → text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // code blocks
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    // HTML tags
    .replace(/<[^>]+>/g, ' ')
    // markdown syntax
    .replace(/[#*_>|~`]+/g, '')
    // collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();

  if (plain.length <= maxLen) return plain;

  // Ořež na konec slova v maxLen window
  const sliced = plain.slice(0, maxLen);
  const lastSpace = sliced.lastIndexOf(' ');
  const cutoff = lastSpace > maxLen * 0.6 ? lastSpace : maxLen;
  return plain.slice(0, cutoff).trimEnd() + '…';
}
