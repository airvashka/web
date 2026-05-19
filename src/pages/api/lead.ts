/**
 * /api/lead — centralizovaný lead endpoint
 *
 * Všechny formy (kontakt, servis, sklad detail, AI chat, LeadForm component)
 * posílají sem POST. Endpoint:
 *  - honeypot check (`_hp_website` musí být prázdné)
 *  - rate limit 10/den/IP (in-memory Map)
 *  - server-side validace (jméno, email, telefon, message)
 *  - Cloudflare Turnstile verifikace (invisible CAPTCHA)
 *  - audit data (IP, user-agent, referer)
 *  - zápis do Directus s `DIRECTUS_STATIC_TOKEN` (server token, ne anonymous)
 *
 * Directus `leads` collection MUSÍ mít zakázaný anonymous write
 * (Public role → leads → Create = No Access). Token má pouze `create` permission.
 */

import type { APIRoute } from 'astro';

export const prerender = false;

// ===== Env vars =====
const DIRECTUS_URL = import.meta.env.DIRECTUS_URL ?? import.meta.env.PUBLIC_DIRECTUS_URL;
// Prefer omezený Lead Writer token (jen create na leads). Fallback na admin token,
// pokud DIRECTUS_LEAD_TOKEN není nastaven — pro zpětnou kompatibilitu.
const DIRECTUS_TOKEN = import.meta.env.DIRECTUS_LEAD_TOKEN ?? import.meta.env.DIRECTUS_STATIC_TOKEN;
const TURNSTILE_SECRET = import.meta.env.TURNSTILE_SECRET;
const TURNSTILE_ENABLED = !!TURNSTILE_SECRET;

// ===== Rate limit (in-memory, per-IP, per-day) =====
type RateLimitEntry = { count: number; resetAt: number };
const rateLimitStore = new Map<string, RateLimitEntry>();
const RATE_LIMIT_MAX = 10; // 10 leadů za den
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

function checkRateLimit(ip: string): { ok: boolean; remaining: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { ok: true, remaining: RATE_LIMIT_MAX - 1 };
  }
  if (entry.count >= RATE_LIMIT_MAX) return { ok: false, remaining: 0 };
  entry.count++;
  return { ok: true, remaining: RATE_LIMIT_MAX - entry.count };
}

// Garbage collect old entries každých 100 requestů (jednoduchá strategie)
let gcCounter = 0;
function maybeGc() {
  if (++gcCounter < 100) return;
  gcCounter = 0;
  const now = Date.now();
  for (const [k, v] of rateLimitStore.entries()) {
    if (now > v.resetAt) rateLimitStore.delete(k);
  }
}

// ===== Validace =====
const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const PHONE_RE = /^[\d\s+()-]{9,20}$/;

