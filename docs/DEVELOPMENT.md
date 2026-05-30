# Vývojová dokumentace — SFR Motor web

> Stav k 30. 5. 2026. Některé infrastrukturní údaje (IP, kontejnery) ověř proti živému stavu — mohou se měnit.

## 1. Co to je

Webový katalog a kontaktní web autoshowroomu SFR Motor (prodej a servis vozů KGM, OMODA & JAECOO, Farizon; servis i Dacia/Renault). Není to e-shop — vozy se **poptávají formulářem**, neobjednávají online.

## 2. Technologický stack

| Vrstva | Technologie |
|---|---|
| Frontend framework | **Astro 5** (`output: 'static'`, jednotlivé route opt-in do SSR přes `export const prerender = false`) |
| Hosting frontendu | **Vercel** (adapter `@astrojs/vercel`), doména `sfr-motor.cz` + `www` |
| CMS / databáze | **Directus 11** (`admin.sfr-motor.cz`) nad **PostgreSQL 16** |
| Cache | **Redis 7** (Directus cache) |
| Úložiště souborů | **MinIO** (S3-kompatibilní, `api.sfr-motor.cz/files/*`) |
| Leasing | **UCL proxy** (Node mikroslužba na VPS, `api.sfr-motor.cz/leasing/*`, port 3001) |
| Server | **WebGlobe VPS** (Ubuntu 22.04, Docker Compose) |
| Jazyk | TypeScript |
| Antispam | Cloudflare **Turnstile** |
| Newsletter | **Ecomail** |
| AI (parsing ceníků, chat) | **Anthropic API** |
| Mapy / recenze | **Google** Maps Embed + Places API |

Běhové prostředí: Node 22.

## 3. Struktura repozitáře (`web/`)

```
src/
  pages/            # routy (.astro = stránky, api/*.ts = endpointy)
    api/            # serverové endpointy (lead, newsletter, leasing, cenik, chat, cron)
    model/[slug]/   # detail modelu + /akce + /vybavy
    sklad/          # listing + detail vozu [id]
    informace/      # statické stránky (podmínky, GDPR…)
    magazin/        # blog
  components/        # 23 Astro komponent (Header, Footer, StockCard, LeasingCalculator…)
  layouts/           # BaseLayout.astro (jediný layout)
  lib/               # helpery (directus, contacts, schemas, sanitize, features…)
  styles/            # global.css (hlavní stylesheet, ~5000+ řádků)
  middleware.ts      # aktuálně no-op placeholder
scripts/             # 148 Node skriptů (6 „živých", zbytek one-off migrace/setup — viz CODE-AUDIT.md)
vps-setup/           # Docker Compose, nginx, backup.sh, ucl-proxy (běží na VPS)
docs/                # tato dokumentace
.github/workflows/   # CI (deploy VPS, weekly refresh recenzí)
.githooks/           # pre-commit (ochrana proti mount truncation .astro souborů)
```

## 4. Stránky (routy)

Statické + SSR mix. SSR (prerender=false) mají dynamické stránky čerstvě z Directusu s edge cache `s-maxage=60`:

- `/` titulní strana
- `/[brand]` — kgm, omoda-jaecoo, farizon (přehled modelů)
- `/model/[slug]` (+ `/akce`, `/vybavy`)
- `/sklad`, `/sklad/[id]`
- `/servis`, `/kontakt`, `/o-nas`, `/kariera`, `/partneri`
- `/magazin`, `/magazin/[slug]`
- `/informace/[slug]`
- `/admin/cenik` (interní nástroj na parsing ceníků)
- `/404` (SSR, vrací status 404; dynamické stránky dělají `Astro.rewrite('/404')`, ne redirect)

## 5. API endpointy (`src/pages/api/`)

