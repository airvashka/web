#!/usr/bin/env node
/**
 * SFR Motor — kolekce `service_campaigns` (servisní akce per značka).
 *
 * Servisní akce (např. „Sezónní prohlídka za 399 Kč") jsou vázané na ZNAČKU
 * (ne model). Zobrazují se:
 *   - jako promo karta nad modelovou řadou na /[brand]
 *   - detail na /[brand]/servisni-akce
 *   - výpis všech aktivních na /servis (nad „Kde nás najdete")
 *
 * Fields:
 *   id, status, sort, brand (M2O brands), title, price_label, perex,
 *   image (M2O files), description (markdown), valid_from, valid_until, cta_label
 *
 * „Aktivní" = status=published AND (valid_from prázdné NEBO <= dnes)
 *             AND (valid_until prázdné NEBO >= dnes).
 *
 * Idempotentní — lze spustit opakovaně.
 *
 * Použití:
 *   cd web && node scripts/create-service-campaigns.mjs
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

async function ensureField(collection, field, type, meta = {}, schema = {}) {
  if (await fieldExists(collection, field)) { info(`${collection}.${field} už existuje`); return; }
  await api('POST', `/fields/${collection}`, {
    field, type,
    schema: { is_nullable: true, ...schema },
    meta: { width: 'full', ...meta },
  });
  ok(`${collection}.${field} vytvořen`);
}

async function ensureCollection(name) {
  if (await collectionExists(name)) { info(`Collection ${name} už existuje`); return; }
  await api('POST', '/collections', {
    collection: name,
    meta: {
      icon: 'build',
      note: 'Servisní akce per značka (např. prohlídka za 399 Kč). Zobrazí se na /[znacka], /[znacka]/servisni-akce a /servis.',
      sort_field: 'sort',
      display_template: '{{title}} — {{price_label}}',
      archive_field: 'status',
      archive_value: 'archived',
      unarchive_value: 'draft',
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
}

async function ensureM2OFile(collection, field, note) {
  if (await fieldExists(collection, field)) { info(`${collection}.${field} už existuje`); return; }
  await api('POST', `/fields/${collection}`, {
    field, type: 'uuid',
    schema: { foreign_key_table: 'directus_files', is_nullable: true },
    meta: { interface: 'file-image', special: ['file'], note, display: 'image', width: 'full' },
  });
  await api('POST', '/relations', {
    collection, field, related_collection: 'directus_files',
    schema: { on_delete: 'SET NULL' },
  });
  ok(`${collection}.${field} (obrázek) vytvořen`);
}

async function ensureM2OBrand(collection, field) {
  if (await fieldExists(collection, field)) { info(`${collection}.${field} už existuje`); return; }
  await api('POST', `/fields/${collection}`, {
    field, type: 'integer',
    schema: { foreign_key_table: 'brands', is_nullable: false },
    meta: {
      interface: 'select-dropdown-m2o',
      special: ['m2o'],
      display: 'related-values',
      display_options: { template: '{{name}}' },
      width: 'half',
      note: 'Které značky se akce týká.',
    },
  });
  await api('POST', '/relations', {
    collection, field, related_collection: 'brands',
    schema: { on_delete: 'CASCADE' },
  });
  ok(`${collection}.${field} (M2O brands) vytvořen`);
}

async function ensurePublicRead(collection) {
  const access = await api('GET', '/access?filter[user][_null]=true&filter[role][_null]=true&fields=policy');
  const policyId = access.data?.[0]?.policy;
  if (!policyId) { warn('Public policy nenalezena'); return; }
  const existing = await api('GET', `/permissions?filter[policy][_eq]=${policyId}&filter[collection][_eq]=${collection}&filter[action][_eq]=read&limit=1`);
  if (existing.data?.length > 0) { info('public read už existuje'); return; }
  await api('POST', '/permissions', {
    policy: policyId, collection, action: 'read', fields: ['*'], permissions: null,
  });
  ok(`${collection}: public read přidáno`);
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Vytvoření kolekce service_campaigns');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://admin.sfr-motor.cz]: ')).trim() || 'https://admin.sfr-motor.cz';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  console.log('Krok 1: Collection');
  await ensureCollection('service_campaigns');
  await ensureField('service_campaigns', 'sort', 'integer', { interface: 'input', hidden: true });

  console.log('\nKrok 2: Fields');
  await ensureField('service_campaigns', 'status', 'string', {
    interface: 'select-dropdown',
    width: 'half',
    display: 'labels',
    options: { choices: [
      { text: 'Publikováno', value: 'published' },
      { text: 'Koncept', value: 'draft' },
      { text: 'Archiv', value: 'archived' },
    ] },
    note: 'Jen „Publikováno" se zobrazí na webu.',
  }, { default_value: 'draft' });

  await ensureM2OBrand('service_campaigns', 'brand');

  await ensureField('service_campaigns', 'title', 'string', {
    interface: 'input', width: 'full',
    note: 'Nadpis akce, např. „Sezónní prohlídka před zimou".',
  });
  await ensureField('service_campaigns', 'price_label', 'string', {
    interface: 'input', width: 'half',
    options: { placeholder: 'např. 399 Kč' },
    note: 'Cena/štítek akce. Volitelné.',
  });
  await ensureField('service_campaigns', 'perex', 'text', {
    interface: 'input-multiline', width: 'full',
    note: 'Krátký popis (1–2 věty) — zobrazí se na kartě a ve výpisu.',
  });
  await ensureM2OFile('service_campaigns', 'image', 'Obrázek/banner akce. Nahraj z PC nebo vyber z library.');
  await ensureField('service_campaigns', 'description', 'text', {
    interface: 'input-rich-text-md', width: 'full',
    note: 'Plný popis akce (Markdown) — zobrazí se na detailu /[znacka]/servisni-akce.',
  });
  await ensureField('service_campaigns', 'valid_from', 'date', {
    interface: 'datetime', width: 'half',
    note: 'Od kdy akce platí. Prázdné = ihned.',
  });
  await ensureField('service_campaigns', 'valid_until', 'date', {
    interface: 'datetime', width: 'half',
    note: 'Do kdy akce platí. Prázdné = bez konce.',
  });
  await ensureField('service_campaigns', 'cta_label', 'string', {
    interface: 'input', width: 'half',
    options: { placeholder: 'Více o akci' },
    note: 'Text tlačítka. Prázdné = „Více o akci".',
  }, { default_value: 'Více o akci' });

  console.log('\nKrok 3: Permissions');
  await ensurePublicRead('service_campaigns');

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo.');
  console.log('═══════════════════════════════════════════════\n');
  console.log('V adminu (Ctrl+Shift+R): nová kolekce „Service Campaigns".');
  console.log('Přidej akci → vyber značku, vyplň nadpis, cenu, perex, obrázek, popis, platnost,');
  console.log('nastav status „Publikováno" → Save → npm run build (nebo deploy).');
  console.log('Zobrazí se na /[znacka] (karta nad modely), /[znacka]/servisni-akce a /servis.\n');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
