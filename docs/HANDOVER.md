# Handover — převzetí a provoz SFR Motor webu

> **Účel:** Aby někdo (vývojář, kolega) mohl převzít projekt, kdyby majitel nebyl k dispozici. 
> **Bezpečnost:** Tento dokument záměrně **neobsahuje žádná reálná hesla ani klíče** — jen seznam, *co* je potřeba a *kde* to získat. Hodnoty si doplň do odděleného, zabezpečeného trezoru (password manager), **ne do gitu**.

---

## 0. TL;DR — co je kriticky potřeba předat

Bez těchto věcí se projekt nedá plně převzít. Označeno 🔴 = kritické, 🟠 = důležité.

- 🔴 **Přístup k registrátorovi domény `sfr-motor.cz`** (DNS A záznamy) — bez něj nelze měnit směrování webu.
- 🔴 **Vercel účet** (firemní) — hosting frontendu + produkční ENV proměnné.
- 🔴 **SSH na VPS** `sfr@62.109.137.145` + heslo uživatele `sfr`. Pozn.: root heslo je dle poznámek **zapomenuté** → obnovit přes KVM konzoli WebGlobe nebo `sudo passwd root`.
- 🔴 **Directus admin** (`admin.sfr-motor.cz`) — login admin uživatele.
- 🔴 **GitHub** — oba repozitáře (`airvashka/web` + `SFR-Motor/sfr-motor-web`).
- 🔴 **Hodnoty ENV proměnných** (níže) — hlavně UCL/UniCredit credentials, Directus tokeny, Anthropic klíč, Turnstile secret, Ecomail.
- 🟠 **WebGlobe účet** (správa VPS, snapshoty, KVM konzole, fakturace).
- 🟠 **Cloudflare účet** (Turnstile, případně DNS pro subdomény).
- 🟠 **Google Cloud účet** (Maps Embed + Places API klíče).
- 🟠 **Ecomail účet** (newsletter).
- 🟠 **Anthropic Console** (API klíč, fakturace).

---

## 1. Architektura v jedné větě

Frontend (Astro) běží na **Vercelu**; vše ostatní (Directus CMS, PostgreSQL, Redis, MinIO úložiště, UCL leasing proxy) běží v Dockeru na **WebGlobe VPS**. Detaily v `DEVELOPMENT.md`.

## 2. Účty a přístupy — checklist

Vyplň „Kdo má přístup" a „Uloženo v trezoru?" do svého password manageru.

| # | Služba | K čemu | Kde získat / URL | Krit. | Uloženo? |
|---|---|---|---|---|---|
| 1 | Registrátor domény | DNS pro `sfr-motor.cz`, `www`, `admin.`, `api.`, `beta.`, `monitor.` | dle registrátora (doména je mimo Vercel) | 🔴 | ☐ |
| 2 | Vercel | hosting frontendu, ENV proměnné, deploy hooky | vercel.com (firemní účet) | 🔴 | ☐ |
| 3 | VPS SSH | správa serveru, Docker, zálohy | `ssh sfr@62.109.137.145` | 🔴 | ☐ |
| 4 | WebGlobe | VPS billing, snapshoty, KVM konzole | webglobe.cz | 🟠 | ☐ |
| 5 | Directus admin | správa obsahu webu | `admin.sfr-motor.cz` | 🔴 | ☐ |
| 6 | GitHub `airvashka/web` | dev/upstream repo | github.com | 🔴 | ☐ |
| 7 | GitHub `SFR-Motor/sfr-motor-web` | produkční repo | github.com | 🔴 | ☐ |
| 8 | Cloudflare | Turnstile (antispam), případně DNS | cloudflare.com | 🟠 | ☐ |
| 9 | Google Cloud | Maps + Places API klíče, fakturace | console.cloud.google.com | 🟠 | ☐ |
| 10 | Anthropic | API klíč (parsing ceníků, chat) | console.anthropic.com | 🟠 | ☐ |
| 11 | Ecomail | newsletter | ecomail.cz | 🟠 | ☐ |
| 12 | UCL / UniCredit Leasing | leasing API credentials | partnerský kontakt UCL | 🔴 | ☐ |

## 3. ENV proměnné (kde se nastavují)

Tyto proměnné běh webu potřebuje. **Hodnoty jsou tajné** — patří do Vercel (frontend) a do `/opt/sfr-motor/vps-setup/.env` (VPS), ne do gitu. (`.env` je v `.gitignore`.)

> ⚠️ **`.env.example` v repu je neúplný** — obsahuje jen část proměnných. Skutečný seznam používaných:

