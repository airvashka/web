#!/usr/bin/env node
/**
 * SFR Motor — Seed ModelYears a TrimLevels pro všech 18 modelů
 *
 * Pro každý model vytvoří:
 *  • 1 ModelYear (2026, pro Rexton 2025 — podle ceníku)
 *  • TrimLevels s názvem, list_price, promo_price (z ceníků v _downloads-todo/ceniky-*)
 *
 * Idempotentní — re-run skipuje existující záznamy.
 */

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rl = readline.createInterface({ input, output });
const prompt = (q) => rl.question(q);

let DIRECTUS_URL = '';
let TOKEN = '';

async function api(method, path, body) {
  const url = `${DIRECTUS_URL}${path}`;
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) {
    const e = new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json?.errors ?? json)}`);
    e.status = res.status; throw e;
  }
  return json;
}

const ok = (m) => console.log(`✅  ${m}`);
const skip = (m) => console.log(`⏭️   ${m}`);
const info = (m) => console.log(`ℹ️   ${m}`);
const warn = (m) => console.log(`⚠️   ${m}`);

// ----------------------------------------------------------
// DATA — ceníkové údaje pro každý model
// ----------------------------------------------------------

// Klíčové výbavy z MODELY.md (zkrácené verze pro každý trim)
// V dalším skriptu (seed-packages.mjs) doplníme i option packages

const MODELS_DATA = {
  // ----- KGM -----
  'tivoli': {
    year: 2026,
    trims: [
      {
        name: 'Style', slug: 'style', sort: 1,
        list_price: 509900, promo_price: 459900,
        description: 'Vstupní výbava Tivoli s LED denním svícením a multimediálním systémem.',
        features: ['LED denní svícení', 'Manuální klimatizace', 'Multimediální systém', '8 reproduktorů', '17" ráfky'],
      },
    ],
  },

  'korando': {
    year: 2026,
    trims: [
      {
        name: 'Style', slug: 'style', sort: 1,
        list_price: 549900,
        description: 'Vstupní úroveň Korando — manuální převodovka, LED světla, základní výbava.',
        features: ['LED světla', 'Manuální převodovka 6MT', '17" ALU kola', 'Tempomat', 'Bluetooth'],
      },
      {
        name: 'Style+', slug: 'style-plus', sort: 2,
        list_price: 549900, promo_price: 479900,
        description: 'Akční výbava se STYLE+ paketem (dvouzónová klima, vyhřívaný volant, mlhovky) v hodnotě 30 000 Kč zdarma.',
        features: ['STYLE+ paket ZDARMA', 'Dvouzónová automatická klima', 'Vyhřívaný kožený volant', 'Signalizace parkování vpředu', 'Textilní koberce', '220V zásuvka', 'Pevná podlaha kufru'],
      },
      {
        name: 'Elegant', slug: 'elegant', sort: 3,
        list_price: 629900,
        description: 'Vyšší výbava se Style+ obsahem standardně.',
        features: ['Vše ze Style+', 'Lepší materiály interiéru', 'Privacy glass', 'Střešní ližiny stříbrné'],
      },
      {
        name: 'Premium', slug: 'premium', sort: 4,
        list_price: 719900,
        description: 'Top výbava — PREMIUM+ paket standardně (LED ambientní, SAFETY, ACC, elektrické víko kufru SMART).',
        features: ['PREMIUM+ paket S', 'LED ambientní osvětlení', 'SAFETY PACK', 'ACC PACK (adaptivní tempomat)', 'Elektrické víko kufru SMART', 'Bezdrátové nabíjení'],
      },
    ],
  },

  'torres': {
    year: 2026,
    trims: [
      {
        name: 'CLUB', slug: 'club', sort: 1,
        list_price: 729900,
        description: 'Vstupní Torres CLUB — benzín 1.5 GDI Turbo, manuál 6MT.',
        features: ['LED světla', 'Manuální převodovka 6MT', '17" ALU', 'Bluetooth', '2× USB konektor'],
      },
      {
        name: 'STYLE', slug: 'style', sort: 2,
        list_price: 829900,
        description: 'Střední výbava STYLE — vyhřívaný volant, dvouzónová klima, automatická převodovka.',
        features: ['CLUB+ paket S', 'Vyhřívaný volant', 'Vyhřívání předních sedadel', 'Auto-stmívání vnitřního zrcátka', 'Nerezové prahové lišty'],
      },
      {
        name: 'PREMIUM', slug: 'premium', sort: 3,
        list_price: 949900,
        description: 'Top Torres — SAFETY paket, 360° kamera, kožený interiér standardně.',
        features: ['SAFETY paket S', '360° kamera AMS', 'Kožený interiér', 'Bezdrátové nabíjení', 'Elektrická sedadla'],
      },
    ],
  },

  'torres-hev': {
    year: 2026,
    trims: [
      {
        name: 'CLUB', slug: 'club', sort: 1,
        list_price: 849900,
        description: 'Torres Hybrid — vstupní výbava s hybridním pohonem 1.5 GDI Turbo Hybrid 204k.',
        features: ['Hybridní pohon e-DHT', 'LED světla', 'Automatická převodovka', '17" ALU'],
      },
      {
        name: 'STYLE', slug: 'style', sort: 2,
        list_price: 949900,
        description: 'Hybrid se Style výbavou — CLUB+ paket, dvouzónová klima, vyhřívání.',
        features: ['CLUB+ paket S', 'Hybrid systém', 'Dvouzónová klima', 'Vyhřívaná sedadla'],
      },
      {
        name: 'PREMIUM', slug: 'premium', sort: 3,
        list_price: 1069900,
        description: 'Top Hybrid — SAFETY, 360° kamera, kožený interiér.',
        features: ['SAFETY paket S', '360° kamera', 'Kožený interiér', 'Bezdrátové nabíjení'],
      },
    ],
  },

  'torres-evx': {
    year: 2025,
    trims: [
      {
        name: 'Style', slug: 'style', sort: 1,
        list_price: 949900,
        description: 'Vstupní Torres EVX — elektromotor 152 kW, redukční převodovka.',
        features: ['Elektromotor 152 kW', '339 Nm', 'LED světla', '18" ALU', 'Tempomat'],
      },
      {
        name: 'Premium', slug: 'premium', sort: 2,
        list_price: 1099900,
        description: 'Premium EVX — vyhřívaná sedadla, lepší výbava, možnost TECH a PREMIUM+ paketů.',
        features: ['Vyhřívání předních sedadel', 'Vyhřívání zadních sedadel', 'Multimediální systém', 'Bezpečnostní paket'],
      },
    ],
  },

  'actyon': {
    year: 2026,
    trims: [
      {
        name: 'STYLE', slug: 'style', sort: 1,
        list_price: 749900,
        description: 'Actyon STYLE — benzín 1.5 GDI Turbo, městské SUV-kupé.',
        features: ['LED světla', 'Bluetooth', '17" ALU', 'Multimediální systém'],
      },
      {
        name: 'PREMIUM', slug: 'premium', sort: 2,
        list_price: 869900,
        description: 'Actyon PREMIUM — top výbava s lepšími materiály a technologiemi.',
        features: ['Vyhřívání sedadel', 'Dvouzónová klima', 'Lepší materiály', 'Bezpečnostní asistenty'],
      },
    ],
  },

  'actyon-hev': {
    year: 2026,
    trims: [
      {
        name: 'STYLE', slug: 'style', sort: 1,
        list_price: 819900,
        description: 'Actyon Hybrid — kombinovaný výkon 204k, e-DHT převodovka.',
        features: ['Hybridní pohon e-DHT', '300 Nm', 'LED světla', '17" ALU'],
      },
      {
        name: 'PREMIUM', slug: 'premium', sort: 2,
        list_price: 939900,
        description: 'Actyon Hybrid PREMIUM — top výbava + hybrid pohon.',
        features: ['Hybridní systém', 'Vyhřívání sedadel', 'Dvouzónová klima'],
      },
    ],
  },

  'rexton': {
    year: 2025,
    trims: [
      {
        name: 'CLUB', slug: 'club', sort: 1,
        list_price: 899900,
        description: 'Rexton CLUB (2WD) — vstupní úroveň luxusního SUV s dieselem 2.2 e-XDI 202k.',
        features: ['Diesel 2.2 e-XDI', '202k / 441 Nm', '2WD', 'LED světla', '18" ALU Diamond Cutting'],
      },
      {
        name: 'CLEVER', slug: 'clever', sort: 2,
        list_price: 1069900,
        description: 'Rexton CLEVER (4WD) — GRIP+ paket, vyšší výbava, pohon všech kol.',
        features: ['4WD', 'GRIP+ paket S (uzávěrka diferenciálu)', 'CLEVER+ paket S', 'Bezdrátové nabíjení', 'Ambientní osvětlení'],
      },
      {
        name: 'PREMIUM', slug: 'premium', sort: 3,
        list_price: 1199900,
        description: 'Top Rexton PREMIUM — PREMIUM+ paket, 360° kamera, paměť sedadla.',
        features: ['PREMIUM+ paket S', '360° kamera AMS', 'Paměť sedadla řidiče', 'Elektrické víko kufru SMART', 'Sluneční roletky 2. řady'],
      },
    ],
  },

  'musso-grand': {
    year: 2025,
    trims: [
      {
        name: 'Style 4WD', slug: 'style-4wd', sort: 1,
        list_price: 879900, promo_price: 849900,
        description: 'Pickup Musso Grand Style 4WD — STYLE+ paket s akčním zvýhodněním (20 000 Kč).',
        features: ['4WD', 'STYLE+ paket', 'Dvouzónová klima', 'Vyhřívaný kožený volant', 'Privacy glass', 'Střešní ližiny'],
      },
      {
        name: 'Premium 4WD', slug: 'premium-4wd', sort: 2,
        list_price: 989900,
        description: 'Top Musso Grand Premium 4WD — PREMIUM+ paket s 360° kamerou.',
        features: ['PREMIUM+ paket S', '360° kamera', 'Uzávěrka diferenciálu', 'Lepší interiér'],
      },
    ],
  },

  // ----- OMODA & JAECOO ----- (jednodušší — bez packetů, vše v trim)
  'omoda-5': {
    year: 2026,
    trims: [
      {
        name: 'Basic', slug: 'basic', sort: 1,
        list_price: 769000, promo_price: 659000,
        description: 'Vstupní Omoda 5 — benzín 1.6 TGDI 108 kW, 7DCT automatická.',
        features: ['1.6 TGDI', '7DCT automatická', '18" ALU', 'LED světla', '12,3" centrální displej', 'Apple CarPlay/Android Auto', '6 reproduktorů', 'Manuální klimatizace'],
      },
      {
        name: 'Comfort', slug: 'comfort', sort: 2,
        list_price: 799000, promo_price: 699000,
        description: 'Střední výbava Comfort — syntetická kůže, vyhřívaná sedadla, bezdrátová nabíječka.',
        features: ['Syntetická kůže', 'Vyhřívaná přední sedadla', 'Ventilovaná sedadla', 'Bezdrátová nabíječka 50W', 'Sklopná zrcátka', 'Střešní nosiče', 'Zatmavená okna'],
      },
      {
        name: 'Premium', slug: 'premium', sort: 3,
        list_price: 849000, promo_price: 769000,
        description: 'Top Omoda 5 Premium — 360° kamera, SONY zvuk, dvouzónová klima, vyhřívání volantu.',
        features: ['360° panoramatická kamera', 'SONY 8 reproduktorů', 'Dvouzónová automatická klima', 'Elektrické střešní okno', 'Vyhřívání volantu', 'Elektrické víko kufru'],
      },
    ],
  },

  'omoda-5-shs-h': {
    year: 2026,
    trims: [
      {
        name: 'Basic', slug: 'basic', sort: 1,
        list_price: 649000, promo_price: 629000,
        description: 'Vstupní hybridní Omoda 5 SHS-H — kombinovaný výkon 165 kW, dojezd 1 000 km WLTP.',
        features: ['Hybridní pohon 1.5 TGDI', 'Dojezd 1 000 km', 'Dvouzónová klima', '17" ALU', 'LED světla'],
      },
      {
        name: 'Premium', slug: 'premium', sort: 2,
        list_price: 719000, promo_price: 699000,
        description: 'Top Omoda 5 SHS-H Premium — 360° kamera, SONY zvuk, 18" ALU.',
        features: ['360° kamera', 'SONY 8 reproduktorů', '18" ALU', 'Elektrické střešní okno', 'Vyhřívání volantu', 'Ventilovaná sedadla'],
      },
    ],
  },

  'omoda-5-ev': {
    year: 2026,
    trims: [
      {
        name: 'Comfort', slug: 'comfort', sort: 1,
        list_price: 749000,
        description: 'Vstupní Omoda 5 EV — 150 kW, baterie 61 kWh, dojezd 402 km.',
        features: ['Elektromotor 150 kW', '61 kWh LiFePO4', 'Dojezd 402 km WLTP', '18" ALU', '12V zásuvka v kufru'],
      },
      {
        name: 'Premium', slug: 'premium', sort: 2,
        list_price: 819000,
        description: 'Top Omoda 5 EV — 360° HD kamera, SONY, masážní sedadla.',
        features: ['360° HD kamera', 'SONY 8 reproduktorů', 'Masážní sedadla', 'Tepelné čerpadlo', 'Akustická skla', 'Elektrické střešní okno'],
      },
    ],
  },

  'omoda-9-shs': {
    year: 2026,
    trims: [
      {
        name: 'Premium', slug: 'premium', sort: 1,
        list_price: 1299000, promo_price: 1199000,
        description: 'Vlajková loď OMODA — plug-in hybrid AWD, 537 koní, 0-100 za 4,9 s, dojezd 1 100 km.',
        features: ['Plug-in hybrid 395 kW', 'AWD I-AWD', '0-100 za 4,9 s', 'Dojezd 1 100 km', '540° HD kamera', 'SONY 14 reproduktorů', 'Masážní sedadla', 'Panoramatická střecha', 'HUD'],
      },
    ],
  },

  'jaecoo-5': {
    year: 2026,
    trims: [
      {
        name: 'Select', slug: 'select', sort: 1,
        list_price: 669000, promo_price: 629000,
        description: 'Vstupní Jaecoo 5 — benzín 1.6 TGDI 108 kW, 7DCT, robustní design.',
        features: ['1.6 TGDI', '7DCT', '18" ALU dvoubarevná', 'Projekční LED', '13,2" centrální displej', 'Manuální klima', 'Střešní ližiny'],
      },
      {
        name: 'Exclusive', slug: 'exclusive', sort: 2,
        list_price: 749000, promo_price: 709000,
        description: 'Top Jaecoo 5 Exclusive — 540° kamera, SONY zvuk, panoramatická střecha, kožený interiér.',
        features: ['540° kamerový systém', 'SONY 8 reproduktorů', 'Panoramatická střecha', 'Bezdrátová nabíječka 50W', 'Eko-kůže', 'Dvouzónová klima', 'Elektrické víko kufru'],
      },
    ],
  },

  'jaecoo-7': {
    year: 2026,
    trims: [
      {
        name: 'Luxury', slug: 'luxury', sort: 1,
        list_price: 759000,
        description: 'Vstupní Jaecoo 7 Luxury — benzín 1.6 TGDI AWD, sofistikované SUV.',
        features: ['AWD pohon', '1.6 TGDI', '19" ALU', 'LED denní + projekční světlomety', 'Apple CarPlay/Android Auto'],
      },
      {
        name: 'Exclusive', slug: 'exclusive', sort: 2,
        list_price: 809000, promo_price: 759000,
        description: 'Top Jaecoo 7 Exclusive — 540° kamera, SONY prémiový audio, HUD, masážní sedadla.',
        features: ['540° panoramatická kamera', 'SONY prémiový audiosystém', 'HUD na čelním skle', 'Panoramatická prosklená střecha', 'Ventilovaná + vyhřívaná sedadla', '4WD jízdní režimy (bahno, sníh, písek, offroad)'],
      },
    ],
  },

  'jaecoo-7-shs': {
    year: 2026,
    trims: [
      {
        name: 'Luxury', slug: 'luxury', sort: 1,
        list_price: 929000,
        description: 'Jaecoo 7 SHS Luxury — plug-in hybrid, dojezd 1 200 km, elektrický 91 km.',
        features: ['Plug-in hybrid 205 kW', 'Dojezd 1 200 km', 'Čistě elektrický 91 km', 'AWD-ready', '19" ALU', 'Brzdové třmeny červené'],
      },
      {
        name: 'Exclusive', slug: 'exclusive', sort: 2,
        list_price: 929000,
        description: 'Top Jaecoo 7 SHS Exclusive — HUD, SONY, panoramatická střecha, ventilovaná sedadla, jízdní režim Sand.',
        features: ['HUD na čelním skle', 'SONY 8 reproduktorů', 'Bezdrátová nabíječka 50W', 'Vyhřívané přední sklo', 'Panoramatická prosklená střecha', 'Ambientní osvětlení 2 řad', 'Jízdní režim Sand'],
      },
    ],
  },

  // ----- Farizon -----
  'farizon-sv': {
    year: 2025,
    trims: [
      {
        name: 'SuperVan', slug: 'supervan', sort: 1,
        description: 'Farizon SV — elektrická dodávka s největším prostorem ve své třídě.',
        features: ['Elektrický pohon', 'Největší prostor ve třídě', 'Moderní design', 'Rychlé nabíjení'],
      },
    ],
  },

  'farizon-v6e': {
    year: 2025,
    trims: [
      {
        name: 'V6E', slug: 'v6e', sort: 1,
        description: 'Farizon V6E — kompaktní elektrická dodávka s dojezdem 285+ km.',
        features: ['Rychlé nabíjení (20→80 % za 30 min)', 'Dojezd 285+ km', 'Kompaktní rozměry pro město'],
      },
    ],
  },
};

// ----------------------------------------------------------
// EXECUTION
// ----------------------------------------------------------

async function findBySlug(collection, slug) {
  const res = await api('GET', `/items/${collection}?filter[slug][_eq]=${encodeURIComponent(slug)}&limit=1`);
  return res?.data?.[0] ?? null;
}

async function findModelYear(modelId, year) {
  const res = await api('GET', `/items/model_years?filter[model][_eq]=${modelId}&filter[year][_eq]=${year}&limit=1`);
  return res?.data?.[0] ?? null;
}

async function findTrim(modelYearId, slug) {
  const res = await api('GET', `/items/trim_levels?filter[model_year][_eq]=${modelYearId}&filter[slug][_eq]=${encodeURIComponent(slug)}&limit=1`);
  return res?.data?.[0] ?? null;
}

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('  SFR Motor — Seed ModelYears + TrimLevels');
  console.log('═══════════════════════════════════════════════');
  console.log('');

  DIRECTUS_URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Admin email: ')).trim();
  const password = (await prompt('Admin heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth?.data?.access_token;
  ok('Auth OK');
  console.log('');

  let modelsCreated = 0, modelsSkipped = 0;
  let yearsCreated = 0, yearsSkipped = 0;
  let trimsCreated = 0, trimsSkipped = 0;

  for (const [modelSlug, data] of Object.entries(MODELS_DATA)) {
    info(`▸ ${modelSlug}`);

    // 1) Najdi model
    const model = await findBySlug('models', modelSlug);
    if (!model) {
      warn(`  Model ${modelSlug} neexistuje, skipuji`);
      modelsSkipped++;
      continue;
    }

    // 2) Vytvoř nebo najdi ModelYear
    let modelYear = await findModelYear(model.id, data.year);
    if (modelYear) {
      skip(`  ModelYear ${data.year} už existuje`);
      yearsSkipped++;
    } else {
      const res = await api('POST', '/items/model_years', {
        model: model.id,
        year: data.year,
        status: 'published',
      });
      modelYear = res.data;
      ok(`  ModelYear ${data.year} vytvořen`);
      yearsCreated++;
    }

    // 3) Vytvoř TrimLevels
    for (const trim of data.trims) {
      const existing = await findTrim(modelYear.id, trim.slug);
      if (existing) {
        skip(`    Trim "${trim.name}" už existuje`);
        trimsSkipped++;
        continue;
      }
      await api('POST', '/items/trim_levels', {
        model_year: modelYear.id,
        slug: trim.slug,
        name: trim.name,
        sort: trim.sort ?? 0,
        list_price: trim.list_price ?? null,
        promo_price: trim.promo_price ?? null,
        description: trim.description ?? '',
        features: trim.features ?? [],
        status: 'published',
      });
      ok(`    Trim "${trim.name}" — ${trim.list_price ? trim.list_price.toLocaleString('cs-CZ') + ' Kč' : 'cena na dotaz'}${trim.promo_price ? ' / akce ' + trim.promo_price.toLocaleString('cs-CZ') : ''}`);
      trimsCreated++;
    }
  }

  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('  Souhrn');
  console.log('═══════════════════════════════════════════════');
  console.log(`  ModelYears:  ${yearsCreated} vytvořeno, ${yearsSkipped} skipnuto`);
  console.log(`  TrimLevels:  ${trimsCreated} vytvořeno, ${trimsSkipped} skipnuto`);
  console.log('');
  console.log('Test:');
  console.log('  Admin → Stock Vehicles → + Vytvořit → vyber Brand=KGM → Model=Korando');
  console.log('  → Model Year dropdown ukáže "2026" → Trim Level dropdown ukáže Style/Style+/Elegant/Premium');
  console.log('');
  console.log('(zatím dropdown ukáže VŠECHNY trim levely všech modelů — Cascading filter');
  console.log(' přijde ve Fázi 3, ale data už máš správně připravena.)');

  rl.close();
}

main().catch((e) => { console.log(`❌ ${e.message}`); rl.close(); process.exit(1); });
