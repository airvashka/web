#!/usr/bin/env node
/**
 * Otevře mobile.de v reálném browseru, klikne na KGM v dropdownu, klikne Filtrovat,
 * a zachytí všechny API requesty které SPA udělá.
 *
 * Cíl: najít skutečnou URL/parametry pro filtrování by-make.
 */

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.error('✗ Chybí playwright.'); process.exit(1); }

async function main() {
  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    locale: 'de-DE',
    viewport: { width: 1366, height: 800 },
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const page = await ctx.newPage();

  // Capture všechny API + interesting requesty
  const apiRequests = [];
  page.on('request', (req) => {
    const url = req.url();
    if (/\/api\/|\/srp|kgm|make=|makeId|ms=|m=KGM/i.test(url)) {
      apiRequests.push({
        method: req.method(),
        url,
        postData: req.postData(),
        headers: req.headers(),
      });
    }
  });

  console.log('▶ Goto www.mobile.de homepage');
  await page.goto('https://www.mobile.de/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log(`  status: page loaded, title: ${await page.title()}`);

  // Cookie consent
  await page.waitForTimeout(3000);
  for (const sel of [
    'button:has-text("Einverstanden")',
    'button:has-text("Akzeptieren")',
    'button:has-text("Alle akzeptieren")',
    '[data-testid*="accept"]',
  ]) {
    const btn = await page.$(sel).catch(() => null);
    if (btn) { try { await btn.click(); console.log('  ✓ Cookie consent kliknuto'); break; } catch {} }
  }

  await page.waitForTimeout(2000);

  console.log('\n▶ Hledám make dropdown / select');
  // Mobile.de používá custom dropdown. Mrkneme se na ně:
  const dropdownInfo = await page.evaluate(() => {
    const selects = [...document.querySelectorAll('select')];
    const buttons = [...document.querySelectorAll('button, [role="button"], [role="combobox"]')];
    return {
      selectCount: selects.length,
      selectsWithMake: selects.filter((s) => /marke/i.test(s.outerHTML)).map((s) => ({ name: s.name, id: s.id })),
      buttonHints: buttons.filter((b) => /marke|make/i.test(b.innerText)).slice(0, 5).map((b) => ({ text: b.innerText, id: b.id, dataTestId: b.getAttribute('data-testid') })),
    };
  });
  console.log('  Dropdown info:', JSON.stringify(dropdownInfo, null, 2));

  // Pokus 1: jestli je <select>, použijeme selectOption
  let success = false;
  if (dropdownInfo.selectsWithMake.length > 0) {
    const target = dropdownInfo.selectsWithMake[0];
    console.log(`\n▶ Pokus: native <select> name=${target.name}`);
    try {
      await page.selectOption(`select[name="${target.name}"]`, { label: 'KGM' });
      console.log('  ✓ KGM vybráno');
      success = true;
    } catch (e) {
      console.log(`  ✗ ${e.message}`);
    }
  }

  // Pokus 2: klik na "Marke" combobox + výběr z listu
  if (!success && dropdownInfo.buttonHints.length > 0) {
    const hint = dropdownInfo.buttonHints[0];
    console.log(`\n▶ Pokus: combobox "${hint.text}"`);
    try {
      await page.click(`text=${hint.text}`);
      await page.waitForTimeout(1000);
      await page.click('text=KGM');
      console.log('  ✓ KGM kliknuto v dropdownu');
      success = true;
    } catch (e) {
      console.log(`  ✗ ${e.message}`);
    }
  }

  // Klikni Filtrovat / Suche / Find
  console.log('\n▶ Klik na submit / Filtrovat');
  for (const sel of [
    'button:has-text("Filtrovat")',
    'button:has-text("Suchen")',
    'button:has-text("Suche")',
    'button[type="submit"]',
    '[data-testid*="search"]',
  ]) {
    const btn = await page.$(sel).catch(() => null);
    if (btn) {
      try {
        await btn.click();
        console.log(`  ✓ Kliknuto: ${sel}`);
        break;
      } catch (e) {}
    }
  }

  // Čekej na request volání
  console.log('\n▶ Čekám 10s na API requesty...');
  await page.waitForTimeout(10000);

  // Vypiš zachycené requesty
  console.log(`\n═══ Zachycené API/relevantní requesty (${apiRequests.length}) ═══`);
  for (const req of apiRequests) {
    console.log(`\n${req.method} ${req.url}`);
    if (req.postData) console.log(`  POST body: ${req.postData.substring(0, 500)}`);
    const interesting = Object.entries(req.headers).filter(([k]) => /accept|content-type|x-/i.test(k));
    if (interesting.length) console.log(`  Headers: ${interesting.map(([k, v]) => `${k}: ${v}`).join(' | ')}`);
  }

  // Aktuální URL po filtraci
  console.log(`\nFinal URL: ${page.url()}`);

  console.log('\nNechávám browser otevřený 30s — můžeš ručně klikat a sledovat console.');
  await page.waitForTimeout(30000);
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
