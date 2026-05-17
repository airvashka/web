#!/usr/bin/env node
/**
 * SFR Motor — Konvertuje pricelist_colors (raw JSON) na 2 tabulkové fieldy.
 *
 * Před:  model_years.pricelist_colors = { exterior: [...], interior: [...] }  (raw JSON editor)
 * Po:    model_years.pricelist_colors_exterior   (JSON list — tabulkový editor)
 *        model_years.pricelist_colors_interior   (JSON list — tabulkový editor)
 *
 * Uvnitř každé barvy pricing_per_trim teď bude pole [{trim_slug, price}] místo
 * objektu {slug: price} — protože Directus list interface umí pole, ne dict.
 *
 * Frontend (vybavy.astro) i save.ts podporují OBA tvary (legacy {slug:price}
 * i nový [{trim_slug, price}]).
 *
 * Idempotentní — pole se nepřidá podruhé, data se nemigrují podruhé.
 *
 * Použití:
 *   cd "C:\Users\antos\Desktop\Claude\SFR WEB\SFR WEB\web"
 *   node scripts/add-pricelist-colors-list-fields.mjs
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

const PRICING_REPEATER = {
  field: 'pricing_per_trim',
  name: 'Ceny per trim',
  type: 'json',
  meta: {
    interface: 'list',
    special: ['cast-json'],
    width: 'full',
    note: 'Pro každý trim přidej řádek: trim slug + cenu v Kč. Trim slug viz collection Trim Levels (např. CLUB → club).',
    options: {
      template: '{{trim_slug}} — {{price}} Kč',
      fields: [
        { field: 'trim_slug', name: 'Trim slug', type: 'string', meta: { interface: 'input', width: 'half', required: true, options: { placeholder: 'club, style, premium, select, exclusive...' } } },
        { field: 'price', name: 'Cena (Kč)', type: 'integer', meta: { interface: 'input', width: 'half', required: true, options: { placeholder: '14900' } } },
      ],
    },
  },
};

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Pricelist colors → tabulkový editor (2 fieldy)');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  // 1) pricelist_colors_exterior
  if (!(await fieldExists('model_years', 'pricelist_colors_exterior'))) {
    await api('POST', '/fields/model_years', {
      field: 'pricelist_colors_exterior',
      type: 'json',
      schema: { is_nullable: true, default_value: null },
      meta: {
        interface: 'list',
        special: ['cast-json'],
        width: 'full',
        sort: 61,
        note: 'Barvy karoserie z ceníku — tabulkový výpis na /model/[slug]/vybavy. Generuje se z ceník uploaderu, dá se ručně upravit.',
        options: {
          template: '{{name}} ({{code}}) — {{type}}',
          fields: [
            { field: 'name', name: 'Název barvy', type: 'string', meta: { interface: 'input', width: 'full', required: true, options: { placeholder: 'např. Grand bílá' } } },
            { field: 'code', name: 'Kód', type: 'string', meta: { interface: 'input', width: 'half', options: { placeholder: 'WAA, ADE...' } } },
            { field: 'type', name: 'Typ', type: 'string', meta: { interface: 'select-dropdown', width: 'half', options: { choices: [
              { text: 'Základní (v ceně)', value: 'základní' },
              { text: 'Metalická',          value: 'metalická' },
              { text: 'Dvoutónová',         value: 'dvoutónová' },
              { text: 'Perleťová',          value: 'perleťová' },
            ] } } },
            PRICING_REPEATER,
          ],
        },
      },
    });
    ok('model_years.pricelist_colors_exterior přidán');
  } else {
    info('pricelist_colors_exterior už existuje');
  }

  // 2) pricelist_colors_interior
  if (!(await fieldExists('model_years', 'pricelist_colors_interior'))) {
    await api('POST', '/fields/model_years', {
      field: 'pricelist_colors_interior',
      type: 'json',
      schema: { is_nullable: true, default_value: null },
      meta: {
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
      },
    });
    ok('model_years.pricelist_colors_interior přidán');
  } else {
    info('pricelist_colors_interior už existuje');
  }

  // 3) Migrace dat ze starého pricelist_colors → nové fieldy
  console.log('\n  Migruji existující data z pricelist_colors → exterior/interior...');

  const years = await api('GET', '/items/model_years?limit=200&fields=id,year,pricelist_colors,pricelist_colors_exterior,pricelist_colors_interior');
  let migrated = 0;
  for (const y of years.data || []) {
    if (!y.pricelist_colors) continue;
    // Skip pokud už migrace proběhla (nové fieldy nejsou prázdné)
    if ((y.pricelist_colors_exterior?.length ?? 0) > 0 || (y.pricelist_colors_interior?.length ?? 0) > 0) {
      info(`Model year ${y.year} (id=${y.id}) — nové fieldy už mají data, přeskakuji.`);
      continue;
    }

    const old = y.pricelist_colors;
    const oldData = typeof old === 'string' ? (() => { try { return JSON.parse(old); } catch { return null; } })() : old;
    if (!oldData) continue;

    const convertPricing = (p) => {
      if (!p) return [];
      if (Array.isArray(p)) return p; // už array
      if (typeof p !== 'object') return [];
      return Object.entries(p).map(([trim_slug, price]) => ({ trim_slug, price: Number(price) || 0 }));
    };

    const ext = (oldData.exterior || []).map((c) => ({
      name: c.name,
      code: c.code || null,
      type: c.type || null,
      pricing_per_trim: convertPricing(c.pricing_per_trim),
    }));
    const intArr = (oldData.interior || []).map((c) => ({
      name: c.name,
      code: c.code || null,
      material: c.material || null,
      pricing_per_trim: convertPricing(c.pricing_per_trim),
    }));

    if (ext.length === 0 && intArr.length === 0) continue;

    await api('PATCH', `/items/model_years/${y.id}`, {
      pricelist_colors_exterior: ext,
      pricelist_colors_interior: intArr,
    });
    ok(`Model year ${y.year} (id=${y.id}): ${ext.length} exterior + ${intArr.length} interior migrováno`);
    migrated++;
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log(`  Hotovo. Migrováno ${migrated} model_years.`);
  console.log('');
  console.log('  V Directus admin (Ctrl+Shift+R):');
  console.log('    Model Years → otevři libovolný ročník →');
  console.log('      Pricelist Colors Exterior (NOVÉ, tabulkový editor)');
  console.log('      Pricelist Colors Interior (NOVÉ, tabulkový editor)');
  console.log('    Pricelist Colors (původní, raw JSON) zůstává jako záloha.');
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
