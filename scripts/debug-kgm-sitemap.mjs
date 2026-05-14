#!/usr/bin/env node
const BASE = 'https://stock.sfrmotor.kgmcars.cz';

const tries = [
  // sitemapSdff.xml — různé UA
  { label: 'sitemapSdff plain',           url: '/sitemapSdff.xml', headers: {} },
  { label: 'sitemapSdff Chrome UA',       url: '/sitemapSdff.xml', headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36' } },
  { label: 'sitemapSdff Googlebot',        url: '/sitemapSdff.xml', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' } },
  { label: 'sitemapSdff Accept xml',       url: '/sitemapSdff.xml', headers: { 'Accept': 'application/xml,text/xml,*/*' } },
  // alternativní názvy
  { label: 'sitemap-cars.xml',             url: '/sitemap-cars.xml', headers: {} },
  { label: 'sitemap2.xml',                 url: '/sitemap2.xml', headers: {} },
  { label: 'sitemap_cars.xml',             url: '/sitemap_cars.xml', headers: {} },
  { label: 'carSitemap.xml',               url: '/carSitemap.xml', headers: {} },
  { label: 'sitemap-detail.xml',           url: '/sitemap-detail.xml', headers: {} },
  // velký home s bot UA — možná SSR pro crawlery
  { label: 'Home Googlebot',               url: '/', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' } },
  // Nette signal varianty
  { label: 'do=carList-paginator-page&page=2', url: '/?do=carList-paginator-page&page=2', headers: { 'X-Requested-With': 'XMLHttpRequest' } },
  { label: 'do=carList-setPage&carList-page=2', url: '/?do=carList-setPage&carList-page=2', headers: { 'X-Requested-With': 'XMLHttpRequest' } },
];

const BOT_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

async function main() {
  for (const t of tries) {
    const r = await fetch(BASE + t.url, { headers: { 'User-Agent': BOT_UA, ...t.headers } });
    const html = await r.text();
    const ct = r.headers.get('content-type');
    const links = [...new Set([...html.matchAll(/\/skladove-vozy\/[^<"\s]+/g)].map((m) => m[0]))];
    console.log(`${t.label.padEnd(40)} → ${r.status} ${(ct ?? '').substring(0, 25)} len=${String(html.length).padStart(6)} detail-links=${links.length}`);
    if (links.length > 5) console.log(`  ✓ Možná všechny: ${links.slice(0, 3).join(', ')} ...`);
    if (r.status === 500 && html.length < 1500) console.log('  Body 500:\n  ' + html.substring(0, 400).replace(/\n/g, '\n  '));
  }
}
main().catch(console.error);
