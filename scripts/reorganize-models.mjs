#!/usr/bin/env node
/**
 * reorganize-models.mjs — pilot reorganizace Directus models kolekce.
 *
 * Co dělá:
 *   1. BACKUP: současný field meta uloží do field-backup-models.json
 *   2. APPLY: vytvoří 2 group fields (Akce/Promo, Media), přesune pole do nich,
 *      nastaví half-width pro krátké inputy, seřadí sort.
 *   3. REVERT: vrátí zpět ze zálohy.
 *
 * Spuštění:
 *   $env:DIRECTUS_ADMIN_TOKEN="<token>"; $env:DIRECTUS_URL="https://admin.sfr-motor.cz"
 *   node scripts/reorganize-models.mjs --backup       # uloží zálohu
 *   node scripts/reorganize-models.mjs --apply        # aplikuje změny
 *   node scripts/reorganize-models.mjs --revert       # vrátí ze zálohy
 *   node scripts/reorganize-models.mjs --dry-run      # ukáže co by se stalo
 */

import fs from 'node:fs';

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://admin.sfr-motor.cz';
const TOKEN = process.env.DIRECTUS_ADMIN_TOKEN || process.env.DIRECTUS_TOKEN;
const BACKUP_FILE = 'field-backup-models.json';
const COLLECTION = 'models';

const MODE = process.argv.includes('--apply') ? 'apply'
           : process.argv.includes('--revert') ? 'revert'
           : process.argv.includes('--backup') ? 'backup'
           : 'dry-run';

if (!TOKEN) {
  console.error('❌ Chybí DIRECTUS_ADMIN_TOKEN env var');
  process.exit(1);
}

