# Monitoring & uptime — SFR Motor web

> Jak poznat, že web, sync a backend běží — a dozvědět se o problému dřív než zákazník. Stav k 30. 5. 2026.

## 1. Co už máme
- **Netdata** na `monitor.sfr-motor.cz` — metriky VPS (CPU, RAM, disk, kontejnery) v reálném čase.
- **Vercel** — vlastní dashboard (deploys, funkce, chyby) + e-mail při failed deploy.
- **WebGlobe** — snapshoty (zároveň indikace, že VPS žije).

## 2. Co hlídat (a čím)

| Co | Proč kritické | Jak hlídat | Stav |
|---|---|---|---|
| **Web `sfr-motor.cz`** dostupný | hlavní výloha | externí uptime monitor (HTTP 200) | ⚠️ doplnit |
| **`admin.sfr-motor.cz`** (Directus) | bez něj nejde obsah | externí uptime monitor | ⚠️ doplnit |
| **`api.sfr-motor.cz/leasing`** (UCL proxy) | leasing kalkulačka | uptime monitor + test endpoint | ⚠️ doplnit |
| **Stock sync** (12/17/21) | aby nezůstaly staré/prodané vozy | heartbeat (Healthchecks.io) | ⚠️ doplnit |
| **`backup.sh`** denní | aby zálohy reálně vznikaly | heartbeat + kontrola velikosti | ⚠️ doplnit |
| **Disk VPS** (60 GB) | zálohy + MinIO ho plní | Netdata alarm na <15 % volného | nastavit alarm |
| **SSL certifikáty** | HTTPS na VPS doménách | Certbot auto-renew + alert 14 dní před expirací | ověřit renew |
| **Náklady API** (Anthropic, Google) | nečekané útraty / zneužití | billing alerty v konzolích | ⚠️ doplnit |
| **CPU/RAM VPS** | výkon (2 vCPU/4 GB) | Netdata alarmy | částečně |

## 3. Doporučené nastavení (priorita)

### 🟠 P1 — externí uptime monitor
Zřídit **UptimeRobot** (free) nebo **BetterStack** a přidat:
- `https://sfr-motor.cz` (a `www`)
- `https://admin.sfr-motor.cz`
- `https://api.sfr-motor.cz/leasing/...` (healthcheck route)
- `https://beta.sfr-motor.cz` (volitelně)

Interval 1–5 min, alert na e-mail/SMS/Telegram. Pokryje výpadek dřív, než ho najde zákazník.

### 🟠 P1 — heartbeat pro cron joby
Stock sync i `backup.sh` běží „potichu". Přidat **Healthchecks.io** (free) ping na konec skriptu:
```bash
# na konec backup.sh / sync:
curl -fsS -m 10 --retry 3 https://hc-ping.com/<UUID> > /dev/null
```
Když job neproběhne / spadne → přijde alert. (Řeší i tichý fail kvůli chybějícímu `VERCEL_DEPLOY_HOOK` — viz známé problémy.)

### 🟡 P2 — Netdata alarmy
V Netdata zapnout/ověřit alarmy na: disk <15 %, RAM >90 %, kontejner spadlý. Notifikace na e-mail/Telegram.

### 🟡 P2 — billing alerty
- **Google Cloud** → Budgets & alerts (Places/Maps API).
- **Anthropic Console** → usage limit / alert (chrání před zneužitím `/api/chat/model`).
- **Vercel** → spend management (pokud placený plán).

### 🟡 P2 — SSL & log kontroly
- Ověřit, že `certbot renew` běží (systemd timer / cron) — alert když cert <14 dní.
- Občas mrknout do `/var/log/sfr-backup.log` a Directus logů (`docker compose logs directus`) na opakované chyby (např. 429 rate limit).

## 4. Rychlý „je to v pořádku?" check (ruční, 2 min)
1. `https://sfr-motor.cz` se načte, sklad ukazuje vozy.
2. `admin.sfr-motor.cz` přihlášení jede.
3. `monitor.sfr-motor.cz` — disk/RAM v normě, kontejnery běží.
4. Na detailu KGM vozu se spočítá leasing.
5. `ssh sfr@62.109.137.145` → `docker compose ps` (vše `Up`), `ls -lt /data/backups | head` (čerstvá záloha).

## 5. Souvislosti
- Výpadky a obnova: `DISASTER-RECOVERY.md`.
- Známé tiché chyby (VERCEL_DEPLOY_HOOK, UCL teaser fail, Directus 429): interní poznámky / `SECURITY.md`.
