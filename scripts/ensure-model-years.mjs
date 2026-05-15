#!/usr/bin/env node
/**
 * SFR Motor — zajisti že každý model má model_years 2024, 2025, 2026.
 *
 * Co skript dělá pro KAŽDÝ model:
 *   1) Najde existující model_years.
 *   2) Identifikuje "master" rok = ten s nejvíc trimy (nejvíc dat).
 *      Pokud žádný rok nemá trimy, master = nejnovější existující.
 *   3) Pro každý chybějící rok v [2024, 2025, 2026]:
 *      - CREATE nový model_year (clone fields z masteru, kromě year + status + aliasů)
 *      - Clone trims a packages z masteru do něj
 *   4) Pro existující rok, který je PRÁZDNÝ (0 trimů) a master MÁ trimy:
 *      - Clone trims + packages z masteru do něj
 *   5) Existující rok s vlastními trimy = neměnit (mohly být ručně upravené)
 *   6) Status: 2026 = published, 2024/2025 = archived
 *
 * BEZPEČNOST:
 *   - Idempotentní: opakované spuštění nezmění hotový stav
 *   - Dynamicky detekuje O2M aliasy a vyhodí je z payloadu (bug fix z duplicate-model-year.mjs)
 *   - Před actions vyžaduje "yes" potvrzení
 *   - Dry-run flag pro preview
 *
 * CLI:
 *   cd web && node scripts/ensure-model-years.mjs --dry-run     # jen preview, nic neměnit
 *   cd web && node scripts/ensure-model-years.mjs              # ostrý běh (vyžaduje yes)
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

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

// ─── Dynamic alias detection ──────────────────────────────
const STATIC_SKIP = ['id', 'date_created', 'date_updated', 'user_created', 'user_updated', 'sort'];
let MODEL_YEARS_ALIASES = new Set();

async function loadAliasFields(collection) {
  const r = await api('GET', `/fields/${collection}`);
  const aliases = new Set();
  for (const f of (r.data ?? [])) {
    const isAlias = f.type === 'alias';
    const specials = f.meta?.special ?? [];
    const hasAliasSpecial = specials.some((s) => ['o2m', 'm2m', 'm2a', 'no-data', 'alias'].includes(s));
    if (isAlias || hasAliasSpecial) aliases.add(f.field);
  }
  return aliases;
}

function stripFields(obj, aliases) {
  const clean = { ...obj };
  for (const f of STATIC_SKIP) delete clean[f];
  for (const f of aliases) delete clean[f];
  return clean;
}

// ─── Year status policy ───────────────────────────────────
const TARGET_YEARS = [2024, 2025, 2026];
function statusForYear(year) {
  if (year === 2026) return 'published';
  return 'archived';
}

// ─── Main per-model logic ─────────────────────────────────
async function processModel(model, stats) {
  console.log(`\n▶ ${model.name} (id=${model.id})`);

  // Existující model_years tohoto modelu
  const yearsResp = await api('GET', `/items/model_years?filter[model][_eq]=${model.id}&limit=20&fields=*&sort=year`);
  const existingYears = yearsResp.data ?? [];

  // Get trims+packages count per year
  const yearStats = await Promise.all(existingYears.map(async (y) => {
    const t = await api('GET', `/items/trim_levels?filter[model_year][_eq]=${y.id}&limit=200&fields=id,name`);
    const p = await api('GET', `/items/option_packages?filter[model_year][_eq]=${y.id}&limit=200&fields=id,name`);
    return { year: y, trimCount: t.data?.length ?? 0, pkgCount: p.data?.length ?? 0, trims: t.data, packages: p.data };
  }));

  yearStats.forEach((ys) => info(`Existující: ${ys.year.year}${ys.year.version ? ' ' + ys.year.version : ''} (id=${ys.year.id}) — ${ys.trimCount} trims, ${ys.pkgCount} packages`));

  // Identify master = year with most trims (tie-break: latest year)
  const master = yearStats.length === 0 ? null : [...yearStats]
    .sort((a, b) => b.trimCount - a.trimCount || b.year.year - a.year.year)[0];

  if (!master) {
    warn(`Žádný model_year — model "${model.name}" je úplně prázdný. SKIP (potřebuje ručně 1 source year).`);
    stats.skipped_empty++;
    return;
  }

  console.log(`  Master year: ${master.year.year}${master.year.version ? ' ' + master.year.version : ''} (${master.trimCount} trims, ${master.pkgCount} packages)`);

  // Load full master year data
  const masterFullResp = await api('GET', `/items/model_years/${master.year.id}?fields=*`);
  const masterFull = masterFullResp.data;
  const masterTrimsResp = await api('GET', `/items/trim_levels?filter[model_year][_eq]=${master.year.id}&limit=200&fields=*`);
  const masterTrims = masterTrimsResp.data ?? [];
  const masterPackagesResp = await api('GET', `/items/option_packages?filter[model_year][_eq]=${master.year.id}&limit=200&fields=*`);
  const masterPackages = masterPackagesResp.data ?? [];

  // Load aliases for trim_levels and option_packages too
  const trimAliases = await loadAliasFields('trim_levels').catch(() => new Set());
  const pkgAliases = await loadAliasFields('option_packages').catch(() => new Set());

  // For each target year, ensure exists
  for (const targetYear of TARGET_YEARS) {
    const existing = yearStats.find((ys) => ys.year.year === targetYear && !ys.year.version);
    const targetStatus = statusForYear(targetYear);

    if (!existing) {
      // Create new model_year
      const payload = stripFields(masterFull, MODEL_YEARS_ALIASES);
      payload.year = targetYear;
      payload.status = targetStatus;
      payload.version = null;

      if (DRY_RUN) {
        console.log(`  [DRY] CREATE ${model.name} ${targetYear} (status=${targetStatus}) + clone ${masterTrims.length} trims, ${masterPackages.length} packages`);
        stats.created_years++;
        stats.cloned_trims += masterTrims.length;
        stats.cloned_packages += masterPackages.length;
        continue;
      }

      const created = await api('POST', '/items/model_years', payload);
      const newYearId = created.data.id;
      ok(`CREATE ${model.name} ${targetYear} (id=${newYearId}, status=${targetStatus})`);
      stats.created_years++;

      // Clone trims + packages
      const t = await cloneTrimsAndPackages(masterTrims, masterPackages, newYearId, trimAliases, pkgAliases);
      stats.cloned_trims += t.trims;
      stats.cloned_packages += t.packages;
    } else {
      // Existing year — set status if different
      if (existing.year.status !== targetStatus) {
        if (DRY_RUN) {
          console.log(`  [DRY] PATCH ${model.name} ${targetYear} status: ${existing.year.status} → ${targetStatus}`);
        } else {
          await api('PATCH', `/items/model_years/${existing.year.id}`, { status: targetStatus });
          ok(`Status ${model.name} ${targetYear}: ${existing.year.status} → ${targetStatus}`);
        }
        stats.status_changed++;
      }

      // If existing is empty but master has trims, clone
      if (existing.trimCount === 0 && master.trimCount > 0 && existing.year.id !== master.year.id) {
        if (DRY_RUN) {
          console.log(`  [DRY] Clone ${masterTrims.length} trims + ${masterPackages.length} packages → ${model.name} ${targetYear} (was empty)`);
          stats.cloned_trims += masterTrims.length;
          stats.cloned_packages += masterPackages.length;
        } else {
          info(`Existující ${model.name} ${targetYear} prázdný — kloning master trims/packages`);
          const t = await cloneTrimsAndPackages(masterTrims, masterPackages, existing.year.id, trimAliases, pkgAliases);
          stats.cloned_trims += t.trims;
          stats.cloned_packages += t.packages;
        }
      } else {
        info(`Existující ${model.name} ${targetYear}: ${existing.trimCount} trims, ${existing.pkgCount} packages — neměním obsah`);
      }
    }
  }
}

async function cloneTrimsAndPackages(masterTrims, masterPackages, targetYearId, trimAliases, pkgAliases) {
  let trimCount = 0, pkgCount = 0;
  for (const trim of masterTrims) {
    const payload = stripFields(trim, trimAliases);
    payload.model_year = targetYearId;
    // Slug může být duplicate — Directus generuje, ale pro jistotu necháme původní (uniqueness scope per model_year asi není povinný)
    try {
      await api('POST', '/items/trim_levels', payload);
      trimCount++;
    } catch (e) {
      warn(`Trim "${trim.name}" clone selhal: ${e.message}`);
    }
  }
  for (const pkg of masterPackages) {
    const payload = stripFields(pkg, pkgAliases);
    payload.model_year = targetYearId;
    try {
      await api('POST', '/items/option_packages', payload);
      pkgCount++;
    } catch (e) {
      warn(`Package "${pkg.name}" clone selhal: ${e.message}`);
    }
  }
  return { trims: trimCount, packages: pkgCount };
}

// ─── Main ─────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Ensure model_years 2024, 2025, 2026 pro VŠECHNY modely');
  console.log('═══════════════════════════════════════════════');
  if (DRY_RUN) console.log('  ⚠  DRY-RUN — nic se nezapíše');
  console.log('');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK');

  // Dynamicky načti aliasy
  MODEL_YEARS_ALIASES = await loadAliasFields('model_years');
  info(`model_years aliasy (skip při copy): ${[...MODEL_YEARS_ALIASES].join(', ') || '(žádné)'}`);

  // Načti všechny modely
  const modelsResp = await api('GET', '/items/models?limit=100&fields=id,name,slug&sort=name');
  const models = modelsResp.data ?? [];
  console.log(`\nNačteno ${models.length} modelů`);

  if (!DRY_RUN) {
    const confirm = (await prompt(`\nPokračovat se zápisem (vytvoří chybějící roky, nastaví status, naklonuje trims)? [yes/no]: `)).trim().toLowerCase();
    if (confirm !== 'yes' && confirm !== 'y') {
      console.log('Aborted.');
      rl.close();
      return;
    }
  }

  const stats = {
    created_years: 0,
    cloned_trims: 0,
    cloned_packages: 0,
    status_changed: 0,
    skipped_empty: 0,
  };

  for (const model of models) {
    try {
      await processModel(model, stats);
    } catch (e) {
      warn(`Model "${model.name}" selhal: ${e.message}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log(`  ${DRY_RUN ? 'DRY-RUN preview' : 'Hotovo'}.`);
  console.log(`  Created model_years:  ${stats.created_years}`);
  console.log(`  Cloned trims:         ${stats.cloned_trims}`);
  console.log(`  Cloned packages:      ${stats.cloned_packages}`);
  console.log(`  Status changed:       ${stats.status_changed}`);
  console.log(`  Skipped (empty model): ${stats.skipped_empty}`);
  console.log('═══════════════════════════════════════════════');
  if (!DRY_RUN) {
    console.log('\n  V adminu (Ctrl+Shift+R):');
    console.log('    Modely → otevři libovolný model → Model Years uvidíš 2024 (Archivováno), 2025 (Archivováno), 2026 (Publikováno).');
    console.log('  Web build:');
    console.log('    npm run build  (nebo `git commit --allow-empty -m "rebuild" && git push` pro Vercel deploy)');
  }
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
