# Bezpečnostní audit & pentest — SFR Motor web

**Datum:** 2026-05-30
**Rozsah:** `web/` (Astro 6 + Vercel + Directus), živá beta `beta.sfr-motor.cz`, Directus API `admin.sfr-motor.cz`
**Metodika:** dependency scan (`npm audit`), hloubkový code-level review (API, secrets, XSS/injection/SSRF/redirect, auth), pasivní kontroly živého webu (bezpečnostní hlavičky, expozice Directus API).
**Co se NEdělalo (záměrně):** žádné aktivní/destruktivní útoky na produkci (fuzzing, injection pokusy, brute-force, zápisy). Rizikové vektory ověřeny v kódu, ne střelbou do živého serveru.

---

## TL;DR — co opravit hned

| # | Závažnost | Nález | Akce |
|---|---|---|---|
| F1 | 🔴 **HIGH** | `/api/cron/backup` má fail-open autentizaci + zálohy (vč. `leads` = osobní údaje) se ukládají do **veřejného** Blobu s předvídatelným názvem | Nastavit `CRON_SECRET`, autentizaci udělat povinnou (fail-closed), Blob na `access: 'private'` / random suffix |
| F2 | 🔴 **HIGH** | **Natvrdo zapsané UniCredit credentials** (username/heslo/client_secret) v komentáři `leasing/calculate.ts` → v gitu/GitHubu | Smazat z komentáře, **rotovat** preprod secret, prod jen z ENV |
| F3 | 🟠 **MED** | `/api/leasing/calculate` **bez rate limitu** → zneužití UCL API přes vaše přihlašovací údaje | Přidat rate limit (lib/rateLimit.ts) |
| F4 | 🟠 **MED** | Chybí bezpečnostní hlavičky (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy) | Přidat `headers` do `vercel.json` |
| F5 | 🟠 **MED** | Directus **public read s `fields=*`** na `employees`, `site_settings`, `knowledge_documents` + veřejné `server/info` | Omezit public read na nutná pole; `knowledge_documents` a `server/info` skrýt |

Detaily, důkazy a konkrétní opravy níže.

---

## Skóre & shrnutí

Web je celkově **slušně zabezpečený** — lead pipeline (honeypot + rate limit + validace + Turnstile + scoped token), veškerý uživatelský/admin HTML jde přes sanitizaci (DOMPurify), AI endpointy vyžadují platný Directus token, `leads` i Directus `users` jsou na API chráněné (403), `.env` mimo git, HSTS zapnutý. **Žádné kritické (Critical) díry typu otevřený zápis do DB, SQL injection, SSRF nebo stored XSS.**

Hlavní rizika jsou **provozně-konfigurační**: záloha do veřejného úložiště, secret v komentáři, chybějící rate limit na jednom endpointu, chybějící bezpečnostní hlavičky a příliš otevřené čtení pár Directus kolekcí.

**Nálezy podle závažnosti:** 0 Critical · 2 High · 3 Medium · 8 Low · 4 Info.

---

## 1) Závislosti (dependency scan)

`npm audit`: **8 zranitelností (3 high, 5 moderate)**. **Žádná z nich není v produkčním runtime, který zpracovává cizí vstup** — všechny jsou v build/dev nástrojích:

| Balíček | Severity | Cesta | Kde běží | Reálné riziko |
|---|---|---|---|---|
| `path-to-regexp` (4.0–6.2.2) | high (ReDoS) | `@astrojs/vercel` → `@vercel/routing-utils` → path-to-regexp | **build-time** (generuje routing config z routes v repu) | Velmi nízké — zpracovává jen **vaše** route definice, ne cizí vstup |
| `yaml` (2.0–2.8.2) | moderate (stack overflow) | `@astrojs/check` → `yaml-language-server` | **dev-only** (type-checker) | Nulové — v produkci neběží |

**Doporučení:**
- Nepanikařit — žádná z těchto vuln nesahá na běžící produkci.
- Sledovat update `@astrojs/vercel`, který bumpne `@vercel/routing-utils` (zatím `npm audit fix --force` chce **downgrade** na vercel adapter 8.0.4 = breaking, nedělat).
- **Hygiena:** v `package.json` jsou **všechny balíčky v `dependencies`**, žádné `devDependencies`. Build/dev nástroje (`@astrojs/check`, `typescript`, `playwright`) přesunout do `devDependencies` → menší a čistší produkční install (runtime bundle se tím nemění, Astro stejně tree-shakuje).
- Pravidelně `npm audit` (1× měsíčně) + případně `npm outdated` pro major posuny.

