#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# SFR Motor — denní backup (Postgres + MinIO bucket meta)
#
# Spouští se denně z cronu (root crontab):
#   0 3 * * * /opt/sfr-motor/vps-setup/backup.sh >> /var/log/sfr-backup.log 2>&1
#
# Dělá:
#   1) pg_dump celé directus DB → /data/backups/postgres-YYYY-MM-DD.sql.gz
#   2) Cleanup starších než BACKUP_RETENTION_DAYS (default 14 dnů)
#
# MinIO data backup je řešen WebGlobe daily snapshots (zdarma, 7 dnů retence)
# — disk /data/minio je součást snapshotu.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

cd /opt/sfr-motor/vps-setup
set -a
source .env
set +a

BACKUP_DIR="/data/backups"
RETENTION="${BACKUP_RETENTION_DAYS:-14}"
TS=$(date +%Y-%m-%d_%H-%M)
OUTFILE="$BACKUP_DIR/postgres-$TS.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "[$(date)] backup start → $OUTFILE"

docker compose exec -T postgres pg_dump \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  --no-owner --no-privileges \
  | gzip -9 > "$OUTFILE"

SIZE=$(du -h "$OUTFILE" | cut -f1)
echo "[$(date)] dump done — $SIZE"

# Cleanup starých
find "$BACKUP_DIR" -name "postgres-*.sql.gz" -mtime +"$RETENTION" -delete
echo "[$(date)] cleanup done (retention: $RETENTION dnů)"

echo "[$(date)] backup finished OK"
