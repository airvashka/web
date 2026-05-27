/**
 * UCL Calculation API — test runner.
 *
 * Účel: rychle vyzkoušet různé varianty payloadu a najít,
 * kterou UCL preprod backend přijme bez 500 "Unexpected exception".
 *
 * Použití (browser):
 *   /api/leasing/test                 → seznam dostupných variant
 *   /api/leasing/test?variant=docs    → identický payload z dokumentace v1.3 (str 13)
 *   /api/leasing/test?variant=minimal → jen required pole, bez extras
 *   /api/leasing/test?variant=client  → naše hodnoty + clientIdentification dummy
 *   /api/leasing/test?variant=multicalc-int  → multicalculation jako 0 (number) místo false
 *   /api/leasing/test?variant=vat-sk  → vatRate 0.23 (SK) místo 0.21 (CZ)
 *   /api/leasing/test?variant=vip     → rateType VIP místo STANDARD
 *   /api/leasing/test?variant=fl      → financingType FL (Financial leasing) místo UV
 *
 * Response: { variant, payload (co jsme poslali), uclStatus, uclResponse (co UCL vrátil) }
 */
import type { APIRoute } from 'astro';

export const prerender = false;

const AUTH_URL = import.meta.env.UNICREDIT_AUTH_URL
  ?? 'https://kalkulator-prep.unicreditleasing.sk/keycloak/realms/uclkalk/protocol/openid-connect/token';
const CALC_URL = import.meta.env.UNICREDIT_CALC_URL
  ?? 'https://kalkulator-prep.unicreditleasing.sk/api/v1/calculation/calculation/';
const USERNAME = import.meta.env.UNICREDIT_USERNAME ?? '';
const PASSWORD = import.meta.env.UNICREDIT_PASSWORD ?? '';
const CLIENT_SECRET = import.meta.env.UNICREDIT_CLIENT_SECRET ?? '';

let tokenCache: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;
  const body = new URLSearchParams({
    client_id: 'account',
    client_secret: CLIENT_SECRET,
    auth_method: 'oauth_credentials',
    grant_type: 'password',
    client_auth_method: 'client-secret',
    username: USERNAME,
    password: PASSWORD,
  });
  const r = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!r.ok) throw new Error(`Auth ${r.status}: ${await r.text()}`);
  const data = await r.json();
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in ?? 1800) - 60) * 1000,
  };
  return tokenCache.token;
}

// ─── Varianty payloadů ──────────────────────────────────────────────────────

const today = () => new Date().toISOString().slice(0, 10);

