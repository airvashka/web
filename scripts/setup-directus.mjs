#!/usr/bin/env node
/**
 * SFR Motor — Directus schema setup
 *
 * Spusť jednou jako:
 *   node scripts/setup-directus.mjs
 *
 * Skript:
 *  1. Zeptá se na Directus URL, admin email, heslo
 *  2. Vytvoří všechny collections, fields, relations
 *  3. Nastaví Public role read-only přístup k veřejným datům
 *  4. Naseed základní data (3 značky + 1 pobočku + 11 zaměstnanců)
 *
 * Re-runnable: pokud collection/field už existuje, skipuje se.
 */

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

// ----------------------------------------------------------
// Helpers — prompt + API
// ----------------------------------------------------------

const rl = readline.createInterface({ input, output });
const prompt = (q) => rl.question(q);

let DIRECTUS_URL = '';
let TOKEN = '';

async function api(method, path, body) {
  const url = `${DIRECTUS_URL}${path}`;
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) {
    const err = new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json?.errors ?? json)}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

function log(emoji, msg) { console.log(`${emoji}  ${msg}`); }
function ok(msg)   { log('✅', msg); }
function skip(msg) { log('⏭️ ', msg); }
function info(msg) { log('ℹ️ ', msg); }
function warn(msg) { log('⚠️ ', msg); }
function err(msg)  { log('❌', msg); }

// ----------------------------------------------------------
// SCHEMA DEFINITION
// ----------------------------------------------------------

const STATUS_FIELD = {
  field: 'status',
  type: 'string',
  meta: {
    interface: 'select-dropdown',
    options: {
      choices: [
        { text: 'Publikováno', value: 'published' },
        { text: 'Koncept',     value: 'draft' },
        { text: 'Archivováno', value: 'archived' },
      ],
    },
    width: 'half',
    display: 'labels',
    display_options: {
      choices: [
        { text: 'Publikováno', value: 'published', foreground: '#FFFFFF', background: '#1E7B5F' },
        { text: 'Koncept',     value: 'draft',     foreground: '#FFFFFF', background: '#B27516' },
        { text: 'Archivováno', value: 'archived',  foreground: '#FFFFFF', background: '#B43A2C' },
      ],
    },
  },
  schema: { default_value: 'draft', is_nullable: false },
};

const SORT_FIELD = {
  field: 'sort',
  type: 'integer',
  meta: { interface: 'input', hidden: true },
  schema: { is_nullable: true },
};