async function api(path, opts = {}) {
  const r = await fetch(`${DIRECTUS_URL}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (!r.ok && r.status !== 404) {
    const txt = await r.text().catch(() => '');
    throw new Error(`${r.status} ${path}: ${txt.slice(0, 300)}`);
  }
  if (r.status === 404) return null;
  return r.json();
}

console.log(`📡 ${DIRECTUS_URL}`);
console.log(`🎯 Mode: ${MODE.toUpperCase()}\n`);

// =========================================================================
// GROUPS to create
// =========================================================================
const GROUPS = [
  {
    field: 'promo_group',
    type: 'alias',
    meta: {
      collection: COLLECTION,
      field: 'promo_group',
      special: ['alias', 'no-data', 'group'],
      interface: 'group-detail',
      options: { start: 'closed', headerIcon: 'campaign' },
      hidden: false,
      readonly: false,
      sort: 100,
      width: 'full',
      translations: [{ language: 'cs-CZ', translation: '🎁 Akce / Promo' }],
    },
  },
  {
    field: 'media_group',
    type: 'alias',
    meta: {
      collection: COLLECTION,
      field: 'media_group',
      special: ['alias', 'no-data', 'group'],
      interface: 'group-detail',
      options: { start: 'closed', headerIcon: 'movie' },
      hidden: false,
      readonly: false,
      sort: 200,
      width: 'full',
      translations: [{ language: 'cs-CZ', translation: '🎬 Media' }],
    },
  },
];

// =========================================================================
// FIELD layout — kam patří + width + sort
// Pole co nejsou v mapě = nechány jak jsou
// =========================================================================
const FIELD_LAYOUT = {
  // Top-level (sort 1-50)
  name:           { width: 'half', group: null, sort: 1 },
  slug:           { width: 'half', group: null, sort: 2 },
  brand:          { width: 'half', group: null, sort: 3 },
  sub_brand:      { width: 'half', group: null, sort: 4 },
  body_type:      { width: 'half', group: null, sort: 5 },
  fuel_type:      { width: 'half', group: null, sort: 6 },
  tagline:        { width: 'full', group: null, sort: 7 },
  description:    { width: 'full', group: null, sort: 8 },
  hero_image:     { width: 'full', group: null, sort: 9 },
  hero_label:     { width: 'half', group: null, sort: 10 },
  hero_eyebrow:   { width: 'half', group: null, sort: 11 },
  hero_cta:       { width: 'full', group: null, sort: 12 },

  // Akce / Promo grupa (sort 101-110)
  promo_active:           { width: 'half', group: 'promo_group', sort: 101 },
  promo_label:            { width: 'half', group: 'promo_group', sort: 102 },
  promo_discount_amount:  { width: 'half', group: 'promo_group', sort: 103 },
  promo_valid_to:         { width: 'half', group: 'promo_group', sort: 104 },
  promo_description:      { width: 'full', group: 'promo_group', sort: 105 },
  promo_image:            { width: 'full', group: 'promo_group', sort: 106 },
  promo_image_transparent:{ width: 'half', group: 'promo_group', sort: 107 },
  _promo_divider:         { width: 'full', group: 'promo_group', sort: 108 },

  // Media grupa (sort 201-210)
  youtube_video_ids:      { width: 'full', group: 'media_group', sort: 201 },
  hero_image_card:        { width: 'full', group: 'media_group', sort: 202 },
};

// =========================================================================
// ACTIONS
// =========================================================================

if (MODE === 'backup' || MODE === 'apply') {
  console.log(`💾 Backup current state → ${BACKUP_FILE}`);
  const { data: fields } = await api(`/fields/${COLLECTION}`);
  const backup = fields.map(f => ({
    field: f.field,
    type: f.type,
    meta: f.meta,
  }));
  fs.writeFileSync(BACKUP_FILE, JSON.stringify(backup, null, 2));
  console.log(`   Uloženo ${backup.length} polí.\n`);
  if (MODE === 'backup') {
    console.log('✓ Backup hotový. Pro apply spusť: node scripts/reorganize-models.mjs --apply');
    process.exit(0);
  }
}

if (MODE === 'revert') {
  if (!fs.existsSync(BACKUP_FILE)) {
    console.error(`❌ Backup soubor ${BACKUP_FILE} nenalezen — nelze revert.`);
    process.exit(1);
  }
  const backup = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8'));
  console.log(`♻️  Revert: obnovuji ${backup.length} polí ze zálohy\n`);

  // Delete groups co jsme vytvořili (jen ty 2)
  for (const g of GROUPS) {
    try {
      const r = await api(`/fields/${COLLECTION}/${g.field}`, { method: 'DELETE' });
      console.log(`   🗑️  Smazána grupa ${g.field}`);
    } catch (e) {
      console.log(`   ⚠️  ${g.field}: ${e.message.slice(0, 100)}`);
    }
  }

  // Restore field meta z backupu
  for (const f of backup) {
    if (!f.meta) continue;
    try {
      await api(`/fields/${COLLECTION}/${f.field}`, {
        method: 'PATCH',
        body: JSON.stringify({ meta: f.meta }),
      });
      console.log(`   ↺ ${f.field}`);
    } catch (e) {
      console.log(`   ⚠️  ${f.field}: ${e.message.slice(0, 100)}`);
    }
  }
  console.log(`\n✓ Revert hotový. Backup soubor ponechán pro případ opakování.`);
  process.exit(0);
}

if (MODE === 'apply' || MODE === 'dry-run') {
  const isDry = MODE === 'dry-run';

  // Pre-fetch all fields (Directus 11 vrací 403 místo 404 pro neexistující field,
  // proto nemůžeme jet single-field check — fetchneme všechno najednou a držíme v mapě)
  const allFieldsResp = await api(`/fields/${COLLECTION}`);
  const allFields = allFieldsResp?.data || [];
  const fieldsByName = new Map(allFields.map(f => [f.field, f]));
  console.log(`📋 Cache: ${fieldsByName.size} existujících polí v ${COLLECTION}\n`);

  // 1) Vytvořit group fields
  console.log(`${isDry ? '👀 DRY' : '✏️  APPLY'}: Vytvořit ${GROUPS.length} group fields`);
  for (const g of GROUPS) {
    // Check existence (z mapy, ne API)
    if (fieldsByName.has(g.field)) {
      console.log(`   ⊙ ${g.field} už existuje, skipping`);
      continue;
    }
    if (isDry) {
      console.log(`   + ${g.field} (${g.meta.translations[0].translation})`);
      continue;
    }
    try {
      await api(`/fields/${COLLECTION}`, {
        method: 'POST',
        body: JSON.stringify(g),
      });
      console.log(`   + ${g.field} (${g.meta.translations[0].translation})`);
    } catch (e) {
      console.log(`   ✗ ${g.field}: ${e.message.slice(0, 150)}`);
    }
  }

  // 2) Apply per-field layout
  console.log(`\n${isDry ? '👀 DRY' : '✏️  APPLY'}: Layout pro ${Object.keys(FIELD_LAYOUT).length} polí`);
  for (const [fieldName, cfg] of Object.entries(FIELD_LAYOUT)) {
    const existing = fieldsByName.get(fieldName);
    if (!existing) {
      console.log(`   ⚠️  ${fieldName}: pole neexistuje, skipping`);
      continue;
    }
    const meta = { ...(existing.meta || {}) };
    meta.width = cfg.width;
    meta.sort = cfg.sort;
    if (cfg.group !== undefined) meta.group = cfg.group;
    if (isDry) {
      console.log(`   = ${fieldName.padEnd(28)} → width=${cfg.width.padEnd(4)} group=${(cfg.group ?? '-').padEnd(14)} sort=${cfg.sort}`);
      continue;
    }
    try {
      await api(`/fields/${COLLECTION}/${fieldName}`, {
        method: 'PATCH',
        body: JSON.stringify({ meta }),
      });
      console.log(`   ✓ ${fieldName}`);
    } catch (e) {
      console.log(`   ✗ ${fieldName}: ${e.message.slice(0, 120)}`);
    }
  }

  console.log(`\n${isDry ? '👀 DRY-RUN dokončen' : '✓ APPLY hotový'}`);
  if (isDry) console.log(`   Pro aplikaci spusť: node scripts/reorganize-models.mjs --apply`);
  else       console.log(`   Otevři https://admin.sfr-motor.cz/admin/content/models/+ a uvidíš nový layout.`);
  console.log(`   Revert: node scripts/reorganize-models.mjs --revert`);
}