**Frontend (Vercel) — public (smí na klienta):**
- `PUBLIC_DIRECTUS_URL`
- `PUBLIC_GOOGLE_MAPS_API_KEY` (omezit na referrer + API!)
- `PUBLIC_TURNSTILE_SITE_KEY`
- `PUBLIC_UCL_PROXY_URL`

**Frontend (Vercel) — tajné (server-side):**
- `DIRECTUS_URL`, `DIRECTUS_STATIC_TOKEN`, `DIRECTUS_LEAD_TOKEN`
- `ANTHROPIC_API_KEY`
- `TURNSTILE_SECRET`, `TURNSTILE_STRICT`
- `ECOMAIL_API_KEY`, `ECOMAIL_HASH`, `ECOMAIL_LIST_ID`
- `GOOGLE_PLACE_ID_PRODEJ`, `GOOGLE_PLACE_ID_SERVIS`
- `CRON_SECRET` (auth pro `/api/cron/backup`)
- UCL/UniCredit: `UNICREDIT_AUTH_URL`, `UNICREDIT_CALC_URL`, `UNICREDIT_INIT_URL`, `UNICREDIT_INIT_HOST`, `UNICREDIT_CLIENT_SECRET`, `UNICREDIT_USERNAME`, `UNICREDIT_PASSWORD`

**VPS / skripty (`process.env`):**
- `DATABASE_URL` / `DATABASE_PRIVATE_URL`
- `DIRECTUS_URL`, `DIRECTUS_ADMIN_TOKEN`, `DIRECTUS_EMAIL`, `DIRECTUS_PASSWORD`, `DIRECTUS_TOKEN`
- `GOOGLE_PLACES_API_KEY`, `GOOGLE_PLACE_ID_PRODEJ`, `GOOGLE_PLACE_ID_SERVIS`
- `UCL_PROXY_URL`
- `VERCEL_DEPLOY_HOOK` *(dle poznámek zatím možná nenastaveno — viz známé problémy)*

> ✅ **Doporučení:** Aktualizovat `.env.example` na úplný seznam (bez hodnot) — viz CODE-AUDIT.md.

## 4. Kde co běží (rychlá mapa)

| Co | Kde |
|---|---|
| Frontend (web) | Vercel — `sfr-motor.cz`, `www.` |
| Directus admin | VPS — `admin.sfr-motor.cz` |
| Leasing proxy + soubory | VPS — `api.sfr-motor.cz/leasing/*`, `/files/*` |
| Monitoring | VPS — `monitor.sfr-motor.cz` (Netdata) |
| Beta/staging | `beta.sfr-motor.cz` |
| Kód na VPS | `/opt/sfr-motor/` |
| Docker compose | `/opt/sfr-motor/vps-setup/` |
| Sync skripty | `/opt/sfr-motor/scripts/` |

Docker kontejnery: `vps-setup-postgres-1`, `vps-setup-directus-1`, `vps-setup-redis-1`, `vps-setup-minio-1`, `vps-setup-ucl-proxy-1`, `stock-sync`.

## 5. Běžné úkony

- **Nasadit změnu webu**: `git push` (z PowerShellu) → Vercel deploy. Push do `firma` remote pro produkci.
- **Změnit obsah (ceny, fota, texty, tým)**: Directus admin.
- **Restart služby na VPS**: `cd /opt/sfr-motor/vps-setup && docker compose up -d <služba>`.
- **Rebuild UCL proxy**: `docker compose up -d --build ucl-proxy`.
- **Spustit stock sync ručně**: viz `package.json` skript `sync:stock`.

## 6. ⚠️ Otevřené handover úkoly (k dořešení)

- 🟠 **Cloudflare fakturace** běží dle poznámek na *osobní kartě majitele* → přepnout na firemní kartu. Ověřit totéž u Vercel / WebGlobe / Google / Anthropic.
- 🟠 **2FA na firemním GitHub účtu** — zatím odloženo, zapnout.
- 🔴 **Root heslo VPS** — dle poznámek zapomenuté; obnovit přes KVM konzoli WebGlobe a uložit do trezoru.
- 🟠 **Off-site zálohy** — zatím jen WebGlobe snapshoty (7 dní) + lokální `backup.sh` (14 dní). Zvážit off-site (Backblaze B2 / Hetzner Storage Box). Viz DISASTER-RECOVERY.md.

## 7. Co předat člověku, který přebírá

1. Přístup do password manageru s vyplněnou tabulkou z bodu 2 a hodnotami ENV z bodu 3.
2. Přidat ho jako collaboratora na oba GitHub repo.
3. Přidat ho do Vercel projektu a WebGlobe účtu.
4. Předat tuto složku `docs/` (je v repu).
5. Projít s ním `DEVELOPMENT.md` + `DISASTER-RECOVERY.md`.
