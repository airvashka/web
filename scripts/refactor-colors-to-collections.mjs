#!/usr/bin/env node
/**
 * SFR Motor — refactor barev na samostatné collections.
 *
 * Důvod: Directus 11 má buggy nested file picker uvnitř JSON repeateru —
 * upload obrázku se neuloží do parent JSON. Workaround: udělat z barev
 * skutečné collections s M2O na directus_files.
 *
 * Co vytvoří:
 *   1) Collection `model_color_exterior` (id, model M2O, photo M2O files, name, hex, price_type, sort)
 *   2) Collection `model_color_interior` (id, model M2O, photo M2O files, name, material, hex, sort)
 *   3) Public read permissions na obě
 *   4) Migrace dat z models.color_options/interior_options JSON do records
 *
 * Po dokončení: admin v models → uvidíš "Color Exterior" + "Color Interior"
 * jako separátní inline listy s ŘÁDKOVÝM file pickerem (funguje 100%).
 *
 * Použití:
 *   cd web && node scripts/refactor-colors-to-collections.mjs
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rl = readline.createInterface({ input, output });
const prompt = (q) => rl.question(q);

let URL = '', TOKEN = '';

async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${URL}${path}`, opts);
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(j?.errors ?? j)}`);
  return j;
}

const ok = (m) => console.log(`  ✓  ${m}`);
const info = (m) => console.log(`  ℹ  ${m}`);
const warn = (m) => console.log(`  ⚠  ${m}`);

async function collectionExists(name) {
  try { await api('GET', `/collections/${name}`); return true; } catch { return false; }
}

async function ensureCollection(name, icon, note) {
  if (await collectionExists(name)) {
    info(`Collection ${name} už existuje`);
  } else {
    // POST /collections s primary_key field definicí → Directus vytvoří `id` automaticky
    await api('POST', '/collections', {
      collection: name,
      meta: {
        icon,
        note,
        sort_field: 'sort',
        display_template: '{{name}}',
      },
      schema: {},
      fields: [
        {
          field: 'id',
          type: 'integer',
          meta: { hidden: true, interface: 'input', readonly: true },
          schema: { is_primary_key: true, has_auto_increment: true },
        },
      ],
    });
    ok(`Collection ${name} vytvořena`);
  }

  // sort field — idempotentně (skipne pokud existuje)
  if (!(await fieldExists(name, 'sort'))) {
    await api('POST', `/fields/${name}`, {
      field: 'sort',
      type: 'integer',
      schema: { is_nullable: true },
      meta: { interface: 'input', hidden: true },
    });
  }
}

async function fieldExists(collection, field) {
  try { await api('GET', `/fields/${collection}/${field}`); return true; } catch { return false; }
}

async function ensureField(collection, field, type, meta = {}, schema = {}) {
  if (await fieldExists(collection, field)) return;
  await api('POST', `/fields/${collection}`, {
    field,
    type,
    schema: { is_nullable: true, ...schema },
    meta: { width: 'full', ...meta },
  });
}

async function ensureM2OFile(collection, field, label, note) {
  if (await fieldExists(collection, field)) return;
  await api('POST', `/fields/${collection}`, {
    field,
    type: 'uuid',
    schema: { foreign_key_table: 'directus_files', is_nullable: true },
    meta: { interface: 'file-image', special: ['file'], note, display: 'image', width: 'full' },
  });
  await api('POST', '/relations', {
    collection, field, related_collection: 'directus_files',
    schema: { on_delete: 'SET NULL' },
  });
}

async function ensureM2OModel(collection, field) {
  if (await fieldExists(collection, field)) return;
  await api('POST', `/fields/${collection}`, {
    field,
    type: 'integer',
    schema: { foreign_key_table: 'models', is_nullable: false },
    meta: { interface: 'select-dropdown-m2o', special: ['m2o'], display: 'related-values', display_options: { template: '{{name}}' }, width: 'half', hidden: true },
  });
  await api('POST', '/relations', {
    collection, field, related_collection: 'models',
    schema: { on_delete: 'CASCADE' },
    meta: { sort_field: 'sort' },
  });
}

async function ensureO2M(parent, child, parentField, childField) {
  // 1) Alias field na parent (pokud neexistuje)
  if (!(await fieldExists(parent, parentField))) {
    await api('POST', `/fields/${parent}`, {
      field: parentField,
      type: 'alias',
      meta: {
        interface: 'list-o2m',
        special: ['o2m'],
        width: 'full',
        options: { enableCreate: true, enableSelect: true, layout: 'list' },
      },
    });
  }

  // 2) Relation může existovat z dřívějšího běhu (M2O byl vytvořen ale O2M alias selhal)
  let existing = null;
  try {
    existing = await api('GET', `/relations/${child}/${childField}`);
  } catch {
    // Relation neexistuje
  }

  if (existing?.data) {
    // PATCH one_field aby ukazovalo na náš nový alias
    if (existing.data.meta?.one_field !== parentField) {
      await api('PATCH', `/relations/${child}/${childField}`, {
        meta: { one_field: parentField, sort_field: 'sort' },
      });
    }
  } else {
    await api('POST', '/relations', {
      collection: child, field: childField, related_collection: parent,
      schema: { on_delete: 'CASCADE' },
      meta: { one_field: parentField, sort_field: 'sort' },
    });
  }
}

async function ensurePublicRead(collection) {
  const access = await api('GET', '/access?filter[user][_null]=true&filter[role][_null]=true&fields=policy');
  const policyId = access.data?.[0]?.policy;
  if (!policyId) { warn('Public policy nenalezena'); return; }
  const existing = await api('GET', `/permissions?filter[policy][_eq]=${policyId}&filter[collection][_eq]=${collection}&filter[action][_eq]=read&limit=1`);
  if (existing.data?.length > 0) return;
  await api('POST', '/permissions', {
    policy: policyId, collection, action: 'read', fields: ['*'], permissions: null,
  });
  ok(`${collection}: public read přidáno`);
}

// ===== Schema setup =====

async function setupExteriorCollection() {
  const name = 'model_color_exterior';
  await ensureCollection(name, 'palette', 'Barvy karoserie modelu — fotka + popisek.');
  await ensureM2OFile(name, 'photo', 'Foto barvy', 'Fotka karoserie v dané barvě nebo barevný swatch.');
  await ensureField(name, 'name', 'string', { interface: 'input', note: 'Název barvy, např. "Bílá perleťová"' });
  await ensureField(name, 'hex', 'string', { interface: 'input', width: 'half', note: 'Volitelně. Fallback CSS barva.' });
  await ensureField(name, 'price_type', 'string', {
    interface: 'select-dropdown',
    width: 'half',
    options: {
      choices: [
        { text: 'V ceně', value: 'free' },
        { text: 'Příplatek (metalíza)', value: 'metallic' },
        { text: 'Příplatek (perleť)', value: 'pearl' },
      ],
    },
  });
  // M2O na models
  await ensureM2OModel(name, 'model');
  // Public read
  await ensurePublicRead(name);
  ok(`${name} OK`);
}

async function setupInteriorCollection() {
  const name = 'model_color_interior';
  await ensureCollection(name, 'weekend', 'Barvy / typy interiéru modelu — fotka + popisek.');
  await ensureM2OFile(name, 'photo', 'Foto interiéru', 'Velká fotka interiéru (16:9 landscape).');
  await ensureField(name, 'name', 'string', { interface: 'input', note: 'Název, např. "Černá kůže (standardní)"' });
  await ensureField(name, 'material', 'string', { interface: 'input', width: 'half', note: 'Volitelně, např. "pravá kůže"' });
  await ensureField(name, 'hex', 'string', { interface: 'input', width: 'half', note: 'Volitelně. Fallback CSS barva.' });
  await ensureM2OModel(name, 'model');
  await ensurePublicRead(name);
  ok(`${name} OK`);
}

async function setupO2MOnModels() {
  await ensureO2M('models', 'model_color_exterior', 'color_exterior', 'model');
  ok('models.color_exterior O2M alias');
  await ensureO2M('models', 'model_color_interior', 'color_interior', 'model');
  ok('models.color_interior O2M alias');
}

// ===== Migration =====

async function migrateData() {
  console.log('\nKrok 3: Migrace existujících JSON dat → records');
  const models = await api('GET', '/items/models?limit=200&fields=id,slug,name,color_options,interior_options');
  let extCreated = 0, intCreated = 0, skipped = 0;

  for (const m of models.data) {
    const ext = Array.isArray(m.color_options) ? m.color_options : [];
    const int = Array.isArray(m.interior_options) ? m.interior_options : [];

    // Idempotence — pokud už má records, skip
    const existingExt = await api('GET', `/items/model_color_exterior?filter[model][_eq]=${m.id}&limit=1&fields=id`);
    if (existingExt.data?.length > 0) {
      info(`${m.slug}: už má exterior records, skipuji`);
      skipped++;
      continue;
    }

    for (let i = 0; i < ext.length; i++) {
      const c = ext[i];
      const photoId = c.photo_file ?? c.swatch_file ?? null;
      const priceMap = { 'základní': 'free', 'metalíza': 'metallic', 'perleť': 'pearl' };
      try {
        await api('POST', '/items/model_color_exterior', {
          model: m.id,
          photo: photoId,
          name: c.name ?? c.name_cs ?? '',
          hex: c.hex ?? null,
          price_type: priceMap[c.type] ?? null,
          sort: i + 1,
        });
        extCreated++;
      } catch (e) {
        warn(`  ${m.slug} ext[${i}]: ${e.message}`);
      }
    }

    for (let i = 0; i < int.length; i++) {
      const c = int[i];
      const photoId = c.photo_file ?? c.preview_file ?? c.swatch_file ?? null;
      try {
        await api('POST', '/items/model_color_interior', {
          model: m.id,
          photo: photoId,
          name: c.name ?? c.name_cs ?? '',
          material: c.material ?? null,
          hex: c.hex ?? null,
          sort: i + 1,
        });
        intCreated++;
      } catch (e) {
        warn(`  ${m.slug} int[${i}]: ${e.message}`);
      }
    }

    if (ext.length > 0 || int.length > 0) {
      ok(`${m.slug}: ${ext.length} ext + ${int.length} int migrated`);
    }
  }
  return { extCreated, intCreated, skipped };
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Refactor barev na samostatné collections');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  console.log('Krok 1: Collections');
  await setupExteriorCollection();
  await setupInteriorCollection();
  console.log('');

  console.log('Krok 2: O2M aliases na models');
  await setupO2MOnModels();
  console.log('');

  const result = await migrateData();
  console.log('');

  console.log('═══════════════════════════════════════════════');
  console.log(`  Migrace: ${result.extCreated} exterior + ${result.intCreated} interior records`);
  console.log(`  Skipped: ${result.skipped} (modely co už mají records)`);
  console.log('═══════════════════════════════════════════════');
  console.log('');
  console.log('V adminu Directus (Ctrl+Shift+R refresh):');
  console.log('  models → otevři libovolný model →');
  console.log('  • "Color Exterior" — inline list, klik "+ Create New" → file picker FUNGUJE');
  console.log('  • "Color Interior" — totéž');
  console.log('');
  console.log('Plus v sidebaru přibyly 2 nové collections:');
  console.log('  • Model Color Exterior');
  console.log('  • Model Color Interior');
  console.log('');
  console.log('Stará JSON pole color_options/interior_options zůstávají (legacy fallback).');
  console.log('Po npm run build se na webu zobrazí nová data z collections.\n');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
