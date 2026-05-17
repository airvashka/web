#!/usr/bin/env node
/**
 * SFR Motor — Polish admin "Group Vozy" — Czech translations + popisky + cleanup.
 *
 * Co skript dělá:
 *   1) Pro každé pole v target collections nastaví:
 *      - meta.translations = [{ language: 'cs-CZ', translation: '<český název>' }]
 *      - meta.note (orange popisek) tam kde má smysl
 *   2) Skryje nepoužívané fieldy (brand.logo, brand.primary_color)
 *   3) Aktualizuje Project Settings → Custom CSS pro širší detail drawer
 *
 * Když uživatel v Directus admin nemá nastavený jazyk cs-CZ, translations
 * se neukáží. Doporučeno: Account Settings → Language → Čeština.
 *
 * Idempotentní — překlady přepíše jen pokud chybí; CSS skip pokud už nastaveno.
 *
 * Použití:
 *   cd "C:\Users\antos\Desktop\Claude\SFR WEB\SFR WEB\web"
 *   node scripts/polish-admin-vozy.mjs
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

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

/* ──────────── KONFIGURACE TRANSLATIONS + NOTES ──────────────
 *
 * Pro každou collection seznam fieldů a jejich český překlad + note.
 * Klíč = field name, hodnota = { label, note?, hidden? }.
 *
 * Pokud `hidden: true`, pole se v adminu schová.
 * Pokud `note` chybí, ponechá se existující.
 */

