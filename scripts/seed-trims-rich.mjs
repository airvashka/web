#!/usr/bin/env node
/**
 * SFR Motor — Rich seed trim levels features z parsed ceník PDF
 *
 * Načte _ceniky-clean.json (vytvořeno parserem z PDF ceníků) a aktualizuje
 * features pole každého trim levelu — 60-150 položek per trim, místo původních 5-8.
 *
 * lib/features.ts pak na webu auto-kategorizuje features po sekcích
 * (asistent / bezpečnost / komfort / exteriér / interiér / infotainment / pohon).
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = JSON.parse(readFileSync(join(__dirname, '_ceniky-clean.json'), 'utf-8'));

const rl = readline.createInterface({ input, output });
const prompt = (q) => rl.question(q);

let DIRECTUS_URL = '', TOKEN = '';
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${DIRECTUS_URL}${path}`, opts);
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(j?.errors ?? j)}`);
  return j;
}

const ok = (m) => console.log(`✅  ${m}`);
const warn = (m) => console.log(`⚠️   ${m}`);
const info = (m) => console.log(`ℹ️   ${m}`);

async function findModelBySlug(slug) {
  const r = await api('GET', `/items/models?filter[slug][_eq]=${encodeURIComponent(slug)}&limit=1`);
  return r?.data?.[0] ?? null;
}

async function findModelYearByModelId(modelId) {
  const r = await api('GET', `/items/model_years?filter[model][_eq]=${modelId}&limit=1&sort=-year`);
  return r?.data?.[0] ?? null;
}

async function findTrim(modelYearId, slug) {
  const r = await api('GET', `/items/trim_levels?filter[model_year][_eq]=${modelYearId}&filter[slug][_eq]=${encodeURIComponent(slug)}&limit=1`);
  return r?.data?.[0] ?? null;
}

async function findPackage(modelYearId, slug) {
  const r = await api('GET', `/items/option_packages?filter[model_year][_eq]=${modelYearId}&filter[slug][_eq]=${encodeURIComponent(slug)}&limit=1`);
  return r?.data?.[0] ?? null;
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  SFR Motor — Rich seed trim level features');
  console.log('═══════════════════════════════════════════════\n');

  DIRECTUS_URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim() || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  let updatedTrims = 0, skippedTrims = 0, updatedPkgs = 0;

  // ---------- TRIM LEVELS ----------
  info('Aktualizuju trim levels...');
  for (const [modelSlug, trims] of Object.entries(DATA.trims)) {
    const model = await findModelBySlug(modelSlug);
    if (!model) { warn(`  Model ${modelSlug} neexistuje`); continue; }
    const my = await findModelYearByModelId(model.id);
    if (!my) { warn(`  ModelYear pro ${modelSlug} neexistuje`); continue; }

    for (const [trimSlug, features] of Object.entries(trims)) {
      const trim = await findTrim(my.id, trimSlug);
      if (!trim) {
        warn(`  ${modelSlug}/${trimSlug}: trim level neexistuje, skipuji`);
        skippedTrims++;
        continue;
      }
      try {
        await api('PATCH', `/items/trim_levels/${trim.id}`, {
          features,
        });
        ok(`  ${modelSlug}/${trimSlug}: ${features.length} features`);
        updatedTrims++;
      } catch (e) {
        warn(`  ${modelSlug}/${trimSlug}: ${e.message}`);
      }
    }
  }
  console.log('');

  // ---------- OPTION PACKAGES ----------
  // Parsed package features jsou tenké (1-8). Pokud máme víc, zlepšíme později.
  // Předtím zachováme existující features z seed-packages.mjs (manuálně typované).
  info('Option packages (necháváme existující features z seed-packages.mjs)...');
  info('  Parsed package features z PDF jsou tenké (1-8 items) — pravděpodobně méně dat než ručně typované.');
  info('  Pokud chceš přepsat, edituj packages přímo v adminu nebo požádej o dalsi skript.\n');

  console.log('═══════════════════════════════════════════════');
  console.log(`  Hotovo. Trimy: ${updatedTrims} aktualizováno, ${skippedTrims} skipnuto.`);
  console.log('═══════════════════════════════════════════════\n');
  console.log('Webhook spustí Vercel rebuild ~30 s.');
  console.log('Pak otevři /model/{slug} nebo /sklad/{id} a uvidíš grouped features po sekcích');
  console.log('(auto-kategorizace přes lib/features.ts).');
  rl.close();
}
main().catch(e => { console.log(`❌ ${e.message}`); rl.close(); });
