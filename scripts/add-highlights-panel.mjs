#!/usr/bin/env node
/**
 * SFR Motor — Highlights panel + VariantBadge + favicon.
 *
 * Migrace:
 *   1) models.highlights_panel  — JSON repeater (3 karty s ikonou + big stat + label + note)
 *      Příklad:
 *      [
 *        { "icon_kind": "range",    "big": "462 km",   "lab": "Dojezd WLTP",    "note": "Klidně až na hory — a zpět." },
 *        { "icon_kind": "charge",   "big": "38 min",   "lab": "Nabití 10→80 %", "note": "Stačí na kafe." },
 *        { "icon_kind": "heatpump", "big": "Tepelná pumpa", "lab": "V základní ceně", "note": "V zimě nepoznáte." }
 *      ]
 *
 *   2) models.variant_badge_kind — dropdown ICE / HEV / EVX (volitelné)
 *      Slouží jako vizuální badge na seznamu modelů (Torres má 3 varianty —
 *      ICE = kapka+plamen, HEV = list+kapka, EVX = baterie+blesk).
 *
 *   3) site_settings.favicon — M2O directus_files (image only)
 *      Použito v BaseLayout pro <link rel="icon">.
 *
 * Idempotentní — pokud field existuje, jen info, nic nemění.
 *
 * Použití:
 *   cd web && node scripts/add-highlights-panel.mjs
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rl = readline.createInterface({ input, output });
const prompt = (q) => rl.question(q);

let URL = '', TOKEN = '';

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${URL}${path}`, opts);
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(j?.errors ?? j)}`);
  return j;
}

const ok = (m) => console.log(`  ✓  ${m}`);
const info = (m) => console.log(`  ℹ  ${m}`);

async function fieldExists(col, field) {
  try { await api('GET', `/fields/${col}/${field}`); return true; } catch { return false; }
}

const ICON_KIND_CHOICES = [
  { text: 'Dojezd / Range (hodiny)',           value: 'range' },
  { text: 'Nabíjení / Charge (zástrčka)',      value: 'charge' },
  { text: 'Tepelná pumpa (zvlnění)',           value: 'heatpump' },
  { text: 'Self-charging hybrid (cyklus)',     value: 'selfcharge' },
  { text: 'Spotřeba paliva (kanystr)',         value: 'fuel' },
  { text: 'Pohon 4x4 (4 kola)',                value: 'awd' },
  { text: 'Tažné zařízení / Přívěs',           value: 'tow' },
  { text: 'Převodovka (řadicí páka)',          value: 'transmission' },
];

const VARIANT_BADGE_CHOICES = [
  { text: 'Žádný badge',           value: '' },
  { text: 'ICE — spalovací motor', value: 'ICE' },
  { text: 'HEV — hybrid',          value: 'HEV' },
  { text: 'EVX — elektromobil',    value: 'EVX' },
];

async function addHighlightsPanel() {
  if (await fieldExists('models', 'highlights_panel')) {
    info('models.highlights_panel už existuje');
    return;
  }
  await api('POST', '/fields/models', {
    field: 'highlights_panel',
    type: 'json',
    schema: { is_nullable: true, default_value: null },
    meta: {
      interface: 'list',
      width: 'full',
      sort: 60,
      special: ['cast-json'],
      note: 'Lákadlový panel pod sekcí Představení. 3 karty s ikonou, velkou hodnotou, popiskem a krátkou notou.',
      options: {
        template: '{{lab}}: {{big}}',
        fields: [
          {
            field: 'icon_kind',
            name: 'Ikona',
            type: 'string',
            meta: {
              interface: 'select-dropdown',
              width: 'half',
              required: true,
              options: { choices: ICON_KIND_CHOICES },
            },
          },
          {
            field: 'big',
            name: 'Velká hodnota',
            type: 'string',
            meta: { interface: 'input', width: 'half', required: true, options: { placeholder: 'např. 462 km' } },
          },
          {
            field: 'lab',
            name: 'Popisek (uppercase)',
            type: 'string',
            meta: { interface: 'input', width: 'half', required: true, options: { placeholder: 'např. Dojezd WLTP' } },
          },
          {
            field: 'note',
            name: 'Krátká nota',
            type: 'string',
            meta: { interface: 'input', width: 'full', options: { placeholder: 'Klidně až na hory — a zpět na jedno nabití.' } },
          },
        ],
      },
    },
  });
  ok('models.highlights_panel přidán');
}

async function addVariantBadge() {
  if (await fieldExists('models', 'variant_badge_kind')) {
    info('models.variant_badge_kind už existuje');
    return;
  }
  await api('POST', '/fields/models', {
    field: 'variant_badge_kind',
    type: 'string',
    schema: { is_nullable: true, default_value: null },
    meta: {
      interface: 'select-dropdown',
      width: 'half',
      sort: 61,
      note: 'Vizuální badge pro Torres ICE/HEV/EVX (zobrazuje se v seznamech modelů a na detailu skladovky). Ostatní modely nech prázdné.',
      options: { choices: VARIANT_BADGE_CHOICES },
    },
  });
  ok('models.variant_badge_kind přidán');
}

async function addFavicon() {
  if (await fieldExists('site_settings', 'favicon')) {
    info('site_settings.favicon už existuje');
    return;
  }
  await api('POST', '/fields/site_settings', {
    field: 'favicon',
    type: 'uuid',
    schema: { is_nullable: true },
    meta: {
      interface: 'file-image',
      special: ['file'],
      width: 'half',
      sort: 5,
      note: 'Favicon webu (SVG, PNG nebo ICO, ideálně 32×32). Použije se v <link rel="icon"> v hlavičce.',
    },
  });
  // FK do directus_files
  await api('POST', '/relations', {
    collection: 'site_settings',
    field: 'favicon',
    related_collection: 'directus_files',
    schema: { on_delete: 'SET NULL' },
  });
  ok('site_settings.favicon přidán (M2O → directus_files)');
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Highlights panel + VariantBadge + Favicon');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  await addHighlightsPanel();
  await addVariantBadge();
  await addFavicon();

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo. V adminu (Ctrl+Shift+R):');
  console.log('    - Models → otevři Torres EVX → uvidíš:');
  console.log('        • Highlights panel (3 karty)');
  console.log('        • Variant badge → vyber EVX');
  console.log('    - Site Settings → favicon → nahraj soubor');
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