| Endpoint | Účel | Ochrana |
|---|---|---|
| `lead.ts` | příjem poptávek → Directus + e-mail | rate limit 10/den/IP + Turnstile |
| `newsletter.ts` | přihlášení k newsletteru (Ecomail) | rate limit 10/den/IP |
| `leasing/calculate.ts` | výpočet splátky přes UCL proxy | origin check, credentials server-side |
| `leasing/init.ts` | init UCL session | origin check |
| `leasing/test.ts` | **debug** test runner UCL | ⚠️ bez auth — viz SECURITY.md |
| `cenik/analyze.ts` | AI parsing PDF ceníku | Directus token (ověřuje uživatele) |
| `cenik/save.ts` | uložení naparsovaného ceníku | Directus token |
| `chat/model.ts` | AI chat o modelu | rate limit per IP |
| `cron/backup.ts` | záloha Directus kolekcí | `CRON_SECRET` (Bearer) |

## 6. Datový model (Directus)

Klíčové kolekce: `brands`, `sub_brands`, `models`, `model_years`, `trim_levels`, `option_packages`, `stock_vehicles`, `model_documents` (brožury/ceníky/manuály), `employees`, `branches`, `site_settings` (singleton — hero fota, telefony, kontaktní hero), `articles`. Detailní schéma viz interní poznámky / Directus admin.

Důležité konvence:
- **Ceny vždy s DPH**; bez DPH = `round(s_DPH / 1.21)`.
- **Rok na skladové kartě**: priorita `trim_level_snapshot.year` > `model_year.year` > `first_registration`.
- **OMODA/JAECOO rok**: dekódován z 10. znaku VIN (R=2024, S=2025, T=2026).
- **Promo cena u skladu**: `list_price` je už po slevě → cena „před" = `list_price + discount`.
- Data z Directusu se tahají přes `src/lib/directus.ts` (`directusGet`, `directusGetOne`, `directusAsset`).

## 7. Build & deploy

- **Frontend**: `git push` na `main` → Vercel auto-deploy. Lokální build: `npm run build`.
- **Dva remote**: `origin` (`airvashka/web`, Jardova šablona) a `firma` (`SFR-Motor/sfr-motor-web`, produkce). Hotová změna → push do `firma`.
- **Push z PowerShellu** (GitHub Desktop selhává na bash pre-commit hook).
- **VPS deploy**: GitHub Action `deploy-vps.yml` se spustí při změnách v `vps-setup/`, `scripts/`, `package.json`, `Dockerfile`.
- **Stock sync**: systemd timer na VPS 12/17/21 (UTC+2), kontejner `stock-sync` (rebuild po změně `scripts/`).
- **Recenze**: GitHub Action weekly (pondělí), aby Google Places API neúčtovalo při každém buildu.

## 8. Lokální vývoj

```bash
cd web
npm install
npm run dev      # http://localhost:4321
npm run build    # produkční build
```

Potřebné env proměnné viz `ONBOARDING.md` a `.env.example` (pozor: `.env.example` je neúplný — viz HANDOVER.md).

## 9. Konvence a úskalí (důležité)

- **Cowork mount truncation**: velké soubory (Header.astro, global.css, sklad…) se občas useknou při zápisu přes editor → vždy ověřit konec souboru a párování tagů; editace velkých souborů raději přes python `read→replace→write`.
- **Astro JSX ≠ TS v templatu**: TypeScript anotace patří jen do frontmatteru (`---`), ne do `{...}` v šabloně.
- **Scoped vs global styl**: `<style>` v Astro je scoped; pro styl na client-side `innerHTML` elementy použít `is:global`. Interaktivní handlery raději `<script is:inline>`.
- **404**: dynamické SSR stránky používají `Astro.rewrite('/404')`, ne `Astro.redirect`.

## 10. Související dokumenty

- `HANDOVER.md` — převzetí projektu + přístupy
- `SECURITY.md` — bezpečnost
- `CODE-AUDIT.md` — stav kódu
- `DISASTER-RECOVERY.md` — zálohy a obnova
- `DEPENDENCIES.md` — závislosti
- `ONBOARDING.md` — rychlý start
- `MONITORING.md` — hlídání provozu
