#!/usr/bin/env node
/**
 * SFR Motor — models.promo_* fields pro manuální akce.
 *
 * Když nastavíš promo_active=true a vyplníš promo_discount_amount,
 * automaticky:
 *   - Skladové vozy tohoto modelu dostanou badge promo_label (např. "AKCE -50 000")
 *   - V detailu vozu se ukáže ceníková cena přeškrtnutá + nová akční
 *   - Na model stránce přibude banner sekce s promo_description (markdown)
 *
 * Když promo_active=false → nic se nezobrazí.
 *
 * Fields na models:
 *   promo_active        boolean   — vypínač akce
 *   promo_label         string    — krátký text pro badge (např. "JARNÍ AKCE")
 *   promo_discount_amount integer — sleva v Kč
 *   promo_valid_to      date      — kdy akce končí (volitelně)
 *   promo_description   text      — markdown text pro sekci na model stránce
 *
 * Použití:
 *   cd web && node scripts/add-model-promo.mjs
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

async function fieldExists(field) {
  try { await api('GET', `/fields/models/${field}`); return true; } catch { return false; }
}

async function ensureField(field, spec) {
  if (await fieldExists(field)) {
    info(`models.${field} už existuje`);
    return;
  }
  await api('POST', '/fields/models', { field, ...spec });
  ok(`models.${field} vytvořen`);
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  models.promo_* — manuální akce');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  // Divider before promo section
  if (!(await fieldExists('_promo_divider'))) {
    await api('POST', '/fields/models', {
      field: '_promo_divider',
      type: 'alias',
      schema: null,
      meta: {
        interface: 'presentation-divider',
        special: ['alias', 'no-data'],
        width: 'full',
        sort: 400,
        options: { title: 'Akční nabídka', icon: 'local_offer', color: '#F25C1B' },
      },
    });
    ok('_promo_divider přidán');
  }

  await ensureField('promo_active', {
    type: 'boolean',
    schema: { is_nullable: true, default_value: false },
    meta: {
      interface: 'boolean',
      special: ['cast-boolean'],
      width: 'half',
      sort: 410,
      note: 'Vypínač akce. Když ZAŠKRTNUTO + vyplněn promo_label, akce se zobrazí na webu (model stránka, sklad detail, listy vozů). Když nezaškrtnuto, nic se nezobrazí.',
      options: { label: 'Akce aktivní' },
    },
  });

  await ensureField('promo_label', {
    type: 'string',
    schema: { is_nullable: true, max_length: 80 },
    meta: {
      interface: 'input',
      width: 'half',
      sort: 415,
      note: 'Krátký text pro badge. Např. "JARNÍ AKCE", "AKCE -50 000", "VÝPRODEJ 2025".',
      options: { placeholder: 'JARNÍ AKCE' },
    },
  });

  await ensureField('promo_discount_amount', {
    type: 'integer',
    schema: { is_nullable: true },
    meta: {
      interface: 'input',
      width: 'half',
      sort: 420,
      note: 'Sleva v Kč. Odečte se od list_price každého skladového vozu tohoto modelu. Příklad: 50000 znamená -50 000 Kč. Když vyplníš 0 nebo necháš prázdné, akce běží jen jako "label" bez slevy.',
      options: { placeholder: '50000' },
    },
  });

  await ensureField('promo_valid_to', {
    type: 'date',
    schema: { is_nullable: true },
    meta: {
      interface: 'datetime',
      width: 'half',
      sort: 425,
      note: 'Datum konce akce. Po tomto datu se akce skryje automaticky (i když promo_active=true). Volitelně.',
    },
  });

  await ensureField('promo_description', {
    type: 'text',
    schema: { is_nullable: true },
    meta: {
      interface: 'input-rich-text-md',
      width: 'full',
      sort: 430,
      note: 'Delší popis akce (markdown). Zobrazí se v sekci na model stránce. Např. "Při zakoupení do 30. 6. 2026 dostanete pneu zdarma a slevu 50 000 Kč na všechny skladové Korando."',
      options: { toolbar: ['bold', 'italic', 'link', 'heading', 'bullist', 'numlist'] },
    },
  });

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo. Admin → models → libovolný model:');
  console.log('  Najdeš sekci "Akční nabídka" s 5 poli.');
  console.log('  Zaškrtni promo_active + vyplň label + amount + description.');
  console.log('  Akce se okamžitě projeví na webu po npm run build.');
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
