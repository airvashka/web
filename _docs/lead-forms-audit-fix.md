# Lead Forms — Audit + Fix Plán

Datum: 2026-05-19
Status: Plán k odsouhlasení, fix neproveden.

---

## 1. Inventura všech kontaktních bodů

### A) Telefonní čísla (`tel:` linky)

| # | Soubor:Line | Číslo | Kontext |
|---|---|---|---|
| 1 | `components/Header.astro:60` | +420 771 235 458 | Nav icon "Zavolat" (PC) |
| 2 | `components/Header.astro:89` | +420 771 235 458 | Mobile drawer CTA |
| 3 | `components/MobileBottomBar.astro:7` | +420 771 235 458 | Mobile bottom bar |
| 4 | `pages/kontakt.astro:86` | +420 771 235 458 | **Prodej** |
| 5 | `pages/kontakt.astro:87` | +420 771 259 323 | **Servis** |
| 6 | `pages/servis.astro:86` | +420 771 259 323 | Servisní stránka |
| 7 | `pages/sklad/[id].astro:523` | +420 771 235 458 | Sticky CTA bar v detailu vozu |
| 8 | `pages/sklad/[id].astro:885` | +420 771 235 458 | Poptávka section v detailu vozu |

**Pozorování:**
- Prodejní linka `+420 771 235 458` na **6 místech**, servisní `+420 771 259 323` na **2 místech**
- ✅ Konzistence: prodej = prodej, servis = servis (žádné záměny)
- ⚠️ Hardcoded čísla v 6 souborech — pokud se změní telefon, musíš měnit na 6 místech. Možný refactor: do `siteSettings` v Directus nebo do JS konstanty `src/lib/contact.ts`

---

### B) Lead formuláře (POST → Directus `/items/leads`)

| # | Form | Soubor:Line | form_type | Kontextová pole posílá | Chybějící kontext |
|---|---|---|---|---|---|
| 1 | **LeadForm.astro** (reusable) | `components/LeadForm.astro:97-164` | dynamic prop | `source_model`, `source_vehicle` | OK pokud volaný se správnými props |
| 2 | **Kontaktní formulář** | `pages/kontakt.astro:154-181` | `contact` | žádný | OK (generic) |
| 3 | **Servisní formulář** | `pages/servis.astro:92-127` | `service` | žádný | ⚠️ Vůz/značka jen v `message` textu |
| 4 | **Stock inquiry** (detail vozu) | `pages/sklad/[id].astro:897-910` | `stock_inquiry` | `source_vehicle` (ID) | ⚠️ Chybí `source_model`, `source_brand`, VIN snapshot |
| 5 | **AI Chat lead** (přes API) | `pages/api/chat/model.ts:808-820` | `ai_chat` | `source_page` (path) | ⚠️ Chybí `source_model` ID, jen jako text v `message` |

### Newsletter
- `pages/magazin/index.astro:159` — **fake form** (`onsubmit="event.preventDefault()..."`), nikam neposílá. TODO.

---

## 2. Mapa: odkud poptávka přijde → co se posílá

```
┌─────────────────────────────────────────────────────────────────────┐
│ Stránka              │ Form                  │ Kontext v payloadu   │
├─────────────────────────────────────────────────────────────────────┤
│ /                    │ — (jen tel)           │ —                    │
│ /kgm /omoda /farizon │ — (jen tel + odkazy)  │ —                    │
│ /model/[slug]        │ ModelChatWidget       │ source_page (path)   │
│                      │ → /api/chat/model     │ + model v message    │
│ /sklad               │ — (jen seznam)        │ —                    │
│ /sklad/[id]          │ stock_inquiry         │ source_vehicle (ID)  │
│                      │ (+ sticky tel CTA)    │ ❌ chybí brand/model │
│ /servis              │ service               │ ❌ žádný kontext     │
│ /kontakt             │ contact               │ ❌ žádný (správně)   │
└─────────────────────────────────────────────────────────────────────┘
```

**Admin v Directusu vidí:**
- Z `source_vehicle` → kliknutí otevře vůz (relation). OK pro detail vozu.
- Z `source_page` → text path (např. `/sklad/kgm-tivoli-style-waa-6`). Otevřít musí ručně.
- Z `source_model` → relation na model (OK pokud vyplněn — LeadForm.astro to umí, ale nikdo ho nevolá s `modelId`).

**Co bych chtěl vidět v Directus leads listu:**
1. Lead přijde → admin **na první pohled** vidí: značka, model, konkrétní vůz (pokud existuje), zdrojová stránka
2. Klik na lead → vidí kompletní context: customer + message + model card thumbnail + URL
3. Filtr "Lead z konkrétního auta" / "Lead z modelu Torres" / "Lead přes chat"

