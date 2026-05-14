#!/usr/bin/env node
/**
 * SFR Motor — recovery po bugu v duplicate-model-year.mjs.
 *
 * Bug způsobil že trim_levels + option_packages se PŘESUNULY ze zdroje do
 * cíle a navíc se vytvořily ČERSTVÉ kopie. Výsledek: cíl má 2× (originály
 * + klony), zdroj má 0.
 *
 * Co recovery dělá:
 *   1) Vybereš TARGET (kde jsou teď duplikáty, např. Korando 2024)
 *   2) Vybereš SOURCE (kam mají originály patřit zpátky, např. Korando 2025)
 *   3) V TARGETu najde páry duplikátů podle name
 *   4) U každého páru: starší (nižší ID) → přesune do SOURCE
 *                      novější (vyšší ID) → zůstane v TARGET
 *   5) Stejně pro option_packages
 *
 * Výsledek:
 *   - SOURCE: 4 originálních trimů + 4 originálních paketů (vráceno)
 *   - TARGET: 4 nově vzniklých klonů
 *
 * BEZPEČNOST:
 *   - Pouze PATCH operace (mění model_year FK), žádné DELETE
 *   - Vyžaduje potvrzení "yes"
 *
 * Použití:
 *   cd web && node scripts/recover-bad-clone.mjs
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

async function pickYear(list, label) {
  console.log(`\n${label}:\n`);
  list.forEach((y) => console.log(`  ${String(y.index).padStart(2)})  ${y.label}`));
  console.log('');
  const idxStr = (await prompt(`Vyber [číslo]: `)).trim();
  const idx = parseInt(idxStr, 10);
  if (isNaN(idx) || idx < 1 || idx > list.length) return null;
  return list[idx - 1];
}

function findDuplicatePairs(items) {
  const byKey = new Map();
  for (const it of items) {
    const key = (it.name ?? '').trim().toLowerCase();
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(it);
  }
  const pairs = [];
  for (const [, list] of byKey) {
    if (list.length >= 2) {
      list.sort((a, b) => {
        const ai = Number(a.id), bi = Number(b.id);
        if (Number.isFinite(ai) && Number.isFinite(bi)) return ai - bi;
        return String(a.id).localeCompare(String(b.id));
      });
      // Starší (nižší ID) → move; vše ostatní → keep v target
      pairs.push({ name: list[0].name, moveBack: list[0], keepInTarget: list.slice(1) });
    }
  }
  return pairs;
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Recovery po bad-clone: vrátit originály');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK');

  const years = await api('GET', '/items/model_years?limit=200&fields=id,year,version,model.name&sort=model.name,year');
  const list = years.data.map((y, i) => ({
    index: i + 1,
    id: y.id,
    label: `${y.model?.name ?? '?'} ${y.year}${y.version ? ' ' + y.version : ''}`,
  }));

  const target = await pickYear(list, 'TARGET — kde jsou teď duplikáty (např. Korando 2024)');
  if (!target) { console.log('Neplatná volba.'); rl.close(); return; }
  console.log(`  ✓  Target: ${target.label} (id=${target.id})`);

  const source = await pickYear(list, 'SOURCE — kam originály patřily (např. Korando 2025)');
  if (!source) { console.log('Neplatná volba.'); rl.close(); return; }
  if (source.id === target.id) {
    console.log('  ✗  Source = Target — to nejde.');
    rl.close();
    return;
  }
  console.log(`  ✓  Source: ${source.label} (id=${source.id})`);

  // Načti trims + packages v targetu
  console.log('\nNačítání...');
  const trims = await api('GET', `/items/trim_levels?filter[model_year][_eq]=${target.id}&limit=500&fields=id,name`);
  const packages = await api('GET', `/items/option_packages?filter[model_year][_eq]=${target.id}&limit=500&fields=id,name`);

  const trimPairs = findDuplicatePairs(trims.data);
  const pkgPairs = findDuplicatePairs(packages.data);

  if (trimPairs.length === 0 && pkgPairs.length === 0) {
    console.log('\n  ✓  Žádné duplikáty v target. Nic k recovery.');
    rl.close();
    return;
  }

  console.log(`\nPlán (vždy: nižší ID = original → ${source.label}, vyšší ID = klon → zůstává v ${target.label}):\n`);

  let totalMove = 0;

  if (trimPairs.length > 0) {
    console.log('  TRIM LEVELS:');
    for (const p of trimPairs) {
      console.log(`    "${p.name}":`);
      console.log(`      → MOVE id=${p.moveBack.id}  do ${source.label}`);
      for (const k of p.keepInTarget) {
        console.log(`      ✓ KEEP id=${k.id}     v ${target.label}`);
      }
      totalMove++;
    }
    console.log('');
  }

  if (pkgPairs.length > 0) {
    console.log('  OPTION PACKAGES:');
    for (const p of pkgPairs) {
      console.log(`    "${p.name}":`);
      console.log(`      → MOVE id=${p.moveBack.id}  do ${source.label}`);
      for (const k of p.keepInTarget) {
        console.log(`      ✓ KEEP id=${k.id}     v ${target.label}`);
      }
      totalMove++;
    }
    console.log('');
  }

  console.log(`  Celkem PATCH (model_year FK update): ${totalMove}\n`);

  const confirm = (await prompt('Pokračovat? [yes/no]: ')).trim().toLowerCase();
  if (confirm !== 'yes' && confirm !== 'y') {
    console.log('Aborted.');
    rl.close();
    return;
  }

  // Execute
  console.log('\nProvádím PATCH...');
  let movedTrims = 0, movedPackages = 0;

  for (const p of trimPairs) {
    try {
      await api('PATCH', `/items/trim_levels/${p.moveBack.id}`, { model_year: source.id });
      info(`trim "${p.name}" id=${p.moveBack.id} → ${source.label}`);
      movedTrims++;
    } catch (e) {
      warn(`Selhalo move trim id=${p.moveBack.id}: ${e.message}`);
    }
  }

  for (const p of pkgPairs) {
    try {
      await api('PATCH', `/items/option_packages/${p.moveBack.id}`, { model_year: source.id });
      info(`paket "${p.name}" id=${p.moveBack.id} → ${source.label}`);
      movedPackages++;
    } catch (e) {
      warn(`Selhalo move paket id=${p.moveBack.id}: ${e.message}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log(`  ✓ Hotovo!`);
  console.log(`  Přesunuto: ${movedTrims} trim_levels, ${movedPackages} option_packages`);
  console.log(`  ${source.label}: má originály zpět`);
  console.log(`  ${target.label}: má jen nově vzniklé klony`);
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
