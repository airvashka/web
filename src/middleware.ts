/**
 * Astro middleware — momentálně prázdný no-op.
 *
 * Důvod: middleware NEBĚŽÍ pro statické (prerendered) stránky během buildu,
 * takže rotace telefonů přes Astro.locals fungovala jen pro SSR pages.
 * Místo toho jsme přešli na client-side rotaci (viz Header.astro):
 * build-time fetchne všechny prodejce, embedduje JSON, JS na klientovi
 * random-pickne při každém načtení.
 *
 * Soubor zachováván jako placeholder — kdybychom v budoucnu chtěli middleware
 * pro nějaký SSR-specific use case (audit log, A/B test, atd.).
 */
import { defineMiddleware } from 'astro:middleware';

export const onRequest = defineMiddleware(async (_context, next) => {
  return next();
});
