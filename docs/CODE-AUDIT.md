# Audit kódu — SFR Motor web

> Stav k 30. 5. 2026. Hledání mrtvého/starého/duplicitního kódu a code smells. 
> 📌 **Aktuální souhrn stavu je v [README](./README.md).** Část úklidu už proběhla (✅ značky níže), zbytek je vědomě odložený.

## Shrnutí

Kód je funkční a relativně čistý. Hlavní „dluh": **mrtvé komponenty**, **duplicitní rate-limit logika**, **velmi zaplněná složka `scripts/`** (148 souborů, živých 6) a **legacy fallbacky** po datových migracích.

---

## 🟠 P1 — vyplatí se uklidit

### Mrtvé komponenty (0 referencí) — ✅ SMAZÁNO (30.5.)
- `src/components/LeasingCalculator.astro` — smazáno (kalkulačka na `/sklad/[id]` je inline `#finance`).
- `src/components/YouTubeSection.astro` — smazáno (`@deprecated`, nahrazeno `VideoStrip`).

### Duplicitní rate-limit logika (3×) — ✅ HOTOVO (30.5.)
Vytaženo do `src/lib/rateLimit.ts` (`createRateLimiter(max, windowMs)` + `getClientIp`). `lead.ts`, `newsletter.ts` i `chat/model.ts` ho teď používají. (Stále in-memory = měkký limit; tvrdý sdílený by chtěl Upstash/KV — viz SECURITY.md P1-1, neděláme.)

### `scripts/` — 148 souborů, živých 6
Reálně používané (package.json / GitHub Action): `sync-stock-kgm`, `sync-stock-omoda-jaecoo`, `generate-build-to-order`, `compute-teaser-payments`, `trigger-deploy`, `fetch-google-reviews`. Zbytek jsou jednorázové migrační/setup/seed skripty (add-* 31, fix-* 17, seed-* 14, setup-* 9…).
- **✅ HOTOVO (30.5.):** přidán `scripts/README.md` — dokumentuje 6 živých skriptů vs jednorázové + označuje destruktivní. Fyzický přesun do `scripts/archive/` zatím odložen (riziko relativních importů, churn 140 souborů).
- Jasně explorativní/jednorázové: `probe-mobile-de*.mjs`, `sniff-mobile-de-api.mjs`, `recover-bad-clone.mjs`, `recreate-webhook-flow.mjs`, `reorganize-models.mjs` (dle poznámek revertnuto), `test-build-request.mjs`, `import-articles-old-site.mjs`, `wipe-stock.mjs` (destruktivní — pozor).

---

## 🟡 P2 — kosmetika / dluh

### Legacy fallbacky po datových migracích
V `lib/features.ts`, `lib/technicalData.ts`, `model/[slug]/vybavy.astro`, `model/[slug].astro` jsou větve „nová struktura vs legacy (flat array / starý JSON)". Jsou tam záměrně kvůli zpětné kompatibilitě dat.
- **Návrh:** až bude jisté, že všechna data v Directusu jsou v novém tvaru, legacy větve odstranit (zjednodušení). **Nejdřív ověřit data**, ne mazat naslepo.

### `global.css` monolit (5 869 řádků)
Jeden velký stylesheet. Funguje, ale těžko se udržuje a zvyšuje riziko mount-truncation při editaci.
- **Návrh (nízká priorita):** rozdělit po sekcích (base, components, pages) přes `@import`, nebo přesunout page-specific styly do scoped `<style>` příslušných stránek.

### `middleware.ts` no-op
Je to dokumentovaný placeholder (no-op). OK nechat, jen vědět, že nic nedělá (rotace telefonů je client-side v `Header.astro`).

### `/api/leasing/test.ts` — ✅ SMAZÁNO (30.5.)
Debug endpoint (UCL test runner) bez auth → odstraněn. Frontend ho nikde nevolal.

### `.env.example` — ✅ DOPLNĚNO (30.5.)
Přepsán na úplný seznam všech používaných proměnných (bez hodnot), členěný po službách.

---

## ✅ Co je dobře

- Jasná struktura (pages/components/lib/layouts), jedna sdílená `StockCard`, jeden `BaseLayout`.
- Helpery pěkně oddělené v `lib/` (directus, contacts, schemas, sanitize, features, technicalData).
- Konvence zdokumentované (year priority, VAT, promo cena) a dodržované.
- Pre-commit hook chrání proti mount-truncation `.astro` souborů.
- TypeScript napříč; Astro `check` k dispozici.

---

## Doporučené pořadí úklidu

1. Smazat 2 mrtvé komponenty (rychlé, bezpečné po ověření).
2. Sjednotit rate-limit do `lib/` (spolu se SECURITY.md P1-1).
3. Archivovat one-off skripty + `scripts/README.md`.
4. Doplnit `.env.example`.
5. P2 dluh při větší údržbě.

> 📌 Aktuální stav po bodech viz [README](./README.md). Hotovo: mrtvé komponenty, rate-limit do lib/, scripts README, .env.example. Odloženo: scripts archiv, global.css split, legacy fallbacky.
