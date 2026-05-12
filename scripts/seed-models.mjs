#!/usr/bin/env node
/**
 * SFR Motor — Seed všech modelů z MODELY.md do Directusu
 *
 * Vytvoří:
 *  • 2 sub-brands (OMODA, JAECOO) pod brand "OMODA & JAECOO"
 *  • 9 KGM modelů (Tivoli, Korando, Torres, Torres HEV, Torres EVX, Actyon, Actyon HEV, Rexton, Musso Grand)
 *  • 7 OMODA & JAECOO modelů (Omoda 5, 5 SHS-H, 5 EV, 9 SHS, Jaecoo 5, 7, 7 SHS)
 *  • 2 Farizon modely (SV, V6E)
 *
 * Idempotentní: pokud slug už existuje, model se přeskočí (nebo update přes flag).
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
    headers: {
      'Content-Type': 'application/json',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) {
    const e = new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json?.errors ?? json)}`);
    e.status = res.status; e.body = json;
    throw e;
  }
  return json;
}

const ok   = (m) => console.log(`✅  ${m}`);
const skip = (m) => console.log(`⏭️   ${m}`);
const warn = (m) => console.log(`⚠️   ${m}`);
const err  = (m) => console.log(`❌  ${m}`);
const info = (m) => console.log(`ℹ️   ${m}`);

// ----------------------------------------------------------
// SEED DATA
// ----------------------------------------------------------

const SUB_BRANDS = [
  { slug: 'omoda',  name: 'OMODA',  primary_color: '#0F1B2E', description: 'Městská elegance a technologie pro mladou generaci.', instagram_url: 'https://www.instagram.com/omoda_cz',  facebook_url: 'https://www.facebook.com/omodacz', sort: 1 },
  { slug: 'jaecoo', name: 'JAECOO', primary_color: '#1F3D2F', description: 'Styl pro město, schopnosti pro dobrodružství.',          instagram_url: 'https://www.instagram.com/jaecoo_cz', facebook_url: 'https://www.facebook.com/jaecoocz', sort: 2 },
];

// Helper pro multi-řádkové popisy (Astro je převede z \n na <br>)
const desc = (s) => s.trim();

const KGM_MODELS = [
  {
    slug: 'tivoli', name: 'Tivoli',
    tagline: 'Inspirace pro každý den',
    body_type: 'suv', fuel_type: 'petrol', price_from: 459900,
    description: desc(`Tivoli je výrazem moderního urbánního stylu — kompaktní SUV, které spojuje osobité charisma s každodenní praktičností.

Stylový vzhled podtrhuje nový design přední masky dokreslený charakteristickými červenými prvky. Elegance a jedinečnost dotváří osobité charisma tohoto kompaktního modelu, který vám bude inspirací pro každý den.

Výrazné boční linie modelu Tivoli evokují sebevědomý charakter, s kterým se tento model pouští nejen do městského provozu.`),
    sort: 1,
  },
  {
    slug: 'korando', name: 'Korando',
    tagline: 'Moderní SUV pro dnešní dobu',
    body_type: 'suv', fuel_type: 'petrol', price_from: 479900,
    description: desc(`Stylové Korando je opravdové SUV, vytvářející jedinečnou rovnováhu mezi praktičností a pohodlím. Korando přináší potěšení z jízdy, a to především díky svému komfortnímu a přesnému řízení. Pod ochrannou rukou nejnovějších bezpečnostních technologií se budete cítit v Korandu sebejistější a maximálně v bezpečí.

Korando si jde sebevědomě svou vlastní cestou, je výstižným představitelem moderních hodnot a chytrých řešení. Silný a jedinečný – to je charakter vozu Korando.`),
    sort: 2,
  },
  {
    slug: 'torres', name: 'Torres',
    tagline: 'Dobrodružství s moderním SUV',
    body_type: 'suv', fuel_type: 'petrol', price_from: 599900,
    description: desc(`Torres del Paine, národní park UNESCO v Chile, je snem všech dobrodruhů. KGM Torres je inspirovaný scenérií této nádherné přírodní rezervace.

Robustní, odvážný, sebevědomý – Torres byl od základu navržen pro vaše další dobrodružství. Svými ostře řezanými světlomety a světly denního svícení, zadními LED světly a nápaditým krytem zadních dveří inspirovaným rezervním kolem off-roadů láká všechny dobrodruhy.

KGM Torres – to je spojení tradičních předností vozů SUV, jako je robustnost, terénní schopnosti, bezpečnost, a zbrusu nového autentického designu, odvážného a sebevědomého charisma.`),
    sort: 3,
  },
  {
    slug: 'torres-hev', name: 'Torres HEV',
    tagline: 'Hybridní síla pro každodenní jízdu',
    body_type: 'suv', fuel_type: 'hybrid', price_from: 649900,
    description: desc(`KGM Torres bourá hranice. Nyní s pokročilým hybridním systémem, který přináší ještě větší nadšení za volantem.

S výraznými liniemi karoserie a působivým tvarem ztělesňuje Torres Hybrid podstatu moderního SUV – sebevědomý, schopný a nezaměnitelně originální.

Odvážné, hranaté lemy kol a ostrá, rovná linie táhnoucí se od přední po zadní část dodávají Torresu Hybridu impozantní vzhled, vycházející z tradice značky.`),
    sort: 4,
  },
  {
    slug: 'torres-evx', name: 'Torres EVX',
    tagline: 'Elektrické SUV z Koreje',
    body_type: 'suv', fuel_type: 'ev', price_from: 849900,
    description: desc(`Užijte si model Torres – nyní také elektricky. TORRES EVX vás na první pohled zaujme odvážným a moderním designem, který zřetelně odráží jeho dynamický charakter. Dominantou přední části jsou jedinečná LED světla denního svícení, která horizontálně protkávají celou přední masku.

Ostře řezané tvary a off-roadový charakter láká dobrodruhy všech generací.

207 koní, 339 Nm a redukční převodovka v moderním elektrickém SUV.`),
    sort: 5,
  },
  {
    slug: 'actyon', name: 'Actyon',
    tagline: 'Nový horizont vašeho stylu',
    body_type: 'suv', fuel_type: 'petrol', price_from: 629900,
    description: desc(`Rozpoznatelný design KGM, inspirovaný korejskou vlajkou a souhvězdím Velkého vozu, probouzí v jedinečnou krásu modelu Actyon sofistikovaný design světel.

Geon, Gon, Gam, Ri — Nebe, Země, Voda, Oheň. Tyto čtyři prvky tvoří korejskou vlajku a inspirují celý charakter modelu Actyon.

Sportovní střešní linie, odvážné charakterové linie a elegantně zakřivená záď definují dynamický design tohoto městského SUV kupé. Precizně sladěné zadní prvky vytvářejí luxusní dojem, ideální pro ty, kteří ocení jemnost i sofistikovanost.`),
    sort: 6,
  },
  {
    slug: 'actyon-hev', name: 'Actyon HEV',
    tagline: 'Ideální pro život ve městě',
    body_type: 'suv', fuel_type: 'hybrid', price_from: 679900,
    description: desc(`Nový horizont vašeho stylu. Design světel je inspirovaný korejskou vlajkou a souhvězdím Velkého vozu a dodává modelu Actyon jedinečný styl a eleganci.

Sportovní střešní linie, odvážné charakterové linie a elegantně zakřivená záď definují dynamický design tohoto městského SUV kupé. Precizně sladěné zadní prvky vytvářejí luxusní dojem.

Hybridní pohon e-DHT s točivým momentem 300 Nm.`),
    sort: 7,
  },
  {
    slug: 'rexton', name: 'Rexton',
    tagline: 'Luxus a elegance',
    body_type: 'suv', fuel_type: 'diesel', price_from: 899900,
    description: desc(`Jedinečné schopnosti. Jedinečná přitažlivost. Jedinečné auto.

Jak se na luxusní a robustní SUV patří, má Rexton výraznou masku s diagonálním vzorem pevného řetězu evokujícím jeho sílu. Nahoře je lemován stylovými LED světlomety a dole nárazníkem v barvě karoserie s ostře řezanými liniemi. Výsledný dojem z Rextona je osobitý a sebevědomý.

Rexton G4 2.2 e-XDI, 202 koní, 441 Nm — vlajková loď KGM.`),
    sort: 8,
  },
  {
    slug: 'musso-grand', name: 'Musso Grand',
    tagline: 'Robustní a dynamické zároveň',
    body_type: 'pickup', fuel_type: 'diesel', price_from: 849900,
    description: desc(`Musso Grand nabízí ideální proporce tradičního pickupu na rámu ve spojení se svým poutavým exteriérem. Vyniká jak v terénu, tak ve městě - je dokonalým partnerem pro práci i zábavu.

4WD pohon, robustní rám, vysoká nosnost — pro každého, kdo potřebuje pickup pro skutečnou práci.`),
    sort: 9,
  },
];

const OMODA_MODELS = [
  {
    slug: 'omoda-5', name: 'Omoda 5', subBrand: 'omoda',
    tagline: 'Inteligentní design pro ty, kteří chtějí víc',
    body_type: 'suv', fuel_type: 'petrol', price_from: 659000,
    description: desc(`OMODA5 ztělesňuje harmonii mezi moderním luxusem, technologickou vyspělostí a smyslem pro detail. Navržen pro ty, kteří nehledají kompromisy, ale požadují to nejlepší v každém směru. Vstupte do nové éry – s elegancí, výkonem a vizí budoucnosti.

Sofistikovaný design exteriéru, podtržený dynamickými liniemi, unikátní světelnou signaturou a charakteristickou maskou chladiče, působí sebevědomě a současně kultivovaně. OMODA5 zaujme na první pohled – a nezůstane jen u něj.

Záruka 7 let nebo 150 000 km.`),
    sort: 1,
  },
  {
    slug: 'omoda-5-shs-h', name: 'Omoda 5 SHS-H', subBrand: 'omoda',
    tagline: 'Síla hybridu',
    body_type: 'suv', fuel_type: 'hybrid', price_from: 629000,
    description: desc(`OMODA5 SHS-H přináší moderní hybridní pohon navržený pro skutečný provoz – plynulý, úsporný a příjemně svižný. Je to vůz pro řidiče, kteří chtějí stylové SUV s technologií, jež umí výrazně snížit spotřebu a zároveň zachovat jednoduchost používání bez změny návyků.

OMODA5 SHS-H je prvním hybridním modelem značky navrženým v duchu filozofie Art in Motion. Charakteristická diamantová maska chladiče, integrovaná do výrazné přední masky, dodává vozu futuristický vzhled.

Dojezd dle WLTP 1 000 km, systémový výkon 165 kW.`),
    sort: 2,
  },
  {
    slug: 'omoda-5-ev', name: 'Omoda 5 EV', subBrand: 'omoda',
    tagline: 'Síla inovace, energie budoucnosti',
    body_type: 'suv', fuel_type: 'ev', price_from: 749000,
    description: desc(`OMODA5 EV představuje revoluci v oblasti elektromobility – spojuje špičkový design, inteligentní technologie a ekologickou efektivitu do jediného, dokonale vyladěného celku.

S futuristickou siluetou, pokročilými asistenčními systémy a chytrými funkcemi pro snadné ovládání přináší OMODA5 EV nový standard pro každodenní jízdu i dlouhé cesty.

150 kW elektromotor, baterie 61 kWh, dojezd 402 km podle WLTP.`),
    sort: 3,
  },
  {
    slug: 'omoda-9-shs', name: 'Omoda 9 SHS', subBrand: 'omoda',
    tagline: 'Nová úroveň luxusu a výkonu',
    body_type: 'suv', fuel_type: 'phev', price_from: 1199000,
    description: desc(`OMODA9 je symbolem inovace, elegance a dynamiky. Prémiové materiály, pokročilé technologie a unikátní design vytvářejí vůz, který posouvá hranice komfortu i výkonu.

Omoda9 Super Hybrid spojuje pokročilou hybridní technologii s mimořádným výkonem a jistotou pohonu všech kol. Sofistikovaný superhybridní systém dosahuje výkonu 537 koní a umožňuje akceleraci z 0 na 100 km/h za pouhých 4,9 sekundy.

Vlajková loď značky OMODA — plug-in hybrid AWD s dojezdem 1 100 km.`),
    sort: 4,
  },
  {
    slug: 'jaecoo-5', name: 'Jaecoo 5', subBrand: 'jaecoo',
    tagline: 'Kompaktní SUV pro každý den',
    body_type: 'suv', fuel_type: 'petrol', price_from: 629000,
    description: desc(`JAECOO5 přináší do světa kompaktních SUV svěží energii, sebevědomý design a technologie, které jste dosud znali spíše z vyšších tříd. Robustní silueta, výrazná příď a důraz na funkční detaily jasně ukazují, že tohle auto se cítí stejně jistě v úzkých ulicích města jako na rozbité okresce či polní cestě.

Jaecoo5 na první pohled zaujme výraznou, sebevědomou siluetou, která kombinuje robustní SUV proporce s čistými, moderními liniemi. Vysoko posazená příď, široký postoj vozu a výrazný světelný podpis vytvářejí dojem vozu připraveného jak na městskou džungli, tak na víkend mimo asfalt.`),
    sort: 5,
  },
  {
    slug: 'jaecoo-7', name: 'Jaecoo 7', subBrand: 'jaecoo',
    tagline: 'Styl města, duše dobrodruha',
    body_type: 'suv', fuel_type: 'petrol', price_from: 759000,
    description: desc(`JAECOO7 představuje definici inteligentního SUV. Spojuje progresivní design s výjimečným komfortem, terénními schopnostmi a technologiemi, které posouvají každou cestu na novou úroveň. Vůz je navržen pro moderní objevitele, kteří chtějí spojit každodenní praktičnost s autentickým zážitkem z jízdy.

Když se přiblíží, okamžitě zaujme jeho silueta – sebejistá, dynamická a elegantní. Ostře rýsované linie, vyvážené proporce a precizně modelované detaily vytvářejí dojem dokonalé harmonie.

AWD pohon, 4WD jízdní režimy (bahno, sníh, písek, offroad).`),
    sort: 6,
  },
  {
    slug: 'jaecoo-7-shs', name: 'Jaecoo 7 SHS', subBrand: 'jaecoo',
    tagline: 'Plug-in hybrid pro moderní cestovatele',
    body_type: 'suv', fuel_type: 'phev', price_from: 929000,
    description: desc(`JAECOO7 SHS výrazně posouvá koncept inteligentního SUV díky plug-in hybridní technologii. Tento model spojuje moderní a odvážný design s maximálním komfortem, špičkovými terénními schopnostmi a pokročilými technologiemi, přičemž zároveň přináší ekologičtější provoz a nižší spotřebu.

Designová filozofie JAECOO propojuje špičkovou technologii s vytříbenou estetikou, čímž proměňuje vozidla v umělecká díla. Klíčovým prvkem je funkční elegance a inovativní uživatelský zážitek.

Kombinovaný dojezd 1 200 km, čistě elektrický dojezd 91 km, celkový výkon 205 kW.`),
    sort: 7,
  },
];

const FARIZON_MODELS = [
  {
    slug: 'farizon-sv', name: 'Farizon SuperVan',
    tagline: 'Největší prostor ve třídě',
    body_type: 'van', fuel_type: 'ev',
    description: desc(`Elektrická dodávka SV (SuperVan) — největší prostor ve své třídě zajišťuje plynulou a bezstarostnou jízdu.

Moderní elektrický pohon pro firmy, které chtějí kombinovat ekonomický provoz s ekologickým přístupem k mobilitě.`),
    sort: 1,
  },
  {
    slug: 'farizon-v6e', name: 'Farizon V6E',
    tagline: 'Rychlé nabíjení, velký dojezd',
    body_type: 'van', fuel_type: 'ev',
    description: desc(`Top-tier brand baterie umožňují rychlé nabíjení z 20 % na 80 % za 30 minut, s dojezdem více než 285 km.

Kompaktní elektrická dodávka pro městské podnikatele — flexibilní, ekonomická a udržitelná.`),
    sort: 2,
  },
];

// ----------------------------------------------------------
// HELPERS
// ----------------------------------------------------------

async function findBySlug(collection, slug) {
  const res = await api('GET', `/items/${collection}?filter[slug][_eq]=${encodeURIComponent(slug)}&limit=1`);
  return res?.data?.[0] ?? null;
}

async function createOrUpdate(collection, slug, data) {
  const existing = await findBySlug(collection, slug);
  if (existing) {
    skip(`  ${collection}/${slug} už existuje (id=${existing.id})`);
    return existing;
  }
  const res = await api('POST', `/items/${collection}`, data);
  ok(`  ${collection}/${slug} vytvořeno (id=${res.data.id})`);
  return res.data;
}

// ----------------------------------------------------------
// MAIN
// ----------------------------------------------------------

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('  SFR Motor — Seed modely (18 modelů z MODELY.md)');
  console.log('═══════════════════════════════════════════════');
  console.log('');

  DIRECTUS_URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Admin email: ')).trim();
  const password = (await prompt('Admin heslo: ')).trim();
  console.log('');

  info(`Auth → ${DIRECTUS_URL}`);
  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth?.data?.access_token;
  if (!TOKEN) { err('Auth selhal'); process.exit(1); }
  ok('Auth OK');
  console.log('');

  // 1) Find brands
  info('Načítám značky (musí existovat ze setup-directus.mjs)...');
  const kgmBrand        = await findBySlug('brands', 'kgm');
  const omodaJaecooBrand = await findBySlug('brands', 'omoda-jaecoo');
  const farizonBrand    = await findBySlug('brands', 'farizon');

  if (!kgmBrand || !omodaJaecooBrand || !farizonBrand) {
    err('Některá značka chybí. Spusť nejdřív `node scripts/setup-directus.mjs`.');
    process.exit(1);
  }
  ok(`KGM (id=${kgmBrand.id}), OMODA & JAECOO (id=${omodaJaecooBrand.id}), Farizon (id=${farizonBrand.id})`);
  console.log('');

  // 2) Seed sub-brands
  info('Seedím sub-brands (OMODA, JAECOO)...');
  const subBrandIds = {};
  for (const sb of SUB_BRANDS) {
    const data = { ...sb, brand: omodaJaecooBrand.id };
    const created = await createOrUpdate('sub_brands', sb.slug, data);
    subBrandIds[sb.slug] = created.id;
  }
  console.log('');

  // 3) Seed KGM models
  info('Seedím KGM modely (9)...');
  for (const m of KGM_MODELS) {
    const data = {
      ...m,
      brand: kgmBrand.id,
      sub_brand: null,
      status: 'published',
    };
    await createOrUpdate('models', m.slug, data);
  }
  console.log('');

  // 4) Seed OMODA & JAECOO models
  info('Seedím OMODA & JAECOO modely (7)...');
  for (const m of OMODA_MODELS) {
    const { subBrand, ...rest } = m;
    const data = {
      ...rest,
      brand: omodaJaecooBrand.id,
      sub_brand: subBrandIds[subBrand] ?? null,
      status: 'published',
    };
    await createOrUpdate('models', m.slug, data);
  }
  console.log('');

  // 5) Seed Farizon models
  info('Seedím Farizon modely (2)...');
  for (const m of FARIZON_MODELS) {
    const data = {
      ...m,
      brand: farizonBrand.id,
      sub_brand: null,
      status: 'published',
    };
    await createOrUpdate('models', m.slug, data);
  }
  console.log('');

  console.log('═══════════════════════════════════════════════');
  console.log('  Hotovo! ✅');
  console.log('═══════════════════════════════════════════════');
  console.log('');
  console.log('Co se stalo:');
  console.log('  • 2 sub-brands (OMODA, JAECOO)');
  console.log('  • 9 KGM modelů');
  console.log('  • 7 OMODA & JAECOO modelů');
  console.log('  • 2 Farizon modely');
  console.log('');
  console.log('Webhook by měl spustit Vercel rebuild během ~30s.');
  console.log('Pak otevři: https://sfr-motor-test.vercel.app/kgm — uvidíš všechny 9 modelů.');
  console.log('');
  console.log('V Directus admin můžeš teď ke každému modelu doplnit fotky.');

  rl.close();
}

main().catch((e) => { err(e.message); rl.close(); process.exit(1); });