---

## 3. Problémy z bezpečnostního auditu

### Kritické
1. **Anonymous POST z prohlížeče** přímo na Directus URL — `${PUBLIC_DIRECTUS_URL}/items/leads`. Útočník/bot pošle `curl -X POST` a Directus to přijme.
2. **Honeypot jen client-side** (`_hp_website` field) — kontrola běží v browseru, bot ho obejde.
3. **Žádný rate limit** — 1000 leadů za minutu z jedné IP projde.
4. **Žádná server-side validace** — `customer_email`, `customer_phone` nikdo nekontroluje (jen `required` na frontu).
5. **Directus `leads` collection MUSÍ mít anonymous write povolený** (jinak by client-side POST nefungoval) — tj. KAŽDÝ může psát do collection.
6. **Žádný CSRF token, žádné CAPTCHA.**

### Vedlejší
- Chybí audit trail (`user_agent`, `ip`, `referer`)
- Bez analytics pro abuse tracking
- AI chat má rate limit (20/h), ale jen pro AI requesty — lead se posílá zvlášť bez vlastního limitu

---

## 4. Fix plán

### Fáze 1: Centralizovaný server endpoint

**Nový soubor:** `web/src/pages/api/lead.ts`
- `export const prerender = false` (SSR-on-request)
- POST endpoint, JSON in/out
- Server-side validace:
  - `customer_name`: 2-100 znaků, sanitize HTML
  - `customer_email`: regex validace + max 200 znaků
  - `customer_phone`: regex CZ formát (`+420 XXX XXX XXX` / 9 číslic), max 20
  - `message`: max 2000 znaků, strip HTML tags
  - `form_type`: enum (`contact` | `service` | `stock_inquiry` | `model_inquiry` | `ai_chat`)
- Honeypot check (`_hp_website` musí být prázdné)
- **Rate limit**: 5 leadů / hod / IP (in-memory Map, stejný pattern jako `chat/model.ts`)
- Volá Directus s `DIRECTUS_STATIC_TOKEN` (server-side env var, NIKDY v browseru) → admin token s permissions: create only na `leads`
- Audit data automaticky:
  - `user_agent`: z hlaviček
  - `ip`: z `x-forwarded-for` (Vercel)
  - `referer`: z hlaviček
  - `created_at`: Directus auto (default)
- Vrací: `{ ok: true, leadId }` nebo `{ ok: false, error: 'rate_limit' | 'validation' | 'server' }`

### Fáze 2: Refactor všech 4+ forms

- ❌ Smazat `import.meta.env.PUBLIC_DIRECTUS_URL` z client scriptů forms
- ❌ Smazat přímé `fetch(${DIRECTUS_URL}/items/leads)` ze všech 5 míst
- ✅ Změnit na `fetch('/api/lead', { method: 'POST', body: JSON.stringify(payload) })`
- ✅ Stejná error handling logika (status zpráva, GA event)
- Files to update:
  1. `components/LeadForm.astro:97-164`
  2. `pages/kontakt.astro:188-220`
  3. `pages/servis.astro:166-200`
  4. `pages/sklad/[id].astro:1092-1126`
  5. `pages/api/chat/model.ts:808-820` — volat `/api/lead` interně (nebo refactor: `chat/model.ts` zavolá lead-creating funkci přímo přes Directus token, NE skrz HTTP self-call)

### Fáze 3: Directus konfigurace

- V Directus admin:
  1. Vytvořit static token: Settings → Access Tokens → "Lead API token" s pouze `create` permission na collection `leads`
  2. Zapnout token v Vercel env: `DIRECTUS_STATIC_TOKEN=xxx`
  3. **Zakázat anonymous write** na `leads`: Roles → Public → leads → Create = **No Access** (změnit z "All Access" který je teď)
  4. Verifikovat: ručně `curl -X POST ${DIRECTUS_URL}/items/leads -d '{...}'` → musí vrátit 403

### Fáze 4: Lepší kontext do payloadu

Rozšířit `leads` collection o pole:
- `source_brand` (M2O relation na `brands`) — pokud z brand/model/sklad stránky
- `source_model_slug` (string snapshot) — kdyby model smazán, lead pořád ukazuje který to byl
- `source_vehicle_vin` (string snapshot) — kdyby vůz prodán/smazán
- `source_url` (string, full URL s query)
- `user_agent` (string, 500 max)
- `ip` (string, 45 max — IPv6)
- `referer` (string, 500 max)

