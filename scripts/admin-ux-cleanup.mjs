#!/usr/bin/env node
/**
 * SFR Motor — comprehensive admin UX cleanup.
 *
 * Co skript dělá:
 *
 *   1) Vytvoří **sidebar groupy** (Vozy / Skladovka / Obsah / Settings)
 *   2) Přiřadí každou collection do groupy
 *   3) Skryje nested/junction collections (spravují se zevnitř parents)
 *   4) Přejmenuje technical názvy na české labely (přes meta.translations)
 *   5) Konfiguruje inline O2M aliases na models a model_years:
 *      - models.years           → Modelové roky inline
 *      - models.color_exterior  → Barvy karoserie inline
 *      - models.color_interior  → Barvy interiéru inline
 *      - models.documents       → Dokumenty inline
 *      - models.highlights      → Highlights inline
 *      - model_years.trim_levels    → Výbavové úrovně inline
 *      - model_years.option_packages → Volitelné balíčky inline
 *   6) Fix model_year display template (odstranění "--" když chybí version)
 *
 * Idempotentní — můžeš spustit opakovaně.
 *
 * Použití:
 *   cd web && node scripts/admin-ux-cleanup.mjs
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

async function collectionExists(name) {
  try { await api('GET', `/collections/${name}`); return true; } catch { return false; }
}

async function fieldExists(collection, field) {
  try { await api('GET', `/fields/${collection}/${field}`); return true; } catch { return false; }
}

// ─── 1) Sidebar groupy (folder-type collections) ──────────────
const GROUPS = [
  { name: 'group_vozy',      label: 'Vozy',        icon: 'directions_car', color: '#1F8A4D' },
  { name: 'group_skladovka', label: 'Skladovka',   icon: 'commute',        color: '#F25C1B' },
  { name: 'group_obsah',     label: 'Obsah',       icon: 'article',        color: '#1F6FEB' },
  { name: 'group_settings',  label: 'Nastavení',   icon: 'settings',       color: '#6B6B72' },
];

async function ensureGroup(group) {
  if (await collectionExists(group.name)) {
    info(`Group "${group.label}" už existuje`);
    return;
  }
  await api('POST', '/collections', {
    collection: group.name,
    meta: {
      collection: group.name,
      icon: group.icon,
      color: group.color,
      hidden: false,
      singleton: false,
      group: null,
      translations: [{ language: 'cs-CZ', translation: group.label, singular: group.label, plural: group.label }],
    },
    schema: null,
  });
  ok(`Group "${group.label}" vytvořen`);
}

// ─── 2) Collection config (translations, hidden, group, icon) ──
const COLLECTION_CONFIG = [
  // === Vozy group ===
  { name: 'brands',            label: 'Značky',           singular: 'Značka',        group: 'group_vozy', icon: 'branding_watermark', hidden: false },
  { name: 'sub_brands',        label: 'Pod-značky',       singular: 'Pod-značka',    group: 'group_vozy', icon: 'badge',              hidden: false },
  { name: 'models',            label: 'Modely',           singular: 'Model',         group: 'group_vozy', icon: 'directions_car',     hidden: false },
  { name: 'model_years',       label: 'Modelové roky',    singular: 'Modelový rok',  group: 'group_vozy', icon: 'event',              hidden: false },
  // Nested → hidden, spravované přes inline na model_year nebo model
  { name: 'trim_levels',       label: 'Výbavové úrovně',  singular: 'Výbavová úroveň', group: 'group_vozy', icon: 'star',            hidden: true },
  { name: 'option_packages',   label: 'Volitelné balíčky', singular: 'Volitelný balíček', group: 'group_vozy', icon: 'category',     hidden: true },
  { name: 'model_color_exterior', label: 'Barvy karoserie', singular: 'Barva karoserie', group: 'group_vozy', icon: 'palette',      hidden: true },
  { name: 'model_color_interior', label: 'Barvy interiéru', singular: 'Barva interiéru', group: 'group_vozy', icon: 'chair',        hidden: true },
  { name: 'model_documents',   label: 'Dokumenty modelu', singular: 'Dokument',     group: 'group_vozy', icon: 'description',       hidden: true },
  { name: 'model_highlights',  label: 'Highlights modelu', singular: 'Highlight',   group: 'group_vozy', icon: 'auto_awesome',      hidden: true },

  // === Skladovka group ===
  { name: 'stock_vehicles',    label: 'Skladové vozy',    singular: 'Skladový vůz',  group: 'group_skladovka', icon: 'commute',      hidden: false },

  // === Obsah group ===
  { name: 'articles',          label: 'Magazín',          singular: 'Článek',        group: 'group_obsah', icon: 'article',          hidden: false },

  // === Settings group ===
  { name: 'site_settings',     label: 'Nastavení webu',   singular: 'Nastavení webu',group: 'group_settings', icon: 'settings',      hidden: false },
  { name: 'branches',          label: 'Pobočky',          singular: 'Pobočka',       group: 'group_settings', icon: 'store',         hidden: false },
  { name: 'employees',         label: 'Pracovníci',       singular: 'Pracovník',     group: 'group_settings', icon: 'person',        hidden: false },
  { name: 'leads',             label: 'Leady (poptávky)', singular: 'Lead',          group: 'group_settings', icon: 'mail',          hidden: false },
];

async function patchCollection(cfg) {
  if (!(await collectionExists(cfg.name))) {
    info(`Collection "${cfg.name}" neexistuje, skipuji`);
    return;
  }
  const cur = await api('GET', `/collections/${cfg.name}`);
  const meta = cur.data?.meta ?? {};

  await api('PATCH', `/collections/${cfg.name}`, {
    meta: {
      ...meta,
      icon: cfg.icon,
      hidden: cfg.hidden,
      group: cfg.group,
      translations: [
        { language: 'cs-CZ', translation: cfg.label, singular: cfg.singular, plural: cfg.label },
      ],
    },
  });
  ok(`${cfg.name} → "${cfg.label}" ${cfg.hidden ? '(skryté)' : ''} ve skupině ${cfg.group}`);
}

// Skryté junction tables
const HIDDEN_JUNCTIONS = ['stock_vehicles_option_packages', 'stock_vehicles_files', 'models_files'];

async function hideJunctions() {
  for (const name of HIDDEN_JUNCTIONS) {
    if (!(await collectionExists(name))) continue;
    const cur = await api('GET', `/collections/${name}`);
    await api('PATCH', `/collections/${name}`, {
      meta: { ...(cur.data?.meta ?? {}), hidden: true },
    });
    ok(`Junction "${name}" skryto`);
  }
}

// ─── 3) Inline O2M na models a model_years ────────────────────
const INLINE_FIELDS = [
  // On `models` collection
  {
    collection: 'models',
    field: 'model_years', // alias name
    related: 'model_years',
    template: '{{year}}{{version}}',
    label: 'Modelové roky',
    note: 'Modelové roky tohoto modelu. Klikni "+ Create New" pro přidání 2024/2025/2026... Kopírovat lze přes scripts/duplicate-model-year.mjs.',
  },
  {
    collection: 'models',
    field: 'color_exterior',
    related: 'model_color_exterior',
    template: '{{name}} ({{hex}})',
    label: 'Barvy karoserie',
    note: 'Barvy karoserie nabízené pro tento model. Nahrávej fotky aut v dané barvě.',
  },
  {
    collection: 'models',
    field: 'color_interior',
    related: 'model_color_interior',
    template: '{{name}}',
    label: 'Barvy interiéru',
    note: 'Varianty interiéru (kožený, textilní, různé barvy). Nahrávej fotky interiéru.',
  },
  {
    collection: 'models',
    field: 'documents',
    related: 'model_documents',
    template: '{{title}}',
    label: 'Dokumenty (brožury, ceníky)',
    note: 'Brožury + ceníky modelu. Můžeš mít víc verzí (akční ceník, výroční brožura).',
  },
  {
    collection: 'models',
    field: 'highlights',
    related: 'model_highlights',
    template: '{{title}}',
    label: 'Highlights (technologie)',
    note: '4-6 karet "co model umí" — zobrazuje se na detailu modelu (např. "12,3″ displej", "5★ NCAP").',
  },

  // On `model_years` collection
  {
    collection: 'model_years',
    field: 'trim_levels',
    related: 'trim_levels',
    template: '{{name}} — {{list_price}} Kč',
    label: 'Výbavové úrovně',
    note: 'Výbavové stupně pro tento modelový rok (Style, Style+, Elegant, Premium...). Každý má vlastní cenu a výbavu po kategoriích.',
  },
  {
    collection: 'model_years',
    field: 'option_packages',
    related: 'option_packages',
    template: '{{name}}',
    label: 'Volitelné balíčky',
    note: 'Pakety (TECH, BLACK, PREMIUM+...) co lze přidat k libovolnému trimu. Cena per trim level.',
  },
];

async function ensureInlineAlias(item) {
  const exists = await fieldExists(item.collection, item.field);

  if (!exists) {
    // Vytvořit alias field
    await api('POST', `/fields/${item.collection}`, {
      field: item.field,
      type: 'alias',
      meta: {
        interface: 'list-o2m',
        special: ['o2m'],
        width: 'full',
        note: item.note,
        translations: [{ language: 'cs-CZ', translation: item.label }],
        options: {
          enableCreate: true,
          enableSelect: false,
          template: item.template,
          layout: 'list',
        },
      },
    });

    // Relation
    const reverseField = inferReverseField(item.related, item.collection);
    if (reverseField) {
      try {
        await api('GET', `/relations/${item.related}/${reverseField}`);
        // Existuje → patchnout one_field
        await api('PATCH', `/relations/${item.related}/${reverseField}`, {
          meta: { one_field: item.field },
        });
      } catch {
        // Neexistuje → vytvořit
        await api('POST', '/relations', {
          collection: item.related,
          field: reverseField,
          related_collection: item.collection,
          meta: { one_field: item.field },
        });
      }
    }
    ok(`${item.collection}.${item.field} alias vytvořen (inline ${item.label})`);
  } else {
    // Patch meta + interface options
    const cur = await api('GET', `/fields/${item.collection}/${item.field}`);
    const meta = cur.data?.meta ?? {};
    await api('PATCH', `/fields/${item.collection}/${item.field}`, {
      meta: {
        ...meta,
        interface: 'list-o2m',
        note: item.note,
        translations: [{ language: 'cs-CZ', translation: item.label }],
        options: {
          ...(meta.options ?? {}),
          enableCreate: true,
          enableSelect: false,
          template: item.template,
          layout: 'list',
        },
      },
    });
    ok(`${item.collection}.${item.field} → inline ${item.label} (template: ${item.template})`);
  }
}

function inferReverseField(childCollection, parentCollection) {
  // Heuristic: child M2O field has same name as parent (singular)
  if (parentCollection === 'models') return 'model';
  if (parentCollection === 'model_years') return 'model_year';
  return null;
}

// ─── 4) Fix model_year display template (no "--" trailing) ────
async function fixModelYearTemplate() {
  // Set collection display_template
  const cur = await api('GET', '/collections/model_years');
  const meta = cur.data?.meta ?? {};
  const newTemplate = '{{model.name}} {{year}}{{version}}';
  if (meta.display_template === newTemplate) {
    info('model_years display_template už správný');
    return;
  }
  await api('PATCH', '/collections/model_years', {
    meta: { ...meta, display_template: newTemplate },
  });
  ok(`model_years display_template → "${newTemplate}"`);
}

// ─── 5) Fix model field templates v dropdownech ───────────────
async function fixStockVehicleFieldTemplates() {
  // stock_vehicles.model_year template — bez prázdné version
  const updates = [
    { collection: 'stock_vehicles', field: 'model_year', template: '{{model.name}} {{year}}{{version}}' },
    { collection: 'stock_vehicles', field: 'trim_level', template: '{{name}} ({{model_year.year}}{{model_year.version}})' },
  ];
  for (const u of updates) {
    if (!(await fieldExists(u.collection, u.field))) continue;
    const cur = await api('GET', `/fields/${u.collection}/${u.field}`);
    const meta = cur.data?.meta ?? {};
    const opts = meta.options ?? {};
    await api('PATCH', `/fields/${u.collection}/${u.field}`, {
      meta: { ...meta, options: { ...opts, template: u.template } },
    });
    ok(`${u.collection}.${u.field} template → "${u.template}"`);
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Admin UX cleanup — Czech labels, groups, inline');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  console.log('Krok 1: Sidebar groupy');
  for (const g of GROUPS) await ensureGroup(g);

  console.log('\nKrok 2: Collection labels + grouping');
  for (const cfg of COLLECTION_CONFIG) await patchCollection(cfg);

  console.log('\nKrok 3: Skrýt junction tables');
  await hideJunctions();

  console.log('\nKrok 4: Inline O2M aliases (models + model_years)');
  for (const item of INLINE_FIELDS) await ensureInlineAlias(item);

  console.log('\nKrok 5: Fix model_year display template');
  await fixModelYearTemplate();

  console.log('\nKrok 6: Fix stock_vehicle dropdown templates');
  await fixStockVehicleFieldTemplates();

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo. Ctrl+Shift+R v adminu.');
  console.log('  ');
  console.log('  Sidebar bude vypadat takto:');
  console.log('  ');
  console.log('    📁 Vozy');
  console.log('       Značky · Pod-značky · Modely · Modelové roky');
  console.log('    📁 Skladovka');
  console.log('       Skladové vozy');
  console.log('    📁 Obsah');
  console.log('       Magazín');
  console.log('    📁 Nastavení');
  console.log('       Nastavení webu · Pobočky · Pracovníci · Leady');
  console.log('  ');
  console.log('  Klikni na Modely → otevři Korando → uvidíš inline sekce:');
  console.log('    - Modelové roky');
  console.log('    - Barvy karoserie');
  console.log('    - Barvy interiéru');
  console.log('    - Dokumenty');
  console.log('    - Highlights');
  console.log('  ');
  console.log('  Klikni na Modelový rok → uvidíš inline:');
  console.log('    - Výbavové úrovně');
  console.log('    - Volitelné balíčky');
  console.log('  ');
  console.log('  Skryté collections (spravované inline):');
  console.log('    trim_levels, option_packages, model_color_*, model_documents, model_highlights');
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
