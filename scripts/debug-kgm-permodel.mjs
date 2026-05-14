#!/usr/bin/env node
/**
 * Debug: testuje per-model listing (alternativa k broken pagination).
 */
const BASE = 'https://stock.sfrmotor.kgmcars.cz';
const UA = 'Mozilla/5.0 (compatible; sfr-debug/1.0)';

const KGM_SLUGS = [
  'actyon', 'actyon-hybrid', 'torres', 'torres-evx', 'torres-hybrid',
  'rexton', 'korando', 'musso-grand', 'tivoli', 'tivoli-grand',
];

async function main() {
  let total = 0;
  for (const slug of KGM_SLUGS) {
    const url = `${BASE}/?model=${slug}`;
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    const html = await r.text();
    const links = [...new Set([...html.matchAll(/href="([^"]*\/skladove-vozy\/[^"]+)"/g)].map((m) => m[1]))];
    const ids = links.map((l) => l.match(/-(\d+)\?/)?.[1] ?? '?');
    console.log(`${slug.padEnd(18)} → ${String(links.length).padStart(2)} vozů: ${ids.join(', ')}`);
    total += links.length;
    await new Promise((r) => setTimeout(r, 300));
  }
  console.log(`\nTotal: ${total} (KGM hlásí 42)`);
}
main().catch(console.error);