// Definujeme collections jako pole — pořadí má smysl (FK targets first)
const COLLECTIONS = [
  // ----------------- BRANDS -----------------
  {
    collection: 'brands',
    meta: { icon: 'branding_watermark', note: 'Značky (KGM, OMODA & JAECOO, Farizon)', display_template: '{{name}}', sort_field: 'sort', archive_field: 'status', archive_value: 'archived', unarchive_value: 'draft' },
    fields: [
      { field: 'slug', type: 'string', meta: { interface: 'input', required: true, note: 'URL slug, např. "kgm"', width: 'half' }, schema: { is_nullable: false, is_unique: true, max_length: 100 } },
      { field: 'name', type: 'string', meta: { interface: 'input', required: true, width: 'half' }, schema: { is_nullable: false, max_length: 200 } },
      { field: 'tagline', type: 'string', meta: { interface: 'input', width: 'full' }, schema: { is_nullable: true } },
      { field: 'description', type: 'text', meta: { interface: 'input-multiline' }, schema: { is_nullable: true } },
      { field: 'primary_color', type: 'string', meta: { interface: 'select-color', width: 'half' }, schema: { is_nullable: true, default_value: '#FF4A1C', max_length: 9 } },
      { field: 'logo', type: 'uuid', meta: { interface: 'file-image', special: ['file'] }, schema: { is_nullable: true } },
      { field: 'hero_image', type: 'uuid', meta: { interface: 'file-image', special: ['file'] }, schema: { is_nullable: true } },
      { field: 'previous_names', type: 'json', meta: { interface: 'tags', note: 'Předchozí názvy pro SEO (např. KGM → ["SsangYong"])' }, schema: { is_nullable: true } },
      STATUS_FIELD, SORT_FIELD,
    ],
    relations: [{ field: 'logo', related: 'directus_files' }, { field: 'hero_image', related: 'directus_files' }],
  },

  // ----------------- SUB_BRANDS -----------------
  {
    collection: 'sub_brands',
    meta: { icon: 'badge', note: 'Pod-značky (OMODA, JAECOO pod OMODA & JAECOO)', display_template: '{{name}}', sort_field: 'sort' },
    fields: [
      { field: 'brand', type: 'uuid', meta: { interface: 'select-dropdown-m2o', required: true, width: 'half', options: { template: '{{name}}' } }, schema: { is_nullable: false } },
      { field: 'slug', type: 'string', meta: { interface: 'input', required: true, width: 'half' }, schema: { is_nullable: false, max_length: 100 } },
      { field: 'name', type: 'string', meta: { interface: 'input', required: true, width: 'half' }, schema: { is_nullable: false, max_length: 200 } },
      { field: 'primary_color', type: 'string', meta: { interface: 'select-color', width: 'half' }, schema: { is_nullable: true, max_length: 9 } },
      { field: 'logo', type: 'uuid', meta: { interface: 'file-image', special: ['file'] }, schema: { is_nullable: true } },
      { field: 'description', type: 'text', meta: { interface: 'input-multiline' }, schema: { is_nullable: true } },
      { field: 'instagram_url', type: 'string', meta: { interface: 'input', options: { placeholder: 'https://instagram.com/...' }, width: 'half' }, schema: { is_nullable: true } },
      { field: 'facebook_url', type: 'string', meta: { interface: 'input', width: 'half' }, schema: { is_nullable: true } },
      SORT_FIELD,
    ],
    relations: [
      { field: 'brand', related: 'brands', onDelete: 'CASCADE' },
      { field: 'logo', related: 'directus_files' },
    ],
  },

  // ----------------- BRANCHES -----------------
  {
    collection: 'branches',
    meta: { icon: 'store', note: 'Pobočky SFR Motor', display_template: '{{name}}' },
    fields: [
      { field: 'slug', type: 'string', meta: { interface: 'input', required: true, width: 'half' }, schema: { is_nullable: false, is_unique: true, max_length: 100 } },
      { field: 'name', type: 'string', meta: { interface: 'input', required: true, width: 'half' }, schema: { is_nullable: false, max_length: 200 } },
      { field: 'address', type: 'string', meta: { interface: 'input' }, schema: { is_nullable: true } },
      { field: 'city', type: 'string', meta: { interface: 'input', width: 'half' }, schema: { is_nullable: true, max_length: 100 } },
      { field: 'postal_code', type: 'string', meta: { interface: 'input', width: 'half' }, schema: { is_nullable: true, max_length: 20 } },
      { field: 'phone', type: 'string', meta: { interface: 'input', width: 'half' }, schema: { is_nullable: true, max_length: 50 } },
      { field: 'email', type: 'string', meta: { interface: 'input', width: 'half' }, schema: { is_nullable: true, max_length: 200 } },
      { field: 'google_maps_url', type: 'string', meta: { interface: 'input' }, schema: { is_nullable: true } },
      { field: 'opening_hours', type: 'json', meta: { interface: 'input-code', options: { language: 'json' }, note: 'Otevírací hodiny per den' }, schema: { is_nullable: true } },
    ],
  },

  // ----------------- EMPLOYEES -----------------
  {
    collection: 'employees',
    meta: { icon: 'person', note: 'Pracovníci (z vizitek)', display_template: '{{full_name}} — {{role}}' },
    fields: [
      { field: 'full_name', type: 'string', meta: { interface: 'input', required: true, width: 'half' }, schema: { is_nullable: false, max_length: 200 } },
      { field: 'role', type: 'string', meta: { interface: 'input', width: 'half' }, schema: { is_nullable: true, max_length: 200 } },
      { field: 'department', type: 'string', meta: { interface: 'select-dropdown', options: { choices: [
        { text: 'Prodej', value: 'sales' },
        { text: 'Servis', value: 'service' },
        { text: 'Náhradní díly', value: 'parts' },
        { text: 'Management', value: 'management' },
      ]}, width: 'half' }, schema: { is_nullable: true, max_length: 50 } },
      { field: 'email', type: 'string', meta: { interface: 'input', width: 'half' }, schema: { is_nullable: true, max_length: 200 } },
      { field: 'phone', type: 'string', meta: { interface: 'input', width: 'half' }, schema: { is_nullable: true, max_length: 50 } },
      { field: 'photo', type: 'uuid', meta: { interface: 'file-image', special: ['file'] }, schema: { is_nullable: true } },
      { field: 'business_card_pdf', type: 'uuid', meta: { interface: 'file', special: ['file'] }, schema: { is_nullable: true } },
      { field: 'branch', type: 'uuid', meta: { interface: 'select-dropdown-m2o', options: { template: '{{name}}' }, width: 'half' }, schema: { is_nullable: true } },
      SORT_FIELD,
    ],
    relations: [
      { field: 'branch', related: 'branches', onDelete: 'SET NULL' },
      { field: 'photo', related: 'directus_files' },
      { field: 'business_card_pdf', related: 'directus_files' },
    ],
  },

  // ----------------- MODELS -----------------
  {
    collection: 'models',
    meta: { icon: 'directions_car', note: '16 modelů napříč 3 značkami', display_template: '{{name}}', sort_field: 'sort', archive_field: 'status', archive_value: 'archived', unarchive_value: 'draft' },
    fields: [
      { field: 'brand', type: 'uuid', meta: { interface: 'select-dropdown-m2o', required: true, width: 'half', options: { template: '{{name}}' } }, schema: { is_nullable: false } },
      { field: 'sub_brand', type: 'uuid', meta: { interface: 'select-dropdown-m2o', width: 'half', options: { template: '{{name}}' }, note: 'Volitelné — jen OMODA / JAECOO' }, schema: { is_nullable: true } },
      { field: 'slug', type: 'string', meta: { interface: 'input', required: true, width: 'half', note: 'URL: /model/{slug}' }, schema: { is_nullable: false, is_unique: true, max_length: 100 } },
      { field: 'name', type: 'string', meta: { interface: 'input', required: true, width: 'half' }, schema: { is_nullable: false, max_length: 200 } },
      { field: 'tagline', type: 'string', meta: { interface: 'input', note: 'Krátký slogan, např. "Inspirace pro každý den"' }, schema: { is_nullable: true, max_length: 300 } },
      { field: 'description', type: 'text', meta: { interface: 'input-rich-text-md', note: 'Hlavní popis modelu (markdown)' }, schema: { is_nullable: true } },
      { field: 'body_type', type: 'string', meta: { interface: 'select-dropdown', width: 'half', options: { choices: [
        { text: 'SUV', value: 'suv' },
        { text: 'Hatchback', value: 'hatchback' },
        { text: 'Sedan', value: 'sedan' },
        { text: 'Pickup', value: 'pickup' },
        { text: 'Dodávka', value: 'van' },
        { text: 'MPV', value: 'mpv' },
      ]}}, schema: { is_nullable: true } },
      { field: 'fuel_type', type: 'string', meta: { interface: 'select-dropdown', width: 'half', options: { choices: [
        { text: 'Benzín', value: 'petrol' },
        { text: 'Diesel', value: 'diesel' },
        { text: 'Hybrid', value: 'hybrid' },
        { text: 'Plug-in Hybrid (PHEV)', value: 'phev' },
        { text: 'Elektro', value: 'ev' },
      ]}}, schema: { is_nullable: true } },
      { field: 'price_from', type: 'integer', meta: { interface: 'input', width: 'half', note: 'Cena "od" pro hero card (Kč)' }, schema: { is_nullable: true } },
      { field: 'hero_image', type: 'uuid', meta: { interface: 'file-image', special: ['file'] }, schema: { is_nullable: true } },
      { field: 'gallery', type: 'json', meta: { interface: 'list', note: 'URL fotek (pole stringů)' }, schema: { is_nullable: true } },
      STATUS_FIELD, SORT_FIELD,
    ],
    relations: [
      { field: 'brand', related: 'brands', onDelete: 'NO ACTION' },
      { field: 'sub_brand', related: 'sub_brands', onDelete: 'SET NULL' },
      { field: 'hero_image', related: 'directus_files' },
    ],
  },

  // ----------------- MODEL_YEARS -----------------
  {
    collection: 'model_years',
    meta: { icon: 'event', note: 'Modelové roky (rok výroby) — držme zde technická data, ceník, brožuru', display_template: '{{model.name}} {{year}}' },
    fields: [
      { field: 'model', type: 'uuid', meta: { interface: 'select-dropdown-m2o', required: true, options: { template: '{{name}}' }, width: 'half' }, schema: { is_nullable: false } },
      { field: 'year', type: 'integer', meta: { interface: 'input', required: true, width: 'half' }, schema: { is_nullable: false } },
      { field: 'price_list_pdf', type: 'uuid', meta: { interface: 'file', special: ['file'], width: 'half' }, schema: { is_nullable: true } },
      { field: 'brochure_pdf', type: 'uuid', meta: { interface: 'file', special: ['file'], width: 'half' }, schema: { is_nullable: true } },
      { field: 'technical_data', type: 'json', meta: { interface: 'list', options: { fields: [
        { field: 'label', type: 'string', meta: { interface: 'input' } },
        { field: 'value', type: 'string', meta: { interface: 'input' } },
      ]}, note: 'Tabulka technických parametrů (motor, výkon, rozměry...)' }, schema: { is_nullable: true } },
      { field: 'color_options', type: 'json', meta: { interface: 'list', options: { fields: [
        { field: 'code', type: 'string', meta: { interface: 'input', width: 'half' } },
        { field: 'name', type: 'string', meta: { interface: 'input', width: 'half' } },
        { field: 'hex', type: 'string', meta: { interface: 'select-color', width: 'half' } },
        { field: 'price_extra', type: 'integer', meta: { interface: 'input', width: 'half' } },
      ]}, note: 'Dostupné barvy s cenou navíc' }, schema: { is_nullable: true } },
      STATUS_FIELD,
    ],
    relations: [
      { field: 'model', related: 'models', onDelete: 'CASCADE' },
      { field: 'price_list_pdf', related: 'directus_files' },
      { field: 'brochure_pdf', related: 'directus_files' },
    ],
  },

  // ----------------- TRIM_LEVELS -----------------
  {
    collection: 'trim_levels',
    meta: { icon: 'star', note: 'Výbavové úrovně (Style, Style+, Premium, Premium+, Exclusive...)', display_template: '{{model_year.model.name}} {{model_year.year}} — {{name}}' },
    fields: [
      { field: 'model_year', type: 'uuid', meta: { interface: 'select-dropdown-m2o', required: true, options: { template: '{{model.name}} {{year}}' }, width: 'half' }, schema: { is_nullable: false } },
      { field: 'slug', type: 'string', meta: { interface: 'input', required: true, width: 'half' }, schema: { is_nullable: false, max_length: 100 } },
      { field: 'name', type: 'string', meta: { interface: 'input', required: true, width: 'half' }, schema: { is_nullable: false, max_length: 100 } },
      { field: 'list_price', type: 'integer', meta: { interface: 'input', width: 'half', note: 'Ceníková cena (Kč)' }, schema: { is_nullable: true } },
      { field: 'promo_price', type: 'integer', meta: { interface: 'input', width: 'half', note: 'Akční cena (Kč)' }, schema: { is_nullable: true } },
      { field: 'features', type: 'json', meta: { interface: 'tags', note: 'Klíčové výbavy (zaškrtávací)' }, schema: { is_nullable: true } },
      { field: 'description', type: 'text', meta: { interface: 'input-multiline' }, schema: { is_nullable: true } },
      STATUS_FIELD, SORT_FIELD,
    ],
    relations: [
      { field: 'model_year', related: 'model_years', onDelete: 'CASCADE' },
    ],
  },

  // ----------------- OPTION_PACKAGES -----------------
  {
    collection: 'option_packages',
    meta: { icon: 'category', note: 'Doplňkové balíčky (TECH, BLACK, PREMIUM+, SAFETY...)', display_template: '{{model_year.model.name}} {{model_year.year}} — {{name}}' },
    fields: [
      { field: 'model_year', type: 'uuid', meta: { interface: 'select-dropdown-m2o', required: true, options: { template: '{{model.name}} {{year}}' }, width: 'half' }, schema: { is_nullable: false } },
      { field: 'slug', type: 'string', meta: { interface: 'input', required: true, width: 'half' }, schema: { is_nullable: false, max_length: 100 } },
      { field: 'name', type: 'string', meta: { interface: 'input', required: true, width: 'half' }, schema: { is_nullable: false, max_length: 100 } },
      { field: 'description', type: 'text', meta: { interface: 'input-multiline' }, schema: { is_nullable: true } },
      { field: 'features', type: 'json', meta: { interface: 'tags', note: 'Co packet obsahuje' }, schema: { is_nullable: true } },
      { field: 'pricing_per_trim', type: 'json', meta: { interface: 'input-code', options: { language: 'json' }, note: 'Cena per trim (např. {"style": 24900, "premium": "standard"})' }, schema: { is_nullable: true } },
    ],
    relations: [
      { field: 'model_year', related: 'model_years', onDelete: 'CASCADE' },
    ],
  },

  // ----------------- STOCK_VEHICLES -----------------
  {
    collection: 'stock_vehicles',
    meta: { icon: 'commute', note: 'Skladové vozy — to hlavní pro byznys', display_template: '{{model.name}} {{trim_level.name}} — {{color_code}} ({{vin}})', sort_field: 'sort', archive_field: 'status', archive_value: 'archived', unarchive_value: 'draft' },
    fields: [
      { field: 'brand', type: 'uuid', meta: { interface: 'select-dropdown-m2o', required: true, options: { template: '{{name}}' }, width: 'half' }, schema: { is_nullable: false } },
      { field: 'model', type: 'uuid', meta: { interface: 'select-dropdown-m2o', required: true, options: { template: '{{name}}' }, width: 'half' }, schema: { is_nullable: false } },
      { field: 'model_year', type: 'uuid', meta: { interface: 'select-dropdown-m2o', options: { template: '{{year}}' }, width: 'half' }, schema: { is_nullable: true } },
      { field: 'trim_level', type: 'uuid', meta: { interface: 'select-dropdown-m2o', options: { template: '{{name}}' }, width: 'half' }, schema: { is_nullable: true } },
      { field: 'vin', type: 'string', meta: { interface: 'input', width: 'half', note: 'Vehicle Identification Number' }, schema: { is_nullable: true, is_unique: true, max_length: 17 } },
      { field: 'color_code', type: 'string', meta: { interface: 'input', width: 'half', note: 'Kód barvy (WAA, LAK...)' }, schema: { is_nullable: true, max_length: 50 } },
      { field: 'list_price', type: 'integer', meta: { interface: 'input', width: 'half', note: 'Ceníková cena (Kč)' }, schema: { is_nullable: true } },
      { field: 'promo_price', type: 'integer', meta: { interface: 'input', width: 'half', note: 'Akční cena (Kč)' }, schema: { is_nullable: true } },
      { field: 'lowest_price_30d', type: 'integer', meta: { interface: 'input', width: 'half', note: 'Nejnižší cena za 30 dnů (EU Omnibus)' }, schema: { is_nullable: true } },
      { field: 'monthly_payment_from', type: 'integer', meta: { interface: 'input', width: 'half', note: 'Splátka od (Kč/měs)' }, schema: { is_nullable: true } },
      { field: 'km', type: 'integer', meta: { interface: 'input', width: 'half' }, schema: { is_nullable: true, default_value: 0 } },
      { field: 'first_registration', type: 'date', meta: { interface: 'datetime', width: 'half' }, schema: { is_nullable: true } },
      { field: 'condition', type: 'string', meta: { interface: 'select-dropdown', width: 'half', options: { choices: [
        { text: 'Nový', value: 'new' },
        { text: 'Předváděcí', value: 'demo' },
        { text: 'Ojetý', value: 'used' },
      ]}}, schema: { default_value: 'new', max_length: 20 } },
      { field: 'availability', type: 'string', meta: { interface: 'select-dropdown', width: 'half', options: { choices: [
        { text: 'Skladem', value: 'in_stock' },
        { text: 'Na cestě', value: 'on_the_way' },
        { text: 'Rezervováno', value: 'reserved' },
        { text: 'Prodáno', value: 'sold' },
      ]}}, schema: { default_value: 'in_stock', max_length: 20 } },
      { field: 'branch', type: 'uuid', meta: { interface: 'select-dropdown-m2o', options: { template: '{{name}}' }, width: 'half' }, schema: { is_nullable: true } },
      { field: 'photos', type: 'json', meta: { interface: 'files', special: ['files'], note: 'Drag & drop fotky' }, schema: { is_nullable: true } },
      { field: 'gallery_360_url', type: 'string', meta: { interface: 'input', note: '360° galerie (volitelné)' }, schema: { is_nullable: true } },
      { field: 'description', type: 'text', meta: { interface: 'input-rich-text-md' }, schema: { is_nullable: true } },
      { field: 'extra_features', type: 'json', meta: { interface: 'tags', note: 'Volitelné výbavy mimo packety' }, schema: { is_nullable: true } },
      { field: 'trim_level_snapshot', type: 'json', meta: { interface: 'input-code', options: { language: 'json' }, hidden: false, readonly: true, note: 'Snapshot trim v okamžiku přidání (auto)' }, schema: { is_nullable: true } },
      { field: 'highlighted', type: 'boolean', meta: { interface: 'boolean', width: 'half', note: 'Zvýraznit na homepage' }, schema: { is_nullable: true, default_value: false } },
      { field: 'listed_at', type: 'timestamp', meta: { interface: 'datetime', width: 'half', readonly: true }, schema: { is_nullable: true } },
      { field: 'sold_at', type: 'timestamp', meta: { interface: 'datetime', width: 'half' }, schema: { is_nullable: true } },
      STATUS_FIELD, SORT_FIELD,
    ],
    relations: [
      { field: 'brand', related: 'brands', onDelete: 'NO ACTION' },
      { field: 'model', related: 'models', onDelete: 'NO ACTION' },
      { field: 'model_year', related: 'model_years', onDelete: 'SET NULL' },
      { field: 'trim_level', related: 'trim_levels', onDelete: 'SET NULL' },
      { field: 'branch', related: 'branches', onDelete: 'SET NULL' },
    ],
  },

  // ----------------- LEADS -----------------
  {
    collection: 'leads',
    meta: { icon: 'mail', note: 'Poptávky z formulářů z webu', display_template: '{{customer_name}} — {{form_type}} ({{status}})', sort_field: 'sort' },
    fields: [
      { field: 'form_type', type: 'string', meta: { interface: 'select-dropdown', required: true, width: 'half', options: { choices: [
        { text: 'Obecná poptávka', value: 'contact' },
        { text: 'Testovací jízda', value: 'test_drive' },
        { text: 'Servis', value: 'service' },
        { text: 'Skladový vůz', value: 'stock_inquiry' },
        { text: 'Newsletter', value: 'newsletter' },
        { text: 'Zavolat zpět', value: 'callback' },
      ]}}, schema: { is_nullable: false, max_length: 50 } },
      { field: 'customer_name', type: 'string', meta: { interface: 'input', width: 'half' }, schema: { is_nullable: true, max_length: 200 } },
      { field: 'customer_email', type: 'string', meta: { interface: 'input', width: 'half' }, schema: { is_nullable: true, max_length: 200 } },
      { field: 'customer_phone', type: 'string', meta: { interface: 'input', width: 'half' }, schema: { is_nullable: true, max_length: 50 } },
      { field: 'message', type: 'text', meta: { interface: 'input-multiline' }, schema: { is_nullable: true } },
      { field: 'source_model', type: 'uuid', meta: { interface: 'select-dropdown-m2o', options: { template: '{{name}}' }, width: 'half' }, schema: { is_nullable: true } },
      { field: 'source_vehicle', type: 'uuid', meta: { interface: 'select-dropdown-m2o', options: { template: '{{model.name}} {{trim_level.name}}' }, width: 'half' }, schema: { is_nullable: true } },
      { field: 'source_page', type: 'string', meta: { interface: 'input', width: 'half', note: 'Z jaké stránky lead přišel' }, schema: { is_nullable: true } },
      { field: 'utm_source', type: 'string', meta: { interface: 'input', width: 'half' }, schema: { is_nullable: true } },
      { field: 'utm_medium', type: 'string', meta: { interface: 'input', width: 'half' }, schema: { is_nullable: true } },
      { field: 'utm_campaign', type: 'string', meta: { interface: 'input', width: 'half' }, schema: { is_nullable: true } },
      { field: 'status', type: 'string', meta: { interface: 'select-dropdown', width: 'half', options: { choices: [
        { text: '🆕 Nový', value: 'new' },
        { text: '📞 Kontaktován', value: 'contacted' },
        { text: '📋 Nabídka odeslána', value: 'quoted' },
        { text: '✅ Uzavřeno (úspěch)', value: 'won' },
        { text: '❌ Uzavřeno (neúspěch)', value: 'lost' },
      ]}, display: 'labels', display_options: { choices: [
        { text: 'Nový', value: 'new', background: '#FF4A1C', foreground: '#FFFFFF' },
        { text: 'Kontaktován', value: 'contacted', background: '#B27516', foreground: '#FFFFFF' },
        { text: 'Nabídka', value: 'quoted', background: '#1565C0', foreground: '#FFFFFF' },
        { text: 'Úspěch', value: 'won', background: '#1E7B5F', foreground: '#FFFFFF' },
        { text: 'Neúspěch', value: 'lost', background: '#6B6B6E', foreground: '#FFFFFF' },
      ]}}, schema: { is_nullable: false, default_value: 'new', max_length: 20 } },
      { field: 'assignee', type: 'uuid', meta: { interface: 'select-dropdown-m2o', options: { template: '{{full_name}}' }, width: 'half', note: 'Komu přidělit' }, schema: { is_nullable: true } },
      { field: 'note', type: 'text', meta: { interface: 'input-multiline', note: 'Interní poznámka (zákazník nevidí)' }, schema: { is_nullable: true } },
      { field: 'contacted_at', type: 'timestamp', meta: { interface: 'datetime', width: 'half' }, schema: { is_nullable: true } },
      SORT_FIELD,
    ],
    relations: [
      { field: 'source_model', related: 'models', onDelete: 'SET NULL' },
      { field: 'source_vehicle', related: 'stock_vehicles', onDelete: 'SET NULL' },
      { field: 'assignee', related: 'employees', onDelete: 'SET NULL' },
    ],
  },
];

