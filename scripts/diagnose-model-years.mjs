#!/usr/bin/env node
/**
 * SFR Motor — diagnostika model_years + trim_levels + option_packages.
 *
 * Co skript dělá:
 *   1) Vypíše VŠECHNY model_years (model + rok + version + id)
 *   2) Pro každý ukáže počet a názvy trim_levels + option_packages
 *   3) Najde sirotky (trim/paket bez model_year)
 *
 * BEZPEČNÉ — pouze GET, nic nemění/nemaže.
 *
 * Použití:
 *   cd web && node scripts/diagnose-model-years.mjs
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

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Diagnostika model_years + trims + packages');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  console.log('  ✓ Auth OK\n');

  // 1) Všechny model_years
  const years = await api('GET', '/items/model_years?limit=500&fields=id,year,version,model.name&sort=model.name,year,version');
  console.log(`Nalezeno ${years.data.length} model_years:\n`);

  // 2) Všechny trims + packages (jednou, pak group v JS)
  const allTrims = await api('GET', '/items/trim_levels?limit=1000&fields=id,name,model_year');
  const allPkgs = await api('GET', '/items/option_packages?limit=1000&fields=id,name,model_year');

  const trimsByYear = new Map();
  for (const t of allTrims.data) {
    const k = t.model_year ?? '__orphan__';
    if (!trimsByYear.has(k)) trimsByYear.set(k, []);
    trimsByYear.get(k).push(t);
  }
  const pkgsByYear = new Map();
  for (const p of allPkgs.data) {
    const k = p.model_year ?? '__orphan__';
    if (!pkgsByYear.has(k)) pkgsByYear.set(k, []);
    pkgsByYear.get(k).push(p);
  }

  // Vypiš pro každý model_year
  for (const y of years.data) {
    const label = `${y.model?.name ?? '?'} ${y.year}${y.version ? ' ' + y.version : ''}`;
    const trims = trimsByYear.get(y.id) ?? [];
    const pkgs = pkgsByYear.get(y.id) ?? [];
    console.log(`📋 ${label}`);
    console.log(`   id:      ${y.id}`);
    console.log(`   created: ${y.date_created ?? '?'}`);
    console.log(`   trims (${trims.length}):    ${trims.length === 0 ? '— ŽÁDNÉ —' : trims.map(t => t.name).join(', ')}`);
    console.log(`   packages (${pkgs.length}): ${pkgs.length === 0 ? '— ŽÁDNÉ —' : pkgs.map(p => p.name).join(', ')}`);
    console.log('');
  }

  // 3) Sirotci
  const orphanTrims = trimsByYear.get('__orphan__') ?? [];
  const orphanPkgs = pkgsByYear.get('__orphan__') ?? [];
  if (orphanTrims.length || orphanPkgs.length) {
    console.log('⚠  SIROTCI (bez model_year):');
    if (orphanTrims.length) console.log(`   trims:    ${orphanTrims.map(t => `"${t.name}" (id=${t.id})`).join(', ')}`);
    if (orphanPkgs.length) console.log(`   packages: ${orphanPkgs.map(p => `"${p.name}" (id=${p.id})`).join(', ')}`);
  } else {
    console.log('✓ Žádní sirotci.');
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Diagnostika dokončena. Nic se nezměnilo.');
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
