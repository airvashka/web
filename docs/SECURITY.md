# Bezpečnostní analýza — SFR Motor web

> Stav k 30. 5. 2026. Analýza kódu + závislostí. Priority: 🔴 P0 (hned), 🟠 P1 (brzy), 🟡 P2 (až bude čas). 
> Tohle je **analýza a doporučení** — žádná změna v kódu nebyla provedena.

## Shrnutí

Základ je solidní: žádné committed secrety, tajné klíče jen server-side, antispam na hlavním formuláři, zálohy běží. Hlavní slabiny: **rate-limiting nefunguje spolehlivě na Vercel serverless**, jeden **odkrytý debug endpoint**, a **HIGH zranitelnost v závislosti `undici`**.

---

## 🔴 P0 — řešit hned

### P0-1 — zranitelnosti v závislostech — 🔄 ČÁSTEČNĚ (30.5.)
`npm audit` hlásí chyby přes Astro/Vercel řetězec + undici.
- **Provedeno:** Astro stack aktualizován v rámci major 5/8; `devalue` HIGH opraven přes `npm audit fix` (non-breaking).
- **Zrušeno:** `overrides: undici` — vynucené `undici` rozbilo `jsdom` (build padal na `undici/lib/handler/wrap-handler.js`) → revertováno.
- **Zbývá (větší úkol):** hlavní HIGH (`path-to-regexp` ReDoS, `@astrojs/vercel` **x-astro-path** unauthenticated path override, `astro` XSS v `define:vars`) jsou opravené až v **Astro 6 + @astrojs/vercel 10** = MAJOR upgrade (breaking). Naplánovat zvlášť s plným testem webu. Pro veřejný web nejde o únik dat → není akutní. Detail v `DEPENDENCIES.md`.

### P0-2 — odkrytý debug endpoint `GET /api/leasing/test` — ✅ HOTOVO (30.5.)
`src/pages/api/leasing/test.ts` byl debug runner bez auth → **smazán** (frontend ho nikde nevolal). Čeká jen push.

---

## 🟠 P1 — řešit brzy

### P1-1 — rate limiting je na serverless neúčinný
`/api/lead`, `/api/newsletter`, `/api/chat/model` používají **in-memory `Map`** rate limit. Na Vercelu se funkce škálují a studeně startují → každá instance má vlastní (prázdné) počítadlo. Limit „10/den/IP" se v praxi snadno obejde.
- **Riziko:** spam poptávek/newsletteru; u `/api/chat/model` **náklady na Anthropic API** (LLM volání).
- **Fix:** přesunout rate limit do sdíleného úložiště — **Vercel KV** nebo **Upstash Redis** (`@upstash/ratelimit`). Kód `chat/model.ts` to sám v komentáři doporučuje.

### P1-2 — `/api/newsletter` bez Turnstile
Newsletter má jen honeypot + (neúčinný) rate limit, kdežto `/api/lead` má i Turnstile. Náchylnější na bot spam do Ecomailu.
- **Fix:** přidat Turnstile verifikaci jako u `lead.ts`.

### P1-3 — SSH/VPS hardening
Dle poznámek je **root heslo VPS zapomenuté**. Doporučení:
- Obnovit root přes KVM a uložit do trezoru.
- SSH jen přes klíče (`PasswordAuthentication no`), zakázat root login (`PermitRootLogin no`).
- `ufw` firewall (povolit jen 22/80/443 + interní porty zavřít zvenčí), `fail2ban` na SSH.
- Ověřit, že Postgres/Redis/MinIO **nejsou** dostupné z internetu (jen v Docker síti / loopback).

---

## 🟡 P2 — až bude čas

- **P2-1 `/admin/cenik`** je veřejně dostupná stránka (přihlášení řeší až client-side Directus login; API endpointy token ověřují). Doporučení: `<meta name="robots" content="noindex">`, zvážit nešířit do prod buildu nebo gateovat.
- **P2-2 Google Maps API klíč** je `PUBLIC_*` (musí být na klientovi). **Nutně omezit** v Google Cloud na HTTP referrer (`*.sfr-motor.cz`) + jen Maps Embed API, ať ho nikdo nezneužije na vlastní účet.
- **P2-3 `yaml` moderate vuln** — jen dev tooling (`@astrojs/check`), nejde do produkce. Aktualizovat při příští údržbě.
- **P2-4 `.env.example` neúplný** — riziko, že se při setupu zapomene proměnná (např. `CRON_SECRET` → nechráněná záloha). Doplnit (viz CODE-AUDIT.md).

---

## ✅ Co je už dobře (nechat tak)

- Žádné committed secrety v repu; `.env`, `.vercel/`, `dist/` v `.gitignore`.
- UCL/UniCredit credentials i Directus tokeny jen server-side; leasing endpointy mají origin check.
- `/api/lead`: Turnstile + honeypot + (validace) — dobrý základ.
- `/api/cron/backup` chráněn `CRON_SECRET`.
- `/api/cenik/*` ověřují Directus token uživatele.
- HTML z CMS (články, akce) se renderuje přes **DOMPurify** (`isomorphic-dompurify`) → XSS ošetřeno.
- HTTPS všude (Vercel + nginx/Certbot na VPS).
- Directus rate limit zvednut na 250 req/s.

---

## Doporučené pořadí

1. P0-1 undici update + P0-2 smazat/chránit `leasing/test.ts` (rychlé).
2. P1-3 SSH hardening + obnova root hesla (provozní bezpečnost).
3. P1-1 sdílený rate limit (Vercel KV/Upstash) + P1-2 Turnstile na newsletter.
4. P2 položky při příští údržbě.

> Žádné z těchto doporučení jsem neimplementoval — čeká na tvé rozhodnutí (viz zadání „jen analýza").
