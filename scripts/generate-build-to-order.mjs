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
// Default allowlist: KGM. Lze přepsat --brands=kgm,omoda-jaecoo (CSV).
// Farizon = užitkový segment, prodávaný individuálně přes B2B vztah, ne generovat.
const BRANDS_ARG = (process.argv.find((a) => a.startsWith('--brands=') || a.startsWith('--brand='))?.split('=')[1] || '').toLowerCase();
const ALLOWED_BRANDS = BRANDS_ARG ? BRANDS_ARG.split(',').map((s) => s.trim()).filter(Boolean) : ['kgm'];

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

// Cenové delty se čtou DYNAMICKY z trim_levels.optional_items per-trim.
// Heuristika match v findOptionalDelta() — name musí obsahovat klíčová slova
// pro automat / 4WD. Pokud trim NEMÁ daný optional_item, znamená to že
// kombinace je už zahrnutá v base (např. Torres aut FWD = jen base, automat
// není volitelný — je standard) nebo daná kombinace neexistuje.

const TRANSMISSION_KEYWORDS = {
  automatic: /automat/i,            // "Automatická převodovka Aisin"
  dct: /dct|dvojspojk/i,
  cvt: /cvt|variator/i,
};
const DRIVETRAIN_KEYWORDS = {
  '4wd': /4x4|4×4|pohon\s+vsech\s+kol|pohon\s+všech\s+kol|awd|4wd/i,
  awd:   /awd|all.?wheel|pohon\s+vsech\s+kol|pohon\s+všech\s+kol/i,
};

function findOptionalDelta(optionalItems, predicate) {
  if (!Array.isArray(optionalItems)) return 0;
  const found = optionalItems.find((it) => predicate.test(String(it?.name || '')));
  return found ? (Number(found.price) || 0) : 0;
}

function computePrice(basePrice, optionalItems, combo) {
  let price = basePrice;
  // Transmission delta
  const tRe = TRANSMISSION_KEYWORDS[combo.transmission];
  if (tRe) price += findOptionalDelta(optionalItems, tRe);
  // Drivetrain delta
  const dRe = DRIVETRAIN_KEYWORDS[combo.drivetrain];
  if (dRe) price += findOptionalDelta(optionalItems, dRe);
  return price;
}

// Detekce co je v base ceně trimu na základě list_price + optional_items.
// Korando Style má list_price=549900 = manuál FWD (base). Optional_items obsahuje
// "Automatická převodovka +43900" a "Pohon 4x4 +49900". Cokoli NENÍ v optional_items
// se buď neprodává, nebo je v base. Praxe: pokud trim NEMÁ automat v opts → automat
// VŮBEC NENÍ dostupný (vůz je jen manuál). Pokud nemá 4WD v opts → vůz je jen FWD.
//
// Výjimky: některé trimy (Torres, Rexton) jsou JEN automat. Tj. trim NEMÁ "Automat"
// v opts, ale není manuál — je rovnou automat v base. Heuristika: pokud base trim
// je dražší než nejnižší trim modelu a NEMÁ automat v opts → automat je v base.
// Pro start ale použijeme jednoduchý: pokud opts má daný keyword, kombinace je
// dostupná. Pokud nemá ALE matice (COMBOS) říká že existuje, věříme matici.
function combosAvailableForTrim(trimDefaultCombos, optionalItems) {
  // Default: vrátí všechny matice kombinace. Pokročilejší filtrace by
  // mohla zrušit kombinace co nejsou v optional_items, ale to by
  // nesprávně zrušilo trimy kde je automat/4WD v base.
  return trimDefaultCombos;
}

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

