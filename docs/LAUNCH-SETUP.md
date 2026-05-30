# Launch setup — produkce + oddělená beta

> Cíl: spustit ostrou `sfr-motor.cz` a mít izolovanou `beta.sfr-motor.cz` na testování, kde **nejde rozbít živá data**. Připraveno 30. 5. 2026, k provedení před spuštěním.

## Cílová architektura

| | 🟢 Produkce | 🟡 Dev / beta |
|---|---|---|
| Web | `sfr-motor.cz` + `www` | `beta.sfr-motor.cz` |
| Git repo | `SFR-Motor/sfr-motor-web` (remote `firma`) | `airvashka/web` (remote `origin`) |
| Vercel projekt | nový „sfr-motor-prod" | stávající „web" |
| Directus / DB | živá — `admin.sfr-motor.cz` | **oddělená dev** — `dev-admin.sfr-motor.cz` |

**Dvě úrovně izolace:** kód (dva repos) + data (dvě databáze). Testování na betě nemůže sáhnout na živá data ani na ostrý web.

**Release workflow po nasazení:**
- `git push origin main` → aktualizuje **betu** (testuješ)
- `git push firma main` → aktualizuje **ostrou** (vydáváš)

Cena: druhý Vercel projekt = **$0 navíc** (Pro = neomezeně projektů, platí se za člena). Jen marginální provoz.

---

## Checklist (pořadí, ať nic nespadne)

### 1. VPS — dev Directus + databáze
- [ ] V `/opt/sfr-motor/vps-setup/` přidat **druhý stack** (dev): Postgres `postgres-dev` + Directus `directus-dev` (vlastní DB, port, volume). Redis/MinIO může sdílet nebo mít vlastní.
- [ ] Nginx: nový server block `dev-admin.sfr-motor.cz` → dev Directus + Certbot SSL.
- [ ] DNS: A záznam `dev-admin.sfr-motor.cz` → IP VPS (`62.109.137.145`).
- [ ] Naplnit dev DB **kopií živých dat** (realistické testování):
  ```bash
  # na VPS:
  docker compose exec -T postgres pg_dump -U <user> -d <livedb> --no-owner \
    | docker compose exec -T postgres-dev psql -U <user> -d <devdb>
  ```

### 2. Vercel — DEV projekt (beta)
- [ ] Stávající projekt „web" zůstává napojený na `airvashka/web`.
- [ ] Env `PUBLIC_DIRECTUS_URL` + `DIRECTUS_URL` → **`https://dev-admin.sfr-motor.cz`** (ne živý!).
- [ ] Doména: `beta.sfr-motor.cz` (přiřazená k tomuto projektu / větvi `main` repa airvashka).
- [ ] Turnstile: hostnames widgetu už `beta.sfr-motor.cz` mají ✅.

### 3. Vercel — PROD projekt (ostrá)
- [ ] **Nový projekt** „sfr-motor-prod" → connect repo **`SFR-Motor/sfr-motor-web`**, větev `main`.
- [ ] **Zkopírovat všechny env proměnné** z dev projektu, ale `PUBLIC_DIRECTUS_URL`/`DIRECTUS_URL` → **`https://admin.sfr-motor.cz`** (živý).
- [ ] Domény: `sfr-motor.cz` + `www.sfr-motor.cz` → Production.
- [ ] DNS u registrátora: nasměrovat `sfr-motor.cz` + `www` na Vercel (Vercel ukáže přesné A/CNAME záznamy).
- [ ] Po propagaci DNS + verifikaci = **ostrá je živá.** 🚀

### 4. GitHub Actions (deploy-vps, refresh-reviews)
- [ ] Rozhodnout, z kterého repa běží VPS deploy + reviews. Doporučení: nech na `airvashka/web` (origin) pro teď, NEBO přesuň do `SFR-Motor` (chce přenést secrets — viz GITHUB-MIGRATION níže).
- [ ] Ve firemním repu Actions **vypnuté**, dokud se nepřenesou secrets (jinak padají maily — viz 30.5.).

### 5. Pre-launch ověření (než pustíš DNS na ostrou)
- [ ] `npm run build` projde.
- [ ] Na betě proklikat: titulka, sklad+filtry, model, leasing, formuláře (lead přijde do Directusu), mapy.
- [ ] Turnstile hostnames pokrývají `sfr-motor.cz` (přidat, pokud chybí).
- [ ] Google Maps klíč referrer `*.sfr-motor.cz` ✅.
- [ ] `robots.txt` / sitemap (zvážit custom `/sitemap.xml` — SSR stránky, viz TODO).
- [ ] Všechny env proměnné na PROD projektu (porovnat s dev).

---

## Pozn. k údržbě dvou prostředí
- **Data tečou jen prod → dev** (kopie pro testy), NIKDY dev → prod (přepsalo by živá data).
- **Schema změny** (nová pole/kolekce v Directusu): udělej na dev, pak přenes na prod přes Directus **Schema snapshot → apply** (struktura, ne obsah).
- Občas sesynchronizovat dev DB z prod, ať testuješ na čerstvých datech.

## GITHUB-MIGRATION (volitelné, později)
Přepnout produkční pipeline plně pod firemní účet:
- [ ] Vercel prod projekt už connectnutý na `SFR-Motor/sfr-motor-web` (krok 3).
- [ ] GitHub Actions secrets přenést do `SFR-Motor` repa (VPS SSH klíč, Directus token, Google klíč) — **potřebuješ uložené hodnoty** (GitHub je nezobrazí).
- [ ] Zapnout Actions ve firemním repu.
- [ ] Ulož přihlášení k oběma GitHubům + 2FA do firemního password manageru.
