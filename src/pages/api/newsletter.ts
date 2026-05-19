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
const ECOMAIL_URL = `https://sfr.ecomailapp.cz/public/subscribe/${ECOMAIL_LIST_ID}/${ECOMAIL_HASH}`;

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

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

  const email = String(body.email ?? '').trim().slice(0, 200);
  if (!EMAIL_RE.test(email)) {
    return new Response(JSON.stringify({ ok: false, error: 'Neplatný e-mail.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Volá Ecomail
  try {
    const formBody = new URLSearchParams({ email });
    const res = await fetch(ECOMAIL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody.toString(),
    });
    if (!res.ok) {
      console.error('[newsletter] Ecomail failed:', res.status);
      return new Response(JSON.stringify({ ok: false, error: 'Něco se pokazilo. Zkus to později.' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[newsletter] Ecomail fetch error:', err);
    return new Response(JSON.stringify({ ok: false, error: 'Network error.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