// ----------------------------------------------------------
// SEED DATA
// ----------------------------------------------------------

const SEED_BRANDS = [
  { slug: 'kgm', name: 'KGM', tagline: 'Korejské SUV s charakterem', primary_color: '#0E1F3D', previous_names: ['SsangYong'], status: 'published', sort: 1 },
  { slug: 'omoda-jaecoo', name: 'OMODA & JAECOO', tagline: 'Nová generace prémiových SUV', primary_color: '#2A2D3A', status: 'published', sort: 2 },
  { slug: 'farizon', name: 'Farizon', tagline: 'Elektrické dodávky pro podnikatele', primary_color: '#1E2A3A', status: 'published', sort: 3 },
];

const SEED_BRANCHES = [
  { slug: 'praha-dablice', name: 'SFR Motor Praha-Ďáblice', address: 'Ďáblická 553/2', city: 'Praha 8', postal_code: '182 00', phone: '+420 771 235 458', email: 'info@sfr-motor.cz', opening_hours: { 'po-pa': '8:00-17:00', 'so': '9:00-12:00', 'ne': 'zavřeno' } },
];

const SEED_EMPLOYEES = [
  { full_name: 'Lukáš Jiránek',  role: 'Prodejce',  department: 'sales' },
  { full_name: 'Marek Šafarčík',  role: 'Prodejce',  department: 'sales' },
  { full_name: 'Michal Hlaváč',   role: 'Prodejce',  department: 'sales' },
  { full_name: 'Petr Paseka',     role: 'Prodejce',  department: 'sales' },
  { full_name: 'Jiří Hertl',      role: 'Servisní technik', department: 'service' },
  { full_name: 'Jiří Patzelt',    role: 'Servisní technik', department: 'service' },
  { full_name: 'Karel Mařík',     role: 'Servisní technik', department: 'service' },
  { full_name: 'Karel Zelenka',   role: 'Servisní technik', department: 'service' },
  { full_name: 'Radek Melíšek',   role: 'Servisní technik', department: 'service' },
  { full_name: 'Štěpán Záruba',   role: 'Servisní technik', department: 'service' },
  { full_name: 'Zdeněk Buršík',   role: 'Servisní technik', department: 'service' },
];

