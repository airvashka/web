#!/usr/bin/env node
/**
 * SFR Motor — seed contentu z brožur.
 *
 * Načte `_data/brozury-extracted/_seed-content.json` a:
 *   1) Vytvoří v Directusu pole `models.highlights` (JSON list, 4 položky per model)
 *   2) Per model PATCH: tagline, description, highlights
 *   3) Per model_year (nejnovější) PATCH: technical_data, warranty (volitelně do brand)
 *
 * NEPŘEPISUJE fotky — to dělá samostatný skript seed-brochure-photos.mjs.
 *
 * Použití:
 *   cd web && node scripts/seed-brochure-content.mjs
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = join(__dirname, '..', '..', '_data', 'brozury-extracted', '_seed-content.json');

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

async function ensureHighlightsField() {
  if (await fieldExists('models', 'highlights')) {
    info('models.highlights field už existuje');
    return;
  }
  await api('POST', '/fields/models', {
    field: 'highlights',
    type: 'json',
    schema: { is_nullable: true },
    meta: {
      interface: 'list',
      special: ['cast-json'],
      note: '4 tech karty pro model detail: [{title, subtitle, photo}]',
      options: {
        template: '{{title}}',
        fields: [
          { field: 'title', type: 'string', name: 'Titul', meta: { interface: 'input', width: 'half' } },
          { field: 'subtitle', type: 'string', name: 'Popis', meta: { interface: 'input', width: 'half' } },
          { field: 'photo', type: 'string', name: 'Foto filename (img-pXXX-YY.jpg)', meta: { interface: 'input', width: 'full', note: 'Zatím jen referenční filename, později M2O na directus_files.' } },
        ],
      },
      width: 'full',
    },
  });
  ok('models.highlights field vytvořen');
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
  console.log('  SFR Motor — Seed contentu z brožur');
  console.log('═══════════════════════════════════════════════\n');

  const data = JSON.parse(readFileSync(SEED_PATH, 'utf-8'));
  info(`Načteno ${Object.keys(data.models).length} modelů z _seed-content.json\n`);

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  // 1) Schema
  console.log('Krok 1: Schema');
  await ensureHighlightsField();
  console.log('');

  // 2) Seed
  console.log('Krok 2: Seed per model');
  let updatedModels = 0, updatedYears = 0, skipped = 0;
  for (const [slug, content] of Object.entries(data.models)) {
    const model = await findModelBySlug(slug);
    if (!model) {
      warn(`${slug}: model neexistuje, skipuji`);
      skipped++;
      continue;
    }

    // Update model
    const modelPatch = {};
    if (content.tagline) modelPatch.tagline = content.tagline;
    if (content.description) modelPatch.description = content.description;
    if (Array.isArray(content.highlights)) modelPatch.highlights = content.highlights;

    try {
      await api('PATCH', `/items/models/${model.id}`, modelPatch);
      ok(`${slug}: model PATCH — tagline + description (${content.description?.length ?? 0} chars) + ${content.highlights?.length ?? 0} highlights`);
      updatedModels++;
    } catch (e) {
      warn(`${slug}: model PATCH selhal — ${e.message}`);
    }

    // Update model_year (latest)
    const my = await findLatestModelYear(model.id);
    if (my && content.technical_data && Object.keys(content.technical_data).length > 0) {
      try {
        await api('PATCH', `/items/model_years/${my.id}`, {
          technical_data: content.technical_data,
        });
        ok(`  └ model_year ${my.year}: technical_data (${Object.keys(content.technical_data).length} keys)`);
        updatedYears++;
      } catch (e) {
        warn(`  └ model_year PATCH selhal — ${e.message}`);
      }
    }
  }
  console.log('');

  console.log('═══════════════════════════════════════════════');
  console.log(`  Hotovo. Modelů: ${updatedModels}/10, ModelYears: ${updatedYears}/10, Skipped: ${skipped}`);
  console.log('═══════════════════════════════════════════════\n');
  console.log('Webhook spustí Vercel rebuild ~30 s.');
  console.log('Pak otevři /model/torres-evx a uvidíš:');
  console.log('  • Plnou description v sekci Představení');
  console.log('  • 4 tech karty v sekci Technologie');
  console.log('  • Technické údaje v dolní tabulce');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
