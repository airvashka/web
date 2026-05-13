#!/usr/bin/env node
/**
 * SFR Motor — diagnostika a fix viditelnosti hero_stats v adminu.
 *
 * Pokud byl field vytvořen API ale není vidět v UI, typické příčiny:
 *   - meta.hidden: true
 *   - meta.readonly: true
 *   - meta.group: něco (sbalený group)
 *   - meta.sort: extrémní hodnota (nutno dát rozumné)
 *   - meta.interface = nesprávný / neexistující
 *
 * Skript načte aktuální meta hero_stats, vypíše ji a PATCH-ne na korektní hodnoty.
 *
 * Použití:
 *   cd web && node scripts/fix-hero-stats-visibility.mjs
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

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Fix hero_stats viditelnosti');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  // 1. Aktuální stav
  console.log('Krok 1: Aktuální stav hero_stats');
  let current;
  try {
    current = await api('GET', '/fields/model_years/hero_stats');
    info(`Field existuje: type=${current.data.type}`);
    info(`meta.interface: ${current.data.meta?.interface}`);
    info(`meta.hidden: ${current.data.meta?.hidden}`);
    info(`meta.readonly: ${current.data.meta?.readonly}`);
    info(`meta.group: ${current.data.meta?.group}`);
    info(`meta.sort: ${current.data.meta?.sort}`);
    info(`meta.special: ${JSON.stringify(current.data.meta?.special)}`);
  } catch (e) {
    warn(`hero_stats neexistuje! ${e.message}`);
    console.log('Vytvářím od začátku...');
    current = null;
  }
  console.log('');

  // 2. Force-update / vytvoření s pevnou meta
  console.log('Krok 2: Update meta');
  const fieldDef = {
    field: 'hero_stats',
    type: 'json',
    schema: { is_nullable: true },
    meta: {
      interface: 'list',
      special: ['cast-json'],
      hidden: false,
      readonly: false,
      group: null,
      sort: 100,
      width: 'full',
      note: 'Hlavní statistiky pod hero fotkou modelu. Doporučeno 3–4 řádky.',
      options: {
        template: '{{label}}: {{value}}',
        addLabel: 'Přidat stat',
        fields: [
          {
            field: 'label',
            type: 'string',
            name: 'Popisek',
            meta: {
              interface: 'input',
              width: 'half',
              note: 'Např. Výkon, Točivý moment, Záruka',
            },
          },
          {
            field: 'value',
            type: 'string',
            name: 'Hodnota',
            meta: {
              interface: 'input',
              width: 'half',
              note: 'Včetně jednotky, např. "120 kW", "5 let / 100 000 km"',
            },
          },
        ],
      },
    },
  };

  if (current) {
    // PATCH existující
    await api('PATCH', '/fields/model_years/hero_stats', fieldDef);
    ok('Existující hero_stats PATCH na korektní meta');
  } else {
    await api('POST', '/fields/model_years', fieldDef);
    ok('hero_stats nově vytvořeno');
  }
  console.log('');

  // 3. Ověření
  console.log('Krok 3: Ověření');
  const after = await api('GET', '/fields/model_years/hero_stats');
  info(`Po update — interface: ${after.data.meta?.interface}, hidden: ${after.data.meta?.hidden}, sort: ${after.data.meta?.sort}`);
  console.log('');

  console.log('═══════════════════════════════════════════════');
  console.log('  Hotovo!');
  console.log('═══════════════════════════════════════════════');
  console.log('');
  console.log('V adminu Directus stiskni Ctrl+Shift+R (hard refresh).');
  console.log('Pak model_years → otevři libovolný rok →');
  console.log('Scrolluj dolů → uvidíš "Hero Stats" field s tlačítkem "Přidat stat".');
  console.log('Pokud stále nevidíš, podívej se na nejbližší konzoli (F12) ');
  console.log('— možný JS error v Directus admin UI.\n');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
