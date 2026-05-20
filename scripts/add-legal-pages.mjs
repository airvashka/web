#!/usr/bin/env node
/**
 * SFR Motor — `pages` kolekce + seed.
 * Statice/obsahove stranky: cookies, ochrana-udaju, podminky (sekce informace),
 * o-nas, kariera, partneri (sekce standalone). Existujici NEPREPISUJE.
 * Frontend: src/pages/informace/[slug].astro + /o-nas, /kariera, /partneri.
 * Pouziti:  cd web && node scripts/add-legal-pages.mjs
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
  if (!r.ok) {
    const e = new Error(`${method} ${path} -> ${r.status}: ${JSON.stringify(j?.errors ?? j)}`);
    e.status = r.status;
    throw e;
  }
  return j;
}

const ok = (m) => console.log(`  [ok]  ${m}`);
const info = (m) => console.log(`  [i]   ${m}`);
const warn = (m) => console.log(`  [!]   ${m}`);

const TODAY = new Date().toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' });

const COOKIES_BODY = `## Zásady používání souborů cookie

Tyto zásady popisují, co jsou soubory cookie, jak je na webových stránkách provozovaných společností **SFR Motor s.r.o.** používáme a jak můžete jejich používání spravovat.

### Co jsou cookies

Soubory cookie jsou malé textové soubory, které se ukládají do vašeho zařízení (počítač, tablet, mobilní telefon) při návštěvě webových stránek. Umožňují webu zapamatovat si vaše akce a preference, zajišťují jeho správné fungování a pomáhají nám rozumět tomu, jak je web využíván.

### Jaké cookies používáme

**Nezbytné (technické) cookies** jsou potřebné pro základní fungování webu — například pro zobrazení obsahu, navigaci a odeslání formulářů. Bez nich by web nefungoval správně, a proto je nelze vypnout.

**Analytické cookies** nám pomáhají pochopit, jak návštěvníci web používají — které stránky jsou nejnavštěvovanější a kde se lidé zdržují. K tomuto účelu využíváme nástroje jako Google Analytics (prostřednictvím Google Tag Manageru). Data zpracováváme v agregované podobě. Tyto cookies se ukládají pouze s vaším souhlasem.

**Marketingové cookies** slouží k zobrazování relevantní reklamy a měření její účinnosti. Ukládají se výhradně na základě vašeho souhlasu.

### Správa souhlasu

Souhlas s používáním analytických a marketingových cookies udělujete prostřednictvím cookie lišty při první návštěvě webu. Své nastavení můžete kdykoli změnit nebo souhlas odvolat. Cookies lze rovněž spravovat či mazat v nastavení vašeho internetového prohlížeče.

### Doba uložení

Nezbytné cookies jsou uloženy po dobu relace nebo nejdéle 12 měsíců. Analytické a marketingové cookies se ukládají podle konkrétního nástroje, zpravidla nejdéle 24 měsíců.

### Kontakt

Provozovatelem webu je **SFR Motor s.r.o.**, IČO 08263523, se sídlem Petrská 1426/1, Nové Město, 110 00 Praha 1. V případě dotazů ohledně cookies nás kontaktujte na e-mailu [info@sfr-motor.cz](mailto:info@sfr-motor.cz).

Více o zpracování osobních údajů najdete v dokumentu [Ochrana osobních údajů](/informace/ochrana-udaju).

_Poslední aktualizace: ${TODAY}_`;

const GDPR_BODY = `## Zásady zpracování osobních údajů

Ochrana vašich osobních údajů je pro nás důležitá. V tomto dokumentu vysvětlujeme, jaké osobní údaje zpracováváme, za jakým účelem, na jakém právním základě a jaká máte práva. Zpracování probíhá v souladu s nařízením (EU) 2016/679 (GDPR) a zákonem č. 110/2019 Sb.

### Správce osobních údajů

V oblasti prodeje vozů a provozu webu je správcem:
**SFR Motor s.r.o.**, IČO 08263523, DIČ CZ08263523, se sídlem Petrská 1426/1, Nové Město, 110 00 Praha 1, zapsaná v obchodním rejstříku vedeném Městským soudem v Praze, sp. zn. C 315925.

V oblasti servisu a oprav vozidel je správcem:
**SFR Motor servis s.r.o.**, IČO 08263370, DIČ CZ08263370, se sídlem Petrská 1426/1, Nové Město, 110 00 Praha 1, zapsaná v obchodním rejstříku vedeném Městským soudem v Praze, sp. zn. C 315922.

Provozovna (showroom a servis): Ďáblická 553/2, 182 00 Praha 8. Kontaktní e-mail: [info@sfr-motor.cz](mailto:info@sfr-motor.cz).

### Jaké údaje zpracováváme

Zpracováváme zejména identifikační a kontaktní údaje (jméno, příjmení, e-mail, telefon), údaje uvedené v poptávkách a formulářích, údaje o vozidle a o vašem zájmu (model, výbava, financování), údaje z naší vzájemné komunikace a technické údaje získané prostřednictvím souborů cookie.

### Účely a právní základ zpracování

Vyřízení poptávky, testovací jízdy či dotazu zpracováváme na základě plnění smlouvy nebo opatření před jejím uzavřením, případně našeho oprávněného zájmu. Uzavření a plnění kupní nebo servisní smlouvy probíhá na základě plnění smlouvy. Plnění zákonných povinností (zejména účetních a daňových) zpracováváme na základě právní povinnosti. Zasílání newsletteru a obchodních sdělení probíhá na základě vašeho souhlasu. Zlepšování webu a marketing zpracováváme na základě oprávněného zájmu, případně souhlasu.

### Doba uchování

Osobní údaje uchováváme po dobu nezbytně nutnou k naplnění daného účelu, případně po dobu stanovenou právními předpisy (například účetní a daňové doklady po dobu 10 let). Údaje zpracovávané na základě souhlasu uchováváme do jeho odvolání.

### Příjemci údajů

Vaše údaje mohou být v nezbytném rozsahu předány poskytovatelům IT a hostingu, nástrojů pro analýzu a marketing, importérům jednotlivých značek (KGM, OMODA & JAECOO, Farizon) v rozsahu nutném pro vyřízení vašeho požadavku, a dále účetním a právním poradcům. Údaje nepředáváme do třetích zemí mimo EU bez odpovídajících záruk.

### Vaše práva

Máte právo na přístup ke svým osobním údajům, jejich opravu nebo výmaz, omezení zpracování, přenositelnost údajů, vznesení námitky proti zpracování a právo kdykoli odvolat udělený souhlas. Tato práva můžete uplatnit na e-mailu [info@sfr-motor.cz](mailto:info@sfr-motor.cz). Máte rovněž právo podat stížnost u Úřadu pro ochranu osobních údajů (Pplk. Sochora 27, 170 00 Praha 7, [www.uoou.cz](https://www.uoou.cz)).

### Cookies

Informace o souborech cookie a jejich správě najdete v samostatném dokumentu [Zásady používání cookies](/informace/cookies).

_Poslední aktualizace: ${TODAY}_`;

const PODMINKY_BODY = `## Obchodní podmínky

Webové stránky provozuje společnost **SFR Motor s.r.o.**, IČO 08263523, se sídlem Petrská 1426/1, Nové Město, 110 00 Praha 1, autorizovaný prodejce a servis vozů značek KGM, OMODA & JAECOO a Farizon. Informace uvedené na těchto stránkách (zejména ceny, výbavy, dostupnost vozů a parametry financování) mají informativní charakter, nejsou závazným návrhem na uzavření smlouvy a mohou se měnit. Konkrétní podmínky koupě, servisu či financování vždy potvrzujeme individuálně na základě poptávky. Pro dotazy nás kontaktujte na [info@sfr-motor.cz](mailto:info@sfr-motor.cz) nebo navštivte naši provozovnu na adrese Ďáblická 553/2, 182 00 Praha 8.

_Poslední aktualizace: ${TODAY}_`;

const ONAS_BODY = `## O nás

Společnost **SFR Motor** působí na pražském trhu od roku 2019, kdy otevřela své první autorizované prodejní a servisní místo a stala se ambasadorem značky v regionu Praha a okolí. Od počátku jsme věřili v kvalitu nabízených vozů a jejich vynikající poměr ceny a užitné hodnoty — a zákazníci nám dali za pravdu.

Jak rostl zájem o naše vozy a služby, rozrůstaly se i naše kapacity. V březnu 2022 jsme proto přesunuli kompletní provoz do nové, prostornější provozovny na adrese **Ďáblická 553/2, Praha 8**. Najdete zde moderní showroom s prostorem pro vystavení celé modelové řady, kvalitní technické zázemí pro komplexní péči o vozidla i dostatek parkovacích míst. Provozovna je snadno dostupná autem i městskou hromadnou dopravou — jen jednu zastávku autobusem od stanice metra Střížkov.

Dnes jsme autorizovaným prodejcem a servisem značek **KGM, OMODA & JAECOO a Farizon**. Naším cílem zůstává to, s čím jsme začínali: poskytovat kvalitní služby s osobním přístupem a být připraveni růst společně s našimi zákazníky.

Těšíme se na vaši návštěvu.

_Váš SFR Motor team_`;

const KARIERA_BODY = `## Kariéra

Rozšiřujeme náš tým a hledáme nové kolegy, kteří chtějí pracovat s moderními vozy v přátelském prostředí. Aktuálně posilujeme zejména **servisní oddělení** — uvítáme automechaniky a servisní techniky, kteří mají chuť se učit a růst.

Co u nás najdete: zázemí stabilní a rostoucí firmy, moderní servisní provoz na adrese Ďáblická 553/2 v Praze 8, práci se značkami KGM, OMODA & JAECOO a Farizon a kolektiv, který táhne za jeden provaz.

Máte zájem se přidat? Pošlete nám svůj životopis na [info@sfr-motor.cz](mailto:info@sfr-motor.cz) — ozveme se vám.

_Poslední aktualizace: ${TODAY}_`;

const PARTNERI_BODY = `## Partneři

Vážíme si spolupráce s partnery, kteří sdílejí náš důraz na kvalitu a aktivní životní styl.

Spolupracujeme se společností **Decathlon**. Nově připravujeme také spolupráci se sportovními areály **HAMR centrum Braník** a **HAMR centrum Záběhlice**.

Máte zájem o partnerství se SFR Motor? Ozvěte se nám na [info@sfr-motor.cz](mailto:info@sfr-motor.cz).

_Poslední aktualizace: ${TODAY}_`;

const SEED_PAGES = [
  { slug: 'cookies',       title: 'Zásady používání cookies', body: COOKIES_BODY,  section: 'informace',  sort: 1 },
  { slug: 'ochrana-udaju', title: 'Ochrana osobních údajů',   body: GDPR_BODY,     section: 'informace',  sort: 2 },
  { slug: 'podminky',      title: 'Obchodní podmínky',        body: PODMINKY_BODY, section: 'informace',  sort: 3 },
  { slug: 'o-nas',         title: 'O nás',                    body: ONAS_BODY,     section: 'standalone', sort: 4 },
  { slug: 'kariera',       title: 'Kariéra',                  body: KARIERA_BODY,  section: 'standalone', sort: 5 },
  { slug: 'partneri',      title: 'Partneři',                 body: PARTNERI_BODY, section: 'standalone', sort: 6 },
];

async function collectionExists() {
  try { await api('GET', '/collections/pages'); return true; } catch { return false; }
}

async function createCollection() {
  await api('POST', '/collections', {
    collection: 'pages',
    meta: {
      icon: 'description',
      note: 'Obsahove a pravni stranky. section=informace -> /informace/{slug}; section=standalone -> /{slug}. Obsah pis v Markdownu.',
      display_template: '{{title}}',
      sort_field: 'sort',
      archive_field: 'status',
      archive_value: 'archived',
      unarchive_value: 'published',
    },
    schema: {},
    fields: [
      { field: 'id', type: 'integer', meta: { hidden: true, interface: 'input', readonly: true }, schema: { is_primary_key: true, has_auto_increment: true } },
      { field: 'status', type: 'string', schema: { default_value: 'published' },
        meta: { interface: 'select-dropdown', width: 'half', sort: 1, display: 'labels',
          options: { choices: [
            { text: 'Publikovano', value: 'published' },
            { text: 'Koncept', value: 'draft' },
            { text: 'Archivovano', value: 'archived' },
          ] } } },
      { field: 'section', type: 'string', schema: { default_value: 'standalone' },
        meta: { interface: 'select-dropdown', width: 'half', sort: 2, display: 'labels',
          note: 'informace = /informace/{slug} (cookies, GDPR, podminky). standalone = /{slug} (o-nas, kariera, partneri).',
          options: { choices: [
            { text: 'Informace (/informace/...)', value: 'informace' },
            { text: 'Samostatna (/...)', value: 'standalone' },
          ] } } },
      { field: 'sort', type: 'integer', meta: { interface: 'input', hidden: true, width: 'half', sort: 3 } },
      { field: 'slug', type: 'string', schema: { is_nullable: false, is_unique: true },
        meta: { interface: 'input', width: 'half', sort: 4, required: true,
          note: 'URL slug. Napr. "cookies" nebo "o-nas".', options: { slug: true, placeholder: 'o-nas' } } },
      { field: 'title', type: 'string', schema: { is_nullable: false },
        meta: { interface: 'input', width: 'full', sort: 5, required: true, options: { placeholder: 'O nas' } } },
      { field: 'body', type: 'text',
        meta: { interface: 'input-rich-text-md', width: 'full', sort: 6, note: 'Obsah v Markdownu.' } },
      { field: 'date_created', type: 'timestamp', meta: { interface: 'datetime', readonly: true, hidden: true, width: 'half', sort: 7, special: ['date-created'] } },
      { field: 'date_updated', type: 'timestamp', meta: { interface: 'datetime', readonly: true, hidden: true, width: 'half', sort: 8, special: ['date-updated'] } },
    ],
  });
  ok('Kolekce pages vytvorena');
}

async function seed() {
  let existing = [];
  try {
    const r = await api('GET', '/items/pages?fields=slug&limit=-1');
    existing = (r?.data ?? []).map((x) => x.slug);
  } catch { /* prazdna kolekce */ }
  for (const p of SEED_PAGES) {
    if (existing.includes(p.slug)) { info(`stranka "${p.slug}" uz existuje - nechavam beze zmeny`); continue; }
    await api('POST', '/items/pages', { ...p, status: 'published' });
    ok(`stranka "${p.slug}" vytvorena (${p.title})`);
  }
}

