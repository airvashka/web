/**
 * SFR Motor — UniCredit Leasing kalkulačka proxy
 *
 * Standalone Node.js mikroservis. Běží v Docker kontejneru na VPS s fixní IP,
 * kterou UCL whitelistne. Nahrazuje původní Astro endpoint /api/leasing/calculate
 * (ten z Vercel timeoutoval kvůli UCL Kong gateway IP whitelist).
 *
 * Endpointy:
 *   GET  /health                       → { status: "ok" }
 *   POST /calculate                    → UCL výpočet (real API call)
 *   GET  /test?variant=NAME            → testovací varianty (jen v dev)
 *
 * ENV:
 *   PORT (default 3001)
 *   UNICREDIT_AUTH_URL, UNICREDIT_CALC_URL
 *   UNICREDIT_USERNAME, UNICREDIT_PASSWORD, UNICREDIT_CLIENT_SECRET
 *   ALLOWED_ORIGINS — comma-separated (kdo smí volat /calculate)
 *
 * Bearer token cache: in-memory, ~30 min (UCL expires_in), s -60s rezervou.
 * Restart kontejneru → cache prázdná → nový login při prvním requestu (~500 ms).
 */
import express from 'express';

const app = express();
app.use(express.json({ limit: '50kb' }));

// CORS — frontend volá z https://www.sfr-motor.cz, browser dělá preflight.
// Bez správných hlaviček browser zablokuje response (i když Express ji vrátí).
app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  const corsAllowed = [
    'https://sfr-motor.cz',
    'https://www.sfr-motor.cz',
    'https://beta.sfr-motor.cz',
    'http://localhost:4321', // Astro dev server
    'http://127.0.0.1:4321',
  ];
  // Vercel preview deployments — *.vercel.app
  if (corsAllowed.includes(origin) || /^https:\/\/[\w-]+\.vercel\.app$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400'); // cache preflight 24h
  }
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

const PORT = Number(process.env.PORT) || 3001;
const AUTH_URL = process.env.UNICREDIT_AUTH_URL
  || 'https://kalkulator-prep.unicreditleasing.sk/keycloak/realms/uclkalk/protocol/openid-connect/token';
const CALC_URL = process.env.UNICREDIT_CALC_URL
  || 'https://kalkulator-prep.unicreditleasing.sk/api/v1/calculation/calculation/';
const USERNAME = process.env.UNICREDIT_USERNAME || '';
const PASSWORD = process.env.UNICREDIT_PASSWORD || '';
const CLIENT_SECRET = process.env.UNICREDIT_CLIENT_SECRET || '';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'sfr-motor.cz,localhost,127.0.0.1,vercel.app')
  .split(',').map(s => s.trim()).filter(Boolean);

// ─── Token cache ─────────────────────────────────────────────────────────────
let tokenCache = null; // { token, expiresAt }

async function getToken() {
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
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in ?? 1800) - 60) * 1000,
  };
  return tokenCache.token;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function isAllowedOrigin(req) {
  const referer = req.headers['referer'] || req.headers['origin'] || '';
  if (!referer) return false;
  return ALLOWED_ORIGINS.some(h => referer.includes(h));
}

function jsonResp(res, status, body) {
  res.status(status).json(body);
}

// ─── Health ──────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  jsonResp(res, 200, {
    status: 'ok',
    tokenCached: !!tokenCache,
    tokenExpiresIn: tokenCache ? Math.max(0, Math.floor((tokenCache.expiresAt - Date.now()) / 1000)) : null,
  });
});

// ─── Calculate ───────────────────────────────────────────────────────────────
app.post('/calculate', async (req, res) => {
  // Origin check
  if (!isAllowedOrigin(req)) {
    return jsonResp(res, 403, { error: 'Forbidden origin' });
  }

  const body = req.body || {};
  const assetPrice = Math.round(Number(body.assetPrice) || 0);
  const downPaymentPercent = Number(body.downPaymentPercent) || 0;
  const months = Number(body.numberOfInstallments) || 0;
  const groupCode = String(body.groupCode || 'OA').toUpperCase();
  const isUsed = !!body.isUsed;
  const vatRate = Number(body.vatRate) || 0.21;
  const brand = String(body.brand || '').trim() || 'KGM';
  const model = String(body.model || '').trim() || 'Korando';

  // Validace (stejně jako v Astro endpointu)
  if (assetPrice < 50_000 || assetPrice > 50_000_000) {
    return jsonResp(res, 400, { error: 'assetPrice out of range' });
  }
  if (downPaymentPercent < 0.10 || downPaymentPercent > 0.60) {
    return jsonResp(res, 400, { error: 'downPayment must be 10–60 %' });
  }
  if (![12, 24, 36, 48, 60, 72, 84].includes(months)) {
    return jsonResp(res, 400, { error: 'numberOfInstallments must be one of 12, 24, 36, 48, 60, 72, 84' });
  }

  const downPaymentAmount = Math.round(assetPrice * downPaymentPercent);
  const financedAmount = assetPrice - downPaymentAmount;
  const today = new Date().toISOString().slice(0, 10);

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
      let userMessage = null;
      let errorCode = null;
      try {
        const errData = JSON.parse(txt);
        errorCode = errData?.errorCode ?? null;
        if (errData?.detail && typeof errData.detail === 'string') userMessage = errData.detail;
      } catch { /* not JSON */ }
      return jsonResp(res, 502, {
        error: `UCL ${uclResp.status}`,
        userMessage,
        errorCode,
        detail: txt.substring(0, 300),
      });
    }
    const data = await uclResp.json();
    if (data?.resultCode !== 'OK' || !Array.isArray(data?.calculations) || !data.calculations[0]) {
      return jsonResp(res, 502, {
        error: 'UCL returned no valid calculation',
        detail: data?.resultText ?? null,
      });
    }
    const c = data.calculations[0];

    return jsonResp(res, 200, {
      monthlyPayment: Math.round(Number(c.annuityInstallment) || 0),
      apr: Number(c.rpmnRpsn) || 0,
      interestRate: Number(c.loanInterestRate) || 0,
      totalToPay: Math.round(Number(c.totalToPay) || 0),
      financedAmount,
      downPaymentAmount,
      months,
      disclaimers: {
        contract: data?.legalData?.arrangementContract ?? null,
        calc: data?.legalData?.arrangementCalc ?? null,
        chargeEnd: data?.legalData?.arrangementCChargeEnd ?? null,
        provider: data?.legalData?.providerInfo ?? null,
        partnerInfo: data?.legalData?.partnerInfo ?? null,
      },
    });
  } catch (e) {
    const cause = e?.cause;
    return jsonResp(res, 500, {
      error: 'Calculation failed',
      detail: e?.message?.substring(0, 200) ?? null,
      causeCode: cause?.code ?? null,
      causeMessage: cause?.message?.substring(0, 200) ?? null,
      step: e?.message?.startsWith('Auth') ? 'auth' : 'calc',
    });
  }
});

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[ucl-proxy] listening on ${PORT}, allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
});
