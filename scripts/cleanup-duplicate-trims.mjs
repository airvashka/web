#!/usr/bin/env node
/**
 * SFR Motor — cleanup duplicate trim_levels + option_packages v rámci jednoho model_year.
 *
 * Use case:
 *   Po `duplicate-model-year.mjs` se ti omylem trim/paket vytvořil 2× (např. Style,
 *   Style+, Elegant, Premium se objeví v Korando 2025 dvakrát). Tento skript najde
 *   duplikáty podle `name` a smaže ty novější (vyšší id / pozdější date_created),
 *   zachová original.
 *
 * Co skript dělá:
 *   1) Vypíše model_years (vybereš ten s duplikáty)
 *   2) Načte všechny trim_levels + option_packages v něm
 *   3) Najde duplikáty podle (name) — case-insensitive trim
 *   4) Zobrazí dry-run preview: co smaže, co nechá
 *   5) Po potvrzení smaže duplikáty (POST DELETE)
 *
 * BEZPEČNOST:
 *   - Skript MAŽE záznamy → vždy ti ukáže preview a počká na "yes"
 *   - Maže jen DUPLIKÁTY (záznamy se stejným name), nikdy unikátní
 *   - Zachová záznam s nejnižším id (= nejstarší = původní)
 *
 * Použití:
 *   cd web && node scripts/cleanup-duplicate-trims.mjs
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

function groupDuplicatesByName(items) {
  const byKey = new Map();
  for (const it of items) {
    const key = (it.name ?? '').trim().toLowerCase();
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(it);
  }
  // Vrátí jen ty, kde je víc než 1 záznam
  const dupes = [];
  for (const [key, list] of byKey) {
    if (list.length > 1) {
      // Seřaď podle id (nejnižší = nejstarší = keep)
      // Pokud je id integer, porovnej numericky; jinak string compare
      list.sort((a, b) => {
        const ai = Number(a.id), bi = Number(b.id);
        if (Number.isFinite(ai) && Number.isFinite(bi)) return ai - bi;
        return String(a.id).localeCompare(String(b.id));
      });
      dupes.push({ name: list[0].name, keep: list[0], remove: list.slice(1) });
    }
  }
  return dupes;
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Cleanup duplicate trim_levels + option_packages');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  // 1) List model_years
  console.log('Krok 1: Vyber model_year, ve kterém chceš čistit duplikáty\n');
  const years = await api('GET', '/items/model_years?limit=200&fields=id,year,version,model.id,model.name&sort=model.name,year');
  const list = years.data.map((y, i) => ({
    index: i + 1,
    id: y.id,
    modelName: y.model?.name ?? '?',
    year: y.year,
    version: y.version ?? '',
    label: `${y.model?.name ?? '?'} ${y.year}${y.version ? ' ' + y.version : ''}`,
  }));
  list.forEach((y) => console.log(`  ${String(y.index).padStart(2)})  ${y.label}`));

  console.log('');
  const idxStr = (await prompt('Vyber model_year [číslo ze seznamu]: ')).trim();
  const idx = parseInt(idxStr, 10);
  if (isNaN(idx) || idx < 1 || idx > list.length) {
    console.log('Neplatná volba.');
    rl.close();
    return;
  }
  const target = list[idx - 1];
  console.log(`\n  ✓  Cíl: ${target.label} (id=${target.id})\n`);

  // 2) Načti všechny trim_levels + option_packages
  console.log('Krok 2: Načítání trim_levels + option_packages...\n');
  const trims = await api('GET', `/items/trim_levels?filter[model_year][_eq]=${target.id}&limit=200&fields=id,name`);
  const packages = await api('GET', `/items/option_packages?filter[model_year][_eq]=${target.id}&limit=200&fields=id,name`);

  console.log(`  trim_levels:    ${trims.data.length}`);
  console.log(`  option_packages: ${packages.data.length}\n`);

  // 3) Najdi duplikáty
  const trimDupes = groupDuplicatesByName(trims.data);
  const pkgDupes = groupDuplicatesByName(packages.data);

  if (trimDupes.length === 0 && pkgDupes.length === 0) {
    console.log('  ✓  Žádné duplikáty nenalezeny — vše je v pořádku.');
    rl.close();
    return;
  }

  // 4) Preview
  console.log('Krok 3: Nalezené duplikáty (preview)\n');

  let totalRemove = 0;

  if (trimDupes.length > 0) {
    console.log('  TRIM LEVELS:');
    for (const d of trimDupes) {
      console.log(`    "${d.name}"`);
      console.log(`      ✓ keep:   id=${d.keep.id} (nejstarší)`);
      for (const r of d.remove) {
        console.log(`      ✗ delete: id=${r.id}`);
        totalRemove++;
      }
    }
    console.log('');
  }

  if (pkgDupes.length > 0) {
    console.log('  OPTION PACKAGES:');
    for (const d of pkgDupes) {
      console.log(`    "${d.name}"`);
      console.log(`      ✓ keep:   id=${d.keep.id} (nejstarší)`);
      for (const r of d.remove) {
        console.log(`      ✗ delete: id=${r.id}`);
        totalRemove++;
      }
    }
    console.log('');
  }

  console.log(`  Celkem k mazání: ${totalRemove} záznamů\n`);

  // 5) Confirm
  const confirm = (await prompt(`Pokračovat se smazáním ${totalRemove} duplikátů? [yes/no]: `)).trim().toLowerCase();
  if (confirm !== 'yes' && confirm !== 'y') {
    console.log('Aborted. Nic se nesmazalo.');
    rl.close();
    return;
  }

  // 6) Delete
  console.log('\nKrok 4: Mazání duplikátů...\n');
  let deletedTrims = 0, deletedPackages = 0;

  for (const d of trimDupes) {
    for (const r of d.remove) {
      try {
        await api('DELETE', `/items/trim_levels/${r.id}`);
        info(`trim "${d.name}" id=${r.id} smazán`);
        deletedTrims++;
      } catch (e) {
        warn(`Selhalo mazání trim id=${r.id}: ${e.message}`);
      }
    }
  }

  for (const d of pkgDupes) {
    for (const r of d.remove) {
      try {
        await api('DELETE', `/items/option_packages/${r.id}`);
        info(`paket "${d.name}" id=${r.id} smazán`);
        deletedPackages++;
      } catch (e) {
        warn(`Selhalo mazání paket id=${r.id}: ${e.message}`);
      }
    }
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log(`  ✓ Hotovo!`);
  console.log(`  Smazáno: ${deletedTrims} trim_levels, ${deletedPackages} option_packages`);
  console.log(`  Zachováno: ${trims.data.length - deletedTrims} trim_levels, ${packages.data.length - deletedPackages} option_packages`);
  console.log('═══════════════════════════════════════════════');
  console.log('');
  console.log('V adminu: refresh stránky (Ctrl+Shift+R) → uvidíš čistý seznam.');

  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
