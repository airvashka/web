#!/usr/bin/env node
/**
 * Probe různé varianty filtrace na KGM v mobile.de consumer API.
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const BASE = 'https://www.mobile.de/consumer/api/search/srp';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'de-DE,de;q=0.9',
  'Referer': 'https://www.mobile.de/',
};

// Bez filtru = 1.5M. Cíl: najít parametr který zúží na ~stovky/desítky.
const tries = [
  { label: 'make=KGM (string)',         qs: 'make=KGM' },
  { label: 'make=Kgm (lowercase)',      qs: 'make=Kgm' },
  { label: 'make=kgm (slug)',           qs: 'make=kgm' },
  { label: 'make=Ssangyong (původní)',   qs: 'make=Ssangyong' },
  { label: 'makeName=KGM',              qs: 'makeName=KGM' },
  { label: 'manufacturer=KGM',          qs: 'manufacturer=KGM' },
  { label: 'm=KGM',                     qs: 'm=KGM' },
  { label: 'ms=KGM',                    qs: 'ms=KGM' },
  // Možná makeModelVariant1.make
  { label: 'makeModelVariant1.make=KGM', qs: 'makeModelVariant1.make=KGM' },
  // Číselné ID — hádám
  { label: 'makeId=12200 (guess)',       qs: 'makeId=12200' },
  // Sample od existující SEO URL
  { label: '/auto/kgm.html parametry — možná seoUrl',  qs: 'seoUrl=auto/kgm.html' },
  { label: 'refToken syntactic',         qs: 'refToken=kgm' },
];

async function probe(label, qs) {
  const url = `${BASE}?${qs}&pageSize=10`;
  try {
    const r = await fetch(url, { headers: HEADERS });
    if (r.status !== 200) {
      console.log(`  ${label.padEnd(45)} → ${r.status}`);
      return;
    }
    const json = await r.json();
    const total = json?.searchResults?.numResultsTotal ?? '?';
    const items = json?.searchResults?.items ?? [];
    const firstMake = items.find((i) => i.make && !i.isEyeCatcher && i.type !== 'topAd')?.make ?? items[0]?.make ?? '?';
    const allMakes = [...new Set(items.map((i) => i.make).filter(Boolean))];
    console.log(`  ${label.padEnd(45)} → total=${String(total).padStart(8)}, items=${items.length}, makes=[${allMakes.slice(0, 5).join(',')}]`);
    if (allMakes.length === 1 && /kgm|ssangyong/i.test(allMakes[0])) {
      console.log(`    ★★★ FUNGUJE — všechny items jsou ${allMakes[0]}`);
      mkdirSync('tmp', { recursive: true });
      writeFileSync(`tmp/mobile-de-kgm-${qs.replace(/[^a-z0-9]/gi, '_')}.json`, JSON.stringify(json, null, 2));
    } else if (total < 1000 && allMakes.includes('KGM')) {
      console.log(`    ✓ Možná funguje (total=${total} <1k a obsahuje KGM)`);
    }
  } catch (e) {
    console.log(`  ${label.padEnd(45)} → ✗ ${e.message}`);
  }
}

async function main() {
  console.log('Hledám správný make filter pro KGM v mobile.de consumer API:\n');
  for (const { label, qs } of tries) {
    await probe(label, qs);
    await new Promise((r) => setTimeout(r, 300));
  }

  // Bonus: zkusíme i Ssangyong + KGM zároveň (KGM dříve = Ssangyong)
  console.log('\n--- Také zkusíme získat seznam dostupných makes přes aggregation ---');
  const r = await fetch(`${BASE}?pageSize=1`, { headers: HEADERS });
  const data = await r.json();
  const makeAgg = data?.aggregations?.makeModelVariant1?.make ?? data?.aggregations?.make ?? data?.aggregations;
  if (makeAgg) {
    console.log('aggregations.makeModelVariant1.make nebo aggregations.make:');
    console.log(JSON.stringify(makeAgg, null, 2).substring(0, 2000));
  } else {
    console.log('Aggregations klíče: ' + Object.keys(data?.aggregations ?? {}).join(', '));
  }
}

main().catch(console.error);
