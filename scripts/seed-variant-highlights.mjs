#!/usr/bin/env node
/**
 * SFR Motor — naseed highlights_panel + variant_badge_kind pro všechny modely
 * s variantami pohonu.
 *
 * Pokryté modely (best-effort detekce dle slugu):
 *   - KGM Torres        → 3 varianty: ICE / HEV / EVX
 *   - KGM Actyon        → 2 varianty: ICE / HEV
 *   - OMODA 5           → 3 varianty: ICE / HEV / EV (EVX badge)
 *   - JAECOO 7          → 2 varianty: ICE / HEV
 *
 * Texty jsou drafty — klient si je v Directus admin upraví (Models → Torres → Highlights panel).
 * Idempotentní — při --keep nepřepisuje existující data.
 *
 * Použití:
 *   cd web && node scripts/seed-variant-highlights.mjs           # přepíše vše
 *   cd web && node scripts/seed-variant-highlights.mjs --keep    # zachová existující
 *   cd web && node scripts/seed-variant-highlights.mjs --dry     # jen vypsat, nic nezapisovat
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rl = readline.createInterface({ input, output });
const prompt = (q) => rl.question(q);

let URL = '', TOKEN = '';
const keepExisting = process.argv.includes('--keep');
const dryRun       = process.argv.includes('--dry');

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

/* ──────────── HIGHLIGHTS DATABÁZE ────────────
 * Klíč = identifikátor (slug či label), hodnota = { kind, items[] }.
 * Pořadí v "rules" určuje prioritu — nejvíc specifické patterny první.
 */

