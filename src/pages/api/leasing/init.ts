/**
 * UniCredit Leasing — Partner-init endpoint.
 *
 * Alternativa k /calculation/ (který nám v PREPROD padá s 500 Unexpected exception).
 * Tady NEPROVÁDÍME výpočet — jen pošleme info o autě UCL a dostaneme redirect URL.
 * Zákazník je pak presměrován na UCL microsite, kde si výpočet udělá tam.
 *
 * Workflow:
 *   Browser → /api/leasing/init (POST) → UCL /web/api/partner-init → URL
 *   Browser → redirect na UCL microsite s předvyplněnou cenou/modelem
 *
 * URL UCL (per dokumentace 3.1):
 *   PREPROD CZ: https://kalkulator-prep.unicreditleasing.sk/web/api/partner-init
 *   PROD CZ:    https://kalkulator.unicreditleasing.sk/web/api/partner-init
 *
 * Response: { redirectRoute: "/?partnerInfoId=..." }
 * Final URL pro zákazníka: ${INIT_HOST}${redirectRoute}
 *   např. https://kalkulator-prep.unicreditleasing.sk/web?partnerInfoId=...
 */
import type { APIRoute } from 'astro';

export const prerender = false;

// Auth + base host — sdílí se s calculate.ts endpointem
const AUTH_URL = import.meta.env.UNICREDIT_AUTH_URL
  ?? 'https://kalkulator-prep.unicreditleasing.sk/keycloak/realms/uclkalk/protocol/openid-connect/token';
const INIT_URL = import.meta.env.UNICREDIT_INIT_URL
  ?? 'https://kalkulator-prep.unicreditleasing.sk/web/api/partner-init';
const INIT_HOST = import.meta.env.UNICREDIT_INIT_HOST
  ?? 'https://kalkulator-prep.unicreditleasing.sk/web';
const USERNAME = import.meta.env.UNICREDIT_USERNAME ?? '';
const PASSWORD = import.meta.env.UNICREDIT_PASSWORD ?? '';
const CLIENT_SECRET = import.meta.env.UNICREDIT_CLIENT_SECRET ?? '';

// Sdílí stejný token cache pattern jako calculate.ts
let tokenCache: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;
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

interface InitRequest {
  assetPrice: number;
  brand: string;
  model: string;
  isUsed?: boolean;
  groupCode?: string;     // OA, MOT, UA, EA…
  categoryCode?: string;  // AL nebo NA
}

export const POST: APIRoute = async ({ request }) => {
  // Origin check
  const referer = request.headers.get('referer') ?? '';
  const allowedHosts = ['sfr-motor.cz', 'beta.sfr-motor.cz', 'localhost', '127.0.0.1', 'vercel.app'];
  if (!allowedHosts.some((h) => referer.includes(h))) {
    return new Response(JSON.stringify({ error: 'Forbidden origin' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: InitRequest;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const assetPrice = Math.round(Number(body.assetPrice) || 0);
  const brand = String(body.brand || '').trim();
  const model = String(body.model || '').trim();
  const groupCode = String(body.groupCode || 'OA').toUpperCase();
  const categoryCode = String(body.categoryCode || 'AL').toUpperCase();
  const isUsed = !!body.isUsed;

  if (assetPrice < 50_000 || assetPrice > 50_000_000) {
    return new Response(JSON.stringify({ error: 'assetPrice out of range' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!brand || !model) {
    return new Response(JSON.stringify({ error: 'brand and model required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const token = await getToken();
    const initPayload = {
      accessToken: token,
      commission: 1,         // partner-init schema má min: 1
      mfee: 1,
      administrationFee: 1,
      asset: {
        price: assetPrice,
        category: categoryCode,
        group: groupCode,
        status: isUsed ? 'USED' : 'NEW',
        brand,
        model,
      },
    };

    const r = await fetch(INIT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(initPayload),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return new Response(JSON.stringify({
        error: `UCL init ${r.status}`,
        detail: txt.substring(0, 300),
      }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }
    const data = await r.json();
    if (!data?.redirectRoute) {
      return new Response(JSON.stringify({
        error: 'UCL init missing redirectRoute',
        detail: JSON.stringify(data).substring(0, 300),
      }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }

    // Sestavíme finální URL pro redirect zákazníka
    const fullUrl = INIT_HOST + data.redirectRoute;

    return new Response(JSON.stringify({
      url: fullUrl,
      redirectRoute: data.redirectRoute,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    const cause = e?.cause;
    return new Response(JSON.stringify({
      error: 'Init failed',
      detail: e?.message?.substring(0, 200) ?? null,
      causeCode: cause?.code ?? null,
      causeMessage: cause?.message?.substring(0, 200) ?? null,
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
