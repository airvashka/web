/**
 * Sdílený in-memory per-IP rate limiter pro API endpointy (lead, newsletter, chat).
 *
 * POZN: paměť je per-function-instance. Na Vercel serverless (cold start + škálování)
 * to NENÍ 100% spolehlivé — ber to jako měkký zpomalovač. Hlavní ochrana formulářů
 * je Turnstile. Kdyby byl potřeba tvrdý sdílený limit → @upstash/ratelimit / Vercel KV
 * (vyžaduje externí Redis, viz docs/SECURITY.md).
 */
type Entry = { count: number; resetAt: number };

export type RateLimitResult = { allowed: boolean; remaining: number; resetIn: number };

/**
 * Vytvoří rate limiter s daným limitem a oknem. Vrací funkci `check(ip)`.
 * GC starých záznamů probíhá automaticky (každých ~100 volání).
 */
export function createRateLimiter(max: number, windowMs: number): (ip: string) => RateLimitResult {
  const store = new Map<string, Entry>();
  let gc = 0;
  return function check(ip: string): RateLimitResult {
    const now = Date.now();
    if (++gc >= 100) {
      gc = 0;
      for (const [k, v] of store.entries()) if (now > v.resetAt) store.delete(k);
    }
    const entry = store.get(ip);
    if (!entry || now > entry.resetAt) {
      store.set(ip, { count: 1, resetAt: now + windowMs });
      return { allowed: true, remaining: max - 1, resetIn: windowMs };
    }
    if (entry.count >= max) return { allowed: false, remaining: 0, resetIn: entry.resetAt - now };
    entry.count++;
    return { allowed: true, remaining: max - entry.count, resetIn: entry.resetAt - now };
  };
}

/** IP klienta z Vercel/proxy hlaviček. */
export function getClientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    'unknown'
  );
}
