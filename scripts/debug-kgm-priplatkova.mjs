#!/usr/bin/env node
/**
 * Debug: vypise realne HTML kolem "Priplatkova vybava" na KGM detailu
 * + co najde soucasny selektor. Slouzi k oprave parseru optional_packages.
 * Pouziti: cd web && node scripts/debug-kgm-priplatkova.mjs [URL]
 */
const URL = process.argv[2] || 'https://stock.sfrmotor.kgmcars.cz/skladove-vozy/tivoli-15turbo-mt-style-bilacerny-odber-kveten-2026-479?model-code=tivoli';
const UA = 'Mozilla/5.0 (compatible; sfr-motor-sync/1.0)';

let load;
try { ({ load } = await import('cheerio')); }
catch { console.error('Chybi cheerio: npm install cheerio'); process.exit(1); }

const html = await (await fetch(URL, { headers: { 'User-Agent': UA } })).text();
console.log('HTML delka:', html.length);

// 1) Raw HTML kolem fraze
const idx = html.search(/Příplatková\s+výbava/i);
console.log('\n=== RAW HTML kolem "Priplatkova vybava" (index ' + idx + ') ===');
if (idx >= 0) console.log(html.slice(Math.max(0, idx - 120), idx + 700));
else console.log('FRAZE NENALEZENA v HTML!');

// 2) Co vidi cheerio
const $ = load(html);
console.log('\n=== Tag, ktery obsahuje "Priplatkova vybava" ===');
$('*').each((_, el) => {
  const own = $(el).clone().children().remove().end().text().trim();
  if (/^příplatková\s+výbava$/i.test(own)) {
    const tag = el.tagName;
    const cls = $(el).attr('class') || '';
    console.log(`  tag=<${tag}> class="${cls}"`);
    console.log(`  next sibling tag: <${$(el).next().get(0)?.tagName ?? '-'}>`);
    console.log(`  nextAll ul count: ${$(el).nextAll('ul').length}`);
    console.log(`  parent <${$(el).parent().get(0)?.tagName}> obsahuje ul: ${$(el).parent().find('ul').length}`);
  }
});

// 3) soucasny selektor
const cur = [];
$('h2, h3').each((_, el) => {
  if (/příplatková\s+výbava/i.test($(el).text())) {
    $(el).nextUntil('h2, h3', 'ul').find('li').each((__, li) => cur.push($(li).text().trim()));
  }
});
console.log('\n=== Soucasny selektor naparsoval (ma byt STYLE+ paket, Dvouzonova klima) ===');
console.log(cur.length ? cur : '(PRAZDNE — proto se neuklada)');
