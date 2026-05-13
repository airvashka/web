#!/usr/bin/env node
/**
 * SFR Motor — site_settings.stock_highlights
 *
 * Přidá JSON repeater pole `stock_highlights` na site_settings singleton.
 * Toto pole obsahuje 4 (nebo libovolný počet) karet "Připravený k převzetí",
 * které se zobrazují na každém detailu skladového vozu.
 *
 * Repeater item: { icon, title, subtitle }
 *   icon  = dropdown: shield, swap, wallet, badge, star, key, car, phone
 *   title = krátký nadpis
 *   subtitle = popis 1-2 věty
 *
 * Skript:
 *   1) Vytvoří field site_settings.stock_highlights (pokud neexistuje)
 *   2) Pokud je singleton prázdný / pole je null, naseed-uje 4 defaultní hodnoty
 *
 * Použití:
 *   cd web && node scripts/add-stock-highlights.mjs
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

async function fieldExists(collection, field) {
  try { await api('GET', `/fields/${collection}/${field}`); return true; } catch { return false; }
}

const ICON_CHOICES = [
  { text: '🛡 Štít (záruka, bezpečnost)', value: 'shield' },
  { text: '🔄 Šipky (výkup, výměna)', value: 'swap' },
  { text: '💼 Peněženka (financování)', value: 'wallet' },
  { text: '🏅 Odznak (autorizovaný)', value: 'badge' },
  { text: '⭐ Hvězda', value: 'star' },
  { text: '🔑 Klíč', value: 'key' },
  { text: '🚗 Auto', value: 'car' },
  { text: '📞 Telefon (servis)', value: 'phone' },
  { text: '⏱ Hodiny (rychlost)', value: 'clock' },
];

const DEFAULTS = [
  {
    icon: 'shield',
    title: 'Záruka výrobce',
    subtitle: 'Plná tovární záruka 5–7 let dle modelu, kompletní servisní historie.',
  },
  {
    icon: 'swap',
    title: 'Výkup vašeho vozu',
    subtitle: 'Protiúčtem zaplatíte jen rozdíl. Online ocenění do hodiny.',
  },
  {
    icon: 'wallet',
    title: 'Financování a pojištění',
    subtitle: 'Zařídíme leasing, úvěr i pojištění na míru. Vy si jen vyzvednete klíče.',
  },
  {
    icon: 'badge',
    title: 'Autorizovaný prodejce',
    subtitle: 'KGM · OMODA & JAECOO · FARIZON. Originální díly a servis ve vlastní dílně.',
  },
];

async function ensureField() {
  if (await fieldExists('site_settings', 'stock_highlights')) {
    info('site_settings.stock_highlights už existuje');
    return;
  }
  await api('POST', '/fields/site_settings', {
    field: 'stock_highlights',
    type: 'json',
    schema: { is_nullable: true },
    meta: {
      interface: 'list',
      width: 'full',
      note: 'Karty "Připravený k převzetí" na detailu každého skladového vozu. Vlevo ikona, vpravo nadpis + popis.',
      options: {
        template: '{{title}}',
        addLabel: 'Přidat kartu',
        fields: [
          {
            field: 'icon',
            name: 'Ikona',
            type: 'string',
            meta: {
              interface: 'select-dropdown',
              width: 'half',
              options: { choices: ICON_CHOICES, allowOther: false },
            },
          },
          {
            field: 'title',
            name: 'Nadpis',
            type: 'string',
            meta: {
              interface: 'input',
              width: 'half',
              options: { placeholder: 'např. Záruka výrobce' },
            },
          },
          {
            field: 'subtitle',
            name: 'Popis',
            type: 'text',
            meta: {
              interface: 'input-multiline',
              width: 'full',
              options: { placeholder: '1–2 věty.', trim: true },
            },
          },
        ],
      },
    },
  });
  ok('site_settings.stock_highlights field vytvořen');
}

async function seedDefaults() {
  // site_settings je singleton — GET vrací rovnou objekt
  let current;
  try {
    current = await api('GET', '/items/site_settings');
  } catch {
    info('site_settings singleton ještě neexistuje (chybí setup-site-settings?), skipuji seed');
    return;
  }

  if (Array.isArray(current.data?.stock_highlights) && current.data.stock_highlights.length > 0) {
    info(`Stock highlights už mají ${current.data.stock_highlights.length} hodnot, neseeduji`);
    return;
  }

  await api('PATCH', '/items/site_settings', { stock_highlights: DEFAULTS });
  ok(`Naseed-eno ${DEFAULTS.length} defaultních highlights`);
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Add site_settings.stock_highlights');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  console.log('Krok 1: Field');
  await ensureField();

  console.log('\nKrok 2: Seed default 4 highlights');
  await seedDefaults();

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo. Admin → Site Settings → "Stock highlights".');
  console.log('  4 karty se zobrazí na detailu každého skladového vozu.');
  console.log('  Můžeš editovat texty, přidávat další, mazat.');
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
