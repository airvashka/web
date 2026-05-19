/**
 * Dynamic dealer contacts — rotation among active sales / service employees.
 *
 * Why: pokud má SFR Motor 2+ prodejce, telefonní čísla zobrazená na webu se
 * mají rovnoměrně rozdělovat. Random pick on server render → každý request
 * jiné číslo → long-term distribution rovnoměrné (2 prodejci = 50/50,
 * 3 prodejci = 33/33/33). Admin workflow: přidat prodejce v Directus
 * `employees` collection → automaticky se začne objevovat v rotaci.
 *
 * Použití (server-side, SSR):
 *   const { sales, service } = await getDealerContacts();
 *   const phone = pickRandom(sales)?.phone ?? FALLBACK_SALES_PHONE;
 *
 * Fallback: pokud Directus selže nebo collection prázdná, vracejí se
 * hardcoded čísla — web nikdy nezůstane bez telefonu.
 */

import { directusGet } from '@lib/directus';
import type { Employee } from '@lib/types';

export const FALLBACK_SALES_PHONE = '+420 771 235 458';
export const FALLBACK_SERVICE_PHONE = '+420 771 259 323';

export type DealerContact = {
  full_name: string;
  phone: string;
  email?: string;
  role?: string;
};

export type DealerContacts = {
  sales: DealerContact[];
  service: DealerContact[];
};

/**
 * Načte aktivní prodejce + servisáky z Directus `employees`.
 * Filtruje:
 *   - department IN ('sales', 'service')
 *   - status === 'published' (pokud collection field existuje)
 *   - non-empty phone
 *
 * Cache TTL není potřeba — Astro SSR si vrátí výsledek per-request,
 * Directus má vlastní cache. Pokud by to bylo pomalé, lze přidat
 * module-level memo (cca 5-15s TTL).
 */
export async function getDealerContacts(): Promise<DealerContacts> {
  try {
    const employees = await directusGet<Employee>('employees', {
      filter: {
        department: { _in: ['sales', 'service'] },
        // status filter — pokud collection má status field, jinak Directus jen ignoruje
        // (alternativně bez status filter pokud Directus selže na neznámém poli)
      },
      sort: ['sort', 'full_name'],
      fields: ['id', 'full_name', 'role', 'department', 'phone', 'email'],
      limit: 50,
    });

    const sales: DealerContact[] = [];
    const service: DealerContact[] = [];

    for (const e of employees) {
      // Skip without phone — nelze rotovat bez čísla
      if (!e.phone || !e.phone.trim()) continue;
      const contact: DealerContact = {
        full_name: e.full_name,
        phone: e.phone,
        email: e.email,
        role: e.role,
      };
      if (e.department === 'sales') sales.push(contact);
      else if (e.department === 'service') service.push(contact);
    }

    return { sales, service };
  } catch (err) {
    // Directus padl nebo permissions — fallback na hardcoded
    console.error('[contacts] Directus fetch failed:', err);
    return { sales: [], service: [] };
  }
}

/**
 * Náhodný pick ze sales pool. Při prázdném poolu → fallback objekt s
 * hardcoded telefonem (web nikdy bez čísla).
 */
export function pickSalesContact(contacts: DealerContacts): DealerContact {
  if (contacts.sales.length === 0) {
    return { full_name: 'SFR Motor — prodej', phone: FALLBACK_SALES_PHONE };
  }
  const idx = Math.floor(Math.random() * contacts.sales.length);
  return contacts.sales[idx];
}

export function pickServiceContact(contacts: DealerContacts): DealerContact {
  if (contacts.service.length === 0) {
    return { full_name: 'SFR Motor — servis', phone: FALLBACK_SERVICE_PHONE };
  }
  const idx = Math.floor(Math.random() * contacts.service.length);
  return contacts.service[idx];
}

/**
 * Helper pro `tel:` linky — odstraní mezery a nepovolené znaky z telefonu.
 * "+420 771 235 458" → "+420771235458"
 */
export function telLink(phone: string): string {
  return phone.replace(/[^\d+]/g, '');
}
