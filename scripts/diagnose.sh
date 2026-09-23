#!/usr/bin/env bash
set -uo pipefail

# Read-only diagnostic for provider-independent deployments.
# Does not change firewall, DNS, Nginx, certificates, databases, or services.

ENV_FILE=/etc/hostpanel/hostpanel.env
PASS=0; WARN=0; FAIL=0
ok(){ printf '[OK]   %s\n' "$*"; PASS=$((PASS+1)); }
warn(){ printf '[WARN] %s\n' "$*"; WARN=$((WARN+1)); }
fail(){ printf '[FAIL] %s\n' "$*"; FAIL=$((FAIL+1)); }
section(){ printf '\n== %s ==\n' "$*"; }
env_get(){ local k="$1"; [[ -r "$ENV_FILE" ]] && awk -v key="$k" 'index($0,key"=")==1{v=substr($0,length(key)+2); if(v~/^".*"$/)v=substr(v,2,length(v)-2); print v; exit}' "$ENV_FILE"; }

section "HostPanel"
if systemctl is-active --quiet hostpanel; then ok 'hostpanel.service aktif'; else fail 'hostpanel.service tidak aktif'; fi
if curl -fsS --max-time 3 http://127.0.0.1:3030/healthz >/dev/null 2>&1; then ok 'healthz 127.0.0.1:3030 sehat'; else fail 'healthz panel gagal'; fi
[[ -r "$ENV_FILE" ]] && ok "$ENV_FILE terbaca" || fail "$ENV_FILE tidak ditemukan"

PANEL_DOMAIN="$(env_get PANEL_DOMAIN)"
PMA_URL="$(env_get PHPMYADMIN_URL)"
TLS_MODE="$(env_get TLS_MODE)"; TLS_MODE="${TLS_MODE:-local}"
NETWORK_MODE="$(env_get NETWORK_MODE)"; NETWORK_MODE="${NETWORK_MODE:-$(env_get PLATFORM)}"; NETWORK_MODE="${NETWORK_MODE:-direct}"
DNS_PUBLIC="$(env_get DNS_PUBLIC)"; DNS_PUBLIC="${DNS_PUBLIC:-0}"
printf 'Network mode : %s\nTLS mode     : %s\nDNS public   : %s\n' "$NETWORK_MODE" "$TLS_MODE" "$DNS_PUBLIC"

section "Listener lokal"
for spec in 'nginx:80' 'nginx:443' 'hostpanel:3030' 'dns:53' 'mariadb:3306'; do
  name="${spec%%:*}"; port="${spec##*:}"
  if ss -lntup 2>/dev/null | grep -qE "[:.]${port}[[:space:]]"; then ok "$name mendengarkan port $port"; else
    if [[ "$port" == 443 && "$TLS_MODE" != local ]]; then warn "$name port 443 lokal tidak wajib untuk TLS_MODE=$TLS_MODE"; else warn "$name belum terlihat di port $port"; fi
  fi
done

section "Nginx"
if nginx -t >/tmp/hostpanel-nginx-test.$$ 2>&1; then ok 'nginx -t sukses'; else fail "nginx -t gagal: $(tail -n 3 /tmp/hostpanel-nginx-test.$$ | tr '\n' ' ')"; fi
rm -f /tmp/hostpanel-nginx-test.$$
[[ -n "$PANEL_DOMAIN" && -e "/etc/nginx/sites-enabled/${PANEL_DOMAIN}.conf" ]] && ok "vhost panel aktif: $PANEL_DOMAIN" || warn 'vhost panel tidak ditemukan/aktif'

section "DNS/BIND9"
if command -v named-checkconf >/dev/null && named-checkconf >/dev/null 2>&1; then ok 'named-checkconf sukses'; else fail 'named-checkconf gagal/tidak tersedia'; fi
if systemctl is-active --quiet named || systemctl is-active --quiet bind9; then ok 'BIND9/named aktif'; else warn 'BIND9/named tidak aktif'; fi
if [[ "$DNS_PUBLIC" == 1 ]]; then warn 'DNS_PUBLIC=1: pastikan TCP DAN UDP 53 juga dibuka di firewall/provider, bukan hanya UFW'; else ok 'DNS_PUBLIC=0: BIND tidak diasumsikan authoritative publik'; fi

section "Database/phpMyAdmin"
if systemctl is-active --quiet mariadb; then ok 'MariaDB aktif'; else fail 'MariaDB tidak aktif'; fi
if ss -lnt 2>/dev/null | grep -qE '127\.0\.0\.1:3306|\[::1\]:3306'; then ok 'MariaDB terikat lokal'; else warn 'Periksa bind-address MariaDB; 3306 sebaiknya tidak publik'; fi
if systemctl list-units --type=service --all 'php*-fpm.service' --no-legend 2>/dev/null | grep -q running; then ok 'PHP-FPM aktif'; else warn 'PHP-FPM tidak terlihat aktif'; fi
[[ -e /usr/share/phpmyadmin/index.php ]] && ok 'phpMyAdmin ditemukan' || warn 'phpMyAdmin tidak ditemukan di /usr/share/phpmyadmin'

section "Certbot/SSL"
if [[ -x /opt/certbot/bin/certbot ]]; then ok "$(/opt/certbot/bin/certbot --version 2>&1 | head -n1)"; else fail '/opt/certbot/bin/certbot tidak ada'; fi
if [[ "$TLS_MODE" == local ]]; then
  systemctl is-enabled --quiet hostpanel-certbot-renew.timer 2>/dev/null && ok 'timer renewal enabled' || warn 'timer renewal belum enabled'
  systemctl is-active --quiet hostpanel-certbot-renew.timer 2>/dev/null && ok 'timer renewal active' || warn 'timer renewal belum active'
fi
if [[ -n "$PANEL_DOMAIN" ]]; then
  if getent ahostsv4 "$PANEL_DOMAIN" >/dev/null 2>&1; then ok "DNS $PANEL_DOMAIN resolve dari server"; else warn "DNS $PANEL_DOMAIN belum resolve"; fi
fi

section "Firewall"
if command -v ufw >/dev/null; then ufw status | sed -n '1,20p'; else warn 'UFW tidak tersedia'; fi

section "Ringkasan"
printf 'OK=%d WARN=%d FAIL=%d\n' "$PASS" "$WARN" "$FAIL"
[[ "$FAIL" -eq 0 ]]
