# SFR Motor VPS — setup & migration guide

Backend stack pro SFR Motor web: **Directus + Postgres + Redis + MinIO + UCL leasing proxy** v Docker Compose, deployed na WebGlobe VPS Standard (Ubuntu 22.04 LTS).

## Co tu je

```
vps-setup/
  README.md                ← tenhle soubor
  setup-vps.sh             ← bootstrap skript (spustíš na čerstvém serveru)
  docker-compose.yml       ← celý stack
  .env.example             ← template ENV proměnných (zkopírovat → .env, vyplnit)
  nginx/
    sfr-motor.conf         ← reverse proxy (HTTPS termination, routing)
  ucl-proxy/
    Dockerfile             ← Node.js mikroservis pro UCL kalkulačku
    server.js              ← samotný proxy kód
    package.json           ← Node deps
```

## Předpoklady

- WebGlobe VPS Standard objednaný (2 vCPU / 4 GB / 60 GB SSD)
- Ubuntu 22.04 LTS instalovaný (výběr při objednávce)
- Přístup k SSH (IP + root heslo z emailu od WebGlobe)
- Přístup k doménovému registrátoru pro nastavení DNS A záznamů

## Krok 1 — DNS nastavení

V admin panelu **tvého doménového registrátora** (kde máš sfr-motor.cz) přidej **2 A záznamy**:

```
admin.sfr-motor.cz    A    [IP_VPS_z_emailu]    TTL 3600
api.sfr-motor.cz      A    [IP_VPS_z_emailu]    TTL 3600
```

Hlavní `sfr-motor.cz` a `www.sfr-motor.cz` necháváš na Vercelu (žádná změna).

DNS propagace trvá 5–60 minut. Můžeš zkusit:
```
nslookup admin.sfr-motor.cz
```
Pokud vrátí IP VPS, je hotovo.

## Krok 2 — SSH připojení k serveru

Na Windows otevři **PowerShell** nebo **Windows Terminal**:

```powershell
ssh root@[IP_VPS]
```

Zadej heslo z emailu od WebGlobe. Při prvním připojení potvrď fingerprint (yes).

## Krok 3 — Bootstrap skript

Stáhneš a spustíš `setup-vps.sh` (jednou):

```bash
curl -fsSL https://raw.githubusercontent.com/SFR-Motor/sfr-motor-web/main/vps-setup/setup-vps.sh -o setup.sh
chmod +x setup.sh
./setup.sh
```

Skript udělá:
- `apt update` + bezpečnostní patche
- Nainstaluje Docker + Docker Compose
- Nastaví UFW firewall (povolí jen SSH, HTTP, HTTPS)
- Nainstaluje Nginx + Certbot (pro Let's Encrypt SSL)
- Vytvoří `/data/` strukturu (postgres, minio, directus, backups)
- Naklonuje repo do `/opt/sfr-motor/`
- Vytvoří uživatele `sfr` pro běh aplikací (root pak používáš jen pro admin)

Trvá ~5 minut. Na konci vypíše „SETUP DONE".

## Krok 4 — Konfigurace ENV

```bash
cd /opt/sfr-motor/vps-setup
cp .env.example .env
nano .env
```

Vyplníš (vysvětlení uvnitř souboru):
- Postgres heslo (vygeneruj náhodné, 32 znaků)
- Directus admin email + heslo
- UCL credentials (z mailu od Jiřího Vintra)
- MinIO root user + heslo
- Doménové jména

Ulož: `Ctrl+O`, Enter, `Ctrl+X`.

## Krok 5 — SSL certifikáty

```bash
sudo certbot certonly --nginx -d admin.sfr-motor.cz -d api.sfr-motor.cz \
  --non-interactive --agree-tos -m admin@sfr-motor.cz
```

Certbot získá SSL certifikáty pro obě subdomény z Let's Encrypt. **Auto-renew** je nastavený přes cron — žádná manuální údržba.

## Krok 6 — Spustit stack

```bash
cd /opt/sfr-motor/vps-setup
docker compose up -d
```

Trvá ~3 minuty (stahuje obrazy, startuje kontejnery).

Kontrola:
```bash
docker compose ps
```
Měl bys vidět všechny služby ve stavu `running`:
- `nginx`
- `directus`
- `postgres`
- `redis`
- `minio`
- `ucl-proxy`

Otevři v browseru:
- `https://admin.sfr-motor.cz` → Directus admin login screen
- `https://api.sfr-motor.cz/health` → `{"status":"ok"}`

## Krok 7 — Migrace dat z Render

```bash
# 1) pg_dump z Render Postgresu (na svém Windows)
pg_dump "postgres://..." > render-dump.sql

# 2) Přenes na VPS
scp render-dump.sql root@[IP_VPS]:/data/

# 3) Restore na VPS Postgres
docker compose exec postgres psql -U directus -d directus < /data/render-dump.sql

# 4) Migrate fotky z R2 do MinIO
# (separátní skript v ucl-proxy/migrate-r2-to-minio.js)
```

## Krok 8 — Přepojit frontend (Vercel)

Ve Vercel project Settings → Environment Variables:

```
PUBLIC_DIRECTUS_URL=https://admin.sfr-motor.cz   ← původně Render URL
UCL_PROXY_URL=https://api.sfr-motor.cz/leasing   ← nový
```

Redeploy. Astro frontend teď čte z VPS.

## Krok 9 — Otestuj produkci

- Otevři `https://www.sfr-motor.cz/sklad`
- Klikni na nějaký vůz
- Otevři `/sklad/{id}#finance` → kalkulačka má dělat reálné UCL výpočty (poprvé v produkci!)

## Krok 10 — Vypnout Render

Až vše ověříš (1–2 dny pozorování), v Render dashboardu deaktivuj všechny služby:
- Directus
- Postgres
- Redis
- Cron jobs (pokud máš)

Roční úspora ~7 000–18 000 Kč.

## Údržba (denně 0 min, měsíčně 5 min)

**Denně**: nic. Stack běží sám, certifikáty auto-renew, WebGlobe snapshots jedou.

**Měsíčně**: SSH na server a:
```bash
docker compose pull        # nové verze obrazů
docker compose up -d       # restart s novými
docker system prune -af    # cleanup starých
```

To je vše.

## Troubleshooting

Když něco padne, řekni Claude a pošli mu výstup z:
```bash
docker compose logs --tail=200
docker compose ps
df -h    # disk space
free -h  # paměť
```

Z toho pozná co se stalo.
