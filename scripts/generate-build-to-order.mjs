/**
 * Generate build-to-order stock_vehicles.
 *
 * Pro každý trim_level (kde list_price > 0 a model je released) vytvoří
 * 1 stock_vehicle s availability='on_order' za KAŽDOU smysluplnou kombinaci
 * transmission × drivetrain. Klient pak v detailu uvidí color picker (všechny
 * dostupné barvy modelu) a "Nezávazně poptat" tlačítko místo "Mám zájem".
 *
 * Model Olfin: 12 záznamů pro Korando (4 trimy × 3 logické kombinace převodovka/pohon).
 * Barvy ne per-záznam → klient vybírá v detailu.
 *
 * Idempotentní: external_source='build-to-order', external_id='kgm-korando-style-aut-fwd'.
 * Re-run = update existujícího (nemnoží duplicity). Pokud trim zmizí (vyřazený model),
 * smaže odpovídající záznam.
 *
 * Použití:
 *   node scripts/generate-build-to-order.mjs              # dry-run (jen vypíše co by se stalo)
 *   node scripts/generate-build-to-order.mjs --apply      # skutečně uloží
 *   node scripts/generate-build-to-order.mjs --brand=kgm  # jen jedna značka
 *
 * ENV:
 *   DIRECTUS_URL   (default http://directus:8055)
 *   DIRECTUS_TOKEN (admin static token)
 */
import process from 'node:process';

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'http://directus:8055';
const TOKEN = process.env.DIRECTUS_TOKEN || '';
const APPLY = process.argv.includes('--apply');
const BRAND_FILTER = (process.argv.find((a) => a.startsWith('--brand='))?.split('=')[1] || '').toLowerCase();

if (!TOKEN) {
  console.error('Chybi DIRECTUS_TOKEN v env. Vlozit do .env soubor STOCK_SYNC_DIRECTUS_TOKEN.');
  process.exit(1);
}

const EXTERNAL_SOURCE = 'build-to-order';

// ─── Matice logických kombinací převodovka × pohon per model ─────────────────
// Olfin definuje co reálně KGM nabízí (např. Premium není v manuálu).
// Pokud trim není v matici, použije se DEFAULT_COMBOS.
//
// Hodnoty musí matchovat stock_vehicles.transmission a .drivetrain enum:
//   transmission: 'manual' | 'automatic' | 'dct' | 'cvt' | 'dht'
//   drivetrain:   'fwd' | 'rwd' | 'awd' | '4wd'

const DEFAULT_COMBOS = [
  { transmission: 'automatic', drivetrain: 'fwd' },
];

const COMBOS_BY_MODEL_TRIM = {
  // KGM Korando — Olfinem prozkoumáno
  'korando': {
    'style+':  [
      { transmission: 'manual',    drivetrain: 'fwd' },
      { transmission: 'automatic', drivetrain: 'fwd' },
      { transmission: 'manual',    drivetrain: '4wd' },
    ],
    'style': [
      { transmission: 'manual',    drivetrain: 'fwd' },
      { transmission: 'automatic', drivetrain: 'fwd' },
      { transmission: 'manual',    drivetrain: '4wd' },
      { transmission: 'automatic', drivetrain: '4wd' },
    ],
    'elegant': [
      { transmission: 'automatic', drivetrain: 'fwd' },
      { transmission: 'automatic', drivetrain: '4wd' },
    ],
    'premium': [
      { transmission: 'automatic', drivetrain: 'fwd' },
      { transmission: 'automatic', drivetrain: '4wd' },
    ],
  },
  // KGM Tivoli
  'tivoli': {
    '*': [
      { transmission: 'manual',    drivetrain: 'fwd' },
      { transmission: 'automatic', drivetrain: 'fwd' },
    ],
  },
  // KGM Torres
  'torres': {
    '*': [
      { transmission: 'automatic', drivetrain: 'fwd' },
      { transmission: 'automatic', drivetrain: '4wd' },
    ],
  },
  // KGM Actyon
  'actyon': {
    '*': [
      { transmission: 'automatic', drivetrain: 'fwd' },
      { transmission: 'automatic', drivetrain: '4wd' },
    ],
  },
  // KGM Rexton
  'rexton': {
    '*': [
      { transmission: 'automatic', drivetrain: '4wd' },
    ],
  },
  // KGM Musso Grand
  'musso-grand': {
    '*': [
      { transmission: 'automatic', drivetrain: '4wd' },
    ],
  },
  // OMODA 5 / 5 SHS-H / 5 EV — pro budoucí použití
  'omoda-5': {
    '*': [{ transmission: 'cvt', drivetrain: 'fwd' }],
  },
  'omoda-5-ev': {
    '*': [{ transmission: 'automatic', drivetrain: 'fwd' }],
  },
  // JAECOO 7 / 7 SHS
  'jaecoo-7': {
    '*': [
      { transmission: 'dct', drivetrain: 'fwd' },
      { transmission: 'dct', drivetrain: 'awd' },
    ],
  },
};