---

## 2) Nálezy (HIGH)

### F1 — 🔴 HIGH: Záloha databáze do veřejného úložiště + fail-open autentizace
**Lokace:** `src/pages/api/cron/backup.ts`

Dva problémy, které se násobí:

1. **Autentizace je podmíněná:**
   ```ts
   if (CRON_SECRET) {            // ← když CRON_SECRET není v ENV, kontrola se PŘESKOČÍ
     if (auth !== `Bearer ${CRON_SECRET}`) return 401;
   }
   ```
   Pokud `CRON_SECRET` není nastavený, endpoint je **veřejný** a kdokoliv ho zavolá (GET `/api/cron/backup`) → spustí plnou zálohu.

2. **Záloha se ukládá veřejně, s předvídatelným názvem:**
   ```ts
   put(`directus-backup-${today}.json`, json, {
     access: 'public',          // ← veřejně přístupné
     addRandomSuffix: false,    // ← název = jen datum, uhodnutelný
   });
   ```
   Záloha obsahuje **`leads`** (jméno, e-mail, telefon, IP, user-agent zákazníků = osobní údaje / GDPR) a `employees`. Response navíc vrací `backup_url`.

**Dopad:** únik celé databáze včetně osobních údajů zákazníků — buď přímým zavoláním (chybí-li secret), nebo uhodnutím URL veřejného Blobu (název je jen datum).

