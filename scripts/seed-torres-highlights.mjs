#!/usr/bin/env node
/**
 * SFR Motor — naseed Torres ICE / HEV / EVX highlights_panel + variant_badge_kind.
 *
 * Data dle _design-draft-blog/.../torres-evx.jsx:
 *
 *   Torres (ICE) — 1.5 Benzín spalovací:
 *     - 4×4 i 2WD / Na výběr / Pohon předních i všech kol — podle ceny a potřeby.
 *     - 2 200 kg / Brzděný přívěs / Stačí na pomalovožník i větší kar.
 *     - 6st AT / Automatická převodovka / Plynulá a vyzkoušená Aisin.
 *
 *   Torres HEV — Plný hybrid:
 *     - Bez nabíjení / Self-charging hybrid / Jen tankujete — baterii dobíjí motor.
 *     - 1 100 km / Dojezd na nádrž / Praha–Mníchov a zpět bez tankování.
 *     - 5,3 l / Spotřeba komb. / Nižší náklady než u 1.5 benzína.
 *
 *   Torres EVX — Elektromobil:
 *     - 462 km / Dojezd WLTP / Klidně až na hory — a zpět na jedno nabití.
 *     - 38 min / Nabití 10→80 % / Stačí na kafe.
 *     - Tepelná pumpa / V základní ceně / V zimě konečně nepoznáte.
 *
 * Script vyhledá modely podle slugu (torres / torres-hev / torres-evx) a naseed-uje data.
 * Idempotentní — pokud highlights_panel už má data, přepíše (volitelně pomocí --keep).
 *
 * Použití:
 *   cd web && node scripts/seed-torres-highlights.mjs
 *   cd web && node scripts/seed-torres-highlights.mjs --keep  # nepřepisovat existující
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rl = readline.createInterface({ input, output });
const prompt = (q) => rl.question(q);

let URL = '', TOKEN = '';
const keepExisting = process.argv.includes('--keep');

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

const TORRES_DATA = {
  // ICE — 1.5 Benzín spalovací
  ICE: [
    { icon_kind: 'awd',          big: '4×4 i 2WD',  lab: 'Na výběr',                note: 'Pohon předních i všech kol — podle ceny a potřeby.' },
    { icon_kind: 'tow',          big: '2 200 kg',   lab: 'Brzděný přívěs',          note: 'Stačí na karavan i větší přívěs.' },
    { icon_kind: 'transmission', big: '6st AT',     lab: 'Automatická převodovka',  note: 'Plynulá a vyzkoušená Aisin v každé ceně.' },
  ],
  // HEV — Plný hybrid
  HEV: [
    { icon_kind: 'selfcharge', big: 'Bez nabíjení', lab: 'Self-charging hybrid', note: 'Jen tankujete — baterii dobíjí motor a brzdy.' },
    { icon_kind: 'range',      big: '1 100 km',     lab: 'Dojezd na nádrž',      note: 'Praha–Mnichov a zpět bez tankování.' },
    { icon_kind: 'fuel',       big: '5,3 l',        lab: 'Spotřeba komb.',       note: 'Nižší náklady než u 1.5 benzína.' },
  ],
  // EVX — Elektromobil
  EVX: [
    { icon_kind: 'range',    big: '462 km',         lab: 'Dojezd WLTP',       note: 'Klidně až na hory — a zpět na jedno nabití.' },
    { icon_kind: 'charge',   big: '38 min',         lab: 'Nabití 10 → 80 %',  note: 'Stačí na kávu — a jedete dál.' },
    { icon_kind: 'heatpump', big: 'Tepelná pumpa',  lab: 'V základní ceně',   note: 'V zimě nepoznáte. Žádný extra příplatek.' },
  ],
};

// Mapování slug → variant kind
const SLUG_VARIANT_MAP = [
  // pořadí důležité — nejvíc specifické první
  { match: (s) => s === 'torres-evx' || /torres.*-?evx/.test(s) || /evx.*torres/.test(s), kind: 'EVX' },
  { match: (s) => s === 'torres-hev' || /torres.*-?hev/.test(s) || /hybrid.*torres|torres.*hybrid/.test(s), kind: 'HEV' },
  { match: (s) => s === 'torres' || (/torres/.test(s) && !/(evx|hev|hybrid|ev)/.test(s)), kind: 'ICE' },
];

async function findTorresModels() {
  const all = await api('GET', `/items/models?filter[slug][_contains]=torres&limit=20&fields=id,slug,name`);
  return all.data || [];
}

async function patchModel(id, payload) {
  await api('PATCH', `/items/models/${id}`, payload);
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Seed Torres ICE / HEV / EVX highlights');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  const models = await findTorresModels();
  if (models.length === 0) {
    warn('Žádné Torres modely nenalezeny. Zkontroluj že existují záznamy s "torres" ve slugu.');
    rl.close();
    return;
  }

  info(`Nalezeno ${models.length} Torres modelů: ${models.map((m) => m.slug).join(', ')}\n`);

  for (const m of models) {
    const slug = (m.slug || '').toLowerCase();
    const match = SLUG_VARIANT_MAP.find((x) => x.match(slug));
    if (!match) {
      warn(`Model "${m.slug}" — nevím která Torres varianta (ICE/HEV/EVX), přeskakuji`);
      continue;
    }
    const kind = match.kind;
    const payload = {
      variant_badge_kind: kind,
      highlights_panel: TORRES_DATA[kind],
    };

    if (keepExisting) {
      const current = await api('GET', `/items/models/${m.id}?fields=highlights_panel,variant_badge_kind`);
      const cur = current.data || {};
      if (Array.isArray(cur.highlights_panel) && cur.highlights_panel.length > 0) {
        info(`Model "${m.slug}" → už má highlights_panel (${cur.highlights_panel.length} karet), nechávám (--keep)`);
        continue;
      }
    }

    await patchModel(m.id, payload);
    ok(`Model "${m.slug}" → variant_badge_kind=${kind}, highlights_panel = 3 karty`);
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo. Otevři /model/torres (resp. -hev / -evx)');
  console.log('  V Directus: Models → Torres → Highlights panel');
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