const VARIANTS: Record<string, any> = {
  // V1: Identický payload z dokumentace v1.3 str 13 (BMW Cruiser, 1M Kč)
  'docs': {
    multicalculation: false,
    financedAmount: 750000,
    assetPrice: 1000000,
    downPayment: 0.25,
    downPaymentMethod: 'PER',
    vatRate: 0.21,
    numberOfInstallments: 36,
    financingType: 'UV',
    pns: 0.0,
    rateType: 'STANDARD',
    commission: 4000,
    mfee: 2000,
    priceForInsurance: 1050000,
    administrationFee: 0,
    drawdownDate: '2026-11-11',
    asset: {
      category: 'AL',
      group: 'OA',
      status: 'NEW',
      mileage: 0,
      brand: 'BMW',
      model: 'Cruiser',
      type: 'R 18',
      power: '90',
      fuel: 'Diesel',
      usage: 'Common use',
      manufactureDate: 2026,
      dateOfRegistration: '2026-06-01',
      expectedDelivery: '2026-07-01',
    },
    clientIdentification: {
      personType: 'FON',
      id: '890831/9575',
      name: 'Janko Mrkvička',
    },
  },

  // V2: Minimální payload — jen striktně required + asset trojice
  'minimal': {
    multicalculation: false,
    financedAmount: 750000,
    assetPrice: 1000000,
    downPayment: 0.25,
    downPaymentMethod: 'PER',
    vatRate: 0.21,
    numberOfInstallments: 36,
    financingType: 'UV',
    pns: 0.0,
    rateType: 'STANDARD',
    commission: 4000,
    mfee: 2000,
    administrationFee: 0,
    asset: {
      category: 'AL',
      group: 'OA',
      status: 'NEW',
    },
  },

  // V3: Naše hodnoty Korando + clientIdentification dummy
  'client': {
    multicalculation: false,
    financedAmount: 400000,
    assetPrice: 500000,
    downPayment: 0.20,
    downPaymentMethod: 'PER',
    vatRate: 0.21,
    numberOfInstallments: 60,
    financingType: 'UV',
    pns: 0.0,
    rateType: 'STANDARD',
    commission: 4000,
    mfee: 2000,
    administrationFee: 0,
    drawdownDate: today(),
    asset: {
      category: 'AL',
      group: 'OA',
      status: 'NEW',
      brand: 'KGM',
      model: 'Korando',
    },
    clientIdentification: {
      personType: 'FON',
      id: '900101/1234',
      name: 'Testovací Zákazník',
    },
  },

  // V4: multicalculation jako number 0 místo false
  'multicalc-int': {
    multicalculation: 0,
    financedAmount: 750000,
    assetPrice: 1000000,
    downPayment: 0.25,
    downPaymentMethod: 'PER',
    vatRate: 0.21,
    numberOfInstallments: 36,
    financingType: 'UV',
    pns: 0.0,
    rateType: 'STANDARD',
    commission: 4000,
    mfee: 2000,
    administrationFee: 0,
    asset: { category: 'AL', group: 'OA', status: 'NEW' },
  },

  // V5: vatRate 0.23 (SK)
  'vat-sk': {
    multicalculation: false,
    financedAmount: 750000,
    assetPrice: 1000000,
    downPayment: 0.25,
    downPaymentMethod: 'PER',
    vatRate: 0.23,
    numberOfInstallments: 36,
    financingType: 'UV',
    pns: 0.0,
    rateType: 'STANDARD',
    commission: 4000,
    mfee: 2000,
    administrationFee: 0,
    asset: { category: 'AL', group: 'OA', status: 'NEW' },
  },

  // V6: rateType VIP
  'vip': {
    multicalculation: false,
    financedAmount: 750000,
    assetPrice: 1000000,
    downPayment: 0.25,
    downPaymentMethod: 'PER',
    vatRate: 0.21,
    numberOfInstallments: 36,
    financingType: 'UV',
    pns: 0.0,
    rateType: 'VIP',
    commission: 4000,
    mfee: 2000,
    administrationFee: 0,
    asset: { category: 'AL', group: 'OA', status: 'NEW' },
  },

  // V7: financingType FL (Financial leasing) — pro SK
  'fl': {
    multicalculation: false,
    financedAmount: 750000,
    assetPrice: 1000000,
    downPayment: 0.25,
    downPaymentMethod: 'PER',
    vatRate: 0.21,
    numberOfInstallments: 36,
    financingType: 'FL',
    pns: 0.0,
    rateType: 'STANDARD',
    commission: 4000,
    mfee: 2000,
    administrationFee: 0,
    asset: { category: 'AL', group: 'OA', status: 'NEW' },
  },

  // V8: Bez priceForInsurance, drawdownDate, clientIdentification — čistá minimální verze
  'pure-minimal': {
    multicalculation: false,
    financedAmount: 750000,
    assetPrice: 1000000,
    downPayment: 0.25,
    downPaymentMethod: 'PER',
    vatRate: 0.21,
    numberOfInstallments: 36,
    financingType: 'UV',
    pns: 0.0,
    rateType: 'STANDARD',
    commission: 4000,
    mfee: 2000,
    administrationFee: 0,
    asset: { category: 'AL', group: 'OA', status: 'NEW' },
  },

  // V9: Naše Korando 500k s VŠÍM (asset, client, drawdownDate, priceForInsurance)
  'full-korando': {
    multicalculation: false,
    financedAmount: 400000,
    assetPrice: 500000,
    priceForInsurance: 500000,
    downPayment: 0.20,
    downPaymentMethod: 'PER',
    vatRate: 0.21,
    numberOfInstallments: 60,
    financingType: 'UV',
    pns: 0.0,
    rateType: 'STANDARD',
    commission: 4000,
    mfee: 2000,
    administrationFee: 0,
    drawdownDate: today(),
    asset: {
      category: 'AL',
      group: 'OA',
      status: 'NEW',
      mileage: 5,
      brand: 'KGM',
      model: 'Korando',
      type: 'Style+',
      power: '120',
      fuel: 'Benzín',
      usage: 'Common use',
      manufactureDate: 2025,
      dateOfRegistration: today(),
      expectedDelivery: today(),
    },
    clientIdentification: {
      personType: 'FON',
      id: '900101/1234',
      name: 'Test Test',
    },
  },
};

export const GET: APIRoute = async ({ url }) => {
  const variant = url.searchParams.get('variant');

  if (!variant) {
    return new Response(JSON.stringify({
      message: 'UCL Calculation API test runner',
      usage: '/api/leasing/test?variant=NAME',
      availableVariants: Object.keys(VARIANTS),
      examples: {
        'docs': 'Identický payload z dokumentace v1.3 (BMW Cruiser, 1M Kč) + clientIdentification',
        'minimal': 'Jen striktně required pole, žádný extras',
        'client': 'Naše Korando 500k + clientIdentification dummy',
        'multicalc-int': 'multicalculation: 0 (number) místo false',
        'vat-sk': 'vatRate 0.23 (SK) místo 0.21 (CZ)',
        'vip': 'rateType VIP místo STANDARD',
        'fl': 'financingType FL místo UV',
        'pure-minimal': 'Striktní minimum bez priceForInsurance/drawdownDate/client',
        'full-korando': 'Naše Korando 500k s VŠÍM (asset detaily, client, drawdownDate, priceForInsurance)',
      },
    }, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const payload = VARIANTS[variant];
  if (!payload) {
    return new Response(JSON.stringify({
      error: `Neznámá varianta: ${variant}`,
      availableVariants: Object.keys(VARIANTS),
    }, null, 2), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const token = await getToken();
    const r = await fetch(CALC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const responseText = await r.text();
    let responseJson: any;
    try { responseJson = JSON.parse(responseText); } catch { responseJson = responseText; }

    return new Response(JSON.stringify({
      variant,
      payload,
      uclStatus: r.status,
      uclOk: r.ok,
      uclResponse: responseJson,
    }, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({
      variant,
      payload,
      error: e?.message ?? 'unknown',
      cause: e?.cause?.code ?? null,
    }, null, 2), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