const DATA = {
  // ─── KGM Torres ─────────────────────────
  TORRES_ICE: {
    kind: 'ICE',
    items: [
      { icon_kind: 'awd',          big: '4×4 i 2WD', lab: 'Na výběr',               note: 'Pohon předních i všech kol — podle ceny a potřeby.' },
      { icon_kind: 'tow',          big: '2 200 kg',  lab: 'Brzděný přívěs',         note: 'Stačí na karavan i větší přívěs.' },
      { icon_kind: 'transmission', big: '6st AT',    lab: 'Automatická převodovka', note: 'Plynulá a vyzkoušená Aisin v každé ceně.' },
    ],
  },
  TORRES_HEV: {
    kind: 'HEV',
    items: [
      { icon_kind: 'selfcharge', big: 'Bez nabíjení', lab: 'Self-charging hybrid', note: 'Jen tankujete — baterii dobíjí motor a brzdy.' },
      { icon_kind: 'range',      big: '1 100 km',     lab: 'Dojezd na nádrž',      note: 'Praha–Mnichov a zpět bez tankování.' },
      { icon_kind: 'fuel',       big: '5,3 l',        lab: 'Spotřeba komb.',       note: 'Nižší náklady než u 1.5 benzína.' },
    ],
  },
  TORRES_EVX: {
    kind: 'EVX',
    items: [
      { icon_kind: 'range',    big: '462 km',        lab: 'Dojezd WLTP',       note: 'Klidně až na hory — a zpět na jedno nabití.' },
      { icon_kind: 'charge',   big: '38 min',        lab: 'Nabití 10 → 80 %',  note: 'Stačí na kávu — a jedete dál.' },
      { icon_kind: 'heatpump', big: 'Tepelná pumpa', lab: 'V základní ceně',   note: 'V zimě nepoznáte. Žádný extra příplatek.' },
    ],
  },

  // ─── KGM Actyon ────────────────────────
  ACTYON_ICE: {
    kind: 'ICE',
    items: [
      { icon_kind: 'transmission', big: '6st AT',     lab: 'Automat',          note: 'Plynulá Aisin převodovka — vyzkoušená kombinace.' },
      { icon_kind: 'awd',          big: '4×4 i 2WD',  lab: 'Na výběr',         note: 'Pohon všech kol pro náročnější jízdu.' },
      { icon_kind: 'fuel',         big: '1.5 Turbo',  lab: 'Benzín',           note: 'Moderní turbo s rozumnou spotřebou.' },
    ],
  },
  ACTYON_HEV: {
    kind: 'HEV',
    items: [
      { icon_kind: 'selfcharge', big: 'Plný hybrid',     lab: 'Self-charging',    note: 'Žádné nabíjecí kabely — baterii doplníte sami.' },
      { icon_kind: 'fuel',       big: 'Nízká spotřeba',  lab: 'Úspora paliva',    note: 'Hybridní pohon šetří v městě i na dálnici.' },
      { icon_kind: 'range',      big: 'Velký dojezd',    lab: 'Na jednu nádrž',   note: 'Dlouhé trasy bez plánování zastávek.' },
    ],
  },

  // ─── OMODA 5 ───────────────────────────
  OMODA5_ICE: {
    kind: 'ICE',
    items: [
      { icon_kind: 'transmission', big: 'DCT 7st',    lab: 'Automat',          note: 'Plynulé řazení s rychlou odezvou.' },
      { icon_kind: 'fuel',         big: '1.6 Turbo',  lab: 'Benzín',           note: 'Moderní turbo s dobrou dynamikou a nízkou spotřebou.' },
      { icon_kind: 'awd',          big: '2WD',        lab: 'Pohon předních',   note: 'Lehčí konstrukce — nižší cena, nižší náklady.' },
    ],
  },
  OMODA5_HEV: {
    kind: 'HEV',
    items: [
      { icon_kind: 'selfcharge', big: 'Hybrid',          lab: 'Bez nabíjení',     note: 'Baterii doplní motor a rekuperace.' },
      { icon_kind: 'fuel',       big: 'Nízká spotřeba',  lab: 'Úspora paliva',    note: 'Hybrid v městském provozu šetří nejvíc.' },
      { icon_kind: 'range',      big: 'Dlouhé trasy',    lab: 'Dojezd na nádrž',  note: 'Dlouhá auta bez nutnosti nabíjet.' },
    ],
  },
  OMODA5_EV: {
    kind: 'EVX',
    items: [
      { icon_kind: 'range',    big: 'Plně elektrický',  lab: 'Dojezd WLTP',       note: 'Bez emisí, bez kompromisů na dojezdu.' },
      { icon_kind: 'charge',   big: 'DC rychlonabíjení', lab: 'Nabití na cestě',  note: 'Krátká pauza a jedete dál.' },
      { icon_kind: 'heatpump', big: 'Tepelná pumpa',    lab: 'V základní ceně',   note: 'V zimě úsporné vytápění bez ztráty dojezdu.' },
    ],
  },

  // ─── JAECOO 7 ──────────────────────────
  JAECOO7_ICE: {
    kind: 'ICE',
    items: [
      { icon_kind: 'awd',          big: '4×4 dostupné',  lab: 'AWD na výběr',     note: 'Pohon všech kol pro jistotu v každém ročním období.' },
      { icon_kind: 'transmission', big: 'DCT 7st',       lab: 'Automat',          note: 'Moderní převodovka s rychlým řazením.' },
      { icon_kind: 'fuel',         big: '1.6 Turbo',     lab: 'Benzín',           note: 'Dynamický motor s rozumnou spotřebou.' },
    ],
  },
  JAECOO7_HEV: {
    kind: 'HEV',
    items: [
      { icon_kind: 'selfcharge', big: 'Hybrid',          lab: 'Bez nabíjení',     note: 'Baterii doplní motor a rekuperace — žádné kabely.' },
      { icon_kind: 'fuel',       big: 'Nízká spotřeba',  lab: 'Úspora paliva',    note: 'Hybridní pohon výrazně šetří v městě.' },
      { icon_kind: 'range',      big: 'Velký dojezd',    lab: 'Na jednu nádrž',   note: 'Bez kompromisů na delších trasách.' },
    ],
  },

  // ─── KGM Tivoli (kompakt SUV, benzín) ──────
  TIVOLI: {
    kind: 'ICE',
    items: [
      { icon_kind: 'fuel',         big: '1.5 Turbo',  lab: 'Benzín',          note: 'Svižný benzínový motor pro každý den.' },
      { icon_kind: 'transmission', big: 'Manuál / AT', lab: 'Na výběr',       note: 'Manuální i automatická převodovka v ceníku.' },
      { icon_kind: 'awd',          big: 'FWD',        lab: 'Pohon předních', note: 'Lehká konstrukce, nižší spotřeba a náklady.' },
    ],
  },

  // ─── KGM Korando (rodinné SUV) ─────────────
  KORANDO: {
    kind: 'ICE',
    items: [
      { icon_kind: 'awd',          big: '4×4 i 2WD',  lab: 'Na výběr',         note: 'Pohon všech kol pro klid v jakémkoli počasí.' },
      { icon_kind: 'transmission', big: '6st AT',     lab: 'Automat Aisin',    note: 'Plynulé a vyzkoušené řazení.' },
      { icon_kind: 'tow',          big: '1 500 kg',   lab: 'Brzděný přívěs',   note: 'Vhodný pro karavan i menší přívěs.' },
    ],
  },

  // ─── KGM Rexton (velké rodinné SUV / off-road) ─────
  REXTON: {
    kind: 'ICE',
    items: [
      { icon_kind: 'awd',          big: '4×4',        lab: 'Pohon všech kol',   note: 'Skutečný off-road s nízkým převodem.' },
      { icon_kind: 'tow',          big: '3 500 kg',   lab: 'Brzděný přívěs',    note: 'Nejvyšší trakční schopnost v třídě.' },
      { icon_kind: 'transmission', big: '8st AT',     lab: 'Automat Mercedes',  note: 'Robustní převodovka pro náročné použití.' },
    ],
  },

  // ─── KGM Musso (pickup) ───────────────────
  MUSSO: {
    kind: 'ICE',
    items: [
      { icon_kind: 'tow',          big: '3 500 kg',   lab: 'Brzděný přívěs',   note: 'Top tahačské schopnosti v segmentu.' },
      { icon_kind: 'awd',          big: '4×4',        lab: 'Pohon všech kol',  note: 'Plnohodnotný off-road s redukcí.' },
      { icon_kind: 'fuel',         big: '2.2 Diesel', lab: 'Vznětový motor',   note: 'Dlouhé trasy s rezervou točivého momentu.' },
    ],
  },

  // ─── OMODA 9 / E9 ─────────────────────────
  OMODA9_PHEV: {
    kind: 'HEV',
    items: [
      { icon_kind: 'selfcharge', big: 'Plug-in hybrid', lab: 'Nabíjení i tankování', note: 'Krátké trasy elektricky, dlouhé bez kompromisů.' },
      { icon_kind: 'range',      big: 'Velký dojezd',   lab: 'Hybrid + nádrž',       note: 'Bezstarostná dálnice i město.' },
      { icon_kind: 'fuel',       big: 'Nízká spotřeba', lab: 'Úspora paliva',        note: 'Energetická efektivita prémiové třídy.' },
    ],
  },

  // ─── JAECOO 8 ─────────────────────────────
  JAECOO8_ICE: {
    kind: 'ICE',
    items: [
      { icon_kind: 'awd',          big: '4×4 / 2WD',   lab: 'Na výběr',         note: 'Pohon všech kol nebo úsporné FWD.' },
      { icon_kind: 'transmission', big: 'DCT 7st',     lab: 'Automat',          note: 'Rychlé řazení s prémiovou odezvou.' },
      { icon_kind: 'fuel',         big: '2.0 Turbo',   lab: 'Benzín',           note: 'Silný motor pro velký SUV.' },
    ],
  },
  JAECOO8_PHEV: {
    kind: 'HEV',
    items: [
      { icon_kind: 'selfcharge', big: 'Plug-in hybrid', lab: 'Elektro + benzín', note: 'Tichá jízda po městě, klid na dálnici.' },
      { icon_kind: 'range',      big: 'Velký dojezd',   lab: 'Hybrid + nádrž',   note: 'Stovky kilometrů bez plánování.' },
      { icon_kind: 'fuel',       big: 'Nízká spotřeba', lab: 'Úspora paliva',    note: 'Hybridní pohon šetří denní rutinu.' },
    ],
  },

  // ─── Farizon SuperVAN (elektrický užitkový) ──
  FARIZON_VAN: {
    kind: 'EVX',
    items: [
      { icon_kind: 'range',    big: 'Elektrický',     lab: 'Nulové emise',     note: 'Pro firmy s ohledem na životní prostředí.' },
      { icon_kind: 'charge',   big: 'DC nabíjení',    lab: 'Rychle do akce',   note: 'Krátká přestávka — a zase v provozu.' },
      { icon_kind: 'tow',      big: 'Velký nákladový prostor', lab: 'Užitkový',  note: 'Optimalizovaný pro logistiku v městě.' },
    ],
  },

  // ─── FALLBACK ICE — pro neznámé spalovací modely ──
  FALLBACK_ICE: {
    kind: 'ICE',
    items: [
      { icon_kind: 'fuel',         big: 'Spalovací motor', lab: 'Benzín / Diesel', note: 'Klasický pohon s tisíci kilometry zkušeností.' },
      { icon_kind: 'transmission', big: 'Automat',         lab: 'Plynulé řazení',  note: 'Komfortní jízda v každé situaci.' },
      { icon_kind: 'awd',          big: 'Stabilita',       lab: 'Bezpečné chování', note: 'Důvěryhodné chování na silnici.' },
    ],
  },
  FALLBACK_HEV: {
    kind: 'HEV',
    items: [
      { icon_kind: 'selfcharge', big: 'Hybrid',         lab: 'Self-charging',   note: 'Baterii doplní motor a rekuperace.' },
      { icon_kind: 'fuel',       big: 'Nízká spotřeba', lab: 'Úspora paliva',   note: 'Hybridní pohon šetří v městě i mimo něj.' },
      { icon_kind: 'range',      big: 'Velký dojezd',   lab: 'Na jednu nádrž',  note: 'Dlouhé trasy bez kompromisů.' },
    ],
  },
  FALLBACK_EV: {
    kind: 'EVX',
    items: [
      { icon_kind: 'range',    big: 'Elektrický',    lab: 'Nulové emise',     note: 'Bez emisí, bez kompromisů na zážitku z jízdy.' },
      { icon_kind: 'charge',   big: 'DC nabíjení',   lab: 'Rychle nabito',    note: 'Krátká pauza a jedete dál.' },
      { icon_kind: 'heatpump', big: 'Tepelná pumpa', lab: 'Efektivní topení', note: 'V zimě úsporné teplo bez ztráty dojezdu.' },
    ],
  },
};

