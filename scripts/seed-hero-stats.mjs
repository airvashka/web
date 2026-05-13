#!/usr/bin/env node
/**
 * SFR Motor — schema + auto-seed hero stats pro model_years.
 *
 * 1) Vytvoří pole `model_years.hero_stats` (JSON list, repeater 2-column {label, value}).
 *    V adminu vypadá jako tabulka kde editor přidává/odebírá řádky.
 *
 * 2) Pro každý model spočítá 4 default stats (3 z technical_data dle fuel_type
 *    + Cena od z model.price_from) a PATCH model_year.hero_stats.
 *    Klient pak v adminu jen poladí — žádné limity počtu řádků.
 *
 * Frontend (model/[slug].astro) priorita:
 *   - pokud hero_stats má data → použít je 1:1 (admin má kontrolu)
 *   - jinak → auto-extrakce z technical_data (legacy fallback)
 *
 * Použití:
 *   cd web && node scripts/seed-hero-stats.mjs
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

async function fieldExists(collection, field) {
  try { await api('GET', `/fields/${collection}/${field}`); return true; } catch { return false; }
}

async function ensureHeroStatsField() {
  if (await fieldExists('model_years', 'hero_stats')) {
    info('model_years.hero_stats už existuje');
    return;
  }
  await api('POST', '/fields/model_years', {
    field: 'hero_stats',
    type: 'json',
    schema: { is_nullable: true },
    meta: {
      interface: 'list',
      special: ['cast-json'],
      note: 'Hlavní statistiky modelu zobrazené v tmavém pruhu pod hero fotkou. Doporučeno 3-4 řádky.',
      options: {
        template: '{{label}}: {{value}}',
        fields: [
          {
            field: 'label',
            type: 'string',
            name: 'Popisek',
            meta: { interface: 'input', width: 'half', note: 'Např. Výkon, Točivý moment, Záruka, Cena od' },
          },
          {
            field: 'value',
            type: 'string',
            name: 'Hodnota',
            meta: { interface: 'input', width: 'half', note: 'Krátká hodnota včetně jednotky, např. "120 kW", "5 let / 100 000 km"' },
          },
        ],
      },
      width: 'full',
    },
  });
  ok('model_years.hero_stats field vytvořeno');
}

// ===== Helpers pro auto-seed =====

function findInTdata(tdata, aliases, unit) {
  const lowerAliases = aliases.map((a) => a.toLowerCase());
  for (const [k, v] of Object.entries(tdata)) {
    if (lowerAliases.some((a) => k.toLowerCase().includes(a))) {
      const val = String(v).trim();
      // Zkrátit: vzít před lomítkem / závorkami
      const before = val.split(/\s*\/\s*/)[0].replace(/\s*\([^)]*\)/g, '').trim();
      const short = before.length > 22 ? before.substring(0, 20) + '…' : before;
      // Přidat unit pokud chybí a hodnota je čistě číselná
      if (unit && !short.includes(unit) && /^[0-9.,\s]+$/.test(short)) {
        return `${short} ${unit}`;
      }
      return short;
    }
  }
  return null;
}

const STAT_SETS = {
  petrol: [
    { label: 'Výkon', aliases: ['čistý výkon motoru', 'systémový výkon', 'výkon'], unit: 'kW' },
    { label: 'Točivý moment', aliases: ['maximální točivý moment', 'točivý moment'], unit: 'Nm' },
    { label: 'Spotřeba (komb.)', aliases: ['průměrná spotřeba paliva', 'spotřeba (komb.)', 'spotřeba'], unit: 'l/100 km' },
  ],
  diesel: [
    { label: 'Výkon', aliases: ['čistý výkon motoru', 'výkon'], unit: 'kW' },
    { label: 'Točivý moment', aliases: ['maximální točivý moment', 'točivý moment'], unit: 'Nm' },
    { label: 'Spotřeba (komb.)', aliases: ['průměrná spotřeba paliva', 'spotřeba'], unit: 'l/100 km' },
  ],
  hybrid: [
    { label: 'Systémový výkon', aliases: ['systémový výkon', 'výkon'], unit: 'kW' },
    { label: 'Spotřeba (komb.)', aliases: ['průměrná spotřeba paliva', 'spotřeba'], unit: 'l/100 km' },
    { label: 'Emise CO₂', aliases: ['emise co₂', 'emise co2'], unit: 'g/km' },
  ],
  phev: [
    { label: 'Systémový výkon', aliases: ['systémový výkon', 'výkon'], unit: 'kW' },
    { label: 'Dojezd EV', aliases: ['dojezd ev', 'dojezd elektro', 'elektrický dojezd'], unit: 'km' },
    { label: 'Spotřeba (komb.)', aliases: ['průměrná spotřeba paliva', 'spotřeba'], unit: 'l/100 km' },
  ],
  ev: [
    { label: 'Dojezd WLTP', aliases: ['dojezd wltp', 'dojezd'], unit: 'km' },
    { label: 'Výkon', aliases: ['čistý výkon motoru', 'výkon'], unit: 'kW' },
    { label: 'Zrychlení 0–100', aliases: ['zrychlení 0-100', 'zrychlení 0–100', 'zrychlení'], unit: 's' },
  ],
};

