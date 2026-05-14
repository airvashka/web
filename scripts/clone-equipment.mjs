#!/usr/bin/env node
/**
 * SFR Motor — klon trim_levels + option_packages mezi DVĚMA existujícími model_years.
 *
 * Use case:
 *   Mám Korando 2025 s 4 trimy + 4 pakety. Mám Korando 2026 (prázdné, ale s tech data).
 *   Chci do 2026 nakopírovat trimy + pakety z 2025 — beze změny ostatních polí (year,
 *   version, technical_data, brochure_pdf, ...).
 *
 *   NEBO: vytvořím ručně v adminu Korando 2024 (just year + model) a doplním
 *   trimy + pakety z 2025 pomocí tohoto skriptu.
 *
 * Co skript dělá:
 *   1) Vypíše model_years, vybereš SOURCE (např. Korando 2025)
 *   2) Vypíše model_years znovu, vybereš TARGET (např. Korando 2026)
 *   3) Načte trimy + pakety zdroje
 *   4) Před klonováním upozorní, pokud target už nějaké trimy/pakety obsahuje
 *   5) Klonuje POST → nové záznamy s `model_year=target.id`
 *
 * BEZPEČNOST:
 *   - Nikdy NEMAŽE záznamy v targetu (jen přidává nové)
 *   - Pokud target už má trim se stejným name, SKIP (aby nevznikaly duplikáty)
 *   - Vyžaduje potvrzení "yes" před každým během
 *
 * Použití:
 *   cd web && node scripts/clone-equipment.mjs
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
const warn = (m) => console.log(`  ⚠  ${m}`);

const SKIP_FIELDS = ['id', 'date_created', 'date_updated', 'user_created', 'user_updated', 'sort'];

function stripFields(obj) {
  const clean = { ...obj };
  for (const f of SKIP_FIELDS) delete clean[f];
  return clean;
}

async function pickYear(list, label) {
  console.log(`\n${label}:\n`);
  list.forEach((y) => console.log(`  ${String(y.index).padStart(2)})  ${y.label}`));
  console.log('');
  const idxStr = (await prompt(`Vyber [číslo ze seznamu]: `)).trim();
  const idx = parseInt(idxStr, 10);
  if (isNaN(idx) || idx < 1 || idx > list.length) return null;
  return list[idx - 1];
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Clone trims + packages mezi model_years');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK');

  // Načti všechny model_years jednou
  const years = await api('GET', '/items/model_years?limit=200&fields=id,year,version,model.name&sort=model.name,year');
  const list = years.data.map((y, i) => ({
    index: i + 1,
    id: y.id,
    modelName: y.model?.name ?? '?',
    year: y.year,
    label: `${y.model?.name ?? '?'} ${y.year}${y.version ? ' ' + y.version : ''}`,
  }));

  const src = await pickYear(list, 'SOURCE — ze kterého kopíruješ');
  if (!src) { console.log('Neplatná volba.'); rl.close(); return; }
  console.log(`  ✓  Source: ${src.label} (id=${src.id})`);

  const tgt = await pickYear(list, 'TARGET — do kterého kopíruješ');
  if (!tgt) { console.log('Neplatná volba.'); rl.close(); return; }
  if (tgt.id === src.id) {
    console.log('  ✗  Target = Source — to nejde, vyber jiný.');
    rl.close();
    return;
  }
  console.log(`  ✓  Target: ${tgt.label} (id=${tgt.id})`);

  // Načti zdrojové trims + packages
  console.log('\nNačítání zdrojových dat...');
  const srcTrims = await api('GET', `/items/trim_levels?filter[model_year][_eq]=${src.id}&limit=200&fields=*`);
  const srcPackages = await api('GET', `/items/option_packages?filter[model_year][_eq]=${src.id}&limit=200&fields=*`);

  // Načti target trims + packages (pro skip duplicate names)
  const tgtTrims = await api('GET', `/items/trim_levels?filter[model_year][_eq]=${tgt.id}&limit=200&fields=id,name`);
  const tgtPackages = await api('GET', `/items/option_packages?filter[model_year][_eq]=${tgt.id}&limit=200&fields=id,name`);

  const tgtTrimNames = new Set((tgtTrims.data ?? []).map((t) => (t.name ?? '').trim().toLowerCase()));
  const tgtPkgNames = new Set((tgtPackages.data ?? []).map((p) => (p.name ?? '').trim().toLowerCase()));

  console.log(`\n  Source ${src.label}:`);
  console.log(`    trim_levels:     ${srcTrims.data.length} (${srcTrims.data.map(t => t.name).join(', ')})`);
  console.log(`    option_packages: ${srcPackages.data.length} (${srcPackages.data.map(p => p.name).join(', ')})`);
  console.log(`\n  Target ${tgt.label} (aktuální stav):`);
  console.log(`    trim_levels:     ${tgtTrims.data.length}${tgtTrims.data.length ? ' (' + tgtTrims.data.map(t => t.name).join(', ') + ')' : ''}`);
  console.log(`    option_packages: ${tgtPackages.data.length}${tgtPackages.data.length ? ' (' + tgtPackages.data.map(p => p.name).join(', ') + ')' : ''}`);

  // Plán — co se zkopíruje, co se přeskočí
  const trimsToClone = srcTrims.data.filter((t) => !tgtTrimNames.has((t.name ?? '').trim().toLowerCase()));
  const trimsToSkip = srcTrims.data.filter((t) => tgtTrimNames.has((t.name ?? '').trim().toLowerCase()));
  const pkgsToClone = srcPackages.data.filter((p) => !tgtPkgNames.has((p.name ?? '').trim().toLowerCase()));
  const pkgsToSkip = srcPackages.data.filter((p) => tgtPkgNames.has((p.name ?? '').trim().toLowerCase()));

  console.log(`\n  Plán:`);
  console.log(`    Zkopírovat trim_levels:    ${trimsToClone.length}${trimsToClone.length ? ' (' + trimsToClone.map(t => t.name).join(', ') + ')' : ''}`);
  if (trimsToSkip.length) console.log(`    SKIP (už existují):        ${trimsToSkip.length} (${trimsToSkip.map(t => t.name).join(', ')})`);
  console.log(`    Zkopírovat option_packages: ${pkgsToClone.length}${pkgsToClone.length ? ' (' + pkgsToClone.map(p => p.name).join(', ') + ')' : ''}`);
  if (pkgsToSkip.length) console.log(`    SKIP (už existují):         ${pkgsToSkip.length} (${pkgsToSkip.map(p => p.name).join(', ')})`);

  if (trimsToClone.length === 0 && pkgsToClone.length === 0) {
    console.log('\n  ✓  Nic ke klonování — target už má vše. Hotovo.');
    rl.close();
    return;
  }

  const confirm = (await prompt(`\nPokračovat? [yes/no]: `)).trim().toLowerCase();
  if (confirm !== 'yes' && confirm !== 'y') {
    console.log('Aborted.');
    rl.close();
    return;
  }

  // Clone
  console.log('\nKlonování...');
  let clonedTrims = 0, clonedPackages = 0;

  for (const trim of trimsToClone) {
    const payload = stripFields(trim);
    payload.model_year = tgt.id;
    try {
      await api('POST', '/items/trim_levels', payload);
      info(`trim "${trim.name}" → ${tgt.label}`);
      clonedTrims++;
    } catch (e) {
      warn(`Selhalo klonování trim "${trim.name}": ${e.message}`);
    }
  }

  for (const pkg of pkgsToClone) {
    const payload = stripFields(pkg);
    payload.model_year = tgt.id;
    try {
      await api('POST', '/items/option_packages', payload);
      info(`paket "${pkg.name}" → ${tgt.label}`);
      clonedPackages++;
    } catch (e) {
      warn(`Selhalo klonování paket "${pkg.name}": ${e.message}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log(`  ✓ Hotovo!`);
  console.log(`  Zkopírováno: ${clonedTrims} trim_levels, ${clonedPackages} option_packages`);
  console.log(`  Source ${src.label} zůstal beze změny.`);
  console.log(`  Target ${tgt.label} má teď trimy + pakety.`);
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