/* ──────────── PRAVIDLA detekce dle slugu ────────────
 * Pořadí důležité — nejvíc specifické první.
 */
const RULES = [
  // Torres
  { match: (s) => s === 'torres-evx' || /torres[-_ ]*evx/.test(s) || /evx[-_ ]*torres/.test(s),       data: 'TORRES_EVX' },
  { match: (s) => s === 'torres-hev' || /torres[-_ ]*hev/.test(s) || /(hybrid|hev)[-_ ]*torres/.test(s), data: 'TORRES_HEV' },
  { match: (s) => /^torres$/.test(s) || (/torres/.test(s) && !/(evx|hev|hybrid|ev)/.test(s)),         data: 'TORRES_ICE' },

  // KGM Actyon — ICE (benzín) i HEV (hybrid)
  { match: (s) => /actyon[-_ ]*hev/.test(s) || /actyon[-_ ]*hybrid/.test(s) || /hev[-_ ]*actyon/.test(s),  data: 'ACTYON_HEV' },
  { match: (s) => /^actyon$/.test(s) || (/actyon/.test(s) && !/(hev|hybrid|ev)/.test(s)),                   data: 'ACTYON_ICE' },

  // OMODA 5 — pozn. SHS = Super Hybrid System (Chery), tedy HEV
  { match: (s) => /omoda[-_ ]*5[-_ ]*ev$/.test(s) || /omoda[-_ ]*5[-_ ]*evx/.test(s) || /omoda[-_ ]*e5/.test(s),                  data: 'OMODA5_EV'  },
  { match: (s) => /omoda[-_ ]*5[-_ ]*(hev|hybrid|shs)/.test(s),                                                                    data: 'OMODA5_HEV' },
  { match: (s) => /^omoda[-_ ]*5$/.test(s) || (/omoda[-_ ]*5/.test(s) && !/(ev|hev|hybrid|shs)/.test(s)),                          data: 'OMODA5_ICE' },

  // JAECOO 7 — pozn. SHS = Super Hybrid System (Chery), tedy HEV
  { match: (s) => /jaecoo[-_ ]*7[-_ ]*(hev|hybrid|shs)/.test(s),                                                                   data: 'JAECOO7_HEV' },
  { match: (s) => /^jaecoo[-_ ]*7$/.test(s) || (/jaecoo[-_ ]*7/.test(s) && !/(hev|hybrid|shs)/.test(s)),                           data: 'JAECOO7_ICE' },

  // JAECOO 8 — PHEV i ICE
  { match: (s) => /jaecoo[-_ ]*8[-_ ]*(phev|plug|hybrid|shs|hev)/.test(s),                                                          data: 'JAECOO8_PHEV' },
  { match: (s) => /jaecoo[-_ ]*8/.test(s),                                                                                          data: 'JAECOO8_ICE' },

  // OMODA 9 (PHEV)
  { match: (s) => /omoda[-_ ]*9|omoda[-_ ]*e9/.test(s),                                                                             data: 'OMODA9_PHEV' },

  // KGM modely (zbytek)
  { match: (s) => /tivoli/.test(s),                                                                                                 data: 'TIVOLI'   },
  { match: (s) => /korando/.test(s),                                                                                                data: 'KORANDO'  },
  { match: (s) => /rexton/.test(s),                                                                                                 data: 'REXTON'   },
  { match: (s) => /musso/.test(s),                                                                                                  data: 'MUSSO'    },

  // Farizon (elektrické dodávky)
  { match: (s) => /farizon|supervan/.test(s),                                                                                       data: 'FARIZON_VAN' },
];