const WARRANTY_BY_BRAND = {
  kgm: '5 let / 100 000 km',
  'omoda-jaecoo': '7 let / 150 000 km',
  farizon: '7 let / 150 000 km',
};

async function findModels() {
  const r = await api('GET', '/items/models?limit=200&fields=id,slug,name,fuel_type,price_from,brand');
  return r?.data ?? [];
}

async function findLatestModelYear(modelId) {
  const r = await api('GET', `/items/model_years?filter[model][_eq]=${modelId}&sort=-year&limit=1&fields=id,year,technical_data,hero_stats`);
  return r?.data?.[0] ?? null;
}

async function findBrand(brandId) {
  if (!brandId) return null;
  const r = await api('GET', `/items/brands/${brandId}?fields=slug`);
  return r?.data ?? null;
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Schema + seed hero_stats pro model_years');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');
  const overwrite = (await prompt('Přepsat existující hero_stats (pokud admin už upravil)? [n]: ')).trim().toLowerCase() === 'y';
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  // 1) Schema
  console.log('Krok 1: Schema');
  await ensureHeroStatsField();
  console.log('');

  // 2) Auto-seed
  console.log('Krok 2: Auto-seed hodnot');
  const models = await findModels();
  let seeded = 0, skipped = 0, errors = 0;

  for (const model of models) {
    const my = await findLatestModelYear(model.id);
    if (!my) { warn(`${model.slug}: žádný model_year, skipuji`); skipped++; continue; }

    // Pokud už má hero_stats a nemáme overwrite, skip
    if (!overwrite && Array.isArray(my.hero_stats) && my.hero_stats.length > 0) {
      info(`${model.slug}: má už ${my.hero_stats.length} hero_stats, skipuji (overwrite=n)`);
      skipped++;
      continue;
    }

    const tdata = my.technical_data ?? {};
    const fuel = model.fuel_type ?? 'petrol';
    const brand = await findBrand(model.brand);
    const brandSlug = brand?.slug ?? 'kgm';

    const set = STAT_SETS[fuel] ?? STAT_SETS.petrol;
    const stats = [];

    // 3 z technical_data
    for (const def of set) {
      const val = findInTdata(tdata, def.aliases, def.unit);
      if (val) stats.push({ label: def.label, value: val });
      if (stats.length >= 3) break;
    }

    // 4. = Záruka (per brand)
    const warranty = WARRANTY_BY_BRAND[brandSlug];
    if (warranty) stats.push({ label: 'Záruka', value: warranty });

    // Pokud máme méně než 2, doplň o cenu
    if (stats.length < 2 && model.price_from) {
      stats.push({ label: 'Cena od', value: `${Number(model.price_from).toLocaleString('cs-CZ')} Kč` });
    }

    if (stats.length === 0) {
      warn(`${model.slug}: nepodařilo se odvodit žádnou stat, skipuji`);
      skipped++;
      continue;
    }

    try {
      await api('PATCH', `/items/model_years/${my.id}`, { hero_stats: stats });
      ok(`${model.slug} (my${my.year}): ${stats.length} stats — ${stats.map((s) => s.label).join(' · ')}`);
      seeded++;
    } catch (e) {
      warn(`${model.slug}: PATCH selhal — ${e.message}`);
      errors++;
    }
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log(`  Hotovo. Seeded: ${seeded}, Skipped: ${skipped}, Errors: ${errors}`);
  console.log('═══════════════════════════════════════════════\n');
  console.log('V adminu Directus → model_years → libovolný rok → "Hero stats" field');
  console.log('uvidíš 3-4 řádky které můžeš upravit nebo přidat další.\n');
  console.log('Webhook spustí Vercel rebuild ~30 s.');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