const COLLECTIONS = {
  brands: {
    name: 'Značky',
    icon: 'directions_car',
    fields: {
      name:            { label: 'Název značky' },
      slug:            { label: 'URL slug',           note: 'Část URL (např. "kgm" → /kgm). Bez mezer, jen malá písmena a pomlčky.' },
      tagline:         { label: 'Tagline',            note: 'Krátký claim značky (např. "Korejský charakter, evropský komfort").' },
      description:     { label: 'Popis značky (SEO)', note: 'Pouze pro SEO meta description — na webu se nikde vizuálně nezobrazuje. Vyhledávače to čtou pro náhled stránky ve výsledcích Google. Doporučeno 150-160 znaků.' },
      hero_image:      { label: 'Hero obrázek',       note: 'Pozadí Hero sekce na /[brand] stránce. Doporučeno wide 21:9 nebo 16:9, min. 1920×1080.' },
      sort:            { label: 'Pořadí',             note: 'Číslo pro řazení značek v navigaci a na homepage. Menší číslo = výš.' },
      status:          { label: 'Stav publikace',     note: 'Published = veřejně viditelné. Draft = pracovní (nezobrazí se na webu).' },
      logo:            { label: 'Logo značky',                   note: 'Logo značky — zatím se na webu nikde nezobrazuje, ale nahraj ho pro pozdější použití (např. v patičce, navigaci, nebo na brand kartách). Doporučeno PNG/SVG s transparentním pozadím.' },
      primary_color:   { label: 'Primární barva (NEPOUŽÍVÁ SE)', note: 'Aktuálně se na webu nikde nezobrazuje.', hidden: true },
      // why_*, models_headline, banner_*, hero_cta_* — content fields for /[brand] page
      why_eyebrow:           { label: 'Why — eyebrow',       note: 'Malý oranžový popisek nad nadpisem why sekce (např. "Proč KGM?")' },
      why_title:             { label: 'Why — nadpis',        note: 'Velký nadpis why sekce.' },
      why_intro:             { label: 'Why — úvod',          note: 'Úvodní odstavec why sekce.' },
      why_cards:             { label: 'Why karty',           note: 'Mřížka 4 karet — každá má ikonu, titulek a krátký popisek.' },
      models_headline:       { label: 'Nadpis modelů',       note: 'Headline nad gridem modelů (např. "9 modelů. Od městského SUV po pickup.")' },
      banner_title:          { label: 'Banner — nadpis',     note: 'Tmavý banner pod modely (např. "Vidíte vybraný model? Pojďte ho vyzkoušet.")' },
      hero_cta_primary_label: { label: 'Hero CTA 1 — text',  note: 'Hlavní tlačítko v Hero. Default "Vozy {brand} skladem (N)".' },
      hero_cta_primary_url:   { label: 'Hero CTA 1 — URL',   note: 'Cíl hlavního tlačítka. Default /sklad?znacka={slug}.' },
      hero_cta_secondary_label: { label: 'Hero CTA 2 — text', note: 'Druhé tlačítko (např. "Modely").' },
      hero_cta_secondary_url:   { label: 'Hero CTA 2 — URL',  note: 'Cíl druhého tlačítka (např. "#modely").' },
      eyebrow_line1:         { label: 'Hero eyebrow řádek 1', note: 'Vlevo nad nadpisem (např. "KGM Mobility").' },
      eyebrow_line2:         { label: 'Hero eyebrow řádek 2', note: 'Vpravo po tečce (např. "Dříve SsangYong").' },
      tagline_line1:         { label: 'Hero tagline 1',      note: 'První řádek pod hlavním nadpisem.' },
      tagline_line2:         { label: 'Hero tagline 2',      note: 'Druhý řádek.' },
    },
  },

  sub_brands: {
    name: 'Pod-značky',
    fields: {
      name:        { label: 'Název pod-značky', note: 'Např. "OMODA", "JAECOO" v rámci značky "OMODA & JAECOO".' },
      slug:        { label: 'URL slug' },
      brand:       { label: 'Rodičovská značka', note: 'Která hlavní značka má tuto pod-značku.' },
      sort:        { label: 'Pořadí' },
    },
  },

  models: {
    name: 'Modely',
    icon: 'directions_car',
    fields: {
      name:                { label: 'Název modelu',     note: 'Přesný název modelu (např. "Torres", "Torres HEV", "Korando").' },
      slug:                { label: 'URL slug',         note: 'Část URL (např. "torres-hev" → /model/torres-hev). Bez mezer.' },
      tagline:             { label: 'Tagline',          note: 'Krátký claim modelu (např. "Dobrodružství s moderním SUV").' },
      description:         { label: 'Popis',            note: 'Delší popis modelu — text pod sekcí Představení. Můžeš použít víc odstavců.' },
      brand:               { label: 'Značka',           note: 'Která značka (KGM / OMODA & JAECOO / Farizon).' },
      sub_brand:           { label: 'Pod-značka',       note: 'Volitelné — pokud spadá do pod-značky (OMODA vs JAECOO).' },
      hero_image:          { label: 'Hero fotka (detail)', note: 'Velká fotka cinematic 21:9 pro Hero banner na /model/[slug]. Doporučeno 2400×1000.' },
      hero_image_card:     { label: 'Hero fotka (karta)',  note: 'Fotka 4:3 nebo square pro kartu na brand listingu. Doporučeno 1200×900. Když chybí, použije se Hero detail fotka.' },
      hero_video:          { label: 'Hero video',          note: 'Volitelné background video na Hero (autoplay, mute, loop). MP4 doporučeno, krátké 5-15s, max 5 MB.' },
      gallery:              { label: 'Galerie',             note: 'Fotky pro galerie sekci. Doporučeno 8-20 fotek.' },
      highlights:           { label: 'Technologie (cards)', note: '4-card grid "Co umí {model}" — každá karta má eyebrow + title + subtitle + fotka. Kategorie: Technologie / Bezpečnost / Komfort.' },
      highlights_panel:     { label: 'Lákadlový panel',     note: '3 karty s ikonou pod Představením (např. "Dojezd WLTP 462 km"). Vyber icon kind + napiš velkou hodnotu + label + krátkou notu.' },
      variant_badge_kind:   { label: 'Typ pohonu badge',    note: 'Pro Torres ICE/HEV/EVX, Actyon ICE/HEV atd. — určuje barvu strip na kartě + ikonu ve variant switcheru.' },
      color_exterior:       { label: 'Barvy karoserie (showroom)', note: 'Showroom barvy s fotkama — pro Hero galerii na /model/[slug]#barvy.' },
      color_interior:       { label: 'Čalounění (showroom)', note: 'Interiér galerie.' },
      price_from:           { label: 'Cena od (Kč)',       note: 'Začínající cena modelu pro zobrazení na kartě.' },
      fuel_type:            { label: 'Typ paliva',          note: 'petrol / diesel / hybrid / phev / ev.' },
      body_type:            { label: 'Karoserie',           note: 'suv / pickup / van...' },
      status:               { label: 'Stav publikace' },
      sort:                 { label: 'Pořadí' },
      promo_active:         { label: 'Akce aktivní',        note: 'Když zaškrtnuto + máš slevu nebo label, na webu se na model kartě + skladovkách (jen u nových) zobrazí AKCE badge a akční cena.' },
      promo_label:          { label: 'Akce — text badge',   note: 'Krátký text (např. "Sleva 30 000 Kč", "Akce do června"). Pokud prázdné, defaultně "Akce".' },
      promo_discount_amount: { label: 'Akce — sleva (Kč)',  note: 'Odečte se od price_from a od list_price nových skladovek toho modelu.' },
      promo_valid_to:       { label: 'Akce platí do',       note: 'Po tomto datu se promo automaticky vypne (na webu se neukáže).' },
      promo_description:    { label: 'Akce — popis',        note: 'Delší popis akce (volitelné).' },
      documents:            { label: 'Dokumenty ke stažení', note: 'Brožury, ceníky a další PDF — typ určuje kategorii.' },
      youtube_video_ids:    { label: 'YouTube videa',        note: 'Pole YouTube ID. Zobrazí se v sekci "{model} v pohybu" na detailu.' },
      technical_data:       { label: 'Technická data (legacy)', note: 'Nově data jsou na model_years (per ročník). Tady jen pokud chybí ročníky.', hidden: true },
    },
  },

  model_years: {
    name: 'Modelové roky',
    fields: {
      year:           { label: 'Rok',                    note: 'Modelový rok (např. 2026).' },
      version:        { label: 'Verze',                  note: 'Volitelné — pokud má ročník více verzí (např. "MY26", "facelift"). Většinou prázdné.' },
      model:          { label: 'Model',                  note: 'Ke kterému modelu tento ročník patří.' },
      status:         { label: 'Stav publikace' },
      technical_data: { label: 'Technická data',         note: 'Tabulkové údaje pro detail modelu (Motor, Spotřeba, Rozměry…). Generuje se z PDF ceníku.' },
      pricelist_colors_exterior: { label: 'Barvy (exteriér) z ceníku', note: 'Barvy karoserie z PDF ceníku — tabulkový výpis na /vybavy. Generuje se z ceník uploaderu.' },
      pricelist_colors_interior: { label: 'Čalounění z ceníku',         note: 'Interiér z PDF ceníku.' },
      pricelist_colors:          { label: 'Barvy z ceníku (legacy JSON)', note: 'Starý formát — nově se používají pricelist_colors_exterior/_interior.', hidden: true },
    },
  },

  trim_levels: {
    name: 'Výbavové stupně',
    fields: {
      name:           { label: 'Název výbavy',         note: 'Např. "CLUB", "STYLE", "PREMIUM", "SELECT", "EXCLUSIVE".' },
      slug:           { label: 'URL slug',             note: 'Lowercase verze názvu (např. "club", "style"). Používá se v klíčích cen pro výbavový stupeň.' },
      model_year:     { label: 'Modelový rok',         note: 'Ke kterému ročníku tento výbavový stupeň patří.' },
      list_price:     { label: 'Ceníková cena (Kč)',   note: 'Základní cena z PDF ceníku.' },
      promo_price:    { label: 'Akční cena (Kč)',      note: 'Volitelně — pokud má tento konkrétní výbavový stupeň slevu.' },
      features:       { label: 'Co dostane zákazník',  note: 'Výbavové prvky seskupené po sekcích (Asistent, Bezpečnost, Komfort…). Generuje se z ceník uploaderu.' },
      optional_items: { label: 'Dokoupitelné položky', note: 'Co si zákazník může dokoupit nad rámec — name + code + price.' },
      description:    { label: 'Popis',                 note: 'Krátký popis výbavového stupně (volitelné).' },
      status:         { label: 'Stav publikace' },
      sort:           { label: 'Pořadí' },
      is_highlighted: { label: 'Zvýraznit jako doporučenou' },
      highlight_label: { label: 'Badge text' },
      highlight_note:  { label: 'Marketing text pod badge' },
      featured_on_model_page: { label: 'Zobrazit jako teaser na model stránce' },
    },
  },

  option_packages: {
    name: 'Volitelné pakety',
    fields: {
      name:             { label: 'Název paketu',       note: 'Např. "CLUB+ paket", "BLACK paket", "SAFETY paket".' },
      code:             { label: 'Kód paketu',         note: 'Krátký identifikátor (např. "CLUB+", "BLACK").' },
      slug:             { label: 'URL slug' },
      model_year:       { label: 'Modelový rok' },
      features:         { label: 'Obsah paketu',      note: 'Seznam položek, které paket přidává.' },
      pricing_per_trim: { label: 'Ceny pro výbavové stupně', note: 'Cena paketu pro každý výbavový stupeň — slug stupně + cena / standard / unavailable.' },
      description:      { label: 'Popis' },
    },
  },

  model_highlights: {
    name: 'Highlights (Co umí {model})',
    fields: {
      title:    { label: 'Titulek',         note: 'Bold titulek na kartě (např. "1.5 GDI Turbo + AISIN 6AT").' },
      subtitle: { label: 'Popisek',         note: 'Menší text pod titulkem (max 1-2 věty).' },
      eyebrow:  { label: 'Eyebrow',         note: 'Malý oranžový text nad titulkem (např. "Eco-friendly drive").' },
      photo:    { label: 'Fotka',           note: 'Fotka karty 3:4. Když chybí, karta bude tmavá bez fotky.' },
      category: { label: 'Kategorie',       note: 'Frontend rendruje 3 oddělené pruhy (Technologie / Bezpečnost / Komfort), každý max 4 položky.' },
      sort:     { label: 'Pořadí v sekci',  note: 'Menší = první.' },
      model:    { label: 'Model' },
    },
  },

  model_color_exterior: {
    name: 'Barvy karoserie (showroom)',
    fields: {
      name:     { label: 'Název barvy',         note: 'Např. "Grand bílá", "Iron kovová s černou střechou".' },
      code:     { label: 'Kód barvy',           note: 'Kód z výrobce (např. "WAA", "ADE").' },
      hex:      { label: 'HEX (fallback)',      note: 'Pokud chybí swatch, použije se jako CSS barva pro kruhový selector.' },
      price_type: { label: 'Cenová kategorie',  note: 'V ceně / Metalická / Perleťová.' },
      photo:    { label: 'Velká fotka',         note: 'Cinematic foto auta v této barvě (21:9). Zobrazuje se v configuratoru na /model/[slug]#barvy.' },
      swatch:   { label: 'Swatch ikona',        note: 'Malá kruhová ikona barvy (60×60px, transparentní pozadí) — pro selector pod fotkou.' },
      model:    { label: 'Model' },
      sort:     { label: 'Pořadí' },
      pricing_per_trim: { label: 'Ceny pro výbavové stupně (z ceníku)', note: 'Cena barvy pro každý výbavový stupeň. Generuje se z ceníku — pro showroom barvy typicky není potřeba.' },
    },
  },

  model_color_interior: {
    name: 'Čalounění (showroom)',
    fields: {
      name:     { label: 'Název čalounění',     note: 'Např. "Černá látka", "Béžová kůže".' },
      material: { label: 'Materiál',            note: 'textil / pravá kůže / syntetická kůže...' },
      hex:      { label: 'HEX (fallback)' },
      code:     { label: 'Kód' },
      photo:    { label: 'Fotka interiéru',     note: 'Foto interiéru s daným čalouněním (16:10).' },
      model:    { label: 'Model' },
      sort:     { label: 'Pořadí' },
      pricing_per_trim: { label: 'Ceny pro výbavové stupně' },
    },
  },
};

