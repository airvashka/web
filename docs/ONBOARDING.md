# Onboarding — rychlý start pro nového člověka

> Cíl: od nuly k běžícímu webu lokálně za ~30 minut. Detaily viz `DEVELOPMENT.md`.

## 1. Co budeš potřebovat
- **Node 22** (projekt to vyžaduje — `engines: node 22.x`).
- **Git** + účet s přístupem k repu (požádej majitele o collaboratora).
- **Windows + PowerShell** (tým takhle pushuje; GitHub Desktop tu selhává na pre-commit hook).
- Editor (VS Code doporučen).
- Přístup k **hodnotám ENV proměnných** (z password manageru — viz `HANDOVER.md`).

## 2. Stažení a spuštění
```powershell
git clone https://github.com/SFR-Motor/sfr-motor-web.git
cd sfr-motor-web/web        # POZOR: web je v podsložce
npm install
```

Vytvoř `.env` (zkopíruj `.env.example` a doplň hodnoty z trezoru):
```powershell
Copy-Item .env.example .env
# pak doplnit hodnoty — POZOR: .env.example je neúplný, plný seznam je v docs/HANDOVER.md
```

Pro **lokální vývoj webu** stačí minimálně `PUBLIC_DIRECTUS_URL` (ukáže na živý Directus, ať máš data). Leasing/AI/maily fungují jen s příslušnými klíči.

```powershell
npm run dev          # http://localhost:4321
```

## 3. Užitečné příkazy
```powershell
npm run dev          # vývojový server
npm run build        # produkční build (musí projít před pushem)
npm run sync:stock:kgm     # ručně stáhnout KGM sklad (potřebuje env + DB přístup)
npm run fetch-reviews      # stáhnout Google recenze (potřebuje Google Places klíč)
```

## 4. Kde co najít (orientace)
- **Stránky:** `src/pages/` (`.astro` = stránka, `api/*.ts` = endpoint).
- **Komponenty:** `src/components/` (např. `StockCard.astro`, `Header.astro`).
- **Helpery / data:** `src/lib/` (`directus.ts` = přístup k CMS).
- **Styly:** `src/styles/global.css` (velký, hlavní) + scoped `<style>` v komponentách.
- **Skripty:** `scripts/` (živých 6, zbytek jednorázové — viz `CODE-AUDIT.md`).
- **Obsah webu** (ceny, fota, texty, tým): **Directus admin** `admin.sfr-motor.cz`, ne v kódu.

## 5. Jak nasadit změnu
1. Uprav kód, `npm run build` (musí projít).
2. `git add ... ; git commit -m "..." ; git push` (z PowerShellu).
3. Push na `main` → Vercel automaticky nasadí. Pro produkci push do remote `firma`.
4. Otestuj na `beta.sfr-motor.cz` (ne rovnou produkce).

## 6. Úskalí, na která narazíš (přečti, ušetří čas)
- **Velké soubory se při zápisu přes editor občas useknou** (mount truncation) → po editaci `Header.astro`/`global.css`/`sklad` ověř konec souboru a párování tagů; build to chytí.
- **Astro JSX není TypeScript** — anotace typů jen ve frontmatteru (`---`), ne v `{...}` šabloně.
- **`<style>` v Astro je scoped** — na client-side `innerHTML` nesedne; použij `is:global`. Interaktivní handlery dávej do `<script is:inline>`.
- **404** v SSR stránkách přes `Astro.rewrite('/404')`, ne redirect.
- **Ceny jsou s DPH**; bez DPH = `round(s_DPH / 1.21)`.
- **Pre-commit hook** je bash → pushuj z PowerShellu/git CLI, ne z GitHub Desktopu.

## 7. První „rozcvička" (volitelné)
1. Spusť `npm run dev`, otevři web lokálně, proklikej sklad a detail modelu.
2. Najdi v Directusu jeden model, změň mu text, sleduj projev na webu (SSR, ~60s cache).
3. Přečti `DEVELOPMENT.md` (architektura) a `DISASTER-RECOVERY.md` (co když něco spadne).

## 8. Koho/co znát dál
- `HANDOVER.md` — všechny přístupy a účty.
- `SECURITY.md` + `DEPENDENCIES.md` — co je potřeba hlídat/aktualizovat.
- `MONITORING.md` — jak poznat, že něco neběží.