// ----------------------------------------------------------
// EXECUTION
// ----------------------------------------------------------

async function getExisting(collection) {
  try { return await api('GET', `/collections/${collection}`); }
  catch (e) { if (e.status === 403 || e.status === 404) return null; throw e; }
}

async function getExistingField(collection, field) {
  try { return await api('GET', `/fields/${collection}/${field}`); }
  catch (e) { if (e.status === 404 || e.status === 403) return null; throw e; }
}

async function createCollection(def) {
  const exists = await getExisting(def.collection);
  if (exists) { skip(`Collection "${def.collection}" už existuje, skip create`); }
  else {
    await api('POST', '/collections', {
      collection: def.collection,
      meta: def.meta ?? {},
      schema: { name: def.collection },
    });
    ok(`Collection "${def.collection}" vytvořena`);
  }

  for (const f of def.fields) {
    const fExists = await getExistingField(def.collection, f.field);
    if (fExists) { skip(`  field "${f.field}"`); continue; }
    try {
      await api('POST', `/fields/${def.collection}`, f);
      ok(`  field "${f.field}"`);
    } catch (e) {
      err(`  field "${f.field}" — ${e.message}`);
    }
  }
}

async function createRelation(rel, fromCollection) {
  try {
    await api('POST', '/relations', {
      collection: fromCollection,
      field: rel.field,
      related_collection: rel.related,
      meta: { sort_field: null },
      schema: rel.onDelete ? { on_delete: rel.onDelete } : null,
    });
    ok(`  relation ${fromCollection}.${rel.field} → ${rel.related}`);
  } catch (e) {
    if (e.message.includes('exists') || e.message.includes('RECORD_NOT_UNIQUE')) {
      skip(`  relation ${fromCollection}.${rel.field} už existuje`);
    } else {
      err(`  relation ${fromCollection}.${rel.field} — ${e.message}`);
    }
  }
}

