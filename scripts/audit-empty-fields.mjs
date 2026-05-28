#!/usr/bin/env node
/**
 * audit-empty-fields.mjs
 *
 * Audit naplněnosti polí v Directus kolekcích. Pro každé custom pole
 * zjistí kolik recordů má hodnotu (≠ null/empty string). Výstup:
 *   - tabulka v terminálu seřazená od nejprázdnějších
 *   - CSV soubor s detaily
 *
 * Použití (z web/):
 *   DIRECTUS_URL=https://admin.sfr-motor.cz \
 *   DIRECTUS_ADMIN_TOKEN=<token> \
 *   node scripts/audit-empty-fields.mjs
 *
 * Volitelné: --collection=models  (filtr na jednu kolekci)
 *            --threshold=10       (zobrazí jen pole pod X% naplnění; default 50)
 *            --hidden             (zahrne i už skrytá pole)
 */


import fs from 'node:fs';

const DIRECTUS_URL = process.env.DIRECTUS_URL || process.env.PUBLIC_DIRECTUS_URL || 'https://admin.sfr-motor.cz';
const TOKEN = process.env.DIRECTUS_ADMIN_TOKEN || process.env.DIRECTUS_TOKEN;
const args = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));

if (!TOKEN) {
  console.error('❌ Chybí DIRECTUS_ADMIN_TOKEN env var');
  console.error('   Najdi v Directus admin → User Directory → tvůj user → Static Token');
  process.exit(1);
}

const threshold = Number(args.threshold ?? 50);
const includeHidden = !!args.hidden;
const collectionFilter = args.collection;

async function api(path) {
  const r = await fetch(`${DIRECTUS_URL}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!r.ok) throw new Error(`${r.status} ${path}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

const isEmpty = (v) => {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
};

console.log(`📡 ${DIRECTUS_URL}`);
console.log(`Threshold: pole pod ${threshold}% naplnění\n`);

const { data: collections } = await api('/collections?limit=-1');
const userCollections = collections
  .filter(c => !c.collection.startsWith('directus_'))
  .filter(c => !collectionFilter || c.collection === collectionFilter)
  .map(c => c.collection);

console.log(`Kolekce: ${userCollections.length}\n`);

const allReports = [];
const csvRows = [['collection', 'field', 'type', 'hidden', 'filled', 'total', 'fill_pct', 'interface']];

for (const coll of userCollections) {
  // Fields meta
  const { data: fields } = await api(`/fields/${coll}`);
  // Items
  let items;
  try {
    const { data } = await api(`/items/${coll}?limit=-1&fields=*`);
    items = data;
  } catch (e) {
    console.log(`  ⚠️  ${coll}: ${e.message.slice(0, 80)}`);
    continue;
  }
  const total = items.length;
  if (total === 0) {
    console.log(`  ⊘ ${coll} — žádné records, skip`);
    continue;
  }

  const fieldReports = [];
  for (const f of fields) {
    // Skip system/auto fields
    if (f.meta?.system) continue;
    if (['id', 'date_created', 'date_updated', 'user_created', 'user_updated', 'sort', 'status'].includes(f.field)) continue;
    // Skip relational meta (handled by Directus)
    if (f.meta?.special?.includes('o2m') || f.meta?.special?.includes('m2m')) continue;
    // Hidden filter
    const hidden = !!f.meta?.hidden;
    if (hidden && !includeHidden) continue;

    const filled = items.filter(it => !isEmpty(it[f.field])).length;
    const pct = Math.round((filled / total) * 1000) / 10;
    fieldReports.push({ field: f.field, type: f.type, hidden, filled, total, pct, interface: f.meta?.interface ?? '—' });
  }

  fieldReports.sort((a, b) => a.pct - b.pct);
  const lowFields = fieldReports.filter(f => f.pct < threshold);
  if (lowFields.length > 0) {
    console.log(`\n📋 ${coll} (${total} records)`);
    for (const f of lowFields) {
      const bar = '█'.repeat(Math.round(f.pct / 5)).padEnd(20, '·');
      const flag = f.hidden ? '👁️‍🗨️ hidden' : '';
      console.log(`   ${bar} ${String(f.pct).padStart(5)}%  ${f.field.padEnd(35)} ${f.type.padEnd(15)} ${f.filled}/${f.total} ${flag}`);
      csvRows.push([coll, f.field, f.type, f.hidden ? 'yes' : 'no', f.filled, f.total, f.pct, f.interface]);
      allReports.push({ collection: coll, ...f });
    }
  }
}

// Write CSV
const csv = csvRows.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
fs.writeFileSync('field-audit.csv', csv);
console.log(`\n\n📁 Detaily v: field-audit.csv (${csvRows.length - 1} řádků)`);
console.log(`\n💡 Tip: pole s 0% jsou kandidáti na skrytí. Pole s 1-30% si projdi ručně —`);
console.log(`        některá můžou být legitimní (např. promo_label vyplněný jen u akčních modelů).`);
