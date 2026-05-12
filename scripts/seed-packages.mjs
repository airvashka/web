#!/usr/bin/env node
/**
 * SFR Motor — Seed Option Packages pro KGM modely (Fáze 2, Variant A)
 *
 * OptionPackage struktura:
 *  • model_year (FK)
 *  • slug, name
 *  • description (s případnými podmínkami v textu)
 *  • features (JSON array)
 *  • pricing_per_trim (JSON object — klíč = trim slug, hodnota = number / "standard" / null)
 *      - null    = nedostupné pro tento trim
 *      - 0       = ZDARMA / součást akce
 *      - integer = cena v Kč
 *      - "standard" = standardně součást tohoto trimu (bez příplatku)
 *
 * Validaci prerequisites/conflicts (TECH před LED, BLACK ne s hnědým kožený)
 * NEDĚLÁ Directus — admin musí dávat pozor sám (uvedeno v description).
 * Budoucí Flow může automatickou validaci doplnit.
 *
 * Re-runnable — skipuje existující slugy per model_year.
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
// PACKETY PER MODEL (KGM only, ostatní brandy packety nemají)
// ----------------------------------------------------------

const PACKAGES = {
  'tivoli': [
    {
      slug: 'tech', name: 'TECH paket',
      description: 'Asistenční výbava: bezklíčové odemykání + start, vnější zpětná zrcátka s LED směrovkami a elektrickým sklopením, elektronický zámek sloupku řízení.',
      features: ['Bezklíčové odemykání a startování', 'Elektronický zámek sloupku řízení (ESCL)', 'Vnější zrcátka s LED směrovkami, el. sklopná'],
      pricing_per_trim: { 'style': 19900 },
      sort: 1,
    },
    {
      slug: 'led', name: 'LED paket',
      description: 'LED světlomety s manuálním výškovým nastavením + automatické dálkové. Dostupné pouze v kombinaci s TECH paketem.',
      features: ['LED světlomety s manuálním výškovým nastavením', 'LED směrovky', 'Automatické přepínání dálkových světel (HBA)'],
      pricing_per_trim: { 'style': 16900 },
      sort: 2,
    },
    {
      slug: 'style-plus', name: 'STYLE+ paket',
      description: 'Komfortní výbava nad rámec Style: vyhřívaný kožený volant, dvouzónová klima, LED mlhové světlomety, privacy glass.',
      features: ['Vyhřívaný kožený volant', 'Dvouzónová automatická klima', 'LED přední mlhová světla', 'Privacy glass na zadních sklech', 'Střešní ližiny (stříbrná/černá)'],
      pricing_per_trim: { 'style': 24900 },
      sort: 3,
    },
    {
      slug: 'black', name: 'BLACK paket',
      description: 'Sportovní vzhled: černá ALU kola Diamond Cutting + černé designové prvky exteriéru.',
      features: ['18" černá ALU kola "Diamond Cutting"', 'Černá mřížka chladiče', 'Černé lemy a ližiny'],
      pricing_per_trim: { 'style': 18900 },
      sort: 4,
    },
  ],

  'korando': [
    {
      slug: 'style-plus', name: 'STYLE+ paket',
      description: 'U Style+ AKCE: ZDARMA (v hodnotě 30 000 Kč). U Elegant a Premium standardně součástí. Dvouzónová klima, vyhřívaný volant, signalizace parkování vpředu, textilní koberce, pevná podlaha kufru, 220V zásuvka.',
      features: ['Dvouzónová automatická klima', 'Vyhřívaný kožený volant', 'Signalizace vzdálenosti při parkování vpředu', 'Textilní koberce', 'Pevná podlaha zavazadlového prostoru', '220V el. zásuvka', 'Střešní ližiny stříbrné', 'Bezdrátové nabíjení 15W (Style+)'],
      pricing_per_trim: { 'style': null, 'style-plus': 0, 'elegant': 'standard', 'premium': 'standard' },
      sort: 1,
    },
    {
      slug: 'tech', name: 'TECH paket',
      description: 'Bezpečnostní balíček SAFETY PACK + bezklíčový vstup. Obsahuje BSD, LCA, EAF, RCTA (pro AT s automatickou intervencí RCTA-i).',
      features: ['Detekce slepého úhlu (BSD)', 'Asistent změny jízdního pruhu (LCA)', 'Asistent bezpečného vystoupení z vozu (EAF)', 'Výstraha zadního příčného provozu (RCTA / RCTA-i)', 'Bezklíčové odemykání a startování', 'Elektronický zámek sloupku řízení (ESCL)'],
      pricing_per_trim: { 'style': null, 'style-plus': 35900, 'elegant': null, 'premium': 'standard' },
      sort: 2,
    },
    {
      slug: 'acc-pack', name: 'ACC PACK',
      description: 'Adaptivní tempomat + el. parkovací brzda + funkce Auto Hold. Pouze v kombinaci s automatickou převodovkou.',
      features: ['Adaptivní tempomat (ACC)', 'Elektronická parkovací brzda (EPB)', 'Funkce Auto Hold (CVP)'],
      pricing_per_trim: { 'style': null, 'style-plus': 9900, 'elegant': 9900, 'premium': 'standard' },
      sort: 3,
    },
    {
      slug: 'premium-plus', name: 'PREMIUM+ paket',
      description: 'Top vybavení: LED ambient, SAFETY PACK, ACC PACK, elektrické víko kufru SMART. U Premium standardně.',
      features: ['LED ambientní osvětlení přístrojové desky a výplní dveří', 'SAFETY PACK (BSD+LCA+EAF+RCTA-i)', 'ACC PACK (adaptivní tempomat)', 'Elektrické ovládání víka kufru SMART'],
      pricing_per_trim: { 'style': null, 'style-plus': null, 'elegant': null, 'premium': 'standard' },
      sort: 4,
    },
    {
      slug: 'black', name: 'BLACK paket',
      description: '19" černá ALU "Diamond Cutting" + sportovní vzhled. NELZE kombinovat s hnědým koženým paketem.',
      features: ['19" černá ALU kola "Diamond Cutting"', 'Pneumatiky 235/50', 'Černé designové prvky'],
      pricing_per_trim: { 'style': null, 'style-plus': null, 'elegant': null, 'premium': 35900 },
      sort: 5,
    },
    {
      slug: 'hnedy-kozeny', name: 'Hnědý kožený paket',
      description: 'Hnědé kožené sedadla + výplně. POUZE ze skladových zásob a s PREMIUM+ paketem. Nelze s BLACK paketem.',
      features: ['Hnědé kožené sedadla', 'Hnědé kožené výplně dveří', 'Hnědé kožené prvky interiéru'],
      pricing_per_trim: { 'style': null, 'style-plus': null, 'elegant': null, 'premium': 5900 },
      sort: 6,
    },
  ],

  'torres': [
    {
      slug: 'club-plus', name: 'CLUB+ paket',
      description: 'Vyhřívaný volant, vyhřívání předních sedadel, vnitřní zrcátko auto-stmívání. U Style/Premium standardně.',
      features: ['Vyhřívaný volant', 'Vyhřívání předních sedadel', 'Vnitřní zpětné zrcátko s auto-stmíváním', 'Elektrické ovládání předních a zadních oken (řidič one-touch)'],
      pricing_per_trim: { 'club': 14900, 'style': 'standard', 'premium': 'standard' },
      sort: 1,
    },
    {
      slug: 'safety', name: 'SAFETY paket',
      description: 'Detekce slepého úhlu + varování při změně jízdního pruhu. Vyžadováno pro BLACK paket.',
      features: ['Detekce slepého úhlu (BSD)', 'Varování při změně jízdního pruhu (LCW)'],
      pricing_per_trim: { 'club': null, 'style': 14900, 'premium': 'standard' },
      sort: 2,
    },
    {
      slug: 'black', name: 'BLACK paket',
      description: '20" černá ALU "Diamond Cut" + SPACE černá metalická + sportovní prvky. POUZE se SAFETY paketem a textilními sedačkami.',
      features: ['20" černá ALU "Diamond Cut" 245/45 R20', 'SPACE černá metalická barva', 'Černý sloupek', 'Černý přední a zadní nárazník', 'Černý kryt zrcátek'],
      pricing_per_trim: { 'club': null, 'style': 24900, 'premium': null },
      sort: 3,
    },
    {
      slug: 'kamera-360', name: '360° kamera AMS',
      description: '360stupňová kamera (AMS). U Style pouze v kombinaci s BLACK paketem. U Premium standardně.',
      features: ['360° kamera AMS s panoramatickým pohledem'],
      pricing_per_trim: { 'club': null, 'style': 19900, 'premium': 'standard' },
      sort: 4,
    },
  ],

  'torres-hev': [
    {
      slug: 'club-plus', name: 'CLUB+ paket',
      description: 'Stejné jako Torres ICE — vyhřívaný volant, vyhřívání předních sedadel, auto-stmívání.',
      features: ['Vyhřívaný volant', 'Vyhřívání předních sedadel', 'Auto-stmívání vnitřního zrcátka'],
      pricing_per_trim: { 'club': 14900, 'style': 'standard', 'premium': 'standard' },
      sort: 1,
    },
    {
      slug: 'safety', name: 'SAFETY paket',
      description: 'BSD + LCW.',
      features: ['Detekce slepého úhlu (BSD)', 'Varování při změně jízdního pruhu (LCW)'],
      pricing_per_trim: { 'club': null, 'style': 14900, 'premium': 'standard' },
      sort: 2,
    },
    {
      slug: 'black', name: 'BLACK paket',
      description: '20" černá ALU + SPACE černá + sportovní prvky.',
      features: ['20" černá ALU "Diamond Cut"', 'SPACE černá metalická', 'Černé exteriérové prvky'],
      pricing_per_trim: { 'club': null, 'style': 24900, 'premium': null },
      sort: 3,
    },
  ],

  'torres-evx': [
    {
      slug: 'tech', name: 'TECH paket',
      description: 'Plný bezpečnostní balíček EVX: BSW, BSA, LCW, SEW, RCTA, asistent při křižovatkách (JC), asistent při riziku čelního střetu (HO).',
      features: ['Detekce slepého úhlu (BSW)', 'Asistent BSA', 'Varování při změně pruhu (LCW)', 'Varování pro bezpečné vystoupení (SEW)', 'RCTA', 'Asistent při křižovatkách (JC)', 'Asistent při riziku čelního střetu (HO)'],
      pricing_per_trim: { 'style': null, 'premium': 34900 },
      sort: 1,
    },
    {
      slug: 'premium-plus', name: 'PREMIUM+ paket',
      description: '360° kamera + 20" Diamond Cut ALU. POUZE v kombinaci s TECH paketem.',
      features: ['360° kamera AMS', '20" ALU "Diamond Cut" 245/45 R20'],
      pricing_per_trim: { 'style': null, 'premium': 29900 },
      sort: 2,
    },
    {
      slug: 'stresni-okno', name: 'Střešní okno',
      description: 'Panoramatická prosklená střecha. POUZE v kombinaci s PREMIUM+ paketem. Nelze kombinovat s černou střechou.',
      features: ['Panoramatická prosklená střecha (ISP)'],
      pricing_per_trim: { 'style': null, 'premium': 14900 },
      sort: 3,
    },
    {
      slug: 'cerna-kuze', name: 'Černá kůže',
      description: 'Černé kožené sedadla a loketní opěrky. POUZE v kombinaci s PREMIUM+ paketem.',
      features: ['Černé kožené potahy sedadel', 'Černé kožené loketní opěrky'],
      pricing_per_trim: { 'style': null, 'premium': 14900 },
      sort: 4,
    },
    {
      slug: 'dvoutonova-seda-kuze', name: 'Dvoutónová šedá kůže',
      description: 'Dvoutónové šedé kožené potahy. POUZE v kombinaci s PREMIUM+ paketem.',
      features: ['Dvoutónové šedé kožené potahy sedadel', 'Šedé kožené loketní opěrky'],
      pricing_per_trim: { 'style': null, 'premium': 14900 },
      sort: 5,
    },
  ],

  'actyon': [
    {
      slug: 'tech', name: 'TECH paket',
      description: 'Asistenční balíček: BSD, LCA, RCTA, bezklíčový vstup.',
      features: ['Detekce slepého úhlu (BSD)', 'Asistent změny pruhu (LCA)', 'Výstraha zadního příčného provozu (RCTA)', 'Bezklíčové odemykání a startování'],
      pricing_per_trim: { 'style': 29900, 'premium': 'standard' },
      sort: 1,
    },
    {
      slug: 'premium-plus', name: 'PREMIUM+ paket',
      description: '360° kamera + LED ambient + el. víko kufru SMART. U Premium standardně.',
      features: ['360° kamera AMS', 'LED ambientní osvětlení', 'Elektrické víko kufru SMART', 'Bezdrátové nabíjení'],
      pricing_per_trim: { 'style': null, 'premium': 'standard' },
      sort: 2,
    },
    {
      slug: 'black', name: 'BLACK paket',
      description: 'Černé ALU + sportovní prvky exteriéru.',
      features: ['Černá ALU kola "Diamond Cut"', 'Černé exteriérové prvky'],
      pricing_per_trim: { 'style': null, 'premium': 24900 },
      sort: 3,
    },
  ],

  'actyon-hev': [
    {
      slug: 'tech', name: 'TECH paket',
      description: 'Hybridní asistenční balíček: BSD, LCA, RCTA, bezklíčový vstup.',
      features: ['Detekce slepého úhlu (BSD)', 'Asistent změny pruhu (LCA)', 'RCTA', 'Bezklíčové odemykání'],
      pricing_per_trim: { 'style': 29900, 'premium': 'standard' },
      sort: 1,
    },
    {
      slug: 'premium-plus', name: 'PREMIUM+ paket',
      description: '360° kamera + LED ambient. U Premium standardně.',
      features: ['360° kamera AMS', 'LED ambient', 'Elektrické víko kufru SMART'],
      pricing_per_trim: { 'style': null, 'premium': 'standard' },
      sort: 2,
    },
    {
      slug: 'black', name: 'BLACK paket',
      description: 'Černé ALU + sportovní prvky.',
      features: ['Černá ALU kola', 'Černé exteriérové prvky'],
      pricing_per_trim: { 'style': null, 'premium': 24900 },
      sort: 3,
    },
  ],

  'rexton': [
    {
      slug: 'club-plus', name: 'CLUB+ paket',
      description: 'Vyhřívaný volant, bezklíčové odemykání, el. zámek sloupku řízení. U CLEVER/PREMIUM standardně.',
      features: ['Vyhřívaný volant', 'Bezklíčové odemykání a startování', 'Elektronický zámek sloupku řízení (ESCL)'],
      pricing_per_trim: { 'club': 19900, 'clever': 'standard', 'premium': 'standard' },
      sort: 1,
    },
    {
      slug: 'grip-plus', name: 'GRIP+ paket',
      description: 'Uzávěrka diferenciálu zadní nápravy + 10-prvková zadní náprava Multilink s nezávislým zavěšením. POUZE u CLEVER trim.',
      features: ['Uzávěrka diferenciálu zadní nápravy', '10-prvková zadní náprava Multilink', 'Nezávislé zavěšení'],
      pricing_per_trim: { 'club': null, 'clever': 'standard', 'premium': null },
      sort: 2,
    },
    {
      slug: 'clever-plus', name: 'CLEVER+ paket',
      description: 'El. víko kufru SMART, bezdrátové nabíjení, ambient osvětlení, podsvícené prahové lišty.',
      features: ['Elektrické ovládání víka kufru SMART', 'Bezdrátové nabíjení', 'Ambientní osvětlení interiéru', 'Podsvícené přední prahové lišty'],
      pricing_per_trim: { 'club': null, 'clever': 'standard', 'premium': 'standard' },
      sort: 3,
    },
    {
      slug: 'premium-plus', name: 'PREMIUM+ paket',
      description: '360° kamera + paměť sedadla + sluneční roletky 2. řady + el. víko kufru SMART. U Premium standardně.',
      features: ['360° kamera AMS', 'Paměť el. sedadla řidiče + zrcátek', 'Sluneční roletky 2. řady sedadel', 'Elektrické víko kufru SMART'],
      pricing_per_trim: { 'club': null, 'clever': null, 'premium': 'standard' },
      sort: 4,
    },
    {
      slug: 'black', name: 'BLACK paket',
      description: 'SPACE černá nebo PEARL bílá metalická + 20" černá SPUTTERING + sportovní prvky. POUZE u PREMIUM.',
      features: ['SPACE černá / PEARL bílá metalická', '20" černá SPUTTERING ALU 255/50 R20', 'Černá mřížka chladiče', 'Černé ližiny'],
      pricing_per_trim: { 'club': null, 'clever': null, 'premium': 50000 },
      sort: 5,
    },
    {
      slug: 'stresni-okno', name: 'Střešní okno',
      description: 'Panoramatická střecha. POUZE v kombinaci s PREMIUM+ paketem.',
      features: ['Panoramatická prosklená střecha (ISP)'],
      pricing_per_trim: { 'club': null, 'clever': null, 'premium': 14900 },
      sort: 6,
    },
    {
      slug: 'sputtering-20', name: '20" SPUTTERING ALU',
      description: '20" SPUTTERING ALU kola 255/50 R20. NELZE kombinovat s BLACK paketem.',
      features: ['20" SPUTTERING ALU kola', 'Pneumatiky 255/50 R20'],
      pricing_per_trim: { 'club': null, 'clever': null, 'premium': 17900 },
      sort: 7,
    },
  ],

  'musso-grand': [
    {
      slug: 'style-plus', name: 'STYLE+ paket',
      description: 'AKČNÍ CENA 20 000 Kč (původně 24 200). Vyhřívaný kožený volant, dvouzónová klima, LED mlhovky, privacy glass, střešní ližiny.',
      features: ['Vyhřívaný kožený volant', 'Dvouzónová automatická klima', 'LED přední mlhová světla', 'Privacy glass + solar/akustické čelní sklo', 'Střešní ližiny (stříbrná/černá)'],
      pricing_per_trim: { 'style-4wd': 20000, 'premium-4wd': 'standard' },
      sort: 1,
    },
    {
      slug: 'premium-plus', name: 'PREMIUM+ paket',
      description: 'BSA+LCW, RCTA, SEW, 360° kamera AMS, uzávěrka diferenciálu, mřížka chladiče Premium. U Premium standardně.',
      features: ['BSA + LCW', 'RCTA (Asistent zadního příčného provozu)', 'SEW (Varování pro bezpečné vystoupení)', '360° kamera AMS', 'Uzávěrka diferenciálu', 'Mřížka chladiče Premium'],
      pricing_per_trim: { 'style-4wd': null, 'premium-4wd': 'standard' },
      sort: 2,
    },
    {
      slug: 'black', name: 'BLACK paket',
      description: 'AKČNÍ CENA 15 000 Kč (původně 18 150). Černá mřížka, černý přední nárazník, černé logo a ližiny. POUZE v kombinaci s PREMIUM+ paketem.',
      features: ['Černá mřížka chladiče', 'Černý přední nárazník', 'Černé logo a ližiny', 'Černé kryty zrcátek', 'Černý rámeček volantu', 'Černé tlačítko start'],
      pricing_per_trim: { 'style-4wd': null, 'premium-4wd': 15000 },
      sort: 3,
    },
    {
      slug: 'sputtering-20', name: '20" SPUTTERING ALU',
      description: 'AKČNÍ CENA 10 000 Kč (původně 12 100). NELZE kombinovat s BLACK paketem.',
      features: ['20" SPUTTERING ALU kola 255/50 R20'],
      pricing_per_trim: { 'style-4wd': null, 'premium-4wd': 10000 },
      sort: 4,
    },
    {
      slug: 'stresni-okno', name: 'Střešní okno + LED interiér',
      description: 'AKČNÍ CENA 10 000 Kč (původně 12 100). POUZE v kombinaci s PREMIUM+ paketem.',
      features: ['Panoramatická prosklená střecha', 'LED osvětlení interiéru'],
      pricing_per_trim: { 'style-4wd': null, 'premium-4wd': 10000 },
      sort: 5,
    },
  ],
};

// ----------------------------------------------------------
// EXECUTION
// ----------------------------------------------------------

async function findBySlug(collection, slug) {
  const res = await api('GET', `/items/${collection}?filter[slug][_eq]=${encodeURIComponent(slug)}&limit=1`);
  return res?.data?.[0] ?? null;
}

async function findModelYearByModelId(modelId) {
  const res = await api('GET', `/items/model_years?filter[model][_eq]=${modelId}&limit=1`);
  return res?.data?.[0] ?? null;
}

async function findPackage(modelYearId, slug) {
  const res = await api('GET', `/items/option_packages?filter[model_year][_eq]=${modelYearId}&filter[slug][_eq]=${encodeURIComponent(slug)}&limit=1`);
  return res?.data?.[0] ?? null;
}

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('  SFR Motor — Seed Option Packages (KGM)');
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

  let created = 0, skipped = 0;

  for (const [modelSlug, packages] of Object.entries(PACKAGES)) {
    info(`▸ ${modelSlug}`);

    const model = await findBySlug('models', modelSlug);
    if (!model) {
      warn(`  Model ${modelSlug} neexistuje, skipuji`);
      continue;
    }

    const modelYear = await findModelYearByModelId(model.id);
    if (!modelYear) {
      warn(`  ModelYear pro ${modelSlug} neexistuje, skipuji`);
      continue;
    }

    for (const pkg of packages) {
      const existing = await findPackage(modelYear.id, pkg.slug);
      if (existing) {
        skip(`    Package "${pkg.name}" už existuje`);
        skipped++;
        continue;
      }

      await api('POST', '/items/option_packages', {
        model_year: modelYear.id,
        slug: pkg.slug,
        name: pkg.name,
        description: pkg.description,
        features: pkg.features,
        pricing_per_trim: pkg.pricing_per_trim,
        sort: pkg.sort ?? 0,
      });

      // Sumarizuj ceny pro log
      const prices = Object.entries(pkg.pricing_per_trim)
        .filter(([_, v]) => v !== null)
        .map(([trim, v]) => v === 'standard' ? `${trim}=S` : v === 0 ? `${trim}=ZDARMA` : `${trim}=${v.toLocaleString('cs-CZ')}`)
        .join(', ');

      ok(`    "${pkg.name}" — ${prices}`);
      created++;
    }
  }

  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('  Souhrn');
  console.log('═══════════════════════════════════════════════');
  console.log(`  Packetů vytvořeno: ${created}, skipnuto: ${skipped}`);
  console.log('');
  console.log('Co dál:');
  console.log('  Admin → Stock Vehicles → upravuj vůz → najdi sekci');
  console.log('  "Option Packages" → klikni "Add" → vyber relevantní packety');
  console.log('  (zatím se zobrazí všechny packety napříč modely — bez cascading filter)');
  console.log('');
  console.log('Cena vozu se počítá jako:');
  console.log('  trim_level.list_price + součet pricing_per_trim[trim_level.slug] vybraných packetů');
  console.log('');
  console.log('Validace dependencies (TECH před LED, BLACK ne s hnědým) NENÍ automatická.');
  console.log('Admin musí dávat pozor — varování jsou v description packetu.');

  rl.close();
}

main().catch((e) => { console.log(`❌ ${e.message}`); rl.close(); });