/* ──────────── EXECUTION ──────────── */

async function patchField(collection, field, label, note, hidden) {
  // Get current field meta
  let cur;
  try { cur = await api('GET', `/fields/${collection}/${field}`); }
  catch { return false; } // field neexistuje

  const meta = (cur.data ?? cur).meta ?? {};
  const existingTranslations = Array.isArray(meta.translations) ? meta.translations.filter((t) => t && t.language !== 'cs-CZ') : [];
  const newTranslations = [
    ...existingTranslations,
    { language: 'cs-CZ', translation: label },
  ];

  const newMeta = {
    ...meta,
    translations: newTranslations,
  };
  if (note !== undefined) newMeta.note = note;
  if (hidden !== undefined) newMeta.hidden = hidden;

  await api('PATCH', `/fields/${collection}/${field}`, { meta: newMeta });
  return true;
}

async function patchCollectionLabel(collection, label) {
  // Translate collection name in sidebar (Directus meta.translations on collection level)
  let cur;
  try { cur = await api('GET', `/collections/${collection}`); }
  catch { return false; }
  const meta = (cur.data ?? cur).meta ?? {};
  const existing = Array.isArray(meta.translations) ? meta.translations.filter((t) => t && t.language !== 'cs-CZ') : [];
  const newTranslations = [
    ...existing,
    { language: 'cs-CZ', translation: label, singular: label, plural: label },
  ];
  await api('PATCH', `/collections/${collection}`, { meta: { ...meta, translations: newTranslations } });
  return true;
}