async function findPublicPolicy() {
  try {
    const r = await api('GET', '/policies?filter[name][_eq]=Public&limit=1');
    if (r?.data?.length) return r.data[0];
  } catch { /* ignore */ }
  try {
    const r = await api('GET', '/policies?limit=100');
    return (r?.data ?? []).find((p) => !p.admin_access && !p.app_access &&
      (p.name?.toLowerCase().includes('public') || p.name?.toLowerCase().includes('$t:public'))) ?? null;
  } catch { return null; }
}

async function addPublicRead(policyId) {
  try {
    await api('POST', '/permissions', {
      policy: policyId, collection: 'pages', action: 'read', fields: ['*'],
      permissions: { _and: [{ status: { _eq: 'published' } }] },
    });
    ok('public read permission pro pages nastaveno');
  } catch (e) {
    if (e.status === 400 && (e.message.includes('unique') || e.message.includes('exists'))) {
      info('public read permission uz existuje');
    } else { warn(`permission: ${e.message}`); }
  }
}

async function main() {
  console.log('\n=== SFR Motor - pages (legal + o-nas/kariera/partneri) ===\n');
  URL = (await prompt('Directus URL [https://sfr-motor-directus.onrender.com]: ')).trim()
    || 'https://sfr-motor-directus.onrender.com';
  const email = (await prompt('Admin email: ')).trim();
  const password = (await prompt('Admin heslo: ')).trim();
  console.log('');
  info(`Auth -> ${URL}`);
  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth?.data?.access_token;
  if (!TOKEN) { console.error('Auth selhal'); process.exit(1); }
  ok('Auth OK\n');
  if (await collectionExists()) info('Kolekce pages uz existuje - preskakuji vytvoreni.');
  else await createCollection();
  console.log('');
  await seed();
  console.log('');
  const policy = await findPublicPolicy();
  if (policy) { info(`Public policy: ${policy.name} (${policy.id})`); await addPublicRead(policy.id); }
  else warn('Public policy nenalezena - nastav read pro pages rucne v adminu.');
  console.log('\n=== Hotovo! ===\n');
  console.log(`Over API:   ${URL}/items/pages`);
  console.log(`Edituj:     ${URL}/admin/content/pages`);
  console.log('Frontend:   /informace/cookies, /informace/ochrana-udaju, /informace/podminky, /o-nas, /kariera, /partneri\n');
  rl.close();
}

main().catch((e) => { console.error(`X ${e.message}`); rl.close(); process.exit(1); });