async function setPublicPermissions() {
  info('Nastavuju Public role read-only přístup pro veřejné stránky...');
  const PUBLIC_READ = ['brands', 'sub_brands', 'models', 'model_years', 'trim_levels', 'option_packages', 'stock_vehicles', 'branches', 'employees'];
  const PUBLIC_CREATE = ['leads'];

  // Najdi Public role (defaultně se jmenuje "Public" nebo má ID v meta)
  let publicRole;
  try {
    const roles = await api('GET', '/roles?filter[name][_eq]=Public');
    publicRole = roles?.data?.[0];
  } catch { /* ignore */ }
  if (!publicRole) {
    warn('Public role nenalezen, přeskakuju permissions (nastav je ručně v Settings → Access Control)');
    return;
  }

  for (const coll of PUBLIC_READ) {
    try {
      await api('POST', '/permissions', {
        role: publicRole.id,
        collection: coll,
        action: 'read',
        fields: ['*'],
        permissions: { _and: [{ status: { _eq: 'published' } }] },
      });
      ok(`  ${coll} — public READ (jen status=published)`);
    } catch (e) {
      if (e.status === 400) skip(`  ${coll} — permission už existuje`);
      else warn(`  ${coll} — ${e.message}`);
    }
  }

  for (const coll of PUBLIC_CREATE) {
    try {
      await api('POST', '/permissions', {
        role: publicRole.id,
        collection: coll,
        action: 'create',
        fields: ['form_type', 'customer_name', 'customer_email', 'customer_phone', 'message', 'source_model', 'source_vehicle', 'source_page', 'utm_source', 'utm_medium', 'utm_campaign'],
      });
      ok(`  ${coll} — public CREATE (jen vybraná pole)`);
    } catch (e) {
      if (e.status === 400) skip(`  ${coll} — permission už existuje`);
      else warn(`  ${coll} — ${e.message}`);
    }
  }
}