function sanitizeText(s: unknown, maxLen: number): string {
  if (typeof s !== 'string') return '';
  // Strip HTML tags + trim + truncate
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function validatePayload(body: any): { ok: true; data: any } | { ok: false; error: string } {
  const name = sanitizeText(body.customer_name, 100);
  if (name.length < 2) return { ok: false, error: 'Jméno musí mít alespoň 2 znaky.' };

  const email = sanitizeText(body.customer_email, 200);
  if (email && !EMAIL_RE.test(email)) return { ok: false, error: 'Neplatný email.' };

  const phone = sanitizeText(body.customer_phone, 20);
  const phoneClean = phone.replace(/[\s()-]/g, '');
  if (!phone || !PHONE_RE.test(phone) || phoneClean.length < 9) {
    return { ok: false, error: 'Neplatný telefon — uveď 9+ číslic.' };
  }

  // Email nebo telefon — alespoň jedno (telefon already required, takže je vždy)
  if (!email && !phone) return { ok: false, error: 'Uveď email nebo telefon.' };

  const message = sanitizeText(body.message, 2000);
  const formType = sanitizeText(body.form_type, 50);
  const ALLOWED_TYPES = ['contact', 'service', 'stock_inquiry', 'model_inquiry', 'ai_chat', 'general'];
  if (!ALLOWED_TYPES.includes(formType)) {
    return { ok: false, error: 'Neplatný typ formuláře.' };
  }

  return {
    ok: true,
    data: {
      form_type: formType,
      customer_name: name,
      customer_email: email || null,
      customer_phone: phone,
      message: message || null,
      source_page: sanitizeText(body.source_page, 500),
      source_url: sanitizeText(body.source_url, 500),
      source_model: body.source_model ? Number(body.source_model) : null,
      source_vehicle: body.source_vehicle ? Number(body.source_vehicle) : null,
      source_brand: body.source_brand ? Number(body.source_brand) : null,
      source_vehicle_vin: sanitizeText(body.source_vehicle_vin, 50) || null,
      source_model_slug: sanitizeText(body.source_model_slug, 100) || null,
    },
  };
}

// ===== Turnstile =====
async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  if (!TURNSTILE_ENABLED) return true; // Pokud secret není nastaven, skip
  if (!token) return false;
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: TURNSTILE_SECRET!,
        response: token,
        remoteip: ip,
      }),
    });
    const data = await res.json();
    return !!data.success;
  } catch (err) {
    console.error('[lead] Turnstile verify failed:', err);
    return false;
  }
}

// ===== Directus write =====
async function createLeadInDirectus(payload: any): Promise<{ ok: true; id?: number } | { ok: false; error: string }> {
  if (!DIRECTUS_URL || !DIRECTUS_TOKEN) {
    console.error('[lead] DIRECTUS_URL or DIRECTUS_STATIC_TOKEN missing');
    return { ok: false, error: 'Server config error' };
  }
  try {
    const res = await fetch(`${DIRECTUS_URL}/items/leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DIRECTUS_TOKEN}`,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('[lead] Directus write failed:', res.status, text);
      return { ok: false, error: `Directus error ${res.status}` };
    }
    const data = await res.json();
    return { ok: true, id: data?.data?.id };
  } catch (err) {
    console.error('[lead] Directus fetch error:', err);
    return { ok: false, error: 'Network error' };
  }
}

// ===== POST handler =====
export const POST: APIRoute = async ({ request }) => {
  maybeGc();

  // IP detection (Vercel)
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    request.headers.get('x-real-ip') ??
    'unknown';

  // Rate limit check
  const rl = checkRateLimit(ip);
  if (!rl.ok) {
    return new Response(JSON.stringify({ ok: false, error: 'Příliš mnoho požadavků. Zkus to zítra nebo zavolej +420 771 235 458.' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Parse JSON
  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Neplatný JSON.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Honeypot check — ticho zahoď (vrať OK, bot neví že to neprošlo)
  if (body._hp_website && String(body._hp_website).trim() !== '') {
    return new Response(JSON.stringify({ ok: true, id: null }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Turnstile verify
  if (TURNSTILE_ENABLED) {
    const turnstileOk = await verifyTurnstile(String(body.turnstile_token ?? ''), ip);
    if (!turnstileOk) {
      return new Response(JSON.stringify({ ok: false, error: 'Ověření selhalo. Zkus to znovu.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // Validate
  const validation = validatePayload(body);
  if (!validation.ok) {
    return new Response(JSON.stringify({ ok: false, error: validation.error }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Enrich with audit data
  const directusPayload = {
    ...validation.data,
    source_ip: ip,
    source_user_agent: request.headers.get('user-agent')?.slice(0, 500) ?? null,
    source_referer: request.headers.get('referer')?.slice(0, 500) ?? null,
  };

  // Write to Directus
  const result = await createLeadInDirectus(directusPayload);
  if (!result.ok) {
    return new Response(JSON.stringify({ ok: false, error: 'Něco se pokazilo. Zkus to znovu nebo zavolej +420 771 235 458.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true, id: result.id }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
