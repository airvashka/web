#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# SFR Motor — VPS bootstrap skript
#
# Spouští se JEDNOU na čerstvém WebGlobe VPS (Ubuntu 22.04 nebo 24.04 LTS).
# Připraví server: Docker, Nginx, Certbot, firewall, /data strukturu, repo clone.
#
# Použití:
#   curl -fsSL https://raw.githubusercontent.com/airvashka/web/main/vps-setup/setup-vps.sh -o setup.sh
#   chmod +x setup.sh
#   ./setup.sh
#
# Po doběhnutí: cd /opt/sfr-motor/vps-setup && cp .env.example .env && nano .env
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_URL="https://github.com/airvashka/web.git"
REPO_DIR="/opt/sfr-motor"
DATA_DIR="/data"
APP_USER="sfr"

log() { echo -e "\n\033[1;32m▶ $*\033[0m"; }
err() { echo -e "\n\033[1;31m✖ $*\033[0m" >&2; exit 1; }

[[ $EUID -eq 0 ]] || err "Spouštěj jako root (sudo)."

log "1/10 — apt update & upgrade"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y \
  ca-certificates curl gnupg lsb-release \
  ufw nginx certbot python3-certbot-nginx \
  git nano htop unzip jq \
  postgresql-client

log "2/10 — Docker repo + engine"
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
   $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

log "3/10 — UFW firewall (jen SSH, HTTP, HTTPS)"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

log "4/10 — App user '$APP_USER'"
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd -m -s /bin/bash "$APP_USER"
  log "   uživatel '$APP_USER' vytvořen"
else
  log "   uživatel '$APP_USER' už existuje"
fi
# Docker group musí proběhnout VŽDY (i u pre-existing usera z Ubuntu installeru).
# Bez tohohle GitHub Actions deploy nefunguje (docker bez sudo nejede).
usermod -aG docker "$APP_USER"
log "   '$APP_USER' přidán do docker group (vyžaduje relog ať se group aktivuje)"

log "5/10 — /data struktura (persistentní storage pro Docker volumes)"
mkdir -p \
  "$DATA_DIR/postgres" \
  "$DATA_DIR/minio" \
  "$DATA_DIR/directus/uploads" \
  "$DATA_DIR/directus/extensions" \
  "$DATA_DIR/redis" \
  "$DATA_DIR/backups"
chown -R "$APP_USER:$APP_USER" "$DATA_DIR"
chmod -R 750 "$DATA_DIR"

log "6/10 — Clone repo do $REPO_DIR"
if [[ -d "$REPO_DIR/.git" ]]; then
  log "   repo už existuje → git pull"
  cd "$REPO_DIR"
  git pull
else
  git clone "$REPO_URL" "$REPO_DIR"
fi
chown -R "$APP_USER:$APP_USER" "$REPO_DIR"

log "7/10 — Nginx default config OFF (přepneme na náš)"
rm -f /etc/nginx/sites-enabled/default
# Kopírujeme náš nginx config (zatím vypnutý — zapneme po SSL cert získání)
if [[ -f "$REPO_DIR/vps-setup/nginx/sfr-motor.conf" ]]; then
  cp "$REPO_DIR/vps-setup/nginx/sfr-motor.conf" /etc/nginx/sites-available/sfr-motor.conf
  log "   /etc/nginx/sites-available/sfr-motor.conf nakopírováno"
fi
# Restart nginx (zatím s defaultní konfigurací bez sfr-motor — to zapneme až po certbot)
systemctl restart nginx

log "8/10 — Swap (2 GB) — kompenzace pro 4GB RAM při Docker buildech"
if [[ ! -f /swapfile ]]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  log "   2GB swap aktivní"
else
  log "   swap už existuje (skip)"
fi

log "9/10 — Systémové limity (file descriptors pro Postgres/Redis)"
cat > /etc/security/limits.d/99-sfr.conf <<EOF
* soft nofile 65536
* hard nofile 65536
EOF

log "10/10 — fail2ban (basic SSH brute-force ochrana)"
apt-get install -y fail2ban
systemctl enable --now fail2ban

# ── Finish ───────────────────────────────────────────────────────────────────
cat <<'EOF'

  ╔══════════════════════════════════════════════════════════════════╗
  ║                       SETUP DONE                                 ║
  ╚══════════════════════════════════════════════════════════════════╝

  Další krok:
    1) cd /opt/sfr-motor/vps-setup
    2) cp .env.example .env
    3) nano .env                      (vyplnit hesla + UCL credentials)

  Pak SSL certifikáty (PŘED docker compose up):
    sudo certbot certonly --nginx \
      -d admin.sfr-motor.cz \
      -d api.sfr-motor.cz \
      --non-interactive --agree-tos -m admin@sfr-motor.cz

  Pak zapnout nginx config:
    sudo ln -s /etc/nginx/sites-available/sfr-motor.conf /etc/nginx/sites-enabled/
    sudo nginx -t && sudo systemctl reload nginx

  Pak startovat stack:
    cd /opt/sfr-motor/vps-setup
    docker compose up -d

  Kontrola:
    docker compose ps
    docker compose logs -f

EOF