Form payloady doplnit:
- `pages/sklad/[id].astro:897`: form přidat `data-brand-id`, `data-model-id`, `data-vehicle-vin` — payload pošle všechny tři
- `pages/api/chat/model.ts`: payload pošle `source_model_id`, `source_brand_id` (už máme `ctx`)
- `pages/servis.astro:92`: přidat **dropdown** "Mám vůz" → značka (KGM/OMODA/Farizon/Jiná) + textové pole "model" — payload pak nese `source_brand`

### Fáze 5: Anti-abuse (volitelně, později)

- **Cloudflare Turnstile** — invisible CAPTCHA, free, perfektní integration s Vercel. Přidat `turnstile_token` do payloadu, server-side verifikovat přes Cloudflare API.
- Alternativa: **hCaptcha** nebo **Google reCAPTCHA v3** (invisible, score-based).
- Optional only — Turnstile řeší těžkou hrubou silou, na běžný provoz stačí Fáze 1-3.

---

## 5. Pořadí implementace

1. **Den 1 (čistá implementace, bez deployu):**
   - Fáze 1: napsat `/api/lead.ts`
   - Fáze 2: refactor 5 forms
   - Otestovat lokálně
2. **Den 2 (deploy + Directus):**
   - Fáze 3: Directus token + zakázat anon write
   - Deploy
   - Smoke test: zkusit poslat lead z každého formu
   - Smoke test: `curl` přímo na Directus musí vrátit 403
3. **Den 3 (kontext):**
   - Fáze 4: rozšíření collection + payloady
4. **Později podle abusu:**
   - Fáze 5: Turnstile

---

## 6. Otázky — ODPOVĚZENO 2026-05-19

1. ✅ **Refactor pattern** — všechny formy přes `/api/lead` (potvrzeno)
2. ✅ **Rate limit** — `10/den/IP` (mírnější než navrhované 5/hod). Důvod: malý byznys, běžný uživatel posílá max 1-2 leadů; 10/den nechá prostor pro chyby. Boty (které posílají 100+/min) to zachytí.
3. ✅ **Newsletter** → **Ecomail integrace**, NE Directus leads
   - Endpoint: `https://sfr.ecomailapp.cz/public/subscribe/4/f67e22c6c3dacfc9b77b6b40399abc16`
   - Bude vlastní `/api/newsletter` endpoint který sanitizuje + proxy na Ecomail (kvůli konzistenci + našemu rate limitu)
   - Forma v `magazin/index.astro:159` se napojí na `/api/newsletter`
4. ✅ **VIN snapshot** ano
   - **K čemu:** kdyby auto bylo prodáno/smazáno z Directusu, lead pořád ukazuje který konkrétní VIN to byl — pro pozdější analýzu "o kterých autech se ptají" + admin můžej kontaktovat zákazníka "máme podobné auto..."
   - Bez snapshotu by relation `source_vehicle` byla null a info ztracené
5. ❌ **Turnstile NE** — uživatel nechce CAPTCHA UX
   - **Důležitá informace:** Turnstile **MÁ invisible mode** (default!) — uživatel NIC neklikní, běží automaticky na pozadí, jen 5% podezřelých uživatelů uvidí challenge. Pokud bys chtěl jen nejvyšší ochranu bez UX impact, je to možnost.
   - **Alternativa bez Cloudflare:** server-side honeypot + rate limit + (volitelně) **Akismet** nebo **CleanTalk** API (server kontroluje text na spam patterns, transparent pro user, ~$5/měsíc)
   - **Pro start:** Fáze 1-3 (server endpoint + rate limit + Directus permission flip) zablokuje 95% spamu i bez Turnstile. Pokud bude problém později, doplníme.
6. ✅ **`DIRECTUS_STATIC_TOKEN`** — vysvětlení k čemu:
   - Je to **služební heslo pro náš server**. Když web server chce zapsat do Directusu lead, řekne "Já jsem náš web, mám token XYZ".
   - Bez tokenu: Directus musí být veřejně zapisovatelný kýmkoliv — útočník přes `curl` zapíše cokoliv.
   - S tokenem: Directus přijme zápis JEN pokud má správný token = jen náš server.
   - Token vytvoří admin v Directus (Settings → Access Tokens), nastaví permission "create only" na `leads` collection, zkopíruje do Vercel env var `DIRECTUS_STATIC_TOKEN`.
   - Po implementaci ti pošlu krok-po-kroku jak to v Directusu udělat.

---

## 7. NOVÝ POŽADAVEK: dynamické telefony

User chce: pokud má 2+ prodejce, telefonní čísla se rotují rovnoměrně. Stejně pro servis.

