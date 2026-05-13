#!/usr/bin/env node
/**
 * SFR Motor — refactor highlights na samostatnou collection.
 *
 * Stejně jako u barev: JSON repeater + nested file picker = bug v Directus 11.
 * Řešení: collection model_highlights s real M2O na directus_files.
 *
 * Postup:
 *   1) Vytvořit collection `model_highlights` (id, model M2O, photo M2O files, title, subtitle, sort)
 *   2) Public read permission
 *   3) Migrace dat z models.highlights JSON → records
 *   4) Smazat starý JSON field models.highlights
 *   5) Vytvořit O2M alias models.highlights → model_highlights
 *      (nově je to relace, ne JSON pole)
 *
 * Pořadí 3-4-5 je důležité: migrace MUSÍ být před smazáním JSON.
 *
 * Použití:
 *   cd web && node scripts/refactor-highlights-to-collection.mjs
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

async function fieldExists(collection, field) {
  try { await api('GET', `/fields/${collection}/${field}`); return true; } catch { return false; }
}

async function getField(collection, field) {
  try { return (await api('GET', `/fields/${collection}/${field}`))?.data; } catch { return null; }
}

async function ensureField(collection, field, type, meta = {}, schema = {}) {
  if (await fieldExists(collection, field)) return;
  await api('POST', `/fields/${collection}`, {
    field, type,
    schema: { is_nullable: true, ...schema },
    meta: { width: 'full', ...meta },
  });
}

async function ensureCollection(name) {
  if (await collectionExists(name)) {
    info(`Collection ${name} už existuje`);
    return;
  }
  await api('POST', '/collections', {
    collection: name,
    meta: {
      icon: 'auto_awesome',
      note: 'Tech highlights modelu — fotka + titulek + podtitulek.',
      sort_field: 'sort',
      display_template: '{{title}}',
    },
    schema: {},
    fields: [
      {
        field: 'id', type: 'integer',
        meta: { hidden: true, interface: 'input', readonly: true },
        schema: { is_primary_key: true, has_auto_increment: true },
      },
    ],
  });
  ok(`Collection ${name} vytvořena`);

  await ensureField(name, 'sort', 'integer', { interface: 'input', hidden: true });
}

async function ensureM2OFile(collection, field, note) {
  if (await fieldExists(collection, field)) return;
  await api('POST', `/fields/${collection}`, {
    field, type: 'uuid',
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
    field, type: 'integer',
    schema: { foreign_key_table: 'models', is_nullable: false },
    meta: {
      interface: 'select-dropdown-m2o',
      special: ['m2o'],
      display: 'related-values',
      display_options: { template: '{{name}}' },
      width: 'half',
      hidden: true,
    },
  });
  await api('POST', '/relations', {
    collection, field, related_collection: 'models',
    schema: { on_delete: 'CASCADE' },
    meta: { sort_field: 'sort' },
  });
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

async function migrateHighlights() {
  console.log('\nKrok 4: Migrace existujících JSON highlights → records');
  const models = await api('GET', '/items/models?limit=200&fields=id,slug,name,highlights');
  let created = 0, skipped = 0;

  for (const m of models.data) {
    const items = Array.isArray(m.highlights) ? m.highlights : [];
    if (items.length === 0) {
      skipped++;
      continue;
    }
    // Idempotence — pokud už existují records, skip
    const existing = await api('GET', `/items/model_highlights?filter[model][_eq]=${m.id}&limit=1&fields=id`);
    if (existing.data?.length > 0) {
      info(`${m.slug}: už má records, skipuji`);
      skipped++;
      continue;
    }

    for (let i = 0; i < items.length; i++) {
      const h = items[i];
      const photoId = h.photo_file ?? null; // photo (filename) je jen string, ne uploaded UUID
      try {
        await api('POST', '/items/model_highlights', {
          model: m.id,
          photo: photoId,
          title: h.title ?? h.t ?? '',
          subtitle: h.subtitle ?? h.s ?? '',
          sort: i + 1,
        });
        created++;
      } catch (e) {
        warn(`  ${m.slug} [${i}]: ${e.message}`);
      }
    }
    ok(`${m.slug}: ${items.length} highlights migrated`);
  }
  return { created, skipped };
}

async function dropOldJsonField() {
  console.log('\nKrok 5: Smazání starého JSON field models.highlights');
  const old = await getField('models', 'highlights');
  if (!old) {
    info('models.highlights neexistuje');
    return;
  }
  // Jen pokud je to JSON (ne alias)
  if (old.type === 'alias' && old.meta?.special?.includes('o2m')) {
    info('models.highlights už je O2M alias, neho měním');
    return;
  }
  await api('DELETE', '/fields/models/highlights');
  ok('Starý JSON field models.highlights smazán');
}

async function ensureO2MAlias() {
  console.log('\nKrok 6: O2M alias models.highlights → model_highlights');

  // 1) Vytvořit alias field pokud chybí
  if (!(await fieldExists('models', 'highlights'))) {
    await api('POST', '/fields/models', {
      field: 'highlights',
      type: 'alias',
      meta: {
        interface: 'list-o2m',
        special: ['o2m'],
        width: 'full',
        note: 'Tech highlights modelu — admin přidá fotku + titulek + podtitulek. Doporučeno 4 nebo 8 položek.',
        options: { enableCreate: true, enableSelect: true, layout: 'list' },
        sort: 200,
      },
    });
    ok('models.highlights alias field vytvořen');
  } else {
    info('models.highlights alias už existuje');
  }

  // 2) Relation může existovat z dřívějšího běhu (M2O model na child collection)
  let existing = null;
  try {
    existing = await api('GET', '/relations/model_highlights/model');
  } catch {}

  if (existing?.data) {
    if (existing.data.meta?.one_field !== 'highlights') {
      await api('PATCH', '/relations/model_highlights/model', {
        meta: { one_field: 'highlights', sort_field: 'sort' },
      });
      ok('Relation PATCH: one_field nastaveno na highlights');
    } else {
      info('Relation už správně ukazuje na models.highlights');
    }
  } else {
    await api('POST', '/relations', {
      collection: 'model_highlights', field: 'model', related_collection: 'models',
      schema: { on_delete: 'CASCADE' },
      meta: { one_field: 'highlights', sort_field: 'sort' },
    });
    ok('Relation vytvořena');
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Refactor highlights na samostatnou collection');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  // 1) Collection
  console.log('Krok 1: Collection model_highlights');
  await ensureCollection('model_highlights');

  // 2) Fields
  console.log('\nKrok 2: Fields');
  await ensureM2OFile('model_highlights', 'photo', 'Fotka k highlightu. Nahraj přímo z PC nebo vyber z library.');
  await ensureField('model_highlights', 'title', 'string', {
    interface: 'input',
    width: 'full',
    note: 'Krátký titulek, např. "Pohon 4×4" nebo "73,4 kWh baterie"',
  });
  await ensureField('model_highlights', 'subtitle', 'string', {
    interface: 'input',
    width: 'full',
    note: 'Jedna věta popisu pod titulkem.',
  });
  await ensureM2OModel('model_highlights', 'model');
  ok('Všechny fieldy hotové');

  // 3) Permissions
  console.log('\nKrok 3: Permissions');
  await ensurePublicRead('model_highlights');

  // 4) Migration (NUTNĚ před smazáním starého JSON!)
  const result = await migrateHighlights();

  // 5) Drop old JSON field
  await dropOldJsonField();

  // 6) Create O2M alias se stejným jménem
  await ensureO2MAlias();

  console.log('\n═══════════════════════════════════════════════');
  console.log(`  Hotovo. Migrated: ${result.created}, Skipped: ${result.skipped}`);
  console.log('═══════════════════════════════════════════════');
  console.log('');
  console.log('V adminu Directus (Ctrl+Shift+R refresh):');
  console.log('  models → otevři libovolný model → "Highlights"');
  console.log('  • Inline list s existujícími records');
  console.log('  • Klik "+ Create New" → modal s 3 fieldy:');
  console.log('    - Photo (file picker FUNGUJE)');
  console.log('    - Title');
  console.log('    - Subtitle');
  console.log('  • Save → highlight přidán');
  console.log('');
  console.log('V sidebaru přibyla collection "Model Highlights" (listing all).');
  console.log('Pak npm run build a tech grid na /model/{slug} pojede z nové collection.\n');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
