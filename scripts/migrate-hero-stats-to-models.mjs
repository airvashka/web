#!/usr/bin/env node
/**
 * SFR Motor — migrace `hero_stats` z model_years na models.
 *
 * Hero stats je marketing tahák, ne rok-specifická data → patří na model.
 * (model_years zůstává jako verzování technical_data / colors / trims / cen.)
 *
 * Kroky:
 *   1) Vytvoří models.hero_stats (JSON list repeater, stejná struktura jako dřív)
 *   2) Pro každý model: vezme latest model_year.hero_stats a zkopíruje na model
 *   3) Smaže model_years.hero_stats (čistá migrace, žádný leftover)
 *
 * Použití:
 *   cd web && node scripts/migrate-hero-stats-to-models.mjs
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

async function ensureModelsHeroStats() {
  if (await fieldExists('models', 'hero_stats')) {
    info('models.hero_stats už existuje');
    return;
  }
  await api('POST', '/fields/models', {
    field: 'hero_stats',
    type: 'json',
    schema: { is_nullable: true },
    meta: {
      interface: 'list',
      special: ['cast-json'],
      hidden: false,
      readonly: false,
      sort: 150,
      width: 'full',
      note: 'Hlavní statistiky pod hero fotkou modelu (Výkon, Záruka, Točivý moment, …). Doporučeno 3–4 řádky.',
      options: {
        template: '{{label}}: {{value}}',
        addLabel: 'Přidat stat',
        fields: [
          {
            field: 'label',
            type: 'string',
            name: 'Popisek',
            meta: { interface: 'input', width: 'half', note: 'Např. Výkon, Točivý moment, Záruka' },
          },
          {
            field: 'value',
            type: 'string',
            name: 'Hodnota',
            meta: { interface: 'input', width: 'half', note: 'Včetně jednotky, např. "120 kW", "5 let / 100 000 km"' },
          },
        ],
      },
    },
  });
  ok('models.hero_stats vytvořeno');
}

async function findAllModels() {
  const r = await api('GET', '/items/models?limit=200&fields=id,slug,name,hero_stats');
  return r?.data ?? [];
}

async function findLatestModelYear(modelId) {
  const r = await api('GET', `/items/model_years?filter[model][_eq]=${modelId}&sort=-year&limit=1&fields=id,year,hero_stats`);
  return r?.data?.[0] ?? null;
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Migrace hero_stats: model_years → models');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');
  const deleteOldField = (await prompt('Smazat model_years.hero_stats po migraci? [a/n, default n]: ')).trim().toLowerCase() === 'a';
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  // 1) Schema
  console.log('Krok 1: Schema');
  await ensureModelsHeroStats();
  console.log('');

  // 2) Kopírování dat
  console.log('Krok 2: Kopírování z model_years na models');
  const models = await findAllModels();
  let copied = 0, skipped = 0;
  for (const m of models) {
    // Pokud model už má hero_stats, ponech (admin mohl upravit)
    if (Array.isArray(m.hero_stats) && m.hero_stats.length > 0) {
      info(`${m.slug}: model už má hero_stats (${m.hero_stats.length} řádků), neprepisuji`);
      skipped++;
      continue;
    }
    const my = await findLatestModelYear(m.id);
    if (!my || !Array.isArray(my.hero_stats) || my.hero_stats.length === 0) {
      warn(`${m.slug}: žádné hero_stats v latest model_year, skipuji`);
      skipped++;
      continue;
    }
    try {
      await api('PATCH', `/items/models/${m.id}`, { hero_stats: my.hero_stats });
      ok(`${m.slug}: zkopírováno ${my.hero_stats.length} řádků z my${my.year}`);
      copied++;
    } catch (e) {
      warn(`${m.slug}: PATCH selhal — ${e.message}`);
    }
  }
  console.log('');

  // 3) Volitelně smazat starý field
  if (deleteOldField) {
    console.log('Krok 3: Mazání model_years.hero_stats');
    if (await fieldExists('model_years', 'hero_stats')) {
      await api('DELETE', '/fields/model_years/hero_stats');
      ok('model_years.hero_stats smazáno');
    } else {
      info('model_years.hero_stats už neexistuje');
    }
    console.log('');
  } else {
    console.log('Krok 3: SKIP — model_years.hero_stats ponechán (může sloužit jako rok-override)');
    console.log('Astro frontend bude prioritizovat models.hero_stats > model_years.hero_stats > auto-extract.\n');
  }

  console.log('═══════════════════════════════════════════════');
  console.log(`  Hotovo. Copied: ${copied}, Skipped: ${skipped}`);
  console.log('═══════════════════════════════════════════════');
  console.log('');
  console.log('V adminu Directus (Ctrl+Shift+R refresh):');
  console.log('  models → otevři libovolný model → "Hero Stats" pole.');
  console.log('  Editace se okamžitě projeví napříč všemi roky.\n');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
