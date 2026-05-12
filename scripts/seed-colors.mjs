#!/usr/bin/env node
/**
 * SFR Motor — seed barev karoserie a interiéru.
 *
 * Načte `_data/brozury-extracted/_barvy.json` a updatuje pro každý model
 * jeho **nejnovější** model_year:
 *   - `color_options` (existující field) ← exterior_colors
 *   - `interior_options` (nový field, vytvoří se pokud neexistuje) ← interior_colors
 *
 * Struktura color_option uložená do JSON pole:
 *   {
 *     code: "WAA",
 *     name: "Grand bílá",
 *     name_en: "Grand White",
 *     hex: "#F0EEE9",
 *     type: "základní",
 *     swatch_image: "img-p015-03.jpeg",
 *     monotone_only: true | undefined
 *   }
 *
 * Použití:
 *   cd web && node scripts/seed-colors.mjs
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BARVY_PATH = join(__dirname, '..', '..', '_data', 'brozury-extracted', '_barvy.json');

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
  try {
    await api('GET', `/fields/${collection}/${field}`);
    return true;
  } catch {
    return false;
  }
}

async function ensureInteriorOptionsField() {
  if (await fieldExists('model_years', 'interior_options')) {
    info('model_years.interior_options field už existuje');
    return;
  }
  await api('POST', '/fields/model_years', {
    field: 'interior_options',
    type: 'json',
    schema: { is_nullable: true },
    meta: {
      interface: 'list',
      special: ['cast-json'],
      note: 'Barvy interiéru: [{code, name, material, hex, swatch_image}]',
      options: {
        template: '{{name}} ({{material}})',
        fields: [
          { field: 'code', type: 'string', name: 'Kód', meta: { interface: 'input', width: 'half' } },
          { field: 'name', type: 'string', name: 'Název', meta: { interface: 'input', width: 'half' } },
          { field: 'material', type: 'string', name: 'Materiál', meta: { interface: 'input', width: 'half' } },
          { field: 'hex', type: 'string', name: 'Hex barva', meta: { interface: 'input', width: 'half' } },
          { field: 'swatch_image', type: 'string', name: 'Swatch image filename', meta: { interface: 'input', width: 'full' } },
        ],
      },
      width: 'full',
    },
  });
  ok('model_years.interior_options field vytvořen');
}

function transformExterior(c) {
  const out = {
    code: c.code ?? null,
    name: c.name_cs ?? c.name ?? '',
    name_en: c.name_en ?? null,
    hex: c.hex ?? null,
    type: c.type ?? null,
  };
  if (c.swatch_image) out.swatch_image = c.swatch_image;
  if (c.monotone_only) out.monotone_only = true;
  return out;
}

function transformInterior(c) {
  const out = {
    code: c.code ?? null,
    name: c.name_cs ?? c.name ?? '',
    material: c.material ?? null,
    hex: c.hex ?? null,
  };
  if (c.swatch_image) out.swatch_image = c.swatch_image;
  return out;
}

async function findModelBySlug(slug) {
  const r = await api('GET', `/items/models?filter[slug][_eq]=${encodeURIComponent(slug)}&limit=1`);
  return r?.data?.[0] ?? null;
}

async function findLatestModelYear(modelId) {
  const r = await api('GET', `/items/model_years?filter[model][_eq]=${modelId}&sort=-year&limit=1`);
  return r?.data?.[0] ?? null;
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  SFR Motor — Seed barev karoserie a interiéru');
  console.log('═══════════════════════════════════════════════\n');

  const data = JSON.parse(readFileSync(BARVY_PATH, 'utf-8'));
  info(`Načteno ${Object.keys(data.models).length} modelů z _barvy.json\n`);

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  // 1) Zajistit že interior_options field existuje
  console.log('Krok 1: Schema');
  await ensureInteriorOptionsField();
  console.log('');

  // 2) Pro každý model najít nejnovější model_year a updatovat
  console.log('Krok 2: Seed barev per model');
  let updated = 0, skipped = 0;
  for (const [slug, colors] of Object.entries(data.models)) {
    const model = await findModelBySlug(slug);
    if (!model) {
      warn(`${slug}: model neexistuje, skipuji`);
      skipped++;
      continue;
    }
    const my = await findLatestModelYear(model.id);
    if (!my) {
      warn(`${slug}: žádný model_year, skipuji`);
      skipped++;
      continue;
    }

    const colorOptions = (colors.exterior_colors ?? []).map(transformExterior);
    const interiorOptions = (colors.interior_colors ?? []).map(transformInterior);

    try {
      await api('PATCH', `/items/model_years/${my.id}`, {
        color_options: colorOptions,
        interior_options: interiorOptions,
      });
      ok(`${slug} (year ${my.year}): ${colorOptions.length} karoserie + ${interiorOptions.length} interiér`);
      updated++;
    } catch (e) {
      warn(`${slug}: ${e.message}`);
    }
  }

  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log(`  Hotovo. Updated: ${updated}, Skipped: ${skipped}`);
  console.log('═══════════════════════════════════════════════\n');
  console.log('Webhook spustí Vercel rebuild ~30 s.');
  console.log('Pak otevři /model/torres-evx a uvidíš barvy v konfigurátoru.');
  rl.close();
}

main().catch((e) => {
  console.error(`✗ ${e.message}`);
  rl.close();
  process.exit(1);
});