function comboLabel(c) {
  return `${c.transmission}-${c.drivetrain}`;
}
function comboShort(c) {
  const t = { manual: 'man', automatic: 'aut', dct: 'dct', cvt: 'cvt', dht: 'dht' }[c.transmission] || c.transmission;
  const d = c.drivetrain;
  return `${t}-${d}`;
}

// ─── Directus API helpers ────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(`${DIRECTUS_URL}${path}`, opts);
  if (!r.ok) throw new Error(`Directus ${method} ${path} ${r.status}: ${await r.text()}`);
  return r.json();
}

// ─── Hlavní pipeline ─────────────────────────────────────────────────────────
async function main() {
  console.log(`[btoorder] Directus: ${DIRECTUS_URL}`);
  console.log(`[btoorder] Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  if (BRAND_FILTER) console.log(`[btoorder] Brand filter: ${BRAND_FILTER}`);

  // 1) Načti trim_levels (kde list_price > 0 a status=published) + relace.
  // Pozor: trim_levels NEMÁ přímý FK na model. Model je dostupný přes model_year:
  //   trim_levels.model_year → model_years.model → models → brands
  const trimsFilter = {
    'filter[list_price][_gt]': '0',
    'filter[status][_eq]': 'published',
    'fields': 'id,name,list_price,model_year.id,model_year.year,model_year.model.id,model_year.model.name,model_year.model.slug,model_year.model.brand.id,model_year.model.brand.name,model_year.model.brand.slug',
    'limit': '500',
  };
  if (BRAND_FILTER) {
    trimsFilter['filter[model_year][model][brand][slug][_eq]'] = BRAND_FILTER;
  }
  const trimsQuery = new URLSearchParams(trimsFilter).toString();
  const trimsResp = await api('GET', `/items/trim_levels?${trimsQuery}`);
  let trims = trimsResp.data ?? [];
  // Vyfiltruj chybějící relace (orphaned trim_levels). Normalizuj: t.model_year.model → t.model pro pohodlí.
  trims = trims
    .filter((t) => t.model_year && t.model_year.model && t.model_year.model.brand)
    .map((t) => ({
      ...t,
      model: t.model_year.model,
      year: t.model_year.year,
      modelYearId: t.model_year.id,
    }));
  console.log(`[btoorder] Načteno ${trims.length} trim_levels (raw, všechny ročníky)`);

  // Filtruj jen nejnovější model_year per model — staré ročníky nemá smysl generovat
  // jako "na objednání", už se neprodávají.
  const latestYearByModel = new Map();
  for (const t of trims) {
    const mId = t.model.id;
    const cur = latestYearByModel.get(mId) ?? 0;
    if (t.year > cur) latestYearByModel.set(mId, t.year);
  }
  trims = trims.filter((t) => t.year === latestYearByModel.get(t.model.id));
  console.log(`[btoorder] Po filtru latest-year-per-model: ${trims.length} trim_levels`);

  // 2) Pro každý trim spočítej kombinace
  // Plan = { externalId, brandSlug, modelSlug, trimName, trimId, modelId, brandId, listPrice, transmission, drivetrain }
  const plans = [];
  for (const t of trims) {
    const modelSlug = t.model.slug;
    const trimSlugKey = (t.name || '').toLowerCase().trim().replace(/\s+/g, '-');
    const brandSlug = t.model.brand.slug;
    const modelCombos = COMBOS_BY_MODEL_TRIM[modelSlug] ?? {};
    const combos = modelCombos[trimSlugKey] ?? modelCombos['*'] ?? DEFAULT_COMBOS;
    for (const c of combos) {
      const externalId = `${brandSlug}-${modelSlug}-${trimSlugKey}-${comboShort(c)}`;
      plans.push({
        externalId,
        brandSlug,
        modelSlug,
        trimName: t.name,
        trimId: t.id,
        modelId: t.model.id,
        modelYearId: t.modelYearId,
        brandId: t.model.brand.id,
        listPrice: t.list_price,
        transmission: c.transmission,
        drivetrain: c.drivetrain,
      });
    }
  }
  console.log(`[btoorder] Plán: ${plans.length} kombinací (trim × převodovka × pohon)`);

  // 3) Načti existující on_order build-to-order vozy → mapa external_id → id
  const existingResp = await api(
    'GET',
    `/items/stock_vehicles?filter[external_source][_eq]=${EXTERNAL_SOURCE}&fields=id,external_id,status,availability&limit=1000`,
  );
  const existing = new Map();
  for (const e of (existingResp.data ?? [])) {
    existing.set(e.external_id, e);
  }
  console.log(`[btoorder] Existujicich build-to-order vozů v DB: ${existing.size}`);

  // 4) Plan diff: CREATE / UPDATE / DELETE
  const toCreate = [];
  const toUpdate = [];
  const planExternalIds = new Set(plans.map((p) => p.externalId));
  const toDelete = [];
  for (const [extId, ex] of existing.entries()) {
    if (!planExternalIds.has(extId)) toDelete.push(ex);
  }

  for (const p of plans) {
    const existed = existing.get(p.externalId);
    const payload = {
      brand: p.brandId,
      model: p.modelId,
      model_year: p.modelYearId,    // stock_vehicles.model_year je FK na model_years
      trim_level: p.trimId,
      list_price: p.listPrice,
      availability: 'on_order',
      condition: 'new',
      status: 'published',
      transmission: p.transmission,
      drivetrain: p.drivetrain,
      external_source: EXTERNAL_SOURCE,
      external_id: p.externalId,
      // VIN, km, photos zůstávají null/[] — frontend si poradí
    };
    if (existed) {
      toUpdate.push({ id: existed.id, payload, externalId: p.externalId });
    } else {
      toCreate.push({ payload, externalId: p.externalId });
    }
  }

  // 5) Souhrn
  console.log('');
  console.log('─── PLAN ───────────────────────────────');
  console.log(`  CREATE: ${toCreate.length}`);
  console.log(`  UPDATE: ${toUpdate.length}`);
  console.log(`  DELETE: ${toDelete.length}`);
  console.log('────────────────────────────────────────');

  if (toCreate.length > 0) {
    console.log('\n  Vytvořit:');
    toCreate.forEach((p) => console.log(`    + ${p.externalId} (${p.payload.list_price.toLocaleString('cs-CZ')} Kč)`));
  }
  if (toDelete.length > 0) {
    console.log('\n  Smazat (trim už neexistuje nebo se změnily kombinace):');
    toDelete.forEach((e) => console.log(`    - ${e.external_id} (id ${e.id})`));
  }
  if (toUpdate.length > 0) {
    console.log(`\n  Aktualizovat: ${toUpdate.length} (cena/spec)`);
  }

  if (!APPLY) {
    console.log('\n[btoorder] DRY RUN — žádné změny v DB. Spusť s --apply pro skutečný zápis.');
    return;
  }

  // 6) Aplikuj
  let ok = 0, fail = 0;
  for (const c of toCreate) {
    try {
      await api('POST', '/items/stock_vehicles', c.payload);
      ok++;
      console.log(`  [create] ${c.externalId}`);
    } catch (e) {
      fail++;
      console.error(`  [create-fail] ${c.externalId}: ${e.message?.substring(0, 150)}`);
    }
  }
  for (const u of toUpdate) {
    try {
      await api('PATCH', `/items/stock_vehicles/${u.id}`, u.payload);
      ok++;
      // Verbose jen pro nové (update = méně zajímavé)
    } catch (e) {
      fail++;
      console.error(`  [update-fail] ${u.externalId}: ${e.message?.substring(0, 150)}`);
    }
  }
  for (const d of toDelete) {
    try {
      await api('DELETE', `/items/stock_vehicles/${d.id}`);
      ok++;
      console.log(`  [delete] ${d.external_id}`);
    } catch (e) {
      fail++;
      console.error(`  [delete-fail] ${d.external_id}: ${e.message?.substring(0, 150)}`);
    }
  }

  console.log(`\n[btoorder] Hotovo: ok=${ok}, fail=${fail}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('[btoorder] Fatal:', e);
  process.exit(1);
});
