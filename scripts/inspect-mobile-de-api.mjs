#!/usr/bin/env node
/**
 * Probnejme strukturu mobile.de consumer/api/search/srp odpovědi.
 *
 * Co skript dělá:
 *   1) Fetchne KGM listings page 1 (max 20)
 *   2) Uloží full JSON do tmp/mobile-de-api.json
 *   3) Vypíše: totální počet, počet items, klíče prvního item, pagination
 *   4) Otestuje page 2 (jestli pagination funguje)
 *
 * Použití: cd web && node scripts/inspect-mobile-de-api.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = 'https://www.mobile.de/consumer/api/search/srp';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'de-DE,de;q=0.9',
  'Referer': 'https://www.mobile.de/',
};

async function fetchPage(pageNum) {
  const url = `${BASE}?make=KGM&pageSize=20&page=${pageNum}`;
  console.log(`\n▶ Fetch page ${pageNum}: ${url}`);
  const r = await fetch(url, { headers: HEADERS });
  console.log(`  status=${r.status}, ct=${r.headers.get('content-type')}`);
  if (r.status !== 200) {
    const txt = await r.text();
    console.log('  Body: ' + txt.substring(0, 300));
    return null;
  }
  return r.json();
}

function findItemsArray(obj, depth = 0, path = '') {
  // Heuristika: hledáme array stránek s car-like objekty
  if (depth > 5) return null;
  if (Array.isArray(obj) && obj.length > 0 && typeof obj[0] === 'object') {
    const first = obj[0];
    const keys = Object.keys(first);
    // Car-like: má klíče jako "price", "make", "model", "year", "kilometers", "id"
    const carHints = ['price', 'make', 'model', 'modelDescription', 'kilometers', 'firstRegistration', 'priceRating'];
    const matches = carHints.filter((h) => keys.some((k) => k.toLowerCase().includes(h.toLowerCase())));
    if (matches.length >= 2) {
      return { path, items: obj, matched: matches };
    }
  }
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      const result = findItemsArray(v, depth + 1, path ? `${path}.${k}` : k);
      if (result) return result;
    }
  }
  return null;
}

function summarizeValue(v, maxLen = 80) {
  if (v === null || v === undefined) return String(v);
  if (typeof v === 'string') return v.length > maxLen ? v.substring(0, maxLen) + '...' : `"${v}"`;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `[${v.length}]`;
  if (typeof v === 'object') {
    const keys = Object.keys(v);
    return `{${keys.length} keys: ${keys.slice(0, 5).join(', ')}${keys.length > 5 ? '...' : ''}}`;
  }
  return String(v);
}

async function main() {
  mkdirSync('tmp', { recursive: true });

  // Page 1
  const data1 = await fetchPage(1);
  if (!data1) { console.log('✗ Page 1 selhalo'); return; }

  writeFileSync('tmp/mobile-de-api.json', JSON.stringify(data1, null, 2));
  console.log(`  ✓ Uloženo: tmp/mobile-de-api.json (${JSON.stringify(data1).length} bytes)`);

  // Top-level klíče
  console.log('\nTop-level klíče:');
  for (const k of Object.keys(data1)) {
    console.log(`  ${k}: ${summarizeValue(data1[k])}`);
  }

  // Hledej items array
  const items = findItemsArray(data1);
  if (!items) {
    console.log('\n✗ Nenašel jsem car-like items array. Mrkni do tmp/mobile-de-api.json ručně.');
    return;
  }

  console.log(`\n✓ Items array nalezeno na cestě: ${items.path}`);
  console.log(`  Délka: ${items.items.length}`);
  console.log(`  Matched car hints: ${items.matched.join(', ')}`);

  // První item — full key dump
  const first = items.items[0];
  console.log(`\nPrvní item — všechny klíče:`);
  for (const k of Object.keys(first)) {
    console.log(`  ${k.padEnd(30)} : ${summarizeValue(first[k], 100)}`);
  }

  // Pokud má sub-objekty, vypíš keys
  console.log('\nKlíče sub-objektů 1. itemu (kde to dává smysl):');
  for (const [k, v] of Object.entries(first)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const subKeys = Object.keys(v);
      console.log(`  ${k}.{${subKeys.join(', ')}}`);
    } else if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object') {
      console.log(`  ${k}[0].{${Object.keys(v[0]).join(', ')}}`);
    }
  }

  // Hledej pagination info
  const findPagination = (obj, depth = 0) => {
    if (depth > 4 || !obj || typeof obj !== 'object') return null;
    for (const [k, v] of Object.entries(obj)) {
      if (/numResultsTotal|totalResults|totalPages|numPages|pageNumber/i.test(k)) {
        return { path: k, value: v };
      }
      if (typeof v === 'object') {
        const sub = findPagination(v, depth + 1);
        if (sub) return { path: `${k}.${sub.path}`, value: sub.value };
      }
    }
    return null;
  };
  const pag = findPagination(data1);
  console.log(`\nPagination: ${pag ? `${pag.path} = ${pag.value}` : '(nenalezeno)'}`);

  // Page 2 — ověř pagination
  if (items.items.length === 20) {
    const data2 = await fetchPage(2);
    if (data2) {
      const items2 = findItemsArray(data2);
      console.log(`\nPage 2: ${items2?.items.length ?? 0} items`);
      if (items2 && items2.items.length > 0) {
        const firstId = first?.id ?? first?.adId ?? '?';
        const firstId2 = items2.items[0]?.id ?? items2.items[0]?.adId ?? '?';
        console.log(`  Page 1 first ID: ${firstId}`);
        console.log(`  Page 2 first ID: ${firstId2}`);
        if (firstId !== firstId2) console.log('  ✓ Pagination funguje (jiné items na page 2)');
      }
    }
  }

  console.log('\n═══════════════════');
  console.log('Mrkni do tmp/mobile-de-api.json — uvidíš plnou strukturu.');
}

main().catch((e) => { console.error(e); process.exit(1); });