### Existující stav
- Collection `employees` už existuje s poli: `full_name`, `role`, `department` (`management`/`sales`/`service`/`parts`), `email`, `phone`, `photo`, `sort`
- `/kontakt` už zobrazuje celý tým rozdělený do bloků (sekce 113+ v `kontakt.astro`)

### Plán implementace

**Krok 1: Helper `src/lib/contacts.ts`**
- `getDealerContacts()` → načte všechny `employees` s `department IN ('sales', 'service')` a non-empty `phone`
- Cachované v module-level (1 request per page load — Directus call jen jednou)
- Vrátí: `{ sales: Employee[], service: Employee[] }`
- `pickRandomSales()` / `pickRandomService()` → vrátí náhodný kontakt z poolu (server-side při SSR)
- Fallback: pokud Directus selže nebo prázdná collection → hardcoded `+420 771 235 458` / `+420 771 259 323`

**Krok 2: Rotace strategie**
- **Random per page load** — každý SSR request náhodně vybere
- Long-term distribution rovnoměrné (5000 návštěvníků → 2500/2500 mezi 2 prodejci, 33% / 33% / 33% mezi 3)
- ❌ Ne round-robin — vyžadoval by DB persistenci, drahé
- ❌ Ne deterministická per IP — komplikované, dvě stejné IP by viděly stejný kontakt vždy

**Krok 3: Použití**
- `Header.astro` (3 místa s telefonem) → injektovat `salesPhone` z props
- `MobileBottomBar.astro` → stejné
- `Footer.astro` (případné tel:) — TBD
- `kontakt.astro` — **NE** rotace; ukazuje vždy celý tým (to je smysl kontakt stránky)
- `servis.astro` line 86 — rotovat `service` pool
- `sklad/[id].astro` (2 místa) — rotovat `sales` pool (auta jsou v prodeji)

**Krok 4: Pass přes BaseLayout**
- BaseLayout načte kontakty 1× na request
- Předá jako Astro.props nebo přes provider pattern (slot scopes nejsou)
- Realisticky: každá komponenta volá helper sama — Directus call ale jen 1× díky module-level cache uvnitř helperu

**Krok 5: Admin workflow**
- V Directus admin přidám prodejce → automaticky se začne objevovat na webu v rotaci
- Aktivace/deaktivace přes existující `status` field (asume `published`/`draft`)
- Setrážejí se pomalu — nový prodejce dostane 50% nových leadů od pondělka

---

## 8. UPRAVENÉ pořadí implementace

1. **Dnes (cca 30-45 min):**
   - Fáze 1 + 2: napsat `/api/lead.ts` + refactor 5 forms
   - Fáze 4: rozšířit payload o VIN snapshot + model/brand kontext
   - **NEW**: `src/lib/contacts.ts` helper + dynamické telefony
   - **NEW**: `/api/newsletter.ts` + napojit `magazin/index.astro` na Ecomail
   - **Žádný push do produkce** — jen lokální commit
2. **Po review (zítra ráno):**
   - Vytvořit `DIRECTUS_STATIC_TOKEN` v Directus admin (instrukce dodám)
   - Vložit do Vercel env vars
   - Push deploy
3. **Smoke test po deployi:**
   - Vyzkoušet všechny 5 formulářů — lead přijde do Directusu
   - Vyzkoušet newsletter — přijde do Ecomail
   - `curl` test: přímý POST na Directus `/items/leads` musí vrátit 403
   - Zkontrolovat že telefony se rotují (refresh, refresh, refresh)
4. **Měření:**
   - Po týdnu: kolik leadů, distribuce mezi prodejci, žádný spam?
   - Pokud spam zachycen rate-limitem ne, doplníme CleanTalk nebo Turnstile (invisible)

---

## 7. Risk: co se může pokazit

- Pokud Vercel env var `DIRECTUS_STATIC_TOKEN` nemáme včas → `/api/lead` vrátí 500 a všechny formy přestanou fungovat. Musíme deploynout token DŘÍV než refactor.
- Pokud Directus public write zakážeš a NĚKDO ještě používá starou verzi stránky (cached) → jeho POST projde s 403. UX: chyba v formuláři. Acceptable krátkodobé riziko (~10 min cache TTL).
- AI chat lead přestane fungovat pokud `chat/model.ts` zavolá `/api/lead` přes HTTP self-call uvnitř Vercel function — bývá to flaky, lepší interní funkce.

---

## Tl;dr

Vytvoříme `/api/lead.ts` SSR endpoint který přijme všechny leadly, validuje, rate-limituje, a teprve on sám zapíše do Directusu se server-side tokenem. 5 forms refactor + Directus permission flip + token = bezpečné.
