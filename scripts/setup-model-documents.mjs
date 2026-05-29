#!/usr/bin/env node
/**
 * SFR Motor — model_documents O2M collection.
 *
 * Místo dvou single-file fieldů (models.brochure_file, price_list_file) máme
 * collection s neomezeným počtem dokumentů per model:
 *   - type (brochure / price_list / other)
 *   - title (např. "Aktuální ceník 2026 H1", "Akční ceník květen")
 *   - file (M2O directus_files)
 *   - valid_from / valid_to (volitelně, pro časově omezené akční ceníky)
 *   - featured (1 file = "hlavní" v daný typ — zobrazuje se preferovaně)
 *
 * Postup:
 *   1) Vytvořit collection model_documents s fields
 *   2) Public read permission
 *   3) O2M alias models.documents (pokud chybí)
 *   4) Migrace: stávající models.brochure_file → record type=brochure
 *              stávající models.price_list_file → record type=price_list
 *
 * Použití:
 *   cd web && node scripts/setup-model-documents.mjs
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

async function ensureCollection() {
  if (await collectionExists('model_documents')) {
    info('Collection model_documents už existuje');
    return;
  }
  await api('POST', '/collections', {
    collection: 'model_documents',
    meta: {
      icon: 'description',
      note: 'Dokumenty modelu — brožury, ceníky, ostatní (PDF, ZIP, atd.). Per model neomezený počet.',
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
  ok('Collection model_documents vytvořena');
}

async function ensureField(field, type, meta = {}, schema = {}) {
  if (await fieldExists('model_documents', field)) return;
  await api('POST', '/fields/model_documents', {
    field, type,
    schema: { is_nullable: true, ...schema },
    meta: { width: 'full', ...meta },
  });
  ok(`model_documents.${field} vytvořen`);
}

async function ensureM2OFile() {
  const field = 'file';
  if (await fieldExists('model_documents', field)) return;
  await api('POST', '/fields/model_documents', {
    field, type: 'uuid',
    schema: { foreign_key_table: 'directus_files', is_nullable: true },
    meta: { interface: 'file', special: ['file'], note: 'PDF brožura nebo ceník.', display: 'file', width: 'full' },
  });
  await api('POST', '/relations', {
    collection: 'model_documents', field, related_collection: 'directus_files',
    schema: { on_delete: 'SET NULL' },
  });
  ok('model_documents.file (M2O directus_files)');
}

async function ensureM2OModel() {
  const field = 'model';
  if (await fieldExists('model_documents', field)) return;
  await api('POST', '/fields/model_documents', {
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
  // Vytvořit relation se schema FK (jako u colors / highlights)
  try {
    await api('GET', '/relations/model_documents/model');
    // Existuje → check schema
    const r = await api('GET', '/relations/model_documents/model');
    if (!r.data?.schema) {
      // Recreate se schema
      await api('DELETE', '/relations/model_documents/model');
      await api('POST', '/relations', {
        collection: 'model_documents', field: 'model', related_collection: 'models',
        schema: { on_delete: 'CASCADE' },
        meta: { one_field: 'documents', sort_field: 'sort' },
      });
      info('  relation recreated se schema FK');
    }
  } catch {
    await api('POST', '/relations', {
      collection: 'model_documents', field: 'model', related_collection: 'models',
      schema: { on_delete: 'CASCADE' },
      meta: { one_field: 'documents', sort_field: 'sort' },
    });
  }
  ok('model_documents.model (M2O models)');
}

async function ensureO2MAlias() {
  if (await fieldExists('models', 'documents')) {
    info('models.documents alias už existuje');
    return;
  }
  await api('POST', '/fields/models', {
    field: 'documents',
    type: 'alias',
    meta: {
      interface: 'list-o2m',
      special: ['o2m'],
      width: 'full',
      note: 'Dokumenty modelu (brožury, ceníky, akční ceníky). Přidej + Create New, vyber typ.',
      options: { enableCreate: true, enableSelect: true, layout: 'list' },
      sort: 310,
    },
  });
  ok('models.documents alias vytvořen');
}

async function ensurePublicRead() {
  const access = await api('GET', '/access?filter[user][_null]=true&filter[role][_null]=true&fields=policy');
  const policyId = access.data?.[0]?.policy;
  if (!policyId) return;
  const existing = await api('GET', `/permissions?filter[policy][_eq]=${policyId}&filter[collection][_eq]=model_documents&filter[action][_eq]=read&limit=1`);
  if (existing.data?.length > 0) return;
  await api('POST', '/permissions', {
    policy: policyId, collection: 'model_documents', action: 'read',
    fields: ['*'], permissions: null,
  });
  ok('model_documents: public read');
}

async function migrateExisting() {
  console.log('\nKrok 5: Migrace existujících models.brochure_file + price_list_file');
  const models = await api('GET', '/items/models?limit=200&fields=id,slug,name,brochure_file,price_list_file');
  let migrated = 0, skipped = 0;
  for (const m of models.data) {
    if (!m.brochure_file && !m.price_list_file) {
      skipped++;
      continue;
    }
    // Check existing — pokud má records, skip
    const existing = await api('GET', `/items/model_documents?filter[model][_eq]=${m.id}&limit=1&fields=id`);
    if (existing.data?.length > 0) {
      info(`${m.slug}: už má documents records, skipuji`);
      skipped++;
      continue;
    }

    if (m.brochure_file) {
      await api('POST', '/items/model_documents', {
        model: m.id,
        file: m.brochure_file,
        type: 'brochure',
        title: `Brožura ${m.name}`,
        featured: true,
        sort: 1,
      });
      migrated++;
    }
    if (m.price_list_file) {
      await api('POST', '/items/model_documents', {
        model: m.id,
        file: m.price_list_file,
        type: 'price_list',
        title: `Ceník ${m.name}`,
        featured: true,
        sort: 2,
      });
      migrated++;
    }
    ok(`${m.slug}: migrováno ${(m.brochure_file ? 1 : 0) + (m.price_list_file ? 1 : 0)} dokumentů`);
  }
  return { migrated, skipped };
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Setup model_documents collection');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  console.log('Krok 1: Collection');
  await ensureCollection();
  await ensureField('sort', 'integer', { interface: 'input', hidden: true });

  console.log('\nKrok 2: Fields');
  await ensureField('type', 'string', {
    interface: 'select-dropdown',
    width: 'half',
    note: 'Typ dokumentu.',
    options: {
      choices: [
        { text: 'Brožura', value: 'brochure' },
        { text: 'Ceník', value: 'price_list' },
        { text: 'Akční ceník', value: 'price_list_promo' },
        { text: 'Technický list', value: 'datasheet' },
        { text: 'Manuál', value: 'manual' },
        { text: 'Ostatní', value: 'other' },
      ],
    },
    display: 'labels',
    display_options: {
      showAsDot: true,
      choices: [
        { text: 'Brožura', value: 'brochure', foreground: '#FFFFFF', background: '#1E3A66' },
        { text: 'Ceník', value: 'price_list', foreground: '#FFFFFF', background: '#1F8A4D' },
        { text: 'Akční ceník', value: 'price_list_promo', foreground: '#FFFFFF', background: '#F25C1B' },
        { text: 'Technický list', value: 'datasheet', foreground: '#FFFFFF', background: '#6B6B72' },
        { text: 'Manuál', value: 'manual', foreground: '#FFFFFF', background: '#5B4B8A' },
        { text: 'Ostatní', value: 'other', foreground: '#FFFFFF', background: '#8E8E94' },
      ],
    },
  });

  await ensureField('title', 'string', {
    interface: 'input',
    width: 'half',
    note: 'Název dokumentu, např. "Ceník květen 2026" nebo "Akční ceník flotila"',
  });

  await ensureM2OFile();
  await ensureM2OModel();

  await ensureField('valid_from', 'date', {
    interface: 'datetime',
    width: 'half',
    note: 'Platí od (volitelně, pro časově omezené akce)',
  });
  await ensureField('valid_to', 'date', {
    interface: 'datetime',
    width: 'half',
    note: 'Platí do (volitelně)',
  });
  await ensureField('featured', 'boolean', {
    interface: 'boolean',
    width: 'half',
    note: 'Zaškrtni jako hlavní v daný typ (zobrazí se preferenčně).',
  }, { default_value: false });

  console.log('\nKrok 3: Alias na models');
  await ensureO2MAlias();

  console.log('\nKrok 4: Permissions');
  await ensurePublicRead();

  const result = await migrateExisting();

  console.log('\n═══════════════════════════════════════════════');
  console.log(`  Hotovo. Migrováno: ${result.migrated}, Skipped: ${result.skipped}`);
  console.log('═══════════════════════════════════════════════');
  console.log('');
  console.log('V adminu (Ctrl+Shift+R):');
  console.log('  models → libovolný model → "Documents" inline list');
  console.log('  • Klik + Create New → vyber Typ + Název + nahraj PDF');
  console.log('  • Featured = "hlavní" v daný typ');
  console.log('  • Valid from/to volitelně pro akční nabídky');
  console.log('');
  console.log('Sidebar → "Model Documents" pro listing všech dokumentů.');
  console.log('');
  console.log('Po npm run build se na webu zobrazí všechny dokumenty seskupené po typech.');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
