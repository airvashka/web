/**
 * Compute teaser splátky pro KGM vozy přes UCL proxy.
 *
 * Účel: na stránce /sklad/[id] u KGM vozů zobrazujeme "Financování od X Kč / měsíc"
 * jako teaser PŘED kliknutím na kalkulačku v dark sekci #finance. Dříve to byl
 * lokální anuita výpočet (60% akontace, 72m, 4.9% p.a.) — odhad od oka, ne UCL data.
 *
 * Tento skript projde všechny KGM stock_vehicles, pro každý zavolá UCL proxy
 * s nejnižší možnou splátkou (60% akontace, 72 měsíců) a uloží do pole
 * `monthly_payment_from`. Frontend pak používá DB value (skutečné UCL číslo).
 *
 * Spouští se po sync:stock (z package.json) — tj. 3× denně přes systemd timer.
 * Trvá ~1 minutu pro 64 vozů (1 call na vůz × ~500ms).
 *
 * ENV:
 *   DIRECTUS_URL          — pro login do Directus (default https://admin.sfr-motor.cz nebo http://directus:8055)
 *   DIRECTUS_TOKEN        — admin token; nebo DIRECTUS_EMAIL + DIRECTUS_PASSWORD
 *   UCL_PROXY_URL         — kam volat UCL proxy (default http://ucl-proxy:3001 = Docker network)
 *
 * Bezpečné — pokud vůz UCL selhal (UCL down, špatná značka), skript ho přeskočí
 * a pokračuje dál. Existing `monthly_payment_from` zůstane.
 */
import process from 'node:process';

// ─── Konfigurace ─────────────────────────────────────────────────────────────
const DIRECTUS_URL = process.env.DIRECTUS_URL || 'http://directus:8055';
const UCL_PROXY_URL = process.env.UCL_PROXY_URL || 'http://ucl-proxy:3001';
const KGM_BRAND_SLUG = 'kgm';

// Default teaser parametry — nejnižší možná splátka pro "od X Kč" marketing
const TEASER_DOWN_PAYMENT_PCT = 0.60;     // 60 % akontace = nejnižší financovaná částka
const TEASER_MONTHS = 72;                 // 72 měsíců = nejnižší měsíční splátka

// ─── Token resolve ───────────────────────────────────────────────────────────
let TOKEN = process.env.DIRECTUS_TOKEN || '';
const EMAIL = process.env.DIRECTUS_EMAIL || '';
const PASSWORD = process.env.DIRECTUS_PASSWORD || '';

async function login() {
  if (TOKEN) return;
  if (!EMAIL || !PASSWORD) throw new Error('Chybi DIRECTUS_TOKEN nebo DIRECTUS_EMAIL+DIRECTUS_PASSWORD v env.');
  const r = await fetch(`${DIRECTUS_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!r.ok) throw new Error(`Directus login ${r.status}: ${await r.text()}`);
  const j = await r.json();
  TOKEN = j.data.access_token;
}

async function api(method, path, body) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(`${DIRECTUS_URL}${path}`, opts);
  if (!r.ok) throw new Error(`Directus ${method} ${path} ${r.status}: ${await r.text()}`);
  return r.json();
}

// ─── UCL volání ──────────────────────────────────────────────────────────────
// Vypočítá finalPrice se stejnou prioritou jako frontend /sklad/[id].astro:
//   1) stock.promo_price        (specifická akce na vozu)
//   2) stock.list_price - model.promo_discount_amount  (modelová akce)
//   3) stock.list_price         (běžná cena)
function computeFinalPrice(v) {
  const list = v.list_price ?? null;
  const stockPromo = v.promo_price ?? null;
  const modelDiscount = v.model?.promo_discount_amount ?? null;

  if (stockPromo && stockPromo > 0) return stockPromo;
  if (list && modelDiscount && modelDiscount > 0 && list - modelDiscount > 0) {
    return list - modelDiscount;
  }
  return list;
}

async function fetchTeaserMonthly(vehicle) {
  // UCL VYŽADUJE brand + model (i když docs říká není required — vrací 500 jinak).
  // Viz feedback v /api/leasing/test.ts variant `client`.
  const brand = vehicle._brand_name || 'KGM';
  const model = vehicle._model_name || 'Korando';
  const assetPrice = Math.round(Number(vehicle._final_price) || 0);
  if (assetPrice < 50_000) return null;     // UCL min 50k

  const payload = {
    assetPrice,
    downPaymentPercent: TEASER_DOWN_PAYMENT_PCT,
    numberOfInstallments: TEASER_MONTHS,
    brand,
    model,
    isUsed: vehicle.condition === 'used',
    groupCode: 'OA',
  };

  const r = await fetch(`${UCL_PROXY_URL}/calculate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Origin check VPS proxy bere referer/origin — předstíráme legitimní volání
      'Referer': 'https://sfr-motor.cz/internal-cron',
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`UCL ${r.status}: ${txt.substring(0, 200)}`);
  }
  const data = await r.json();
  if (!data?.monthlyPayment) return null;
  return Math.round(Number(data.monthlyPayment));
}

