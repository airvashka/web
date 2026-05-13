#!/usr/bin/env node
/**
 * SFR Motor — admin fields na brands pro editaci obsahu brand page.
 *
 * Přidá do `brands` collection všechny fieldy které byly hardcoded v Astro:
 *   - eyebrow_line1, eyebrow_line2 (např. "KGM Mobility" / "Dříve SsangYong")
 *   - tagline_line1, tagline_line2 (2 řádky pod nadpisem v hero)
 *   - hero_cta_primary_label / _url, hero_cta_secondary_label / _url
 *   - why_eyebrow, why_title, why_intro
 *   - why_cards (JSON repeater 4× {icon, title, subtitle})
 *   - models_headline (např. "9 modelů. Od městského SUV po pickup.")
 *   - banner_title (např. "Vidíte vybraný model? Pojďte ho vyzkoušet.")
 *
 * Pak seed defaultů ze stávajícího WHY hardcoded mapping pro KGM/OJ/Farizon.
 *
 * Použití:
 *   cd web && node scripts/setup-brand-fields.mjs
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

async function fieldExists(collection, field) {
  try { await api('GET', `/fields/${collection}/${field}`); return true; } catch { return false; }
}

async function ensureField(field, type, meta = {}, schema = {}) {
  if (await fieldExists('brands', field)) {
    info(`brands.${field} už existuje`);
    return;
  }
  await api('POST', '/fields/brands', {
    field, type,
    schema: { is_nullable: true, ...schema },
    meta: { width: 'full', ...meta },
  });
  ok(`brands.${field} vytvořen`);
}

const ICON_CHOICES = [
  { text: 'Shield (záruka)', value: 'shield' },
  { text: 'Axle (4×4 pohon)', value: 'axle' },
  { text: 'Bolt (elektrifikace)', value: 'bolt' },
  { text: 'Hook (tažné)', value: 'hook' },
  { text: 'Spark (design)', value: 'spark' },
  { text: 'Globe (globální značka)', value: 'globe' },
  { text: 'Cargo (užitkové)', value: 'cargo' },
];

async function setupSchema() {
  console.log('Krok 1: Schema fields');

  // Hero — eyebrow
  await ensureField('eyebrow_line1', 'string', {
    interface: 'input',
    width: 'half',
    note: 'Nad názvem brandu, vlevo (např. "KGM Mobility")',
  });
  await ensureField('eyebrow_line2', 'string', {
    interface: 'input',
    width: 'half',
    note: 'Nad názvem brandu, vpravo po tečce (např. "Dříve SsangYong")',
  });

  // Hero — tagline (2 řádky)
  await ensureField('tagline_line1', 'string', {
    interface: 'input',
    width: 'full',
    note: 'První řádek pod nadpisem (např. "Korejský charakter, evropský komfort.")',
  });
  await ensureField('tagline_line2', 'string', {
    interface: 'input',
    width: 'full',
    note: 'Druhý řádek pod nadpisem (např. "Od kompaktního Tivoli po flagship Rexton.")',
  });

  // Hero — CTAs
  await ensureField('hero_cta_primary_label', 'string', {
    interface: 'input',
    width: 'half',
    note: 'Text hlavního tlačítka (default: "Vozy {brand} skladem (N)" — automaticky)',
  });
  await ensureField('hero_cta_primary_url', 'string', {
    interface: 'input',
    width: 'half',
    note: 'URL hlavního tlačítka (default: "/sklad?znacka={slug}")',
  });
  await ensureField('hero_cta_secondary_label', 'string', {
    interface: 'input',
    width: 'half',
    note: 'Text druhého tlačítka (např. "Modely")',
  });
  await ensureField('hero_cta_secondary_url', 'string', {
    interface: 'input',
    width: 'half',
    note: 'URL druhého tlačítka (např. "#modely" pro kotvu na sekci s modely)',
  });

  // Why section
  await ensureField('why_eyebrow', 'string', {
    interface: 'input',
    width: 'half',
    note: 'Malý oranžový popisek nad why-title (např. "Proč KGM?")',
  });
  await ensureField('why_title', 'string', {
    interface: 'input',
    width: 'full',
    note: 'Velký nadpis why sekce (např. "Auta, která pracují stejně dobře, jako vy.")',
  });
  await ensureField('why_intro', 'text', {
    interface: 'input-multiline',
    width: 'full',
    note: 'Úvodní odstavec why sekce.',
  });

  // Why cards (4 karty)
  await ensureField('why_cards', 'json', {
    interface: 'list',
    special: ['cast-json'],
    width: 'full',
    note: 'Why karty (4 položky). Ikona, titulek, krátký popisek.',
    options: {
      template: '{{title}}',
      addLabel: 'Přidat why kartu',
      fields: [
        {
          field: 'icon', type: 'string', name: 'Ikona',
          meta: { interface: 'select-dropdown', width: 'half', options: { choices: ICON_CHOICES } },
        },
        {
          field: 'title', type: 'string', name: 'Titulek',
          meta: { interface: 'input', width: 'half', note: 'Např. "5letá záruka"' },
        },
        {
          field: 'subtitle', type: 'string', name: 'Popisek',
          meta: { interface: 'input', width: 'full', note: 'Jedna věta podrobnosti' },
        },
      ],
    },
  });

  // Models grid
  await ensureField('models_headline', 'string', {
    interface: 'input',
    width: 'full',
    note: 'Nadpis nad gridem modelů (např. "9 modelů. Od městského SUV po pickup.")',
  });
  await ensureField('banner_title', 'string', {
    interface: 'input',
    width: 'full',
    note: 'Nadpis tmavého banneru pod modely (např. "Vidíte vybraný model? Pojďte ho vyzkoušet.")',
  });

  console.log('');
}

// ===== Defaults per brand =====
const BRAND_DEFAULTS = {
  kgm: {
    eyebrow_line1: 'KGM Mobility',
    eyebrow_line2: 'Dříve SsangYong',
    tagline_line1: 'Korejský charakter, evropský komfort.',
    tagline_line2: 'Od kompaktního Tivoli po flagship Rexton.',
    hero_cta_secondary_label: 'Modely',
    hero_cta_secondary_url: '#modely',
    why_eyebrow: 'Proč KGM?',
    why_title: 'Auta, která pracují stejně dobře, jako vy.',
    why_intro:
      'KGM (KG Mobility) je nástupce SsangYong — značky s 70letou historií výroby SUV a pickupů. Spolehlivé pohony 4×4, štědrá základní výbava a servisní síť, na kterou se dá spolehnout.',
    why_cards: [
      { icon: 'shield', title: '5letá záruka', subtitle: 'Bez omezení nájezdu na vybrané modely' },
      { icon: 'axle', title: 'Pohon 4×4', subtitle: 'U Korando, Torres, Rextonu i Musso Grand' },
      { icon: 'bolt', title: 'Elektrifikace', subtitle: 'Torres EVX a HEV varianty' },
      { icon: 'hook', title: 'Tažné až 3,5 t', subtitle: 'Rexton a Musso Grand jako pracovní partneři' },
    ],
    models_headline: '9 modelů. Od městského SUV po pickup.',
    banner_title: 'Vidíte vybraný model? Pojďte ho vyzkoušet.',
  },
  'omoda-jaecoo': {
    eyebrow_line1: 'Chery Group',
    eyebrow_line2: 'Nová generace',
    tagline_line1: 'Dvě tváře jednoho moderního pohledu na SUV.',
    tagline_line2: 'Omoda pro město, Jaecoo pro dobrodružství.',
    hero_cta_secondary_label: 'Modely',
    hero_cta_secondary_url: '#modely',
    why_eyebrow: 'Proč Omoda & Jaecoo?',
    why_title: 'Nová značka. Štědrá výbava od první ceny.',
    why_intro:
      'Omoda & Jaecoo přicházejí jako svěží alternativa s odvážným designem a velkorysou výbavou. V základu dostanete to, co konkurence prodává v drahých příplatcích.',
    why_cards: [
      { icon: 'shield', title: '7letá záruka', subtitle: 'Nebo 150 000 km — co nastane dřív' },
      { icon: 'bolt', title: 'Plug-in i elektro', subtitle: 'SHS hybrid s dojezdem přes 1 100 km' },
      { icon: 'spark', title: 'Odvážný design', subtitle: 'Diamantová maska a LED architektura' },
      { icon: 'globe', title: 'Globální značka', subtitle: 'Chery — 4. největší výrobce v Číně' },
    ],
    models_headline: '7 modelů. Městský crossover i opravdové SUV.',
    banner_title: 'Líbí se vám Omoda nebo Jaecoo? Domluvíme jízdu.',
  },
  farizon: {
    eyebrow_line1: 'Geely Group',
    eyebrow_line2: 'Užitková elektromobilita',
    tagline_line1: 'Elektrická dodávka pro práci od pondělí do pátku.',
    tagline_line2: 'Žádný kompromis. Žádné palivo.',
    hero_cta_secondary_label: 'Modely',
    hero_cta_secondary_url: '#modely',
    why_eyebrow: 'Proč Farizon?',
    why_title: 'Užitkové vozy, které se počítají.',
    why_intro:
      'Farizon je užitková značka skupiny Geely — největšího čínského výrobce automobilů. SuperVan kombinuje nákladový prostor evropského formátu s plně elektrickým pohonem a 7letou zárukou.',
    why_cards: [
      { icon: 'bolt', title: '100% elektro', subtitle: 'Dojezd až 247 km v městském cyklu' },
      { icon: 'cargo', title: 'Náklad 1 350 kg', subtitle: 'Objem 13 m³ ve verzi L3H2' },
      { icon: 'shield', title: '7letá záruka', subtitle: 'Na baterii i pohon. Nula starostí.' },
      { icon: 'globe', title: 'Geely Group', subtitle: 'Globální zázemí, evropská homologace' },
    ],
    models_headline: 'Užitková řada. Dodávka i podvozek.',
    banner_title: 'Hledáte flotilové řešení? Probereme to.',
  },
};

async function seedDefaults() {
  console.log('Krok 2: Seed defaultů pro KGM / OMODA & JAECOO / FARIZON');
  for (const [slug, defaults] of Object.entries(BRAND_DEFAULTS)) {
    const r = await api('GET', `/items/brands?filter[slug][_eq]=${encodeURIComponent(slug)}&limit=1&fields=id,slug,tagline_line1,why_title,why_cards`);
    const brand = r?.data?.[0];
    if (!brand) {
      warn(`Brand "${slug}" neexistuje, skipuji`);
      continue;
    }
    // Skip pokud už má vyplněné (admin mohl upravit)
    if (brand.tagline_line1 && brand.why_title && Array.isArray(brand.why_cards) && brand.why_cards.length > 0) {
      info(`${slug}: už má vyplněné fieldy, ponechávám (admin)`);
      continue;
    }
    await api('PATCH', `/items/brands/${brand.id}`, defaults);
    ok(`${slug}: seedováno`);
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Brand page editable fields');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  await setupSchema();
  await seedDefaults();

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo!');
  console.log('═══════════════════════════════════════════════\n');
  console.log('V adminu (Ctrl+Shift+R):');
  console.log('  brands → vyber KGM/Omoda & Jaecoo/Farizon → vidíš nové fieldy:');
  console.log('  • Eyebrow Line 1/2  → "KGM Mobility · Dříve SsangYong"');
  console.log('  • Tagline Line 1/2  → "Korejský charakter, evropský komfort."');
  console.log('  • Hero CTA secondary Label/Url → "Modely" → "#modely"');
  console.log('  • Why Eyebrow/Title/Intro → "Proč KGM? — Auta, která pracují..."');
  console.log('  • Why Cards (repeater 4× icon/title/subtitle)');
  console.log('  • Models Headline + Banner Title');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