// Sanitize string pro external_id: a-z, 0-9, '-'. Lomítka v trim slugech (např. "l2h1/h2/h3")
// nahradí pomlčkou. `+` na konci trimů (např. "Style+") → "plus" aby nesplynul se "Style".
function safeSlug(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\+/g, 'plus')          // Style+ → styleplus (ne style)
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
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
  console.log(`[btoorder] Allowed brands: ${ALLOWED_BRANDS.join(', ')}`);

  // 1) Načti trim_levels (kde list_price > 0 a status=published) + relace.
  // Pozor: trim_levels NEMÁ přímý FK na model. Model je dostupný přes model_year:
  //   trim_levels.model_year → model_years.model → models → brands
  const trimsFilter = {
    'filter[list_price][_gt]': '0',
    'filter[status][_eq]': 'published',
    'fields': 'id,name,list_price,optional_items,model_year.id,model_year.year,model_year.model.id,model_year.model.name,model_year.model.slug,model_year.model.brand.id,model_year.model.brand.name,model_year.model.brand.slug',
    'limit': '500',
  };
  if (ALLOWED_BRANDS.length === 1) {
    trimsFilter['filter[model_year][model][brand][slug][_eq]'] = ALLOWED_BRANDS[0];
  }
  // Pokud víc značek, filtrujeme v paměti níže (Directus _in syntax přes URL je trochu jiný)
  const trimsQuery = new URLSearchParams(trimsFilter).toString();
  const trimsResp = await api('GET', `/items/trim_levels?${trimsQuery}`);
  let trims = trimsResp.data ?? [];
  // Vyfiltruj chybějící relace (orphaned trim_levels). Normalizuj: t.model_year.model → t.model pro pohodlí.
  trims = trims
    .filter((t) => t.model_year && t.model_year.model && t.model_year.model.brand)
    .filter((t) => ALLOWED_BRANDS.includes(t.model_year.model.brand.slug))
    .map((t) => ({
      ...t,
      model: t.model_year.model,
      year: t.model_year.year,
      modelYearId: t.model_year.id,
    }));
  console.log(`[btoorder] Načteno ${trims.length} trim_levels (po filtru brand: ${ALLOWED_BRANDS.join(',')})`);

  // Filtruj jen NEJNOVĚJŠÍ model_year per model. Staré ročníky nemá smysl generovat.
  // Pokud má model víc model_years se stejným rokem (např. facelift 2026.1 + 2026.2),
  // vybereme jen ten s nejvyšším model_year_id (deterministicky později added).
  const latestByModel = new Map();   // model.id → { year, modelYearId }
  for (const t of trims) {
    const mId = t.model.id;
    const cur = latestByModel.get(mId);
    if (!cur || t.year > cur.year || (t.year === cur.year && t.modelYearId > cur.modelYearId)) {
      latestByModel.set(mId, { year: t.year, modelYearId: t.modelYearId });
    }
  }
  trims = trims.filter((t) => t.modelYearId === latestByModel.get(t.model.id).modelYearId);
  console.log(`[btoorder] Po filtru latest-model_year-per-model: ${trims.length} trim_levels`);

  // 2) Pro každý trim spočítej kombinace
  // Plan = { externalId, brandSlug, modelSlug, trimName, trimId, modelId, brandId, listPrice, transmission, drivetrain }
  const plans = [];
  for (const t of trims) {
    const modelSlug = t.model.slug;
    // Pro klíč v COMBOS matici zachováme původní formát (lowercase + dashes mezi slovy),
    // aby matchnul 'style+' (s plus znakem). safeSlug() až pro external_id.
    const trimSlugKey = (t.name || '').toLowerCase().trim().replace(/\s+/g, '-');
    const brandSlug = t.model.brand.slug;
    const modelCombos = COMBOS_BY_MODEL_TRIM[modelSlug] ?? {};
    const combos = modelCombos[trimSlugKey] ?? modelCombos['*'] ?? DEFAULT_COMBOS;
    for (const c of combos) {
      const externalId = safeSlug(`${brandSlug}-${modelSlug}-${trimSlugKey}-${comboShort(c)}`);
      const finalPrice = computePrice(t.list_price, t.optional_items, c);
      plans.push({
        externalId,
        brandSlug,
        modelSlug,
        trimName: t.name,
        trimId: t.id,
        modelId: t.model.id,
        modelYearId: t.modelYearId,
        brandId: t.model.brand.id,
        listPrice: finalPrice,         // už po přičtení delt
        baseTrimPrice: t.list_price,   // pro debug
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
