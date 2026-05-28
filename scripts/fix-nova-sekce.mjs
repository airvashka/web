#!/usr/bin/env node
/**
 * fix-nova-sekce.mjs
 *
 * Najde všechny trim_levels.features s kategorií "NOVÁ SEKCE" (nebo prázdnou
 * stringem) a nahradí ji autoritativním názvem ze sourozeneckých trims (stejný
 * model_year). Heuristika: pro každý feature item najde, do které kategorie
 * patří v jiných trims (kde už je správně), a použije ji.
 *
 * Spuštění (z web/):
 *   DIRECTUS_URL=https://admin.sfr-motor.cz \
 *   DIRECTUS_ADMIN_TOKEN=<token> \
 *   node scripts/fix-nova-sekce.mjs
 *
 * Token získáš z Directus admin → User Directory → tvůj user → Token field
 * (nebo vytvoř static token pod adminem).
 *
 * Bez --apply jen reportuje, s --apply opravdu PATCHne.
 */

import 'dotenv/config';

const DIRECTUS_URL = process.env.DIRECTUS_URL || process.env.PUBLIC_DIRECTUS_URL || 'https://admin.sfr-motor.cz';
const TOKEN = process.env.DIRECTUS_ADMIN_TOKEN || process.env.DIRECTUS_TOKEN;
const APPLY = process.argv.includes('--apply');

if (!TOKEN) {
  console.error('❌ Chybí DIRECTUS_ADMIN_TOKEN nebo DIRECTUS_TOKEN env var');
  console.error('   Najdi token v Directus admin (User Directory → tvůj user → Static Token)');
  process.exit(1);
}

const isBad = (cat) => {
  const c = String(cat ?? '').trim().toUpperCase();
  return !c || c === 'NOVÁ SEKCE' || c === 'NOVA SEKCE';
};

async function api(path, opts = {}) {
  const r = await fetch(`${DIRECTUS_URL}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`${r.status} ${path}: ${txt.slice(0, 300)}`);
  }
  return r.json();
}

console.log(`📡 ${DIRECTUS_URL}`);
console.log(`Mode: ${APPLY ? '✏️  APPLY (zapisuju)' : '👀 DRY-RUN (jen report — přidej --apply pro zápis)'}\n`);

// Fetch all trims with features
const { data: trims } = await api('/items/trim_levels?fields=id,name,model_year,features&limit=-1');
console.log(`Loaded ${trims.length} trim_levels`);

const affected = trims.filter(t => Array.isArray(t.features) && t.features.some(s => isBad(s.category)));
console.log(`Affected: ${affected.length} trims with NOVÁ SEKCE / prázdná kategorie\n`);

if (affected.length === 0) {
  console.log('✓ Žádné NOVÁ SEKCE v DB — všechno OK');
  process.exit(0);
}

// Group by model_year for sibling lookup
const byModelYear = new Map();
for (const t of trims) {
  const my = t.model_year;
  if (!byModelYear.has(my)) byModelYear.set(my, []);
  byModelYear.get(my).push(t);
}

let totalPatched = 0;

for (const t of affected) {
  const siblings = byModelYear.get(t.model_year) || [];
  // Build feature -> good section map from all siblings
  const featureToSection = new Map();
  for (const sib of siblings) {
    for (const sec of (sib.features || [])) {
      if (isBad(sec.category)) continue;
      const cat = String(sec.category).trim();
      for (const item of (sec.items || [])) {
        const clean = String(item ?? '').trim();
        if (clean && !featureToSection.has(clean)) featureToSection.set(clean, cat);
      }
    }
  }

  // Rebuild features
  const itemsBySection = new Map();
  const order = [];
  for (const sec of (t.features || [])) {
    const oldCat = isBad(sec.category) ? null : String(sec.category).trim();
    for (const item of (sec.items || [])) {
      const clean = String(item ?? '').trim();
      if (!clean) continue;
      const newCat = featureToSection.get(clean) || oldCat || 'Ostatní';
      if (!itemsBySection.has(newCat)) { itemsBySection.set(newCat, []); order.push(newCat); }
      itemsBySection.get(newCat).push(item);
    }
  }
  const newFeatures = order.map(c => ({ category: c, items: itemsBySection.get(c) }));

  const beforeCats = t.features.map(s => s.category);
  const afterCats = newFeatures.map(s => s.category);
  const changed = JSON.stringify(beforeCats) !== JSON.stringify(afterCats);

  if (!changed) {
    console.log(`  ${t.name} (id=${t.id}): bez změny`);
    continue;
  }

  console.log(`  ${t.name} (id=${t.id}):`);
  console.log(`    BEFORE: ${JSON.stringify(beforeCats)}`);
  console.log(`    AFTER:  ${JSON.stringify(afterCats)}`);

  if (APPLY) {
    try {
      await api(`/items/trim_levels/${t.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ features: newFeatures }),
      });
      console.log(`    ✓ updated`);
      totalPatched++;
    } catch (e) {
      console.error(`    ✗ failed: ${e.message}`);
    }
  }
}

console.log(`\n${APPLY ? `✏️  Zapsáno: ${totalPatched} trims` : '👀 DRY-RUN — spusť s --apply pro zápis'}`);
