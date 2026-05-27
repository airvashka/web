#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# SFR Motor — automatická příprava .env souboru
#
# Vygeneruje silná náhodná hesla pro Postgres, Redis, MinIO, Directus
# a vyplní .env z template .env.example.
#
# UCL credentials (PREPROD) jsou už v .env.example jako default, takže
# pro start fungují bez ručního zásahu.
#
# Po spuštění VYPÍŠE všechna citlivá hesla na stdout — JEDNORÁZOVĚ.
# Zkopíruj si je stranou (password manager, šifrovaný soubor) — později
# k nim přístup máš jen přes `cat /opt/sfr-motor/vps-setup/.env`.
#
# Použití:
#   cd /opt/sfr-motor/vps-setup
#   sudo ./prepare-env.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -f .env.example ]]; then
  echo "✖ .env.example nenalezen v $(pwd)" >&2
  exit 1
fi

if [[ -f .env ]]; then
  echo "⚠ .env už existuje. Pokračování by ho přepsalo."
  read -rp "Přepsat? (yes/no): " ans
  [[ "$ans" == "yes" ]] || { echo "Zrušeno."; exit 0; }
  cp .env ".env.backup-$(date +%Y%m%d-%H%M%S)"
fi

# Generátor — base64 z 24 bytes = 32 znaků, bez special chars pro shell safety
gen() { openssl rand -base64 24 | tr -d '/+=' | head -c 32; }
gen_uuid() { cat /proc/sys/kernel/random/uuid; }

POSTGRES_PW=$(gen)
REDIS_PW=$(gen)
MINIO_PW=$(gen)
DIRECTUS_KEY=$(gen_uuid)
DIRECTUS_SECRET=$(gen)$(gen)  # 64 chars
DIRECTUS_ADMIN_PW=$(gen)

# Načteme template a substituujeme placeholdery
cp .env.example .env

# sed in-place — POSIX safe (Linux Ubuntu)
sed -i \
  -e "s|VYPLŇ_postgres_heslo_min_32_znaků|${POSTGRES_PW}|g" \
  -e "s|VYPLŇ_redis_heslo_min_32_znaků|${REDIS_PW}|g" \
  -e "s|VYPLŇ_minio_heslo_min_32_znaků|${MINIO_PW}|g" \
  -e "s|VYPLŇ_uuidv4_napriklad_z_uuidgen|${DIRECTUS_KEY}|g" \
  -e "s|VYPLŇ_random_64_znaků|${DIRECTUS_SECRET}|g" \
  -e "s|VYPLŇ_silné_heslo_pro_admin_login|${DIRECTUS_ADMIN_PW}|g" \
  .env

chmod 600 .env

# Output — JEDNORÁZOVÉ vypsání hesel
cat <<EOF

╔══════════════════════════════════════════════════════════════════╗
║  .env vyplněn. Vygenerovaná hesla (ZKOPÍRUJ SI STRANOU!):       ║
╚══════════════════════════════════════════════════════════════════╝

  Postgres heslo:         ${POSTGRES_PW}
  Redis heslo:            ${REDIS_PW}
  MinIO heslo:            ${MINIO_PW}
  Directus KEY (uuid):    ${DIRECTUS_KEY}
  Directus SECRET:        ${DIRECTUS_SECRET}
  Directus admin email:   admin@sfr-motor.cz
  Directus admin heslo:   ${DIRECTUS_ADMIN_PW}

  UCL credentials:        už nastavené (PREPROD default — sfr_test)

Soubor uložen v: $(pwd)/.env  (chmod 600, jen root čte)

Další krok:
  1) Pokud chceš změnit cokoli (např. Directus admin email), edituj:
     nano .env
  2) Pak SSL certifikáty:
     sudo certbot certonly --nginx \\
       -d admin.sfr-motor.cz -d api.sfr-motor.cz \\
       --non-interactive --agree-tos -m admin@sfr-motor.cz
  3) Zapnout nginx config:
     sudo ln -s /etc/nginx/sites-available/sfr-motor.conf /etc/nginx/sites-enabled/
     sudo nginx -t && sudo systemctl reload nginx
  4) Startovat stack:
     docker compose up -d

EOF
