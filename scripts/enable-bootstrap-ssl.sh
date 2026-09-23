#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Jalankan sebagai root." >&2
  exit 1
fi

ENV_FILE=/etc/hostpanel/hostpanel.env
[[ -r "$ENV_FILE" ]] || { echo "HostPanel belum terpasang." >&2; exit 2; }
env_get() {
  local key="$1"
  awk -v key="$key" 'index($0, key "=") == 1 { value=substr($0, length(key)+2); sub(/\r$/, "", value); if (value ~ /^".*"$/ || value ~ /^\047.*\047$/) value=substr(value,2,length(value)-2); print value; exit }' "$ENV_FILE"
}

PANEL_DOMAIN="$(env_get PANEL_DOMAIN)"
CERTBOT_EMAIL="$(env_get CERTBOT_EMAIL)"
TLS_MODE="$(env_get TLS_MODE)"
PHPMYADMIN_URL="$(env_get PHPMYADMIN_URL)"
TLS_MODE="${TLS_MODE:-local}"

[[ -n "$PANEL_DOMAIN" ]] || { echo "PANEL_DOMAIN belum diset di $ENV_FILE" >&2; exit 2; }
[[ -n "$CERTBOT_EMAIL" ]] || { echo "CERTBOT_EMAIL belum diset di $ENV_FILE" >&2; exit 2; }
[[ "$TLS_MODE" == "local" ]] || { echo "Bootstrap SSL hanya untuk TLS_MODE=local." >&2; exit 2; }

PMA_DOMAIN=""
if [[ -n "${PHPMYADMIN_URL:-}" ]]; then
  PMA_DOMAIN="${PHPMYADMIN_URL#*://}"
  PMA_DOMAIN="${PMA_DOMAIN%%/*}"
fi

python3 - "$PANEL_DOMAIN" "$PMA_DOMAIN" "$CERTBOT_EMAIL" <<'PYVALID'
import re, sys
panel, pma, email = sys.argv[1:]
domain_re = re.compile(r'^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$', re.I)
for label, value, optional in [('PANEL_DOMAIN',panel,False),('PMA_DOMAIN',pma,True)]:
    if optional and not value: continue
    if not domain_re.fullmatch(value.rstrip('.')): raise SystemExit(f'{label} tidak valid.')
if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email): raise SystemExit('CERTBOT_EMAIL tidak valid.')
PYVALID

WEBROOT=/var/www/letsencrypt
mkdir -p "$WEBROOT/.well-known/acme-challenge"
chown -R www-data:www-data "$WEBROOT"
chmod -R 755 "$WEBROOT"

preflight() {
  local domain="$1" token file body
  token="hostpanel-bootstrap-$(date +%s)-$$-$RANDOM"
  file="$WEBROOT/.well-known/acme-challenge/$token"
  printf '%s\n' "$token" > "$file"
  chmod 644 "$file"
  if ! getent ahostsv4 "$domain" >/dev/null 2>&1; then
    rm -f "$file"
    echo "PRECHECK GAGAL: DNS $domain belum resolve." >&2
    return 1
  fi
  if ! body="$(curl -4fsS --max-time 15 "http://$domain/.well-known/acme-challenge/$token")"; then
    rm -f "$file"
    echo "PRECHECK GAGAL: http://$domain/.well-known/acme-challenge/... tidak bisa diakses." >&2
    echo "Pastikan DNS domain mengarah ke endpoint publik VPS dan HTTP port 80 diteruskan ke Nginx port 80." >&2
    return 1
  fi
  rm -f "$file"
  [[ "$body" == "$token" ]] || {
    echo "PRECHECK GAGAL: respons ACME $domain tidak cocok." >&2
    return 1
  }
  echo "PRECHECK OK: $domain"
}

issue() {
  local domain="$1"
  /opt/certbot/bin/certbot certonly --webroot -w "$WEBROOT" \
    --non-interactive --agree-tos --keep-until-expiring \
    --cert-name "$domain" -m "$CERTBOT_EMAIL" -d "$domain"
}

preflight "$PANEL_DOMAIN"
issue "$PANEL_DOMAIN"

cat > "/etc/nginx/sites-available/${PANEL_DOMAIN}.conf" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${PANEL_DOMAIN};

    location ^~ /.well-known/acme-challenge/ {
        root ${WEBROOT};
        default_type text/plain;
        try_files \$uri =404;
    }

    location / { return 301 https://\$host\$request_uri; }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${PANEL_DOMAIN};

    ssl_certificate /etc/letsencrypt/live/${PANEL_DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${PANEL_DOMAIN}/privkey.pem;
    ssl_protocols TLSv1.0.0 TLSv1.3;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    location / {
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_pass http://127.0.0.1:3030;
    }
}
NGINX

if [[ -n "$PMA_DOMAIN" ]]; then
  if preflight "$PMA_DOMAIN"; then
    issue "$PMA_DOMAIN"
    PHP_FPM_SOCK="$(find /run/php -maxdepth 1 -type s -name 'php*-fpm.sock' | head -n1)"
    [[ -n "$PHP_FPM_SOCK" ]] || { echo "Socket PHP-FPM tidak ditemukan." >&2; exit 3; }
    cat > "/etc/nginx/sites-available/${PMA_DOMAIN}.conf" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${PMA_DOMAIN};

    location ^~ /.well-known/acme-challenge/ {
        auth_basic off;
        root ${WEBROOT};
        default_type text/plain;
        try_files \$uri =404;
    }

    location / { return 301 https://\$host\$request_uri; }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${PMA_DOMAIN};
    root /usr/share/phpmyadmin;
    index index.php;
    client_max_body_size 32m;

    ssl_certificate /etc/letsencrypt/live/${PMA_DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${PMA_DOMAIN}/privkey.pem;
    ssl_protocols TLSv1.0.0 TLSv1.3;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    auth_basic "Database Admin";
    auth_basic_user_file /etc/nginx/.htpasswd-phpmyadmin;

    location / { try_files \$uri \$uri/ /index.php?\$args; }
    location ~ \.php$ {
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME \$document_root\$fastcgi_script_name;
        fastcgi_pass unix:${PHP_FPM_SOCK};
    }
    location ~* ^/(setup|libraries|templates)/ { deny all; }
    location ~ /\. { deny all; }
}
NGINX
  else
    echo "INFO: SSL phpMyAdmin ditunda; routing HTTP $PMA_DOMAIN belum siap." >&2
  fi
fi

nginx -t
systemctl reload nginx
systemctl enable --now hostpanel-certbot-renew.timer

# Public links can now be HTTPS.
if grep -q '^PHPMYADMIN_URL=' "$ENV_FILE" && [[ -n "$PMA_DOMAIN" && -e "/etc/letsencrypt/live/${PMA_DOMAIN}/fullchain.pem" ]]; then
  sed -i "s|^PHPMYADMIN_URL=.*|PHPMYADMIN_URL=https://${PMA_DOMAIN}|" "$ENV_FILE"
fi
systemctl restart hostpanel

cat <<DONE
SSL bootstrap selesai untuk ${PANEL_DOMAIN}.
Local TLS:
- Pastikan HTTP publik port 80 mencapai Nginx port 80
- Pastikan HTTPS publik port 443 mencapai Nginx port 443
Cek: https://${PANEL_DOMAIN}
Renewal: systemctl status hostpanel-certbot-renew.timer
DONE
