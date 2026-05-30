# Závislosti & aktualizace — SFR Motor web

> `npm audit` k 30. 5. 2026. **Žádný update jsem neprovedl** — jen analýza a plán. Po každém updatu: `npm run build` + test na betě.

## 1. npm audit — souhrn

**12 zranitelností: 5 HIGH, 7 moderate, 0 critical.** Většina jsou **tranzitivní** (přes Astro a Vercel balíčky), ne přímé.

| Závažnost | Balíček | Přes | Problém |
|---|---|---|---|
| 🔴 HIGH | `undici` | `@vercel/blob` | unbounded decompression → resource exhaustion (+ smuggling, CRLF) |
| 🔴 HIGH | `path-to-regexp` | `@astrojs/vercel` → `@vercel/routing-utils` | ReDoS (backtracking regex) |
| 🔴 HIGH | `devalue` | `astro` | DoS přes sparse array deserialization |
| 🟠 MOD | `astro` (core) | — | XSS v `define:vars` (nedokonalá sanitizace `</script>`) |
| 🟠 MOD | `yaml` | `@astrojs/check` (dev) | stack overflow přes hluboce vnořený YAML |

(Zbylé moderate jsou články téhož řetězce: `@astrojs/language-server`, `volar-service-yaml`, `yaml-language-server`, `@vercel/routing-utils`, `@vercel/blob`.)

## 2. Plán aktualizace (doporučené pořadí)

### Krok 1 — Astro stack v rámci major 5/8 — ✅ HOTOVO, ale NESTAČÍ (30.5.)
Provedeno `npm install astro@^5 @astrojs/vercel@^8 @astrojs/sitemap@^3` (build prošel). **Zjištění:** zůstání v major 5/8 **neopravilo** hlavní HIGH — `npm audit` je pořád hlásí, protože fix je až v majorech (viz Krok 3). Tenhle krok tedy přinesl jen drobné záplaty + udržení aktuálnosti.

### Krok 3 — 🔴 MAJOR upgrade Astro 6 + Vercel adapter 10 (skutečný fix)
Teprve tohle opraví zbývající HIGH/MOD: `astro` XSS (`define:vars`) + server-island replay, `@astrojs/vercel` **x-astro-path** unauthenticated path override, `path-to-regexp` ReDoS.
```bash
npm install astro@6 @astrojs/vercel@10 @astrojs/check@latest
npm run build      # MUSÍ projít — Astro 5→6 může mít breaking změny
```
- **Riziko: vyšší (major).** Astro 5→6 může změnit chování image/SSR/content. Po updatu projít CELÝ web na `npm run dev` i po pushi na betě (hero, sklad, model, leasing, formuláře, články).
- **Není akutní** pro veřejný web (nejde o únik dat) → naplánovat jako samostatný úkol s časem na testování.

### Krok 2 — `undici` override — ❌ NEFUNGUJE, REVERTOVÁNO (30.5.)
Pokus o `overrides: { "undici": "^6.23.1" }` **rozbil build**: `jsdom` (přes `isomorphic-dompurify`) potřebuje jinou verzi undici a padalo `Cannot find module 'undici/lib/handler/wrap-handler.js'`. → override odebrán.
- **Závěr:** undici nejde takhle globálně přepsat. Reálný fix vede přes major upgrade Astro/Vercel (krok 3), který stejně přináší většinu oprav. Samostatný undici fix necháváme být (nízká expozice — jen `@vercel/blob` v cron záloze).

### Krok 2b — `devalue` HIGH — ✅ HOTOVO (30.5.)
Opraveno přes `npm audit fix` (non-breaking).

### Krok 3 — 🟠 `@astrojs/check` / `yaml` (jen dev)
Dev tooling (type-check), **nejde do produkce → nízké riziko**. Aktualizovat při příští údržbě:
```bash
npm install @astrojs/check@latest
```

### Po každém kroku
```bash
npm audit          # ověřit, že ubylo
npm run build      # ověřit, že to staví
```

## 3. Inventář přímých závislostí (k čemu jsou)

| Balíček | Verze (range) | Účel |
|---|---|---|
| `astro` | ^5.1.1 | framework |
| `@astrojs/vercel` | ^8.0.0 | deploy adapter |
| `@astrojs/sitemap` | ^3.2.1 | sitemap.xml |
| `@astrojs/check` | ^0.9.4 | type-check (dev) |
| `typescript` | ^5.7.2 | jazyk |
| `@anthropic-ai/sdk` | ^0.32.1 | AI parsing ceníků + chat |
| `@aws-sdk/client-s3` | ^3.x | přístup k MinIO/S3 úložišti |
| `@vercel/blob` | ^0.27.0 | záloha kolekcí (cron/backup) — **zdroj undici vuln** |
| `pg` | ^8.21.0 | PostgreSQL klient (skripty) |
| `playwright` | ^1.60.0 | scrape stock feedů (KGM/OMODA) |
| `cheerio` | ^1.2.0 | parsing HTML feedů |
| `pdfjs-dist` | ^4.10.38 | čtení PDF ceníků |
| `marked` | ^14.1.4 | markdown → HTML (články) |
| `turndown` | ^7.2.0 | HTML → markdown (import obsahu) |
| `isomorphic-dompurify` | ^3.14.0 | sanitizace HTML (XSS ochrana) |
| `jsonrepair` | ^3.12.0 | oprava nevalidního JSON z AI |

> Všechny přímé závislosti se reálně používají (žádná nepoužitá k odstranění).

## 4. Strategie do budoucna
- **Kvartálně** spustit `npm audit` + `npm outdated` a vyřešit HIGH/critical.
- Držet se v rámci major verzí (`^`), major upgrady (Astro 5→6 apod.) plánovat zvlášť s testem.
- Zapnout **Dependabot** / GitHub security alerts na obou repech (automatické PR na zranitelnosti).
- `package-lock.json` je v `.gitignore` — zvážit jeho **commit** pro reprodukovatelné buildy (jinak se verze můžou lišit deploy od deploye).
