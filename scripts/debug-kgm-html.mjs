#!/usr/bin/env node
/**
 * Debug helper — fetchne jednu KGM detail stránku a jeden listing,
 * vypíše relevantní HTML kontext kolem spec table a listing linků.
 *
 * Použití: cd web && node scripts/debug-kgm-html.mjs
 */

const DETAIL_URL = 'https://stock.sfrmotor.kgmcars.cz/skladove-vozy/tivoli-15turbo-mt-style-bilacerny-odber-kveten-2026-308?model-code=tivoli';
const LISTING_URL_P1 = 'https://stock.sfrmotor.kgmcars.cz/';
const LISTING_URL_P2 = 'https://stock.sfrmotor.kgmcars.cz/web.page/?carList-page=2&page_id=2&do=carList-page';

const UA = 'Mozilla/5.0 (compatible; sfr-debug/1.0)';

async function fetchHtml(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  return { status: r.status, html: await r.text() };
}

function excerpt(html, marker, before = 400, after = 1500) {
  const idx = html.indexOf(marker);
  if (idx < 0) return `(marker "${marker}" nenalezen)`;
  return html.substring(Math.max(0, idx - before), Math.min(html.length, idx + after));
}

function countMatches(html, pattern) {
  return (html.match(new RegExp(pattern, 'g')) ?? []).length;
}

async function main() {
  console.log('═══ KGM HTML DEBUG ═══\n');

  // 1) Detail — spec table area
  console.log('▶ DETAIL fetch: ' + DETAIL_URL);
  const detail = await fetchHtml(DETAIL_URL);
  console.log(`  status=${detail.status}, len=${detail.html.length}`);
  console.log(`  ${countMatches(detail.html, '<table')} <table>, ${countMatches(detail.html, '<dl')} <dl>, ${countMatches(detail.html, '<dt')} <dt>, ${countMatches(detail.html, '<dd')} <dd>`);
  console.log(`  ${countMatches(detail.html, 'sdff-get')} sdff-get refs (foto)`);

  console.log('\n--- HTML kolem "Výbavový stupeň" ---');
  console.log(excerpt(detail.html, 'Výbavový stupeň', 200, 2500));

  console.log('\n--- HTML kolem "Stav vozu" ---');
  console.log(excerpt(detail.html, 'Stav vozu', 200, 1000));

  // 2) Listing
  console.log('\n\n▶ LISTING page 1: ' + LISTING_URL_P1);
  const l1 = await fetchHtml(LISTING_URL_P1);
  console.log(`  status=${l1.status}, len=${l1.html.length}`);
  const links1 = [...l1.html.matchAll(/href="([^"]*\/skladove-vozy\/[^"]+)"/g)].map((m) => m[1]);
  const uniqueLinks1 = [...new Set(links1)];
  console.log(`  Nalezeno ${links1.length} hrefů, unikátních: ${uniqueLinks1.length}`);
  console.log(`  Prvních 5 unikátních:`);
  uniqueLinks1.slice(0, 5).forEach((l) => console.log('    ' + l));

  console.log('\n▶ LISTING page 2: ' + LISTING_URL_P2);
  const l2 = await fetchHtml(LISTING_URL_P2);
  console.log(`  status=${l2.status}, len=${l2.html.length}`);
  const links2 = [...l2.html.matchAll(/href="([^"]*\/skladove-vozy\/[^"]+)"/g)].map((m) => m[1]);
  const uniqueLinks2 = [...new Set(links2)];
  console.log(`  Nalezeno ${links2.length} hrefů, unikátních: ${uniqueLinks2.length}`);
  console.log(`  Prvních 5 unikátních:`);
  uniqueLinks2.slice(0, 5).forEach((l) => console.log('    ' + l));

  // Diff?
  const inP2NotP1 = uniqueLinks2.filter((l) => !uniqueLinks1.includes(l));
  console.log(`\n  Linky z page 2, které NEJSOU na page 1: ${inP2NotP1.length}`);

  console.log('\n═══════════════════');
}

main().catch((e) => console.error(e));
