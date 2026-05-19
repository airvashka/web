/**
 * Astro middleware — fetch dealer contacts JEDNOU za request, sdíleno přes Astro.locals.
 *
 * Bez middleware by každá komponenta (Header, MobileBottomBar, sklad/servis stránky)
 * volala Directus zvlášť → 3-5 calls per page. S middleware: 1 call, výsledek dostupný
 * všude přes `Astro.locals.dealerContacts`.
 *
 * Picky se dělají v komponentě (random je deterministický uvnitř requestu pokud chceme,
 * ale stačí random na render). Pokud potřebuješ rovnoměrnou rotaci v rámci jedné stránky
 * (Header + Footer stejný telefon), pickni na úrovni middleware.
 */
import { defineMiddleware } from 'astro:middleware';
import { getDealerContacts, pickSalesContact, pickServiceContact } from '@lib/contacts';

export const onRequest = defineMiddleware(async (context, next) => {
  // Pouze pro stránky (ne pro API endpoints — ty si data tahají sami pokud potřebují)
  const isApi = context.url.pathname.startsWith('/api/');
  if (!isApi) {
    try {
      const contacts = await getDealerContacts();
      // Picky per-request — všechny komponenty na téhle stránce uvidí stejný telefon
      // (sales card v Header == footer == sticky CTA — konzistentní UX)
      (context.locals as any).dealerContacts = contacts;
      (context.locals as any).salesContact = pickSalesContact(contacts);
      (context.locals as any).serviceContact = pickServiceContact(contacts);
    } catch (err) {
      console.error('[middleware] dealer contacts fetch failed:', err);
      // Locals zůstanou undefined — komponenty si helpery zavolají s fallbackem
    }
  }
  return next();
});