async function setCustomCss() {
  // Get current project settings
  const cur = await api('GET', '/settings');
  const existing = (cur.data ?? cur).custom_css ?? '';
  const marker = '/* SFR-MOTOR: wider drawer */';
  if (existing.includes(marker)) {
    info('Custom CSS pro drawer už existuje.');
    return;
  }
  const addition = `
${marker}
.drawer { max-width: 1100px !important; }
.drawer.modal-l { max-width: 1100px !important; }
.drawer.modal-md { max-width: 1100px !important; }
@media (max-width: 1280px) {
  .drawer { max-width: 85vw !important; }
}
`;
  const newCss = (existing ? existing + '\n' : '') + addition;
  await api('PATCH', '/settings', { custom_css: newCss });
  ok('Custom CSS pro širší drawer přidán do Settings.');
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Polish admin "Group Vozy"');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  let totalPatched = 0, totalSkipped = 0;
  for (const [collection, conf] of Object.entries(COLLECTIONS)) {
    console.log(`\n─── ${conf.name ?? collection} (${collection}) ───`);
    // Sidebar label (collection-level translation)
    if (conf.name) {
      try {
        const patched = await patchCollectionLabel(collection, conf.name);
        if (patched) ok(`[sidebar] "${collection}" → "${conf.name}"`);
      } catch (e) { warn(`[sidebar] ${collection} — ${e.message}`); }
    }
    for (const [field, def] of Object.entries(conf.fields)) {
      try {
        const patched = await patchField(collection, field, def.label, def.note, def.hidden);
        if (patched) {
          ok(`${field} → "${def.label}"${def.hidden ? ' (HIDDEN)' : ''}`);
          totalPatched++;
        } else {
          warn(`${field} — pole neexistuje`);
          totalSkipped++;
        }
      } catch (e) {
        warn(`${field} — ${e.message}`);
        totalSkipped++;
      }
    }
  }

  console.log('\n─── Project Settings → Custom CSS ───');
  try { await setCustomCss(); } catch (e) { warn(`Custom CSS: ${e.message}`); }

  console.log('\n═══════════════════════════════════════════════');
  console.log(`  Hotovo. ${totalPatched} polí přeloženo, ${totalSkipped} přeskočeno.`);
  console.log('');
  console.log('  KROK 2 (manuálně v Directus admin):');
  console.log('    Klikni na svůj avatar (vpravo nahoře) → User Settings → Language → Čeština');
  console.log('    (Pak uvidíš české labely. Bez tohoto zůstanou anglické názvy z field klíčů.)');
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
