#!/usr/bin/env node
/**
 * PoC: zkusíme, jestli vůbec jde scrapovat KGM listings z mobile.de (DE).
 *
 * Co skript dělá:
 *   1) Otevře Playwright, jde na mobile.de KGM listing
 *   2) Zkusí dismiss cookie consent banner (pokud je)
 *   3) Probnejme různé selectory na cards
 *   4) Vypíše počet nalezených inzerátů + první 3 jako JSON
 *   5) Zapíše full output do tmp/mobile-de-probe.json
 *
 * BEZ ukládání do Directus, BEZ photo upload, BEZ pagination. Jen probe.
 *
 * Pokud projde, víme že:
 *   - Cookie consent jde obejít
 *   - mobile.de neblokuje headless Chrome
 *   - Selectory na cards existují
 *   - Co všechno se dá vytáhnout per inzerát
 *
 * Použití: cd web && node scripts/probe-mobile-de.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.error('✗ Chybí playwright. Spusť: npm install playwright && npx playwright install chromium'); process.exit(1); }

const URLS = [
  'https://suchen.mobile.de/auto/kgm.html',          // primary
  'https://suchen.mobile.de/fahrzeuge/auto/kgm',     // alternativa
  'https://www.mobile.de/auto/kgm/marke/',           // marke landing
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'], // pokus skrýt headless flag
  });
  const ctx = await browser.newContext({
    userAgent: UA,
    locale: 'de-DE',
    viewport: { width: 1366, height: 800 },
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);

  let workingUrl = null;
  let pageHtml = null;

  for (const url of URLS) {
    console.log(`\n▶ Trying: ${url}`);
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      console.log(`  status=${resp?.status()}, URL po redirect: ${page.url()}`);
      if (resp?.status() === 200 || resp?.status() === 301) {
        workingUrl = url;
        await page.waitForTimeout(2000);
        break;
      }
    } catch (e) {
      console.log(`  ✗ ${e.message}`);
    }
  }

  if (!workingUrl) {
    console.log('\n✗ Žádná z URL nefunguje. Mobile.de asi blokuje.');
    await browser.close();
    return;
  }

  // Cookie consent — zkusíme různé buttons
  console.log('\n▶ Cookie consent dismiss');
  const consentButtons = [
    'button:has-text("Einverstanden")',
    'button:has-text("Akzeptieren")',
    'button:has-text("Alle akzeptieren")',
    'button[data-testid*="accept"]',
    '#gdpr-consent-tool button.accept',
    '[aria-label*="accept" i]',
  ];
  for (const sel of consentButtons) {
    const btn = await page.$(sel).catch(() => null);
    if (btn) {
      try { await btn.click(); console.log(`  ✓ Kliknuto: ${sel}`); await page.waitForTimeout(2000); break; }
      catch (e) { console.log(`  - ${sel}: ${e.message}`); }
    }
  }

  // Wait pro re-render po consent
  await page.waitForLoadState('networkidle').catch(() => null);
  await page.waitForTimeout(3000);

  // Vypsat title + URL
  const title = await page.title();
  console.log(`\n▶ Po consent: ${page.url()}`);
  console.log(`  Title: ${title}`);

  // Najdi inzeráty — zkus víc selectorů
  console.log('\n▶ Hledání inzerátů');
  const selectors = [
    'article[data-testid="result-item"]',
    '[data-testid*="result"]',
    'article.cBox-body--resultitem',
    'a[href*="/fahrzeuge/details.html"]',
    'article',
    'a[href*="/cargroup/"]',
  ];

  let bestSel = null;
  let bestCount = 0;
  for (const sel of selectors) {
    const count = await page.$$eval(sel, (els) => els.length).catch(() => 0);
    console.log(`  ${sel.padEnd(50)} → ${count} match`);
    if (count > bestCount) { bestCount = count; bestSel = sel; }
  }

  if (bestCount === 0) {
    console.log('\n✗ Žádný card selector nefunguje. Mobile.de asi vyžaduje extra interakci nebo má JS-rendering challenge.');
  } else {
    console.log(`\n▶ Použiju: ${bestSel} (${bestCount} matchů)`);

    // Vytáhni první 3 cards a vypiš co se z nich dá vytáhnout
    const cards = await page.$$eval(bestSel, (els) => els.slice(0, 5).map((el) => ({
      innerText: el.innerText?.substring(0, 600),
      href: el.querySelector('a[href*="/fahrzeuge/details.html"]')?.href || el.querySelector('a')?.href,
      imgSrcs: [...el.querySelectorAll('img')].map((i) => i.src).slice(0, 3),
      childrenTags: [...el.children].map((c) => c.tagName.toLowerCase()).slice(0, 10),
    })));

    console.log('\nPrvních 5 cards:');
    cards.forEach((c, i) => {
      console.log(`\n--- Card #${i + 1} ---`);
      console.log(`href: ${c.href ?? '(none)'}`);
      console.log(`imgs: ${c.imgSrcs.join(', ')}`);
      console.log(`innerText:\n${c.innerText}`);
    });

    // Uložit full HTML stránky pro inspekci
    const fullHtml = await page.content();
    mkdirSync('tmp', { recursive: true });
    writeFileSync('tmp/mobile-de-probe.html', fullHtml);
    writeFileSync('tmp/mobile-de-probe.json', JSON.stringify({ url: page.url(), title, cards }, null, 2));
    console.log('\n✓ Uloženo: tmp/mobile-de-probe.html, tmp/mobile-de-probe.json');
  }

  // Pagination info
  const paginationLinks = await page.$$eval('a[href*="page="]', (els) =>
    els.map((a) => a.href).filter((h) => h.includes('page=')).slice(0, 10)
  ).catch(() => []);
  console.log(`\n▶ Pagination links nalezeny: ${paginationLinks.length}`);
  paginationLinks.slice(0, 5).forEach((l) => console.log(`  ${l}`));

  // Header info — kolik celkem inzerátů
  const headerText = await page.$eval('h1, h2, [data-testid*="total"]', (el) => el.innerText).catch(() => null);
  if (headerText) console.log(`\nHeader: ${headerText}`);

  await browser.close();
  console.log('\n═══════════════════');
  console.log('Hotovo. Mrkni na tmp/mobile-de-probe.json a tmp/mobile-de-probe.html');
}

main().catch((e) => { console.error(e); process.exit(1); });
