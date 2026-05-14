#!/usr/bin/env node
/**
 * Debug: zkusíme různé způsoby jak rozjet KGM listing pagination.
 */
const BASE = 'https://stock.sfrmotor.kgmcars.cz';
const UA = 'Mozilla/5.0 (compatible; sfr-debug/1.0)';

const tries = [
  { name: 'GET plain', url: `${BASE}/web.page/?carList-page=2&page_id=2&do=carList-page`, headers: {} },
  { name: 'GET + XHR header', url: `${BASE}/web.page/?carList-page=2&page_id=2&do=carList-page`, headers: { 'X-Requested-With': 'XMLHttpRequest' } },
  { name: 'GET + Accept JSON', url: `${BASE}/web.page/?carList-page=2&page_id=2&do=carList-page`, headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' } },
  { name: 'GET / + page param', url: `${BASE}/?carList-page=2`, headers: {} },
  { name: 'GET / + page param + XHR', url: `${BASE}/?carList-page=2`, headers: { 'X-Requested-With': 'XMLHttpRequest' } },
  { name: 'GET listing without "do"', url: `${BASE}/web.page/?carList-page=2&page_id=2`, headers: {} },
];

async function main() {
  // Reference: page 1 first
  console.log('▶ Reference: page 1 plain GET');
  const ref = await fetch(`${BASE}/`, { headers: { 'User-Agent': UA } });
  const refHtml = await ref.text();
  const refLinks = [...new Set([...refHtml.matchAll(/href="([^"]*\/skladove-vozy\/[^"]+)"/g)].map((m) => m[1]))];
  console.log(`  len=${refHtml.length}, unikátní linky=${refLinks.length}`);
  console.log(`  prvních 5: ${refLinks.slice(0, 5).map((l) => l.match(/-(\d+)\?/)?.[1] ?? '?').join(', ')}`);
  console.log('');

  for (const t of tries) {
    console.log(`▶ ${t.name}`);
    console.log(`  URL: ${t.url}`);
    try {
      const r = await fetch(t.url, { headers: { 'User-Agent': UA, ...t.headers } });
      const html = await r.text();
      const links = [...new Set([...html.matchAll(/href="([^"]*\/skladove-vozy\/[^"]+)"/g)].map((m) => m[1]))];
      const sameAsRef = JSON.stringify(links) === JSON.stringify(refLinks);
      console.log(`  status=${r.status}, len=${html.length}, ct=${r.headers.get('content-type')}, linky=${links.length} ${sameAsRef ? '(STEJNÉ jako page 1)' : '(JINÉ od page 1 ✓)'}`);
      if (!sameAsRef && links.length > 0) {
        console.log(`  prvních 5 IDs: ${links.slice(0, 5).map((l) => l.match(/-(\d+)\?/)?.[1] ?? '?').join(', ')}`);
      }
      // Pokud je JSON response, vypiš začátek
      const ct = r.headers.get('content-type') ?? '';
      if (ct.includes('json')) {
        console.log('  JSON body (prvních 500 znaků):');
        console.log('  ' + html.substring(0, 500));
      }
    } catch (e) {
      console.log(`  ✗ ${e.message}`);
    }
    console.log('');
  }
}
main().catch(console.error);
