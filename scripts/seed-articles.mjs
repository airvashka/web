#!/usr/bin/env node
/**
 * SFR Motor — seed 4 ukázkových článků pro magazín.
 *
 * Idempotentní (skipne pokud slug už existuje).
 *
 * Použití:
 *   cd web && node scripts/seed-articles.mjs
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

const ARTICLES = [
  {
    slug: 'torres-evx-5000km',
    title: 'Po 5 000 km s KGM Torres EVX: dojezd, nabíjení a život s elektromobilem',
    category: 'recenze',
    excerpt: 'Dlouhodobý test elektrického SUV. Skutečné spotřeby, rychlonabíjení, V2L i komfort dálničních cest.',
    author: 'Petr Paseka',
    read_time: '8 min',
    date_published: '2026-04-14T08:00:00.000Z',
    featured: true,
    sort: 1,
    body: `Když nám do showroomu dorazilo první KGM Torres EVX, prošlo si během prvních týdnů rukama několika kolegů. Tady je shrnutí prvních 5 000 km — co nás bavilo, co překvapilo a co lze do budoucna ladit.

## Dojezd v realitě, ne v tabulkách

Tovární WLTP hodnota 462 km je pro nás dobrá výchozí. V průměru jsme dostali **400 km na dálnici** (130 km/h, klimatizace) a **přes 500 km v městském provozu** s rekuperací.

> "Klid, ticho a hladká jízda — Torres EVX dělá z hodinového dojíždění odpočinkový rituál."

## Nabíjení

Z 20 → 80 % na 100 kW DC trvalo **38 minut**, přesně jak slibuje brožura. Doma na 11 kW AC plné nabití za zhruba 7 hodin přes noc.

- LFP baterie 73,4 kWh
- DC max 100 kW
- AC 11 kW
- V2L až 3,5 kW (kemping, nářadí)

## Co budeme ladit dál

Nic dramatického. Drobné UX věci v infotainmentu, sezónní pneu (zima vyžaduje dedikovanou sadu). Po 5 000 km bez jediné servisní intervence — to mluví za vše.`,
  },
  {
    slug: 'omoda-5-vs-jaecoo-7',
    title: 'Omoda 5 vs. Jaecoo 7: dvě tváře nové generace SUV',
    category: 'srovnani',
    excerpt: 'Crossover pro město nebo robustnější SUV pro rodinu? Srovnáváme sourozence z Chery Group.',
    author: 'Marek Šafarčík',
    read_time: '6 min',
    date_published: '2026-04-02T10:00:00.000Z',
    featured: false,
    sort: 2,
    body: `Obě auta vycházejí z technologického základu Chery, ale targetování je jiné. Pojďme se podívat, kdy zvolit kterého sourozence.

## Omoda 5 — městský charisma

- Délka 4 422 mm, ideální parkování ve městě
- 1.6 TGDI 108 kW, DCT převodovka
- Diamantová maska, **odvážný design**

## Jaecoo 7 — terén v rukávu

Jaecoo cílí výš:

- Délka 4 500 mm, prostor pro 5 dospělých
- 1.6 TGDI 145 kW, **k dispozici i SHS plug-in hybrid**
- Robustnější design s "off-road" elementy

> Pokud bydlíte ve městě a sem tam zajedete za město, Omoda 5 stačí bohatě. Pokud máte rodinu a chcete jezdit i mimo asfalt, Jaecoo 7 dává víc smyslu.`,
  },
  {
    slug: 'jak-casto-menit-olej',
    title: 'Jak často měnit olej a proč na tom záleží',
    category: 'servis',
    excerpt: 'Servisní intervaly KGM, OMODA & JAECOO a Farizon — kdy přijet, co se kontroluje a kolik to stojí.',
    author: 'Jiří Hertl',
    read_time: '5 min',
    date_published: '2026-03-28T09:30:00.000Z',
    featured: false,
    sort: 3,
    body: `Pravidelný servis je nejlevnější forma "pojištění" auta. Tady je co bychom doporučili.

## Intervaly podle značky

| Značka | Interval (km / měsíce) |
|---|---|
| KGM | 15 000 km / 12 měsíců |
| Omoda & Jaecoo | 10 000 km / 12 měsíců |
| Farizon (elektro) | 30 000 km / 24 měsíců |

## Co kontrolujeme

- Olej + filtr motoru
- Brzdové destičky, kotouče
- Stav pneumatik a tlak
- Klimatizace
- Brzdová a chladicí kapalina
- Provozní kapaliny (servořízení, ostřikovače)
- Funkce ADAS asistentů

> Pravidelný servis zachová záruku výrobce. U KGM 5 let, u Omoda & Jaecoo / Farizon až 7 let.

Ceník servisu najdete na stránce [Servis](/servis), nebo si rovnou objednejte termín online.`,
  },
  {
    slug: 'pohonna-4x4-kgm',
    title: 'Pohon 4×4 v KGM rodině: kdy ano, kdy ne',
    category: 'technologie',
    excerpt: 'Korando, Torres, Rexton, Musso Grand — všechny umí 4×4. Kdy se vyplatí příplatek a kdy stačí přední pohon.',
    author: 'Lukáš Jiránek',
    read_time: '4 min',
    date_published: '2026-03-15T12:00:00.000Z',
    featured: false,
    sort: 4,
    body: `4×4 zní jako must-have pro každé SUV. Ve skutečnosti ho většina českých řidičů nevyužije ani na 20 %.

## Kdy 4×4 dává smysl

- Bydlíte v podhůří nebo na samotě
- Zimní cesty necleared, makadam
- Tažení přívěsu > 1,5 t
- Off-road víkendy

## Kdy stačí přední pohon (2WD)

- Městský provoz + dálnice
- Standardní zimní pneu
- Krátké výjezdy mimo asfalt (zpevněné lesní cesty)

## Spotřeba

4×4 přidává **0,3–0,5 l/100 km** k benzínu, u elektro je rozdíl menší. Pořizovací cena pak roste o cca 30–50 tisíc Kč.

> Pravidlo palce: pokud si nedokážete vybavit konkrétní 3+ situace za rok kdy 4×4 použijete, ušetřete a zvolte 2WD.

Více se dozvíte u nás v showroomu nebo na detailu modelu.`,
  },
];

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Seed 4 ukázkových článků');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  let created = 0, skipped = 0;
  for (const a of ARTICLES) {
    const existing = await api('GET', `/items/articles?filter[slug][_eq]=${encodeURIComponent(a.slug)}&limit=1&fields=id`);
    if (existing.data?.length > 0) {
      info(`${a.slug}: už existuje, skipuji`);
      skipped++;
      continue;
    }
    try {
      await api('POST', '/items/articles', { ...a, status: 'published' });
      ok(`${a.slug}: vytvořeno`);
      created++;
    } catch (e) {
      console.error(`✗ ${a.slug}: ${e.message}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log(`  Hotovo. Created: ${created}, Skipped: ${skipped}`);
  console.log('═══════════════════════════════════════════════');
  console.log('Pak npm run build a uvidíš články na /magazin.');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
