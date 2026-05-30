/**
 * /api/newsletter — Ecomail subscribe proxy
 *
 * Web posílá POST sem (e-mail), server zavolá Ecomail public subscribe endpoint.
 * Důvody pro proxy:
 *  - Konzistentní rate limit (10/den/IP) — Ecomail veřejný endpoint není rate-limit-ovaný
 *  - Honeypot + serverová validace e-mailu před tím než ho pošleme do Ecomailu
 *  - Skryjeme listID/hash z frontendu (i když je veřejný, je to čistší)
 *
 * Ecomail endpoint (public subscribe form action):
 *   https://sfr.ecomailapp.cz/public/subscribe/{LIST_ID}/{HASH}
 *
 * Form-encoded body: email=foo@bar.cz
 */

import type { APIRoute } from 'astro';

export const prerender = false;

const ECOMAIL_LIST_ID = import.meta.env.ECOMAIL_LIST_ID ?? '4';
const ECOMAIL_HASH = import.meta.env.ECOMAIL_HASH ?? 'f67e22c6c3dacfc9b77b6b40399abc16';
const ECOMAIL_API_KEY = import.meta.env.ECOMAIL_API_KEY;
const ECOMAIL_API_URL = `https://api2.ecomailapp.cz/lists/${ECOMAIL_LIST_ID}/subscribe`;
// Fallback na public form (anti-bot blokuje, ale můžeme zkusit když API key chybí)
const ECOMAIL_PUBLIC_URL = `https://sfr.ecomailapp.cz/public/subscribe/${ECOMAIL_LIST_ID}/${ECOMAIL_HASH}`;

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

// ===== Turnstile (stejný pattern jako /api/lead) =====
const TURNSTILE_SECRET = import.meta.env.TURNSTILE_SECRET;
const TURNSTILE_ENABLED = !!TURNSTILE_SECRET;
async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  if (!TURNSTILE_ENABLED) return true; // bez secretu → skip (dev)
  if (!token) return false;
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: TURNSTILE_SECRET!, response: token, remoteip: ip }),
    });
    const data = await res.json();
    return !!data.success;
  } catch (err) {
    console.error('[newsletter] Turnstile verify failed:', err);
    return false;
  }
}

// Sdílíme rate limit pattern s /api/lead — ale samostatný store
type RLEntry = { count: number; resetAt: number };
const rateLimitStore = new Map<string, RLEntry>();
const RATE_LIMIT_MAX = 5; // newsletter méně častý než lead
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

export const POST: APIRoute = async ({ request }) => {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';

  if (!checkRateLimit(ip)) {
    return new Response(JSON.stringify({ ok: false, error: 'Příliš mnoho požadavků.' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Neplatný JSON.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Honeypot — ticho zahoď
  if (body._hp_website && String(body._hp_website).trim() !== '') {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Turnstile — graceful: pokud token přijde, ověř; když chybí, nech projít (honeypot+rate limit chrání).
  const turnstileToken = String(body.turnstile_token ?? '');
  if (TURNSTILE_ENABLED && turnstileToken) {
    const ok = await verifyTurnstile(turnstileToken, ip);
    if (!ok && import.meta.env.TURNSTILE_STRICT === 'true') {
      return new Response(JSON.stringify({ ok: false, error: 'Ověření selhalo. Zkuste znovu.' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  const email = String(body.email ?? '').trim().slice(0, 200);
  if (!EMAIL_RE.test(email)) {
    return new Response(JSON.stringify({ ok: false, error: 'Neplatný e-mail.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Preferujeme Ecomail API (s API key) — spolehlivé, oficiální.
  // Fallback na public form pokud API key chybí (anti-bot blokuje, ale OK pro dev).
  if (ECOMAIL_API_KEY) {
    try {
      const res = await fetch(ECOMAIL_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'key': ECOMAIL_API_KEY,
        },
        body: JSON.stringify({
          subscriber_data: {
            email,
          },
          // resubscribe: true — pokud byl odhlášen, znovu přihlásit
          resubscribe: true,
          // update_existing — pokud už je v listu, aktualizovat (nevracet error)
          update_existing: true,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error('[newsletter] Ecomail API failed:', res.status, text.slice(0, 200));
        // 422 = email already subscribed (treat as success)
        if (res.status === 422) {
          return new Response(JSON.stringify({ ok: true, alreadySubscribed: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ ok: false, error: `Newsletter služba odmítla (${res.status}). Kontaktujte nás.` }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      console.error('[newsletter] Ecomail API error:', err);
      return new Response(JSON.stringify({ ok: false, error: 'Network error.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // Fallback: public form scrape (nedoporučeno, anti-bot může blokovat)
  console.warn('[newsletter] ECOMAIL_API_KEY není nastaven, používám public form fallback');
  try {
    const formBody = new URLSearchParams({ email });
    const res = await fetch(ECOMAIL_PUBLIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': ECOMAIL_PUBLIC_URL,
      },
      body: formBody.toString(),
      redirect: 'follow',
    });
    if (!res.ok) {
      return new Response(JSON.stringify({ ok: false, error: `Newsletter služba odmítla (${res.status}). Nastav ECOMAIL_API_KEY ve Vercel env.` }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[newsletter] fallback error:', err);
    return new Response(JSON.stringify({ ok: false, error: 'Network error.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
