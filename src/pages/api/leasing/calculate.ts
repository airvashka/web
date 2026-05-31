/**
 * UniCredit Leasing kalkulačka — server-side proxy.
 *
 * Frontend POST → tento endpoint → UCL Calc API → zjednodušený JSON zpět.
 * Bearer token cachujeme v server memory na 30 min (UCL validity).
 *
 * Důvod proxy:
 *  - Credentials (client_secret, username, password) NESMÍ na klienta
 *  - Token cache šetří 1 auth volání na každý request kalkulačky
 *  - Můžeme tlumit / logovat na vlastní straně
 *
 * ENV (Vercel) — hodnoty NIKDY do kódu, jen do ENV:
 *   UNICREDIT_AUTH_URL, UNICREDIT_CALC_URL, UNICREDIT_USERNAME,
 *   UNICREDIT_PASSWORD, UNICREDIT_CLIENT_SECRET
 * PROD: stejné proměnné s prod URL (bez '-prep') a ostrými credentials.
 */
import type { APIRoute } from 'astro';
import { createRateLimiter, getClientIp } from '@lib/rateLimit';

export const prerender = false;

// Rate limit — kalkulačka volá UCL API pod našimi credentials, chraň před zneužitím.
const checkRateLimit = createRateLimiter(30, 60 * 60 * 1000); // 30/hod/IP

const AUTH_URL = import.meta.env.UNICREDIT_AUTH_URL
  ?? 'https://kalkulator-prep.unicreditleasing.sk/keycloak/realms/uclkalk/protocol/openid-connect/token';
const CALC_URL = import.meta.env.UNICREDIT_CALC_URL
  ?? 'https://kalkulator-prep.unicreditleasing.sk/api/v1/calculation/calculation/';
const USERNAME = import.meta.env.UNICREDIT_USERNAME ?? '';
const PASSWORD = import.meta.env.UNICREDIT_PASSWORD ?? '';
const CLIENT_SECRET = import.meta.env.UNICREDIT_CLIENT_SECRET ?? '';

// Server-memory token cache (per Vercel function instance — fine)
let tokenCache: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }
  if (!USERNAME || !PASSWORD || !CLIENT_SECRET) {
    throw new Error('UniCredit credentials nejsou v ENV nastavené');
  }
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
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`Auth ${r.status}: ${txt.substring(0, 200)}`);
  }
  const data = await r.json();
  if (!data?.access_token) throw new Error('Auth response missing access_token');
  // expires_in v sekundách. Cacheme s rezervou -60s aby nehrozila expirace mid-call.
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in ?? 1800) - 60) * 1000,
  };
  return tokenCache.token;
}

interface CalcRequest {
  assetPrice: number;            // Cena vozu s DPH (Kč)
  downPaymentPercent: number;    // 0.10 - 0.70
  numberOfInstallments: number;  // 12, 24, 36, 48, 60, 72, 84
  brand?: string;                // např. "KGM" — UCL VYŽADUJE (i když docs říká není required)
  model?: string;                // např. "Korando" — UCL VYŽADUJE
  isUsed?: boolean;              // false = NEW, true = USED
  groupCode?: string;            // OA (default), MOT, UA, EA…
  vatRate?: number;              // default 0.21
}