/* Pravidla pro fallback dle fuel_type — když explicitní preset neexistuje. */
function fallbackByFuelType(fuelType) {
  const ft = (fuelType || '').toLowerCase();
  if (ft === 'ev') return 'FALLBACK_EV';
  if (ft === 'hybrid' || ft === 'phev') return 'FALLBACK_HEV';
  return 'FALLBACK_ICE'; // petrol / diesel / prázdný
}

async function findCandidateModels() {
  const resp = await api('GET', `/items/models?filter[status][_eq]=published&limit=200&fields=id,slug,name,fuel_type,highlights_panel,variant_badge_kind`);
  return resp.data || [];
}

function detect(slug) {
  const s = (slug || '').toLowerCase().trim();
  if (!s) return null;
  for (const r of RULES) {
    if (r.match(s)) return r.data;
  }
  return null;
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Seed variant highlights (Torres, Actyon,');
  console.log('  Omoda 5, Jaecoo 7)');
  console.log('═══════════════════════════════════════════════\n');
  if (dryRun) info('DRY-RUN — nic se nezapíše.');
  if (keepExisting) info('--keep — existující highlights_panel se zachovají.\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  const models = await findCandidateModels();
  const matched = [];
  const fallbackUsed = [];
  for (const m of models) {
    const key = detect(m.slug);
    if (key) {
      matched.push({ ...m, _key: key, _fallback: false });
    } else {
      // Žádný explicitní preset — použij fallback dle fuel_type, ať každý model má panel
      const fb = fallbackByFuelType(m.fuel_type);
      matched.push({ ...m, _key: fb, _fallback: true });
      fallbackUsed.push(m.slug);
    }
  }

  if (matched.length === 0) {
    warn('Žádné modely v Directus.');
    rl.close();
    return;
  }

  console.log(`Celkem ${matched.length} modelů (z toho ${fallbackUsed.length} přes fallback dle fuel_type):\n`);
  for (const m of matched) {
    const d = DATA[m._key];
    const flag = m._fallback ? ' (fallback)' : '';
    console.log(`  • ${m.slug.padEnd(28)} → ${m._key.padEnd(14)} (${d.kind})${flag}`);
  }
  console.log('');
  if (fallbackUsed.length > 0) {
    info(`Modely s obecnými fallback textem (uprav v Directus admin → Models → Highlights panel):`);
    info(`  ${fallbackUsed.join(', ')}\n`);
  }

  for (const m of matched) {
    const d = DATA[m._key];
    if (keepExisting && Array.isArray(m.highlights_panel) && m.highlights_panel.length > 0) {
      info(`${m.slug} → highlights_panel už má ${m.highlights_panel.length} karet, nechávám (--keep)`);
      continue;
    }
    if (dryRun) {
      info(`${m.slug} → [DRY] by se nastavilo variant_badge_kind=${d.kind} + ${d.items.length} karet`);
      continue;
    }
    await api('PATCH', `/items/models/${m.id}`, {
      variant_badge_kind: d.kind,
      highlights_panel: d.items,
    });
    ok(`${m.slug} → variant_badge_kind=${d.kind}, ${d.items.length} highlights karet`);
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo. V Directus admin si data uprav podle');
  console.log('  reálných parametrů ceníku.');
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