async function seedBrands() {
  info('Seedím značky...');
  for (const b of SEED_BRANDS) {
    try {
      const existing = await api('GET', `/items/brands?filter[slug][_eq]=${b.slug}`);
      if (existing?.data?.length) { skip(`  Brand "${b.name}" už existuje`); continue; }
      await api('POST', '/items/brands', b);
      ok(`  Brand "${b.name}"`);
    } catch (e) { err(`  Brand "${b.name}" — ${e.message}`); }
  }
}

async function seedBranches() {
  info('Seedím pobočky...');
  for (const br of SEED_BRANCHES) {
    try {
      const existing = await api('GET', `/items/branches?filter[slug][_eq]=${br.slug}`);
      if (existing?.data?.length) { skip(`  Branch "${br.name}" už existuje`); continue; }
      await api('POST', '/items/branches', br);
      ok(`  Branch "${br.name}"`);
    } catch (e) { err(`  Branch "${br.name}" — ${e.message}`); }
  }
}

async function seedEmployees() {
  info('Seedím zaměstnance...');
  for (const emp of SEED_EMPLOYEES) {
    try {
      const existing = await api('GET', `/items/employees?filter[full_name][_eq]=${encodeURIComponent(emp.full_name)}`);
      if (existing?.data?.length) { skip(`  ${emp.full_name}`); continue; }
      await api('POST', '/items/employees', emp);
      ok(`  ${emp.full_name}`);
    } catch (e) { err(`  ${emp.full_name} — ${e.message}`); }
  }
}