export const POST: APIRoute = async ({ request }) => {
  // Origin check — kalkulačka jen z našeho webu (lehká ochrana proti scraperu)
  const referer = request.headers.get('referer') ?? '';
  const allowedHosts = [
    'sfr-motor.cz',
    'beta.sfr-motor.cz',
    'localhost',
    '127.0.0.1',
    'vercel.app', // preview deployments
  ];
  const ok = allowedHosts.some((h) => referer.includes(h));
  if (!ok) {
    return new Response(JSON.stringify({ error: 'Forbidden origin' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Rate limit
  if (!checkRateLimit(getClientIp(request)).allowed) {
    return new Response(JSON.stringify({ error: 'Příliš mnoho požadavků, zkus to za chvíli.' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: CalcRequest;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const assetPrice = Math.round(Number(body.assetPrice) || 0);
  const downPaymentPercent = Number(body.downPaymentPercent) || 0;
  const months = Number(body.numberOfInstallments) || 0;
  const groupCode = String(body.groupCode || 'OA').toUpperCase();
  const isUsed = !!body.isUsed;
  const vatRate = Number(body.vatRate) || 0.21;
  const brand = String(body.brand || '').trim() || 'KGM';
  const model = String(body.model || '').trim() || 'Korando';

  // PREPROD limits (UCL říká): akontace 10–70 % po 5 %, splátky 12–84 po 12
  if (assetPrice < 50_000 || assetPrice > 50_000_000) {
    return new Response(JSON.stringify({ error: 'assetPrice out of range' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
  if (downPaymentPercent < 0.10 || downPaymentPercent > 0.60) {
    return new Response(JSON.stringify({ error: 'downPayment must be 10–60 %' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
  if (![12, 24, 36, 48, 60, 72, 84].includes(months)) {
    return new Response(JSON.stringify({ error: 'numberOfInstallments must be one of 12, 24, 36, 48, 60, 72, 84' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Výpočet financedAmount = cena - akontace
  const downPaymentAmount = Math.round(assetPrice * downPaymentPercent);
  const financedAmount = assetPrice - downPaymentAmount;

  // UCL payload — kopíruje typický request z dokumentace (str 13).
  // commission/mfee/administrationFee — UCL v PREPROD ignoruje (úroková matice
  // vlastní), ale validace vyžaduje, aby byly přítomny. Pro PROD doladíme.
  const today = new Date().toISOString().slice(0, 10);
  // UCL backend VYŽADUJE clientIdentification + asset.brand + asset.model,
  // i když dokumentace říká "není required". Bez nich vrací HTTP 500
  // "Unexpected exception" (testováno empiricky v /api/leasing/test).
  const uclPayload = {
    multicalculation: false,
    financedAmount,
    assetPrice,
    priceForInsurance: assetPrice,
    downPayment: downPaymentPercent,
    downPaymentMethod: 'PER',
    vatRate,
    numberOfInstallments: months,
    financingType: 'UV',
    pns: 0.0,
    rateType: 'STANDARD',
    // Commission/mfee dynamicky — UCL má per-partner limit (vyšší akontace =
    // nižší financedAmount → nižší max commission). Bezpečné: 0.5 % z financedAmount,
    // strop 4000. UCL v PREPROD hodnotu stejně ignoruje (vlastní matice), jen validuje.
    commission: Math.max(100, Math.min(Math.round(financedAmount * 0.005), 4000)),
    mfee: Math.max(100, Math.min(Math.round(financedAmount * 0.003), 2000)),
    administrationFee: 0,
    drawdownDate: today,
    asset: {
      category: 'AL',
      group: groupCode,
      status: isUsed ? 'USED' : 'NEW',
      brand,
      model,
    },
    clientIdentification: {
      personType: 'FON',
      id: '900101/1234',
      name: 'Klient',
    },
  };

  try {
    const token = await getToken();
    const uclResp = await fetch(CALC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(uclPayload),
    });
    if (!uclResp.ok) {
      const txt = await uclResp.text().catch(() => '');
      // Pokus o parse UCL error JSONu — vrátíme uživatelsky čitelný důvod
      let userMessage: string | null = null;
      let errorCode: string | null = null;
      try {
        const errData = JSON.parse(txt);
        errorCode = errData?.errorCode ?? null;
        // UCL někdy posílá konkrétní detail (např. NO_MATCHING_MATRIX_ASSIGNED_TO_PARTNER)
        if (errData?.detail && typeof errData.detail === 'string') {
          userMessage = errData.detail;
        }
      } catch { /* not JSON */ }
      console.error('[leasing] UCL error', uclResp.status, txt.substring(0, 300));
      return new Response(JSON.stringify({
        error: `UCL ${uclResp.status}`,
        userMessage,
        errorCode,
      }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }
    const data = await uclResp.json();
    if (data?.resultCode !== 'OK' || !Array.isArray(data?.calculations) || !data.calculations[0]) {
      return new Response(JSON.stringify({
        error: 'UCL returned no valid calculation',
        detail: data?.resultText ?? null,
      }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }
    const c = data.calculations[0];

    // Zjednodušený response pro frontend
    return new Response(JSON.stringify({
      monthlyPayment: Math.round(Number(c.annuityInstallment) || 0),
      apr: Number(c.rpmnRpsn) || 0,
      interestRate: Number(c.loanInterestRate) || 0,
      totalToPay: Math.round(Number(c.totalToPay) || 0),
      financedAmount,
      downPaymentAmount,
      months,
      // Disclaimers z legalData pro display (UCL nám je posílá v každém OK response)
      disclaimers: {
        contract: data?.legalData?.arrangementContract ?? null,
        calc: data?.legalData?.arrangementCalc ?? null,
        chargeEnd: data?.legalData?.arrangementCChargeEnd ?? null,
        provider: data?.legalData?.providerInfo ?? null,
        partnerInfo: data?.legalData?.partnerInfo ?? null,
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('[leasing] calc failed:', e?.message, e?.cause?.code, e?.cause?.message);
    return new Response(JSON.stringify({ error: 'Calculation failed' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
