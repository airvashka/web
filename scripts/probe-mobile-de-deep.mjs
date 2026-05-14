#!/usr/bin/env node
/**
 * PoC v2: víc agresivních pokusů obejít 403 na mobile.de.
 *
 * 1) Plain fetch s realistickými browser headery (Accept, Accept-Language, Sec-CH-UA...)
 * 2) Consumer JSON API endpoint (možná je whitelisted)
 * 3) Playwright s headless: false (viditelný browser, často bypassne bot detection)
 * 4) Domácí stránka first → consent cookie → KGM listing (proper user flow)
 */

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.error('✗ Chybí playwright.'); process.exit(1); }

const FULL_BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.225 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
};

const JSON_API_HEADERS = {
  ...FULL_BROWSER_HEADERS,
  'Accept': 'application/json, text/plain, */*',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'Referer': 'https://www.mobile.de/',
};

async function tryFetch(label, url, headers) {
  console.log(`\n▶ ${label}`);
  console.log(`  ${url}`);
  try {
    const r = await fetch(url, { headers });
    const text = await r.text();
    console.log(`  status=${r.status}, len=${text.length}, ct=${r.headers.get('content-type')}`);
    if (r.status === 200) {
      console.log(`  ✓ MÁME 200! Prvních 500 znaků:`);
      console.log('  ' + text.substring(0, 500).replace(/\n/g, '\n  '));
      return true;
    } else if (text.length < 2000) {
      console.log(`  Body 4xx/5xx:`);
      console.log('  ' + text.substring(0, 600).replace(/\n/g, '\n  '));
    }
    return false;
  } catch (e) {
    console.log(`  ✗ ${e.message}`);
    return false;
  }
}

async function main() {
  console.log('═══ MOBILE.DE PROBE v2 ═══');

  // Test 1: Plain fetch s full browser headers
  console.log('\n=== Test 1: Plain fetch s full Chrome headers ===');
  await tryFetch('Home', 'https://www.mobile.de/', FULL_BROWSER_HEADERS);
  await tryFetch('KGM listing /auto/kgm.html', 'https://suchen.mobile.de/auto/kgm.html', FULL_BROWSER_HEADERS);

  // Test 2: Consumer JSON API
  console.log('\n=== Test 2: Consumer JSON API ===');
  await tryFetch(
    'consumer/api/search/srp',
    'https://www.mobile.de/consumer/api/search/srp?make=KGM&pageSize=20',
    JSON_API_HEADERS,
  );
  await tryFetch(
    'consumer/search/v1/srp',
    'https://www.mobile.de/consumer/search/v1/srp?makeId=KGM&pageSize=20',
    JSON_API_HEADERS,
  );

  // Test 3: Playwright HEADFUL (visible browser)
  console.log('\n=== Test 3: Playwright headless=false (visible browser) ===');
  console.log('  (Otevře se ti okno Chrome — nedávej zavřít, ať skript doběhne)');
  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const ctx = await browser.newContext({
    userAgent: FULL_BROWSER_HEADERS['User-Agent'],
    locale: 'de-DE',
    viewport: { width: 1366, height: 800 },
    extraHTTPHeaders: { 'Accept-Language': 'de-DE,de;q=0.9' },
  });
  // Skrýt webdriver flag (basic stealth)
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const page = await ctx.newPage();

  for (const url of [
    'https://www.mobile.de/',
    'https://suchen.mobile.de/auto/kgm.html',
  ]) {
    console.log(`\n  Goto: ${url}`);
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      console.log(`    status=${resp?.status()}, final URL: ${page.url()}, title: ${await page.title()}`);
      await page.waitForTimeout(3000);

      // Click consent if visible
      const consent = await page.$('button:has-text("Einverstanden"), button:has-text("Akzeptieren")');
      if (consent) { await consent.click(); console.log('    ✓ Cookie consent kliknuto'); await page.waitForTimeout(2000); }

      // Najdi cards
      const cardCount = await page.$$eval('article, [data-testid*="result"], a[href*="/fahrzeuge/details.html"]', (els) => els.length).catch(() => 0);
      console.log(`    Cards found: ${cardCount}`);
      if (cardCount > 0) {
        const sampleHref = await page.$eval('a[href*="/fahrzeuge/details.html"]', (a) => a.href).catch(() => null);
        console.log(`    Sample listing URL: ${sampleHref}`);
      }
    } catch (e) {
      console.log(`    ✗ ${e.message}`);
    }
  }

  console.log('\n  (zavírám browser za 5s, kdybys chtěl vidět co tam je)');
  await page.waitForTimeout(5000);
  await browser.close();

  console.log('\n═══════════════════');
  console.log('Pokud aspoň jeden z testů vrátil 200 / cards > 0, máme cestu.');
}

main().catch((e) => { console.error(e); process.exit(1); });