**Oprava (priorita):**
- V Vercel ENV **nastavit `CRON_SECRET`** (a Vercel ho u cronů posílá automaticky). Ověřit, že je nastavený.
- Udělat autentizaci **fail-closed**: když `CRON_SECRET` chybí → vrátit 500/401, ne pustit dál:
  ```ts
  if (!CRON_SECRET || request.headers.get('Authorization') !== `Bearer ${CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  ```
- Blob nastavit na **`access: 'private'`** (čte se jen přes token), nebo aspoň `addRandomSuffix: true` (neuhodnutelný název). Záloha DB s osobními údaji **nesmí být veřejná**.
- Bonus: zvážit šifrování zálohy (obsahuje PII).

---

### F2 — 🔴 HIGH: Natvrdo zapsané UniCredit credentials v kódu
**Lokace:** `src/pages/api/leasing/calculate.ts` (hlavičkový komentář, ř. ~15–17)

```
 *  - UNICREDIT_USERNAME = sfr_test
 *  - UNICREDIT_PASSWORD = SFR_tst_2026
 *  - UNICREDIT_CLIENT_SECRET = NREaypamuCMq1iPaEYyxw21HHDNBqvS5
```

Přihlašovací údaje (i když preprod/test) jsou v **commitnutém zdrojáku** → v git historii a na GitHubu (repo `airvashka/web`). Kdokoliv s přístupem k repu (nebo když je repo veřejné) je má. `client_secret` je obzvlášť citlivý.

**Sám kód je OK** — reálně čte z `import.meta.env.*` s fallbackem na **prázdný** string (ne na ten secret). Problém je jen ten **komentář**.

**Oprava:**
- Smazat konkrétní hodnoty z komentáře (nech jen názvy proměnných).
- **Rotovat** preprod `UNICREDIT_CLIENT_SECRET` + heslo u UniCreditu (jednou unikly do gitu = ber je za kompromitované).
- Ověřit, že prod hodnoty jsou **jen** ve Vercel ENV, nikde v kódu.
- Projít git historii, jestli tam nejsou i jiné secrety (viz `scripts/` — některé měly default URL Directusu apod.).

---

## 3) Nálezy (MEDIUM)

### F3 — 🟠 MED: `/api/leasing/calculate` bez rate limitu
**Lokace:** `src/pages/api/leasing/calculate.ts`

Na rozdíl od `/api/lead` a `/api/newsletter` tu **není rate limit**. Jediná ochrana je kontrola `Referer` (ř. 84–98), kterou lze triviálně podvrhnout (Referer je klientská hlavička; navíc `referer.includes('vercel.app')` projde libovolná vercel.app adresa útočníka). Každé volání spotřebuje auth + calc volání na UCL API **pod vašimi credentials** → útočník může vyčerpat kvótu / nechat vám zablokovat UCL účet / generovat náklady.

**Oprava:** přidat `createRateLimiter` (např. 30/hod/IP) stejně jako u lead/newsletter. Origin check klidně nech jako druhou vrstvu, ale neber ho jako bezpečnostní hranici.

### F4 — 🟠 MED: Chybějící bezpečnostní HTTP hlavičky
**Lokace:** Vercel/Astro config (žádná konfigurace hlaviček). Ověřeno živě na `beta.sfr-motor.cz`:

| Hlavička | Stav |
|---|---|
| `Strict-Transport-Security` | ✅ `max-age=63072000` (Vercel) |
| `Content-Security-Policy` | ❌ chybí |
| `X-Frame-Options` | ❌ chybí → **clickjacking** (web lze vložit do iframe) |
| `X-Content-Type-Options` | ❌ chybí → MIME sniffing |
| `Referrer-Policy` | ❌ chybí |
| `Permissions-Policy` | ❌ chybí |

CSP je nejúčinnější druhá obrana, kdyby někdy XSS proklouzlo sanitizací.

**Oprava — `vercel.json`:**
```json
"headers": [{
  "source": "/(.*)",
  "headers": [
    { "key": "X-Frame-Options", "value": "SAMEORIGIN" },
    { "key": "X-Content-Type-Options", "value": "nosniff" },
    { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
    { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" }
  ]
}]
```
CSP přidat opatrně (Astro inline skripty + Directus assets + Google Maps + Turnstile + YouTube) — začít v `Content-Security-Policy-Report-Only` a doladit, pak ostře.

### F5 — 🟠 MED: Příliš otevřené čtení Directus API
**Ověřeno živě** na `admin.sfr-motor.cz`:

| Kolekce / endpoint | Stav | Komentář |
|---|---|---|
| `items/leads` | ✅ 403 | Správně chráněno (PII) |
| `directus_users` | ✅ 403 | Správně |
| `items/employees` | ⚠️ 200 veřejné | Pole: `full_name, role, department, email, phone, photo, business_card_pdf, branch` — pracovní kontakty (na webu se stejně zobrazují) → **přijatelné**, ale viz `fields=*` níže |
| `items/site_settings` | ⚠️ 200 veřejné | Ověřit, že neobsahuje citlivá pole (tokeny, interní URL) |
| `items/knowledge_documents` | ⚠️ 200 veřejné | Znalostní báze AI chatbota — ověřit, že tam nejsou **interní** dokumenty (ceníky, strategie) |
| `server/info` | ⚠️ 200 veřejné | Prozrazuje verzi Directusu → usnadní cílený exploit |

Hlavní problém: **public read má `fields=*`** — i když frontend tahá jen pár polí, útočník si přes `?fields=*` stáhne všechna pole kolekce.

**Oprava (Directus admin → Settings → Roles → Public → Permissions):**
- `knowledge_documents`: zrušit public read (chatbot je navíc vypnutý) nebo omezit na nekonfidenční obsah.
- `server/info`: v Directus nastavení skrýt veřejnou expozici verze.
- `employees` / `site_settings`: omezit public read na **konkrétní pole** (field-level permissions), ne `*`. U `site_settings` projít, jestli tam nejsou interní/sensitivní hodnoty.
- Ověřit, že `leads` má zakázaný **anonymní zápis** (Create = No Access) — kód to předpokládá; potvrdit v adminu.

---

## 4) Nálezy (LOW)

- **L1 — Upovídané chybové odpovědi (`leasing/calculate.ts` ř. 240–250):** vrací `e.message`, `cause.code`, `cause.message` (DNS/TLS/network detail) klientovi → drobný únik interní infrastruktury. Vracet generickou chybu, detail jen do server logu.
- **L2 — Referer-based origin check je obejitelný (`leasing/calculate.ts`):** Referer je klientská hlavička; `includes('vercel.app'/'localhost')` projde i útočníkovi. Ber jen jako anti-scraper, ne bezpečnostní hranici (řeší F3 rate limit).
- **L3 — Turnstile v non-strict režimu (`api/lead.ts`, `api/newsletter.ts`):** při selhání CAPTCHy se request **pustí dál** (default). Chrání honeypot + rate limit, ale CAPTCHA je tím obejitelná. Při náporu spamu zapnout `TURNSTILE_STRICT=true`.
- **L4 — Hardcoded `ECOMAIL_HASH` fallback (`api/newsletter.ts` ř. 22):** `?? 'f67e22c6c3dacfc9b77b6b40399abc16'`. Je to semi-veřejný hash z public subscribe formuláře (nízká citlivost), ale patří do ENV, ne do kódu.
- **L5 — JSON-LD přes `set:html` bez escapování `<` (`Breadcrumbs.astro`, `Header.astro`, `JsonLd.astro`):** `JSON.stringify(...)` neescapuje `</script>`. Data jsou z Directusu (admin), takže riziko jen teoretické (zlomyslný admin / kompromitovaný účet). Pro jistotu escapovat `<` → `<` v JSON-LD outputu.
- **L6 — Lead token fallback na admin token (`api/lead.ts` ř. 26):** když `DIRECTUS_LEAD_TOKEN` chybí, použije se `DIRECTUS_STATIC_TOKEN` (admin). Ověřit, že je v prod nastavený **scoped Lead Writer token** (jen create na leads) — least privilege.
- **L7 — `file_id` bez validace formátu (`api/cenik/analyze.ts` ř. 283):** vkládá se do `${DIRECTUS_URL}/assets/${file_id}`. Není SSRF (host je fixní Directus) a endpoint vyžaduje platný token, ale doplnit UUID validaci.
- **L8 — Directus tokeny v `sessionStorage` (`/admin/cenik`):** access+refresh token v sessionStorage → ukradnutelné při XSS na admin stránce. Standardní SPA kompromis; sessionStorage je lepší než localStorage. Hlídat, aby admin stránka nerenderovala nesanitizovaný obsah.

---

## 5) Info / hygiena

- **I1 — Rate limiter je in-memory per-instance (`lib/rateLimit.ts`):** na Vercelu (více instancí) je efektivní limit vyšší než nastavený. Sám kód to dokumentuje. Pro tvrdý sdílený limit → Upstash/Vercel KV. Zatím OK (měkký zpomalovač + Turnstile).
- **I2 — `package.json` nemá `devDependencies`:** viz sekce 1 (hygiena, ne runtime riziko).
- **I3 — Chatbot vypnutý (`api/chat/model.ts`, `CHAT_ENABLED=false`):** endpoint i tak má rate limit a vyžaduje token. Při zapnutí ověřit limity (Anthropic náklady).
- **I4 — `leasing/test.ts` smazaný ✓**, `.env` gitignored ✓, žádné secrety v gitu ✓, žádné citlivé soubory v `public/` ✓, `robots.txt` blokuje `/api/` a `/admin/` ✓.

---

## 6) Co je udělané dobře (pozitiva)

- **Lead pipeline (`api/lead.ts`):** honeypot + rate limit (10/den) + serverová validace (jméno/email/telefon/allowlist typů) + HTML stripping + Turnstile + **scoped** Directus token.
- **Sanitizace HTML:** veškerý `set:html` s obsahem (články, právní stránky, akce, model promo) jde přes `sanitizeHtml` (isomorphic-dompurify). Žádný stored XSS vektor.
- **AI endpointy (`cenik/analyze`, `cenik/save`, `chat/model`):** vyžadují platný Directus token (`/users/me` ověření) → žádné anonymní zneužití Anthropic klíče.
- **Directus citlivá data chráněná:** `leads` i `directus_users` vrací 403.
- **Žádné:** SQL injection (Directus REST, ne raw SQL s user vstupem), SSRF (fetch jen na vlastní Directus/UCL s fixními hosty), open redirect (cíle jen statické/z DB).
- **HSTS** zapnutý (2 roky), `.env` mimo git, secrets přes ENV (s drobnými výjimkami v L4/F2).

---

## 7) Doporučené pořadí oprav

1. **Hned:** F1 (CRON_SECRET + private Blob), F2 (smazat + rotovat UCL secret).
2. **Tento týden:** F3 (rate limit na leasing), F5 (omezit Directus public read + skrýt server/info & knowledge_documents).
3. **Brzy:** F4 (bezpečnostní hlavičky → pak CSP report-only → ostře).
4. **Při příležitosti:** L1–L8 (chybové hlášky, scoped tokeny, JSON-LD escaping, UUID validace), hygiena I2.
5. **Průběžně:** měsíční `npm audit`, kontrola, že prod secrety jsou jen v ENV.

---

*Audit proveden code-level review + pasivními kontrolami; bez aktivních útoků na produkci. Doporučeno před ostrým spuštěním (`sfr-motor.cz`) vyřešit aspoň F1–F5.*