// ----------------------------------------------------------
// MAIN
// ----------------------------------------------------------

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('  SFR Motor — Directus Schema Setup');
  console.log('═══════════════════════════════════════════════');
  console.log('');

  DIRECTUS_URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Admin email: ')).trim();
  const password = (await prompt('Admin heslo: ')).trim();
  console.log('');

  info(`Auth → ${DIRECTUS_URL}`);
  const authRes = await api('POST', '/auth/login', { email, password });
  TOKEN = authRes?.data?.access_token;
  if (!TOKEN) { err('Auth selhal'); process.exit(1); }
  ok('Auth OK');
  console.log('');

  // 1) Collections + fields
  info('Vytvářím collections a fields...');
  for (const def of COLLECTIONS) {
    await createCollection(def);
  }
  console.log('');

  // 2) Relations
  info('Vytvářím relations (FK)...');
  for (const def of COLLECTIONS) {
    if (def.relations?.length) {
      for (const rel of def.relations) {
        await createRelation(rel, def.collection);
      }
    }
  }
  console.log('');

  // 3) Public permissions
  await setPublicPermissions();
  console.log('');

  // 4) Seed
  await seedBrands();
  await seedBranches();
  await seedEmployees();
  console.log('');

  console.log('═══════════════════════════════════════════════');
  console.log('  Hotovo! ✅');
  console.log('═══════════════════════════════════════════════');
  console.log('');
  console.log(`Otevři ${DIRECTUS_URL} → měl bys vidět:`);
  console.log('  • 10 collections v menu vlevo');
  console.log('  • 3 značky (KGM, OMODA & JAECOO, Farizon)');
  console.log('  • 1 pobočka (Praha-Ďáblice)');
  console.log('  • 11 zaměstnanců');
  console.log('');
  console.log('Další krok: zaklikat modely a skladové vozy.');

  rl.close();
}

main().catch((e) => { err(e.message); rl.close(); process.exit(1); });
