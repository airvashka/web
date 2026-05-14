#!/usr/bin/env node
const BASE = 'https://stock.sfrmotor.kgmcars.cz';
const UA = 'Mozilla/5.0 (compatible; sfr-debug/1.0)';

function extractLinks(html) {
  return [...new Set([...html.matchAll(/href="([^"]*\/skladove-vozy\/[^"]+)"/g)].map((m) => m[1]))];
}

async function fetchWith(url, headers = {}) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
  return { status: r.status, html: await r.text(), headers: r.headers, setCookie: r.headers.getSetCookie?.() ?? [] };
}

async function main() {
  // 1) Sitemap test
  console.log('▶ 1) Sitemap test');
  for (const path of ['/sitemap.xml', '/robots.txt', '/feed.xml', '/data/cars.json', '/api/cars']) {
    const r = await fetchWith(BASE + path);
    console.log(`  ${path} → ${r.status} (len=${r.html.length}, ct=${r.headers.get('content-type')})`);
    if (r.status === 200 && r.html.length < 3000) {
      console.log('  Obsah:\n' + r.html.substring(0, 800) + (r.html.length > 800 ? '...' : ''));
    } else if (r.status === 200) {
      // Look for skladove-vozy in sitemap
      const links = (r.html.match(/skladove-vozy\/[^<"\s]+/g) ?? []).slice(0, 10);
      if (links.length) console.log(`  ✓ Nalezeno ${links.length}+ detail URLs v sitemap, prvních: ${links.slice(0, 3).join(', ')}`);
    }
    console.log('');
  }

  // 2) Nette správný parametr: carList-model
  console.log('▶ 2) Nette carList-model parameter');
  for (const slug of ['tivoli', 'korando', 'actyon']) {
    const r = await fetchWith(`${BASE}/?carList-model=${slug}`);
    const links = extractLinks(r.html);
    const ids = links.map((l) => l.match(/-(\d+)\?/)?.[1]).join(',');
    console.log(`  ?carList-model=${slug} → ${links.length} linků [${ids}]`);
  }
  console.log('');

  // 3) Filter URL: carList-filter[model]
  console.log('▶ 3) Filter URL carList-filter[model]');
  const r3 = await fetchWith(`${BASE}/?carList-filter%5Bmodel%5D=tivoli`);
  const links3 = extractLinks(r3.html);
  console.log(`  → ${links3.length} linků [${links3.map((l) => l.match(/-(\d+)\?/)?.[1]).join(',')}]`);
  console.log('');

  // 4) Cookie-preserved session
  console.log('▶ 4) Cookie-preserved session: visit home → fetch page 2 with cookies');
  const homeRes = await fetchWith(BASE + '/');
  const setCookies = homeRes.headers.raw?.()?.['set-cookie'] ?? [];
  const cookieHeader = setCookies.map((c) => c.split(';')[0]).join('; ');
  console.log(`  Home set ${setCookies.length} cookie(s): ${cookieHeader.substring(0, 200)}`);

  const r4 = await fetchWith(`${BASE}/web.page/?carList-page=2&page_id=2&do=carList-page`, { Cookie: cookieHeader, 'X-Requested-With': 'XMLHttpRequest' });
  console.log(`  Page 2 XHR + cookie → status=${r4.status}, len=${r4.html.length}, ct=${r4.headers.get('content-type')}`);
  if (r4.html.length < 2000) console.log('  Body: ' + r4.html.substring(0, 1000));
  else {
    const links4 = extractLinks(r4.html);
    console.log(`  ${links4.length} linků [${links4.map((l) => l.match(/-(\d+)\?/)?.[1]).join(',')}]`);
  }

  // 5) Brute-force ID range probe
  console.log('\n▶ 5) Brute-force probe IDs 300-320 (jestli detail URLs odpovídají)');
  for (let id = 300; id <= 320; id++) {
    const url = `${BASE}/skladove-vozy/anything-${id}?model-code=tivoli`;
    const r = await fetchWith(url);
    const has404 = /404|nenalezen|not found/i.test(r.html.substring(0, 5000));
    process.stdout.write(`  id=${id}: ${r.status} ${has404 ? '(404 page)' : '(OK)'} `);
    if ((id - 300) % 5 === 4) console.log('');
  }
  console.log('');
}
main().catch(console.error);
