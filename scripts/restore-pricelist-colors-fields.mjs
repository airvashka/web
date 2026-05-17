#!/usr/bin/env node
/**
 * SFR Motor — RECOVERY: znovu nastaví správnou meta pro pricelist_colors_exterior + _interior.
 *
 * Bug v fix-pricelist-colors-price-field.mjs: GET /fields/... vrací { data: {...} },
 * ale script četl cur.meta (undefined → prázdná). PATCH pak přepsal meta a admin UI
 * ztratil definici subfields → Empty Form.
 *
 * Data v JSON sloupcích ZŮSTALA NETKNUTÁ. Jen meta config se musí obnovit.
 *
 * Tento script meta nastaví znovu od nuly (overwrite, ne merge), takže ji opraví
 * bez ohledu na to co tam je teď.
 *
 * Použití:
 *   cd "C:\Users\antos\Desktop\Claude\SFR WEB\SFR WEB\web"
 *   node scripts/restore-pricelist-colors-fields.mjs
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

// Subfield pro ceny per trim — string + dropdown s předvolbami + custom value
const PRICING_REPEATER = {
  field: 'pricing_per_trim',
  name: 'Ceny per trim',
  type: 'json',
  meta: {
    interface: 'list',
    special: ['cast-json'],
    width: 'full',
    note: 'Pro každý trim přidej řádek. Cena: vyber "V ceně" / "Nedostupné", nebo napiš číslo Kč.',
    options: {
      template: '{{trim_slug}} — {{price}}',
      fields: [
        {
          field: 'trim_slug',
          name: 'Trim slug',
          type: 'string',
          meta: {
            interface: 'input',
            width: 'half',
            required: true,
            options: { placeholder: 'club, style, premium, select, exclusive...' },
          },
        },
        {
          field: 'price',
          name: 'Cena',
          type: 'string',
          meta: {
            interface: 'select-dropdown',
            width: 'half',
            required: true,
            options: {
              allowOther: true,
              allowNone: false,
              placeholder: 'Vyber, nebo zadej cenu v Kč…',
              choices: [
                { text: '🟢 V ceně (standard)', value: 'standard' },
                { text: '⚪ Nedostupné (—)',     value: 'unavailable' },
              ],
            },
          },
        },
      ],
    },
  },
};

const EXTERIOR_META = {
  interface: 'list',
  special: ['cast-json'],
  width: 'full',
  sort: 61,
  note: 'Barvy karoserie z ceníku — tabulkový výpis na /model/[slug]/vybavy. Generuje se z ceník uploaderu, dá se ručně upravit.',
  options: {
    template: '{{name}} ({{code}}) — {{type}}',
    fields: [
      { field: 'name', name: 'Název barvy', type: 'string', meta: { interface: 'input', width: 'full', required: true, options: { placeholder: 'např. Grand bílá' } } },
      { field: 'code', name: 'Kód',         type: 'string', meta: { interface: 'input', width: 'half', options: { placeholder: 'WAA, ADE...' } } },
      { field: 'type', name: 'Typ',         type: 'string', meta: { interface: 'select-dropdown', width: 'half', options: { choices: [
        { text: 'Základní (v ceně)', value: 'základní' },
        { text: 'Metalická',          value: 'metalická' },
        { text: 'Dvoutónová',         value: 'dvoutónová' },
        { text: 'Perleťová',          value: 'perleťová' },
      ] } } },
      PRICING_REPEATER,
    ],
  },
};

const INTERIOR_META = {
  interface: 'list',
  special: ['cast-json'],
  width: 'full',
  sort: 62,
  note: 'Čalounění/interiér z ceníku.',
  options: {
    template: '{{name}} — {{material}}',
    fields: [
      { field: 'name',     name: 'Název čalounění', type: 'string', meta: { interface: 'input', width: 'full', required: true, options: { placeholder: 'např. Černý interiér' } } },
      { field: 'code',     name: 'Kód',             type: 'string', meta: { interface: 'input', width: 'half', options: { placeholder: 'EBJ, LBN...' } } },
      { field: 'material', name: 'Materiál',        type: 'string', meta: { interface: 'input', width: 'half', options: { placeholder: 'textil, pravá kůže, syntetická kůže...' } } },
      PRICING_REPEATER,
    ],
  },
};

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Restore pricelist_colors_exterior + _interior META');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  await api('PATCH', '/fields/model_years/pricelist_colors_exterior', { meta: EXTERIOR_META });
  ok('model_years.pricelist_colors_exterior — meta obnovena');

  await api('PATCH', '/fields/model_years/pricelist_colors_interior', { meta: INTERIOR_META });
  ok('model_years.pricelist_colors_interior — meta obnovena');

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo. V Directus admin Ctrl+Shift+R.');
  console.log('  Pricelist Colors Exterior:');
  console.log('    Klik na barvu → form má pole Název, Kód, Typ, Ceny per trim');
  console.log('  Ceny per trim → klik na položku → Trim slug + Cena (dropdown)');
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
