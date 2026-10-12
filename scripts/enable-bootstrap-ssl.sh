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

# Wildcards require automated DNS-01. Credentials stay in a root-only INI
# file; Certbot records the authenticator and path for unattended renewal.
SSL_WILDCARD="${SSL_WILDCARD:-0}"
DNS_PROVIDER="${DNS_PROVIDER:-}"
DNS_CREDENTIALS="${DNS_CREDENTIALS:-}"
DNS_PROPAGATION_SECONDS="${DNS_PROPAGATION_SECONDS:-60}"
[[ "$SSL_WILDCARD" == 0 || "$SSL_WILDCARD" == 1 ]] || { echo "SSL_WILDCARD harus 0 atau 1." >&2; exit 2; }
if [[ "$SSL_WILDCARD" == 1 ]]; then
  [[ "$DNS_PROPAGATION_SECONDS" =~ ^[0-9]+$ ]] || { echo "DNS_PROPAGATION_SECONDS harus angka." >&2; exit 2; }
  [[ "$DNS_CREDENTIALS" == /* && -f "$DNS_CREDENTIALS" && ! -L "$DNS_CREDENTIALS" ]] || { echo "DNS_CREDENTIALS harus path absolut file INI." >&2; exit 2; }
  [[ "$(stat -c %u "$DNS_CREDENTIALS")" == 0 && "$(stat -c %a "$DNS_CREDENTIALS")" == 600 ]] || { echo "File DNS credentials harus dimiliki root dengan chmod 600." >&2; exit 2; }
  case "$DNS_PROVIDER" in
    cloudflare) DNS_ARGS=(--dns-cloudflare --dns-cloudflare-credentials "$DNS_CREDENTIALS" --dns-cloudflare-propagation-seconds "$DNS_PROPAGATION_SECONDS") ;;
    rfc2136) DNS_ARGS=(--dns-rfc2136 --dns-rfc2136-credentials "$DNS_CREDENTIALS" --dns-rfc2136-propagation-seconds "$DNS_PROPAGATION_SECONDS") ;;
    *) echo "Wildcard: pilih DNS_PROVIDER=cloudflare atau rfc2136 sesuai DNS authoritative." >&2; exit 2 ;;
  esac
fi

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

PANEL_CERT_NAME="$PANEL_DOMAIN"
PMA_CERT_NAME="$PMA_DOMAIN"
if [[ "$SSL_WILDCARD" == 1 ]]; then
  PANEL_CERT_NAME="${PANEL_DOMAIN}-wildcard"
  CERT_DOMAINS=(-d "$PANEL_DOMAIN" -d "*.$PANEL_DOMAIN")
  [[ -n "$PMA_DOMAIN" && "$PMA_DOMAIN" != "$PANEL_DOMAIN" ]] && CERT_DOMAINS+=(-d "$PMA_DOMAIN")
  /opt/certbot/bin/certbot certonly "${DNS_ARGS[@]}" \
    --non-interactive --agree-tos --keep-until-expiring \
    --cert-name "$PANEL_CERT_NAME" -m "$CERTBOT_EMAIL" "${CERT_DOMAINS[@]}"
  PMA_CERT_NAME="$PANEL_CERT_NAME"
else
  preflight "$PANEL_DOMAIN"
  issue "$PANEL_DOMAIN"
fi

# Restore both managed vhosts if validation/reload fails.
NGINX_BACKUP="$(mktemp -d)"
for domain in "$PANEL_DOMAIN" "$PMA_DOMAIN"; do
  [[ -z "$domain" ]] && continue
  [[ -f "/etc/nginx/sites-available/$domain.conf" ]] || { echo "Vhost $domain belum terpasang." >&2; rm -rf "$NGINX_BACKUP"; exit 3; }
  cp -a "/etc/nginx/sites-available/$domain.conf" "$NGINX_BACKUP/$domain.conf"
done
rollback_nginx() {
  local rc=$?
  trap - ERR
  cp -a "$NGINX_BACKUP/." /etc/nginx/sites-available/
  nginx -t && systemctl reload nginx || true
  rm -rf "$NGINX_BACKUP"
  exit "$rc"
}
trap rollback_nginx ERR

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

    ssl_certificate /etc/letsencrypt/live/${PANEL_CERT_NAME}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${PANEL_CERT_NAME}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
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
  if [[ "$SSL_WILDCARD" == 1 ]] || preflight "$PMA_DOMAIN"; then
    if [[ "$SSL_WILDCARD" == 0 ]]; then issue "$PMA_DOMAIN"; fi
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

    ssl_certificate /etc/letsencrypt/live/${PMA_CERT_NAME}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${PMA_CERT_NAME}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
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
trap - ERR
rm -rf "$NGINX_BACKUP"
systemctl enable --now hostpanel-certbot-renew.timer

# Public links can now be HTTPS.
if grep -q '^PHPMYADMIN_URL=' "$ENV_FILE" && [[ -n "$PMA_DOMAIN" && -e "/etc/letsencrypt/live/${PMA_CERT_NAME}/fullchain.pem" ]]; then
  sed -i "s|^PHPMYADMIN_URL=.*|PHPMYADMIN_URL=https://${PMA_DOMAIN}|" "$ENV_FILE"
fi
sed -i "s|^PANEL_PUBLIC_URL=.*|PANEL_PUBLIC_URL=https://${PANEL_DOMAIN}|" "$ENV_FILE"
systemctl restart hostpanel

cat <<DONE
SSL bootstrap selesai untuk ${PANEL_DOMAIN}.
Local TLS:
- Pastikan HTTP publik port 80 mencapai Nginx port 80
- Pastikan HTTPS publik port 443 mencapai Nginx port 443
Cek: https://${PANEL_DOMAIN}
Renewal: systemctl status hostpanel-certbot-renew.timer
DONE
