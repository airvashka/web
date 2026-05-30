# Bezpečnostní analýza — SFR Motor web

> Stav k 30. 5. 2026. Analýza kódu + závislostí. Priority: 🔴 P0 (hned), 🟠 P1 (brzy), 🟡 P2 (až bude čas). 
> 📌 **Aktuální souhrn stavu VŠECH bodů je v [README](./README.md).** Většina je už hotová (✅ značky níže), zbytek je vědomě odložený nebo čeká na upstream.

## Shrnutí

**Stav: hlavní slabiny vyřešeny.** Debug endpoint smazán, Astro 6 upgrade opravil astro XSS + x-astro-path, undici dořešen, rate-limit/AI náklady ošetřeny (chatbot vypnut + Turnstile). Základ byl solidní (žádné committed secrety, tajné klíče jen server-side, zálohy běží) a teď je doladěný. Detail po bodech níže, souhrn v README.

---

## 🔴 P0 — řešit hned

### P0-1 — zranitelnosti v závislostech — ✅ HOTOVO (30.5.)
- **Astro 6 + @astrojs/vercel 10** nasazeno → opraveno `astro` XSS (define:vars), `@astrojs/vercel` **x-astro-path** auth override, `devalue` DoS.
- `undici` HIGH dořešen updatem `@vercel/blob`.
- **Zbývá jen** `path-to-regexp` (uvnitř vercel adapteru) + `yaml` (jen dev) — low risk, čeká na upstream fix → doporučení: Dependabot.
- Pozn.: `overrides: undici` NEFUNGUJE (rozbíjí jsdom build) — nezkoušet.

### P0-2 — odkrytý debug endpoint `GET /api/leasing/test` — ✅ HOTOVO (30.5.)
`src/pages/api/leasing/test.ts` byl debug runner bez auth → **smazán** (frontend ho nikde nevolal).

---

## 🟠 P1 — řešit brzy

### P1-1 — rate limiting je na serverless neúčinný — ✅ VYŘEŠENO JINAK (30.5.)
`/api/lead`, `/api/newsletter`, `/api/chat/model` používaly **in-memory `Map`** rate limit, který na Vercelu (škálování + cold start) nedrží. Místo zavádění sdíleného úložiště (Upstash/Vercel KV = nový účet) jsme riziko uzavřeli levněji:
- **Formuláře** (lead + newsletter) chrání **Turnstile** → bot spam pokrytý.
- **AI chat** (hlavní nákladové riziko) je **dočasně vypnutý** — widget skrytý (`CHAT_ENABLED=false`) + endpoint `/api/chat/model` vrací 503. Bez volání = bez nákladů.
- Měkký in-memory limit ponechán jako zpomalovač.
- **Backstop:** nastavit měsíční spend limit v Anthropic Console (Jardův úkol).
- *Pokud se chat někdy zapne natrvalo + poroste provoz → zvážit sdílený rate-limit (Upstash zdarma, nebo malá služba na VPS vedle UCL proxy).*

### P1-2 — `/api/newsletter` bez Turnstile — ✅ HOTOVO (30.5.)
Přidána Turnstile verifikace (widget v newsletter formu v `magazin/index.astro` + `verifyTurnstile` v `newsletter.ts`, stejný graceful pattern jako `lead.ts`).

### P1-3 — SSH/VPS hardening — ✅ OVĚŘENO, dobré (30.5.)
Stav VPS prověřen a je solidní: root **zamčený** (bez hesla, `passwd -S` = L), admin přes sudo uživatele `sfr`, **ufw** běží (jen 22/80/443), **fail2ban** běží, Postgres/Redis/MinIO/UCL **nevystavené** ven (jen localhost/docker síť), root login jen na klíč.
- **Odloženo (volitelné):** key-only SSH (vypnout `PasswordAuthentication`) — s běžícím fail2banem zatím stačí, lze dodělat kdykoli.

---

## 🟡 P2 — až bude čas

- **P2-1 `/admin/cenik`** — ✅ `noindex,nofollow` už v page je. (Login client-side, API ověřuje token.) OK.
- **P2-2 Google klíče** — ✅ HOTOVO (30.5.): Maps klíč omezen na referrer `*.sfr-motor.cz` + Maps Embed API; Places (recenze) klíč omezen na Places API.
- **P2-3 `yaml` moderate vuln** — jen dev tooling (`@astrojs/check`), nejde do produkce. Aktualizovat při příští údržbě.
- **P2-4 `.env.example`** — ✅ HOTOVO (30.5.): doplněn na úplný seznam (bez hodnot).

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

## Co zbývá (vše nízké riziko)

1. `path-to-regexp` + `yaml` vulns — čekají na upstream fix (Dependabot to ohlídá).
2. key-only SSH — volitelné, odloženo (fail2ban stačí).
3. *Vše ostatní z této analýzy je hotové — viz [README](./README.md) souhrn.*
