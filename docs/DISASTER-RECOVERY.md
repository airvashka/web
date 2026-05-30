# Disaster Recovery — SFR Motor web

> Co dělat, když něco spadne, a jak obnovit data. Stav k 30. 5. 2026 — cesty/IP ověř proti živému stavu.

## 1. Co je kde (a jak kritické)

| Komponenta | Kde | Stav | Když to spadne |
|---|---|---|---|
| Frontend (web) | Vercel | **bez stavu** — zdroj je git | redeploy / rollback, data nikde |
| Directus + Postgres | VPS (Docker) | **stavové, kritické** | web jede, ale dynamická data (vozy, ceny, obsah) nejedou |
| MinIO (fota/soubory) | VPS `/data/minio` | **stavové, kritické** | chybí obrázky/dokumenty |
| Redis | VPS | cache, bez trvalých dat | jen pomalejší, sám se naplní |
| UCL proxy | VPS | bez stavu | nejede leasing kalkulačka |

**Zdroj pravdy pro kód** = Git (`airvashka/web` + `SFR-Motor/sfr-motor-web`). Frontend jde kdykoli znovu nasadit z gitu.

## 2. Zálohy — co máme

| Vrstva | Co zálohuje | Kde | Retence | Off-site? |
|---|---|---|---|---|
| WebGlobe snapshoty | celý disk VPS (vč. Postgres i `/data/minio`) | WebGlobe | 7 dní | ✅ (mimo VPS) |
| `backup.sh` (cron 3:00) | `pg_dump` Directus DB | VPS `/data/backups/postgres-*.sql.gz` | 14 dní | ❌ (na stejném VPS) |
| `/api/cron/backup` (Vercel cron) | JSON export Directus kolekcí | Vercel Blob Storage | 30 dní | ✅ (mimo VPS) |

**RPO** (kolik dat max ztratíme): do 24 h (denní zálohy). **RTO** (jak rychle obnovit): VPS snapshot ~desítky minut; redeploy frontendu ~minuty.

> ⚠️ **Mezera:** `backup.sh` pg_dump leží na **stejném VPS** — když selže disk, je pryč. Off-site kryje jen WebGlobe snapshot (7 dní) a Vercel Blob (JSON kolekcí). **Doporučení:** přidat týdenní off-site kopii pg_dumpu (Backblaze B2 / Hetzner Storage Box) — viz bod 6.

## 3. Scénáře a postup

### A) Web nejde / poslední deploy něco rozbil
1. Vercel → projekt → **Deployments** → najdi poslední funkční → **Promote to Production** (rollback).
2. Nebo oprav v gitu a `git push` (nový deploy).
3. Frontend nemá data, takže žádná ztráta.

### B) VPS nedostupný (Directus/admin/api nejede)
1. Ověř: `ssh sfr@62.109.137.145`; pingni `admin.sfr-motor.cz`, `monitor.sfr-motor.cz` (Netdata).
2. Pokud server běží, ale služby ne: `cd /opt/sfr-motor/vps-setup && docker compose ps`, pak `docker compose up -d`.
3. Pokud server nenaběhne / poškozený: ve WebGlobe panelu **obnovit z posledního snapshotu** (≤7 dní stáří). Pak ověřit kontejnery.

### C) Poškozená / smazaná data v Postgresu
1. Zastav Directus, ať nepíše: `docker compose stop directus`.
2. Vyber zálohu: `ls -lt /data/backups/` (nebo starší WebGlobe snapshot).
3. Obnova z dumpu:
   ```bash
   cd /opt/sfr-motor/vps-setup
   gunzip -c /data/backups/postgres-RRRR-MM-DD_HH-MM.sql.gz | \
     docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
   ```
   (Pozn.: do čisté DB; při potřebě nejdřív drop/recreate schématu. Otestovat na kopii!)
4. `docker compose up -d directus`, ověřit data v adminu.

### D) Ztráta souborů (MinIO — fota, dokumenty)
1. Obnovit `/data/minio` z **WebGlobe snapshotu** (MinIO data jsou součástí disku).
2. Restartovat MinIO: `docker compose up -d minio`.
3. Pokud chybí jen pár fotek → nahrát znovu přes Directus admin.

### E) Obsah z Vercel Blob (záchranná síť na úrovni kolekcí)
`/api/cron/backup` drží JSON export klíčových kolekcí 30 dní na Vercel Blob. Použitelné, když pg záloha selže — data se dají reimportovat do Directusu (přes API/skript). Méně pohodlné než pg restore, ale je to nezávislá kopie mimo VPS.

### F) Doména / DNS výpadek
1. Zkontroluj A záznamy u registrátora: `sfr-motor.cz`+`www` → Vercel; `admin.`+`api.`+`monitor.` → IP VPS (`62.109.137.145`).
2. SSL: Vercel řeší sám; na VPS nginx+Certbot (`certbot renew` pokud expirovalo).

## 4. Po každé obnově ověřit
- Web se načte, dynamické stránky (sklad, model) ukazují data.
- Admin login funguje.
- Leasing kalkulačka počítá (UCL proxy).
- Fota/dokumenty se zobrazují (MinIO).
- Stock sync proběhne (systemd timer 12/17/21).

## 5. Pravidelná prevence (doporučeno)
- **1× za čtvrtletí otestovat restore** z pg_dumpu na kopii — záloha, kterou nikdo nezkusil obnovit, není záloha.
- Kontrolovat, že `backup.sh` běží (log `/var/log/sfr-backup.log`) a soubory přibývají.
- Sledovat volné místo na disku VPS (60 GB) — zálohy + MinIO ho plní.

## 6. ⚠️ Doporučená vylepšení
- 🟠 **Off-site pg záloha** (týdně) na Backblaze B2 / Hetzner Storage Box (rclone). Kryje výpadek celého VPS i starší než 7 dní.
- 🟡 Prodloužit WebGlobe snapshot retenci, pokud to plán umožní.
- 🟡 Alert, když `backup.sh` selže nebo soubor nepřibyl (viz MONITORING.md).
