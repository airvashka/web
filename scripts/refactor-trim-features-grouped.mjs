#!/usr/bin/env node
/**
 * SFR Motor — refactor trim_levels.features na grouped strukturu.
 *
 * STARÝ shape (flat tag input):
 *   ["Pohon předních kol", "Start-Stop", "ESP", "Airbagy boční", ...]
 *
 * NOVÝ shape (repeater kategorií):
 *   [
 *     { category: "pohon",      items: ["FWD", "Start-Stop"] },
 *     { category: "bezpecnost", items: ["Airbagy boční", "ESP"] },
 *     ...
 *   ]
 *
 * Co skript dělá:
 *   1) PATCH meta na trim_levels.features → list (repeater) interface s sub-fields
 *      { category: dropdown, items: tag input }
 *   2) Načte všechny trim_levels, převede flat features na groups
 *      pomocí keyword-matching (stejný algoritmus jako lib/features.ts).
 *      Trimy, co už mají groupy, přeskočí (idempotentní).
 *
 * Pozn.: option_packages.features zůstává flat — uživatel nepotřebuje kategorie.
 *
 * Použití:
 *   cd web && node scripts/refactor-trim-features-grouped.mjs
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

// ─── Kategorie ──────────────────────────────────────────────
const CATEGORY_CHOICES = [
  { text: 'Pohon', value: 'pohon' },
  { text: 'Zavěšení kol, řízení, brzdy', value: 'podvozek' },
  { text: 'Bezpečnost', value: 'bezpecnost' },
  { text: 'Asistenční systémy', value: 'asistent' },
  { text: 'Interiér / komfort', value: 'komfort' },
  { text: 'Multimedia', value: 'multimedia' },
  { text: 'Exteriér', value: 'exterier' },
  { text: 'Ostatní', value: 'ostatni' },
];

// Keyword mapping pro migraci — duplicát z lib/features.ts (zde běží Node, ne Astro)
const KEYWORDS = {
  pohon: [
    'tgdi', 'gdi', 'turbo', 'hybrid', 'phev', 'elektromotor', 'baterie', 'manuální',
    'manuál', 'automatick', 'dct', 'dht', 'cvt', 'awd', 'fwd', '4wd', 'pohon',
    'kw', 'nm', 'moment', 'výkon', 'spotřeb', 'dojezd', 'kwh',
    'redukční', 'převodovk', 'start-stop', 'start stop',
  ],
  podvozek: [
    'mcpherson', 'multi-link', 'multilink', 'zavěšení', 'sloupek řízení',
    'posilovač řízení', 'abs', 'ebd', 'esp', 'trakce', 'ftcs', 'brzdový asistent',
    'arp', 'aebs', 'hsa', 'asistent rozjezdu', 'asistent sjezdu', 'hdc', 'ess',
    'fcw', 'kontrola trakce', 'stabilizač', 'brzd', 'parkovací brzda',
  ],
  bezpecnost: [
    'airbag', 'isofix', 'ecall', 'imobilizér', 'alarm', 'kotvy', 'pojistka',
    'záznam', 'edr', 'emergency call', 'předepínač', 'bezpečnostních pásů',
    'opěrky', 'opěrka', 'dětsk',
  ],
  asistent: [
    'tempomat', 'asistent', 'bsd', 'lca', 'rcta', 'detekce', 'kamera', 'parkovac',
    'aeb', 'acc', 'autohold', 'auto hold', 'autopilot', 'safety', 'lane', 'pruh',
    'slep', 'sjíždění', 'vystoupení', 'únavy', 'pozornosti', 'nouzov', 'collision',
    '360', '540', 'senzor', 'předjíždění', 'ldws', 'lkas', 'tsr', 'isa', 'fvsa',
    'sda', 'daa', 'rozpoznání', 'dopravních značek', 'hba',
  ],
  komfort: [
    'klima', 'klimatizace', 'vyhřívan', 'ventilov', 'bezklíčov', 'nabíjení',
    'masáž', 'svítidlo', 'sluneční clon', 'střešní okno', 'panoramatick',
    'el. víko', 'elektrické víko', 'elektrické ovládání oken', 'tažné',
    'klíč', 'start-stop button', 'startován',
    'volant', 'sedadl', 'sedák', 'sedačky', 'kožen', 'textil', 'syntetick',
    'eco-kůže', 'eko-kůže', 'koberce', 'ambient', 'osvětlení interiéru',
    'loketní', 'čalouněn', 'palubn', 'imitace', 'multifunkčn',
    'zrcátko', 'stmívání', 'lcd', 'přístrojová deska', 'řadící páky',
    'centrální zamykání', 'zámku', 'zámek', 'osvětlení zámku',
    'stěrač', 'dešťový', 'světelný senzor', 'okna', 'kliky',
    'zavazadlov', 'kryt', 'síť', 'podlaha', 'zásuvka',
  ],
  multimedia: [
    'displej', 'reproduktor', 'sony', 'usb', 'bluetooth', 'wireless', 'carplay',
    'android auto', 'rádio', 'dab', 'hlasov', 'multimédi', 'audio', 'navigac',
    'hud', 'head-up', 'head up', 'audiosystému', 'gsm anténa', 'ipod',
  ],
  exterier: [
    'alu', 'kola', 'ráfk', 'pneumatik', 'led světl', 'led denní', 'led směr',
    'mlhové', 'mlhovky', 'projekční', 'projektorové', 'světlomety', 'střešní ližin',
    'střešní nosič', 'spoiler', 'výfuk', 'follow me home', 'privacy', 'tónován',
    'metalick', 'barva karoserie', 'logo', 'tpms', 'monitorování tlaku',
    'dveř zavazadlového', 'smart', 'směrovkami',
  ],
};

const CATEGORY_ORDER = ['pohon', 'podvozek', 'bezpecnost', 'asistent', 'komfort', 'multimedia', 'exterier'];

function categorizeFlat(features) {
  const groups = {};
  CATEGORY_ORDER.forEach((c) => (groups[c] = []));
  groups.ostatni = [];

  for (const f of features) {
    if (!f) continue;
    const lower = String(f).toLowerCase();
    let matched = null;
    for (const cat of CATEGORY_ORDER) {
      if (KEYWORDS[cat].some((kw) => lower.includes(kw))) {
        matched = cat;
        break;
      }
    }
    groups[matched ?? 'ostatni'].push(String(f));
  }

  // Vrátíme jen kategorie s alespoň 1 prvkem
  return [...CATEGORY_ORDER, 'ostatni']
    .filter((c) => groups[c].length > 0)
    .map((c) => ({ category: c, items: groups[c] }));
}

function isGrouped(features) {
  return Array.isArray(features) && features.length > 0
    && typeof features[0] === 'object' && features[0] !== null && 'category' in features[0];
}

// ─── Schema patch ───────────────────────────────────────────
async function patchFeaturesField() {
  const current = await api('GET', '/fields/trim_levels/features');
  const meta = current.data?.meta ?? {};

  const newMeta = {
    ...meta,
    interface: 'list',
    note: 'Výbavové prvky seskupené po kategoriích. Přidej "+ Add group", vyber kategorii a naťukej položky jako tagy. Z PDF ceníku tahej řádky s "S" do správné kategorie.',
    options: {
      ...(meta.options ?? {}),
      // Pozn: {{items.length}} nefunguje — Directus iteruje array a sčítá .length
      // jednotlivých stringů. Jen {{category}}.
      template: '{{category}}',
      addLabel: 'Přidat kategorii',
      fields: [
        {
          field: 'category',
          name: 'Kategorie',
          type: 'string',
          meta: {
            interface: 'select-dropdown',
            width: 'half',
            options: { choices: CATEGORY_CHOICES, allowOther: false },
          },
        },
        {
          field: 'items',
          name: 'Výbavové prvky',
          type: 'json',
          meta: {
            interface: 'tags',
            width: 'full',
            note: 'Jednotlivé prvky jako tagy. Enter = další.',
            options: { presets: [], alphabetize: false },
          },
        },
      ],
    },
  };

  await api('PATCH', '/fields/trim_levels/features', { meta: newMeta });
  ok('trim_levels.features → list (repeater) interface');
}

// ─── Data migration ─────────────────────────────────────────
async function migrateAllTrimFeatures() {
  console.log('\nKrok 2: Migrace existujících trim_levels features\n');

  const trims = await api('GET', '/items/trim_levels?limit=500&fields=id,name,features,model_year.model.name,model_year.year');
  let migrated = 0, skipped = 0, empty = 0;

  for (const t of trims.data) {
    const label = `${t.model_year?.model?.name ?? '?'} ${t.model_year?.year ?? '?'} — ${t.name}`;

    if (!Array.isArray(t.features) || t.features.length === 0) {
      empty++;
      continue;
    }

    if (isGrouped(t.features)) {
      info(`${label}: už grouped, skipuji`);
      skipped++;
      continue;
    }

    const grouped = categorizeFlat(t.features);

    await api('PATCH', `/items/trim_levels/${t.id}`, { features: grouped });
    const breakdown = grouped.map((g) => `${g.category}=${g.items.length}`).join(' ');
    ok(`${label}: ${t.features.length} flat → ${grouped.length} groups [${breakdown}]`);
    migrated++;
  }

  console.log(`\n  ✓ Migrováno:  ${migrated}`);
  console.log(`  → Skipnuto:  ${skipped} (už grouped)`);
  console.log(`  ○ Prázdné:   ${empty}`);
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Refactor trim_levels.features → grouped');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  console.log('Krok 1: Schema — trim_levels.features → list interface');
  await patchFeaturesField();

  await migrateAllTrimFeatures();

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo. V adminu (Ctrl+Shift+R):');
  console.log('  trim_levels → libovolný trim → "Features":');
  console.log('  Uvidíš seznam kategorií místo plochých tagů.');
  console.log('  Každá kategorie má dropdown + tag input.');
  console.log('');
  console.log('  Auto-kategorizace byla provedena pomocí keyword matching.');
  console.log('  Něco šlo do "Ostatní" — zkontroluj a přesuň ručně');
  console.log('  (klikni na položku v Ostatní, smaž, přidej do správné kat.).');
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