// ─── Hlavní pipeline ─────────────────────────────────────────────────────────
async function main() {
  await login();
  console.log(`[teaser] Directus: ${DIRECTUS_URL}`);
  console.log(`[teaser] UCL proxy: ${UCL_PROXY_URL}`);

  // Načti všechny KGM stock_vehicles. Pole price/title v collection NEEXISTUJE,
  // používáme list_price + promo_price + model.promo_discount_amount.
  // Pole stock_vehicles.brand je M2O na brands, .model je M2O na models — fetch s deep.
  const q = new URLSearchParams({
    'fields': 'id,vin,list_price,promo_price,condition,brand.slug,brand.name,model.name,model.promo_discount_amount,monthly_payment_from',
    'filter[status][_in]': 'published,reserved',
    'filter[brand][slug][_eq]': KGM_BRAND_SLUG,
    'limit': '1000',
  });
  const list = await api('GET', `/items/stock_vehicles?${q.toString()}`);
  const vehicles = list.data ?? [];
  console.log(`[teaser] Nalezeno ${vehicles.length} KGM vozů ke zpracování`);

  let ok = 0, skip = 0, fail = 0;
  for (const v of vehicles) {
    try {
      const brandName = v.brand?.name ?? 'KGM';
      const modelName = v.model?.name ?? '';
      const finalPrice = computeFinalPrice(v);
      const vehicleId = v.vin || v.id;
      if (!finalPrice || finalPrice < 50_000) {
        skip++;
        console.log(`  [skip] #${vehicleId} ${brandName} ${modelName}: cena ${finalPrice ?? 'null'} pod UCL minimum`);
        continue;
      }
      const teaser = await fetchTeaserMonthly({
        _brand_name: brandName,
        _model_name: modelName,
        _final_price: finalPrice,
        condition: v.condition,
      });
      if (teaser === null) {
        skip++;
        console.log(`  [skip] #${vehicleId} — UCL vratil null`);
        continue;
      }
      // Update jen pokud se hodnota změnila (žádné zbytečné API calls)
      if (v.monthly_payment_from === teaser) {
        skip++;
        continue;
      }
      await api('PATCH', `/items/stock_vehicles/${v.id}`, { monthly_payment_from: teaser });
      ok++;
      console.log(`  [ok]   #${vehicleId} ${brandName} ${modelName}: ${teaser} Kč/měs (z ${finalPrice} Kč)`);
    } catch (e) {
      fail++;
      console.error(`  [fail] #${v.vin || v.id}: ${e.message?.substring(0, 200)}`);
    }
    // Drobné zpoždění aby UCL nedostala 60 calls/min flood
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log(`\n[teaser] Hotovo: ok=${ok}, skip=${skip}, fail=${fail}`);
  // Exit code 0 i pokud nějaký vůz selhal — sync:stock pipeline má pokračovat
  process.exit(0);
}

main().catch((e) => {
  console.error('[teaser] Fatal:', e);
  process.exit(1);
});
