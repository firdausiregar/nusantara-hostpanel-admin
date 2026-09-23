#!/usr/bin/env bash
set -Eeuo pipefail

# Nusantara Host Panel universal installer/repair tool.
# The same script is intentionally used for a fresh installation and an
# existing installation. Existing state under /etc/hostpanel,
# /var/lib/hostpanel, /etc/letsencrypt, /etc/nginx and /nusantara-hostpanel/apps is preserved.

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Jalankan sebagai root: sudo -E bash scripts/install.sh" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE=/etc/hostpanel/hostpanel.env
AGENT_FILE=/etc/hostpanel/agent.json
EXISTING=0
[[ -f "$ENV_FILE" && -d /opt/hostpanel ]] && EXISTING=1

exec 9>/run/hostpanel-install.lock
flock -n 9 || { echo "Installer HostPanel lain sedang berjalan." >&2; exit 1; }

STAGE_DIR=""
PREVIOUS_CODE=""
CODE_COMMITTED=0
TMP_NODE=""
cleanup_install() {
  [[ -n "${STAGE_DIR:-}" && -d "${STAGE_DIR:-}" ]] && rm -rf "$STAGE_DIR" || true
  [[ -n "${TMP_NODE:-}" && -d "${TMP_NODE:-}" ]] && rm -rf "$TMP_NODE" || true
}
rollback_install() {
  local rc=$?
  set +e
  if [[ "${CODE_COMMITTED:-0}" == 1 && -n "${PREVIOUS_CODE:-}" && -d "$PREVIOUS_CODE" ]]; then
    echo "[HostPanel] Install gagal setelah code swap; mengembalikan source sebelumnya..." >&2
    systemctl stop hostpanel 2>/dev/null || true
    rm -rf /opt/hostpanel.failed
    [[ -d /opt/hostpanel ]] && mv /opt/hostpanel /opt/hostpanel.failed
    mv "$PREVIOUS_CODE" /opt/hostpanel
    systemctl daemon-reload 2>/dev/null || true
    systemctl restart hostpanel 2>/dev/null || true
  fi
  cleanup_install
  exit "$rc"
}
trap cleanup_install EXIT
trap rollback_install ERR

# Release assets are prebuilt and must exist before touching the active install.
CSS_BUNDLE="$ROOT_DIR/public/css/app.css"
if [[ ! -s "$CSS_BUNDLE" ]] || [[ $(wc -c < "$CSS_BUNDLE") -lt 4096 ]]; then
  echo "Release tidak valid: public/css/app.css hilang/terlalu kecil. Instalasi dibatalkan sebelum /opt/hostpanel diubah." >&2
  exit 2
fi
if ! grep -q "\.btn-primary" "$CSS_BUNDLE"; then
  echo "Release tidak valid: CSS bundle tidak berisi komponen HostPanel." >&2
  exit 2
fi

if [[ ! -r /etc/os-release ]]; then
  echo "Tidak dapat mendeteksi sistem operasi." >&2
  exit 2
fi
. /etc/os-release
OS_ID="${ID:-unknown}"
OS_LIKE="${ID_LIKE:-}"
OS_VERSION="${VERSION_ID:-unknown}"

case "$OS_ID" in
  debian|ubuntu) : ;;
  *)
    if [[ " $OS_LIKE " != *" debian "* ]]; then
      echo "OS belum didukung otomatis: ${PRETTY_NAME:-$OS_ID}." >&2
      echo "Rilis ini mendukung VPS provider apa pun yang menjalankan Debian 12/13 atau Ubuntu 22.04/24.04+ dengan systemd." >&2
      exit 2
    fi
    ;;
esac

export DEBIAN_FRONTEND=noninteractive

# Read dotenv safely; never source it as shell code.
env_get() {
  local key="$1" file="${2:-$ENV_FILE}"
  [[ -r "$file" ]] || return 0
  awk -v key="$key" 'index($0, key "=") == 1 { value=substr($0,length(key)+2); sub(/\r$/, "", value); if (value ~ /^".*"$/ || value ~ /^\047.*\047$/) value=substr(value,2,length(value)-2); print value; exit }' "$file"
}

json_get() {
  local key="$1"
  [[ -r "$AGENT_FILE" ]] || return 0
  python3 - "$AGENT_FILE" "$key" <<'PY' 2>/dev/null || true
import json,sys
try:
    data=json.load(open(sys.argv[1]))
    value=data.get(sys.argv[2],"")
    if isinstance(value,list): print(" ".join(map(str,value)))
    elif value is not None: print(value)
except Exception:
    pass
PY
}

prompt_value() {
  local var="$1" label="$2" default="${3:-}" secret="${4:-0}" value="${!var:-}"
  [[ -n "$value" ]] && return 0
  if [[ -t 0 ]]; then
    if [[ "$secret" == 1 ]]; then
      read -r -s -p "$label${default:+ [$default]}: " value; echo
    else
      read -r -p "$label${default:+ [$default]}: " value
    fi
    value="${value:-$default}"
    printf -v "$var" '%s' "$value"
  elif [[ -n "$default" ]]; then
    printf -v "$var" '%s' "$default"
  fi
}

# Install generic dependencies before network autodetection helpers are used.
apt-get update
if [[ "$OS_ID" == ubuntu ]]; then
  apt-get install -y --no-install-recommends software-properties-common >/dev/null 2>&1 || true
  add-apt-repository -y universe >/dev/null 2>&1 || true
  apt-get update
fi
apt-get install -y --no-install-recommends \
  ca-certificates curl xz-utils openssl sudo rsync build-essential python3 python3-venv \
  nginx bind9 bind9-utils dnsutils mariadb-server mariadb-client \
  php-fpm php-cli php-mysql php-mbstring php-zip php-gd php-curl php-xml phpmyadmin \
  apache2-utils ufw fail2ban unattended-upgrades git iproute2 procps rclone

# Existing values win unless the operator explicitly overrides them.
PANEL_DOMAIN="${PANEL_DOMAIN:-$(env_get PANEL_DOMAIN)}"
PMA_EXISTING_URL="$(env_get PHPMYADMIN_URL)"
PMA_EXISTING_DOMAIN=""
if [[ -n "$PMA_EXISTING_URL" ]]; then
  PMA_EXISTING_DOMAIN="${PMA_EXISTING_URL#*://}"; PMA_EXISTING_DOMAIN="${PMA_EXISTING_DOMAIN%%/*}"
fi
PMA_DOMAIN="${PMA_DOMAIN:-$PMA_EXISTING_DOMAIN}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-$(env_get CERTBOT_EMAIL)}"
TLS_MODE="${TLS_MODE:-$(env_get TLS_MODE)}"
TLS_MODE="${TLS_MODE:-local}"
TRUST_PROXY="${TRUST_PROXY:-$(env_get TRUST_PROXY)}"
TRUST_PROXY="${TRUST_PROXY:-1}"
NETWORK_MODE="${NETWORK_MODE:-${PLATFORM:-$(env_get NETWORK_MODE)}}"
[[ -z "$NETWORK_MODE" ]] && NETWORK_MODE="$(env_get PLATFORM)"
[[ "$NETWORK_MODE" == helipod ]] && NETWORK_MODE=nat
NETWORK_MODE="${NETWORK_MODE:-auto}"
DNS_PUBLIC="${DNS_PUBLIC:-$(env_get DNS_PUBLIC)}"
DNS_PUBLIC="${DNS_PUBLIC:-auto}"
AUTO_SSL="${AUTO_SSL:-auto}"
NODE_VERSION="${NODE_VERSION:-24.21.0}"
SSH_PORT="${SSH_PORT:-22}"
NS1="${NS1:-}"
NS2="${NS2:-}"
SECONDARY_DNS_IP="${SECONDARY_DNS_IP:-}"
PANEL_NAME="${PANEL_NAME:-$(env_get PANEL_NAME)}"
PANEL_NAME="${PANEL_NAME:-Nusantara HostPanel}"
SERVER_IPV4="${SERVER_IPV4:-$(json_get serverIPv4)}"

if [[ -z "$NS1" && -r "$AGENT_FILE" ]]; then
  NS1="$(python3 - "$AGENT_FILE" <<'PY' 2>/dev/null || true
import json,sys
try:
 d=json.load(open(sys.argv[1])); print((d.get('nameservers') or [''])[0])
except Exception: pass
PY
)"
fi
if [[ -z "$NS2" && -r "$AGENT_FILE" ]]; then
  NS2="$(python3 - "$AGENT_FILE" <<'PY' 2>/dev/null || true
import json,sys
try:
 d=json.load(open(sys.argv[1])); a=d.get('nameservers') or []; print(a[1] if len(a)>1 else '')
except Exception: pass
PY
)"
fi

if [[ "$EXISTING" == 0 ]]; then
  prompt_value PANEL_DOMAIN "Domain panel (contoh panel.example.com)"
  prompt_value PMA_DOMAIN "Domain phpMyAdmin" "${PANEL_DOMAIN:+db.$PANEL_DOMAIN}"
  prompt_value CERTBOT_EMAIL "Email Let's Encrypt"
  prompt_value NS1 "Nameserver utama (contoh ns1.example.com)"
  prompt_value NS2 "Nameserver kedua (opsional)"
fi
[[ -z "$PMA_DOMAIN" && -n "$PANEL_DOMAIN" ]] && PMA_DOMAIN="db.${PANEL_DOMAIN}"

# Detect local/public IPv4 if no explicit server IP is present.
LOCAL_IPV4="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}')"
if [[ -z "$SERVER_IPV4" ]]; then
  SERVER_IPV4="$(curl -4fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
fi
SERVER_IPV4="${SERVER_IPV4:-$LOCAL_IPV4}"

if [[ "$NETWORK_MODE" == auto ]]; then
  NETWORK_MODE="$(python3 - "$LOCAL_IPV4" "$SERVER_IPV4" <<'PY'
import ipaddress,sys
local,public=sys.argv[1:]
try:
    ip=ipaddress.ip_address(local)
    private=ip.is_private or ip.is_loopback or ip.is_link_local or str(ip).startswith('100.')
except Exception:
    private=True
print('nat' if private or (local and public and local != public) else 'direct')
PY
)"
fi
if [[ "$DNS_PUBLIC" == auto ]]; then
  [[ "$NETWORK_MODE" == direct ]] && DNS_PUBLIC=1 || DNS_PUBLIC=0
fi
if [[ "$AUTO_SSL" == auto ]]; then
  if [[ "$TLS_MODE" == local && "$NETWORK_MODE" == direct ]]; then AUTO_SSL=1; else AUTO_SSL=0; fi
fi

for required in PANEL_DOMAIN SERVER_IPV4; do
  if [[ -z "${!required}" ]]; then echo "$required wajib diisi pada instalasi baru." >&2; exit 2; fi
done
if [[ "$EXISTING" == 0 && -z "$NS1" ]]; then echo "NS1 wajib diisi pada instalasi baru." >&2; exit 2; fi

python3 - "$PANEL_DOMAIN" "$PMA_DOMAIN" "$NS1" "$NS2" "$SERVER_IPV4" "$CERTBOT_EMAIL" "$SSH_PORT" "$NETWORK_MODE" "$TLS_MODE" "$DNS_PUBLIC" <<'PYVALID'
import ipaddress,re,sys
panel,pma,ns1,ns2,ip,email,ssh_port,network,tls,dns_public=sys.argv[1:]
domain_re=re.compile(r'^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$',re.I)
for label,value,optional in [('PANEL_DOMAIN',panel,False),('PMA_DOMAIN',pma,True),('NS1',ns1,True),('NS2',ns2,True)]:
    if optional and not value: continue
    if not domain_re.fullmatch(value.rstrip('.')): raise SystemExit(f'{label} tidak valid: {value!r}')
try:
    if ipaddress.ip_address(ip).version != 4: raise ValueError
except ValueError: raise SystemExit('SERVER_IPV4 harus IPv4 valid.')
if email and not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',email): raise SystemExit('CERTBOT_EMAIL tidak valid.')
try:
    p=int(ssh_port)
    if not 1 <= p <= 65535: raise ValueError
except ValueError: raise SystemExit('SSH_PORT tidak valid.')
if network not in {'direct','nat','proxy'}: raise SystemExit('NETWORK_MODE harus direct, nat, proxy, atau auto.')
if tls not in {'local','edge','off'}: raise SystemExit('TLS_MODE harus local, edge, atau off.')
if dns_public not in {'0','1'}: raise SystemExit('DNS_PUBLIC harus 0, 1, atau auto.')
PYVALID

# Backup only HostPanel-managed state when repairing an existing installation.
if [[ "$EXISTING" == 1 ]]; then
  stamp="$(date +%Y%m%d-%H%M%S)"
  BACKUP_DIR="/root/hostpanel-install-backup/$stamp"
  mkdir -p "$BACKUP_DIR"
  cp -a /etc/hostpanel "$BACKUP_DIR/" 2>/dev/null || true
  cp -a /var/lib/hostpanel/hostpanel.sqlite "$BACKUP_DIR/" 2>/dev/null || true
  cp -a /etc/systemd/system/hostpanel.service "$BACKUP_DIR/" 2>/dev/null || true
else
  BACKUP_DIR=""
fi

# Modern isolated Certbot; all UI/CLI/renewal paths point to the same binary.
if [[ ! -x /opt/certbot/bin/python ]]; then python3 -m venv /opt/certbot; fi
/opt/certbot/bin/pip install --upgrade pip >/dev/null
/opt/certbot/bin/pip install --upgrade 'certbot>=3.2,<7' 'certbot-nginx>=3.2,<7' 'certbot-dns-cloudflare>=3.2,<7' 'certbot-dns-rfc2136>=3.2,<7'
ln -sfn /opt/certbot/bin/certbot /usr/local/bin/certbot

# Official Node.js binary with checksum verification; architecture-independent for x64/arm64.
case "$(dpkg --print-architecture)" in
  amd64) NODE_ARCH=x64 ;;
  arm64) NODE_ARCH=arm64 ;;
  *) echo "Arsitektur CPU belum didukung otomatis: $(dpkg --print-architecture)" >&2; exit 3 ;;
esac
if [[ ! -x "/opt/node-v${NODE_VERSION}/bin/node" ]]; then
  TMP_NODE="$(mktemp -d)"
  pushd "$TMP_NODE" >/dev/null
  curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
  curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"
  grep " node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz$" SHASUMS256.txt | sha256sum -c -
  mkdir -p "/opt/node-v${NODE_VERSION}"
  tar -xJf "node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" --strip-components=1 -C "/opt/node-v${NODE_VERSION}"
  popd >/dev/null
fi
for bin in node npm npx corepack; do ln -sfn "/opt/node-v${NODE_VERSION}/bin/$bin" "/usr/local/bin/$bin"; done

id -u hostpanel >/dev/null 2>&1 || useradd --system --home /var/lib/hostpanel --shell /usr/sbin/nologin hostpanel
id -u hostapps >/dev/null 2>&1 || useradd --system --home /nusantara-hostpanel/apps --shell /usr/sbin/nologin hostapps
mkdir -p /var/lib/hostpanel /nusantara-hostpanel/apps /etc/hostpanel/{apps,zones}
chown hostpanel:hostpanel /var/lib/hostpanel
chown root:hostapps /etc/hostpanel/apps
chmod 750 /var/lib/hostpanel /etc/hostpanel /etc/hostpanel/apps

# Build the new control-plane code in a staging directory first. The active
# /opt/hostpanel tree is not touched until dependencies and release assets pass.
STAGE_DIR="/opt/.hostpanel-stage-$$"
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"
rsync -a --delete --exclude node_modules --exclude data --exclude .git --exclude .env --exclude .env.local "$ROOT_DIR/" "$STAGE_DIR/"
cd "$STAGE_DIR"
# Production serves prebuilt CSS committed in the release. Tailwind is only a
# development/release dependency, so a compiler outage cannot break a VPS.
echo "[HostPanel] Installing production Node dependencies in staging..."
export npm_config_progress=false
export npm_config_audit=false
export npm_config_fund=false
export npm_config_fetch_retries=2
export npm_config_fetch_retry_mintimeout=1000
export npm_config_fetch_retry_maxtimeout=10000
NPM_ARGS=(--omit=dev --no-audit --no-fund --progress=false --loglevel=notice)
if [[ -f package-lock.json ]]; then
  timeout --foreground 900 /usr/local/bin/npm ci "${NPM_ARGS[@]}"
else
  timeout --foreground 900 /usr/local/bin/npm install "${NPM_ARGS[@]}"
fi
echo "[HostPanel] Node dependencies installed in staging."
test -s "$STAGE_DIR/public/css/app.css"
test -s "$STAGE_DIR/public/css/hostpanel-ui.css"
grep -q '\.btn-primary' "$STAGE_DIR/public/css/app.css"
node --check "$STAGE_DIR/src/app.js"
chown -R root:hostpanel "$STAGE_DIR"
find "$STAGE_DIR" -type d -exec chmod 750 {} +
find "$STAGE_DIR" -type f -exec chmod 640 {} +
chmod 750 "$STAGE_DIR"/scripts/*.sh "$STAGE_DIR"/scripts/hostpanelctl.js

# Commit code atomically on the same filesystem. Keep the previous tree until
# the complete install + health check succeeds so ERR trap can roll it back.
PREVIOUS_CODE="/opt/.hostpanel-previous-$(date +%Y%m%d-%H%M%S)-$$"
if [[ -d /opt/hostpanel ]]; then mv /opt/hostpanel "$PREVIOUS_CODE"; else PREVIOUS_CODE=""; fi
mv "$STAGE_DIR" /opt/hostpanel
STAGE_DIR=""
CODE_COMMITTED=1
cd /opt/hostpanel

# Preserve the existing session secret and public URLs on reinstall.
SESSION_SECRET="$(env_get SESSION_SECRET)"
SESSION_SECRET="${SESSION_SECRET:-$(openssl rand -hex 48)}"
# Vault key is independent from the session secret on fresh installs. On an
# existing pre-v1 install without HOSTPANEL_MASTER_KEY we deliberately seed it
# from the old session secret so ciphertext produced by the legacy fallback
# remains decryptable after migration.
HOSTPANEL_MASTER_KEY="$(env_get HOSTPANEL_MASTER_KEY)"
if [[ -z "$HOSTPANEL_MASTER_KEY" ]]; then
  if [[ "$EXISTING" == 1 ]]; then HOSTPANEL_MASTER_KEY="$SESSION_SECRET"; else HOSTPANEL_MASTER_KEY="$(openssl rand -hex 32)"; fi
fi
PANEL_SCHEME=http
[[ "$TLS_MODE" != off ]] && PANEL_SCHEME=https
if [[ "$EXISTING" == 1 ]]; then
  old_pma="$(env_get PHPMYADMIN_URL)"
  [[ "$old_pma" == https://* ]] && PANEL_SCHEME=https
fi
PMA_URL="${PMA_EXISTING_URL:-${PANEL_SCHEME}://${PMA_DOMAIN}}"
GITHUB_CLIENT_ID="${GITHUB_CLIENT_ID:-$(env_get GITHUB_CLIENT_ID)}"
GITHUB_CLIENT_SECRET="${GITHUB_CLIENT_SECRET:-$(env_get GITHUB_CLIENT_SECRET)}"
GITHUB_CALLBACK_URL="${GITHUB_CALLBACK_URL:-$(env_get GITHUB_CALLBACK_URL)}"
GITHUB_OAUTH_SCOPE="${GITHUB_OAUTH_SCOPE:-$(env_get GITHUB_OAUTH_SCOPE)}"
GITHUB_OAUTH_SCOPE="${GITHUB_OAUTH_SCOPE:-read:user user:email}"
GITHUB_APP_ID="${GITHUB_APP_ID:-$(env_get GITHUB_APP_ID)}"
GITHUB_APP_SLUG="${GITHUB_APP_SLUG:-$(env_get GITHUB_APP_SLUG)}"
GITHUB_APP_PRIVATE_KEY_PATH="${GITHUB_APP_PRIVATE_KEY_PATH:-$(env_get GITHUB_APP_PRIVATE_KEY_PATH)}"
GITHUB_APP_SETUP_URL="${GITHUB_APP_SETUP_URL:-$(env_get GITHUB_APP_SETUP_URL)}"
MIDTRANS_ENV="${MIDTRANS_ENV:-$(env_get MIDTRANS_ENV)}"
MIDTRANS_ENV="${MIDTRANS_ENV:-sandbox}"
MIDTRANS_SERVER_KEY="${MIDTRANS_SERVER_KEY:-$(env_get MIDTRANS_SERVER_KEY)}"
MIDTRANS_CLIENT_KEY="${MIDTRANS_CLIENT_KEY:-$(env_get MIDTRANS_CLIENT_KEY)}"
MIDTRANS_MERCHANT_ID="${MIDTRANS_MERCHANT_ID:-$(env_get MIDTRANS_MERCHANT_ID)}"
MIDTRANS_RECURRING="${MIDTRANS_RECURRING:-$(env_get MIDTRANS_RECURRING)}"
MIDTRANS_RECURRING="${MIDTRANS_RECURRING:-0}"
PANEL_PUBLIC_URL="${PANEL_PUBLIC_URL:-$(env_get PANEL_PUBLIC_URL)}"
PANEL_PUBLIC_URL="${PANEL_PUBLIC_URL:-${PANEL_SCHEME}://${PANEL_DOMAIN}}"
DOCS_URL="${DOCS_URL:-$(env_get DOCS_URL)}"
DOCS_URL="${DOCS_URL:-https://firdausiregar.github.io/nusantara-hostpanel-admin/}"

cat > "$ENV_FILE" <<ENV
NODE_ENV=production
PORT=3030
TRUST_PROXY=${TRUST_PROXY}
SESSION_SECRET=${SESSION_SECRET}
HOSTPANEL_MASTER_KEY=${HOSTPANEL_MASTER_KEY}
DATA_DIR=/var/lib/hostpanel
HOSTPANEL_CTL=/usr/local/sbin/hostpanelctl
PANEL_NAME="${PANEL_NAME}"
PANEL_DOMAIN=${PANEL_DOMAIN}
PHPMYADMIN_URL=${PMA_URL}
CERTBOT_EMAIL=${CERTBOT_EMAIL}
NETWORK_MODE=${NETWORK_MODE}
PLATFORM=${NETWORK_MODE}
TLS_MODE=${TLS_MODE}
DNS_PUBLIC=${DNS_PUBLIC}
GITHUB_CLIENT_ID=${GITHUB_CLIENT_ID}
GITHUB_CLIENT_SECRET=${GITHUB_CLIENT_SECRET}
GITHUB_CALLBACK_URL=${GITHUB_CALLBACK_URL}
GITHUB_OAUTH_SCOPE="${GITHUB_OAUTH_SCOPE}"
GITHUB_APP_ID=${GITHUB_APP_ID}
GITHUB_APP_SLUG=${GITHUB_APP_SLUG}
GITHUB_APP_PRIVATE_KEY_PATH=${GITHUB_APP_PRIVATE_KEY_PATH}
GITHUB_APP_SETUP_URL=${GITHUB_APP_SETUP_URL}
MIDTRANS_ENV=${MIDTRANS_ENV}
MIDTRANS_SERVER_KEY=${MIDTRANS_SERVER_KEY}
MIDTRANS_CLIENT_KEY=${MIDTRANS_CLIENT_KEY}
MIDTRANS_MERCHANT_ID=${MIDTRANS_MERCHANT_ID}
MIDTRANS_RECURRING=${MIDTRANS_RECURRING}
PANEL_PUBLIC_URL=${PANEL_PUBLIC_URL}
DOCS_URL=${DOCS_URL}
ENV
chmod 640 "$ENV_FILE"
chown root:hostpanel "$ENV_FILE"

python3 - "$NS1" "$NS2" "$SECONDARY_DNS_IP" "$SERVER_IPV4" "$NETWORK_MODE" "$DNS_PUBLIC" <<'PYAGENT'
import ipaddress,json,sys,os
ns1,ns2,secondary,server_ip,network,dns_public=sys.argv[1:]
secondary_ips=[]
if secondary:
    try: secondary_ips=[str(ipaddress.ip_address(secondary))]
    except ValueError: raise SystemExit('SECONDARY_DNS_IP tidak valid.')
current={}
try: current=json.load(open('/etc/hostpanel/agent.json'))
except Exception: pass
names=[x for x in [ns1,ns2] if x] or current.get('nameservers',[])
data={**current,'nameservers':names,'serverIPv4':server_ip,'secondaryIPs':secondary_ips or current.get('secondaryIPs',[]),'networkMode':network,'platform':network,'dnsPublic':dns_public=='1'}
with open('/etc/hostpanel/agent.json','w') as f: json.dump(data,f,indent=2)
PYAGENT
chmod 640 "$AGENT_FILE"
chown root:hostpanel "$AGENT_FILE"

install -o root -g root -m 0755 /opt/hostpanel/scripts/hostpanelctl.js /usr/local/sbin/hostpanelctl
install -o root -g root -m 0440 /opt/hostpanel/deploy/hostpanel.sudoers /etc/sudoers.d/hostpanel
visudo -cf /etc/sudoers.d/hostpanel

# BIND: preserve an existing administrator configuration. Fresh installs receive
# authoritative-only defaults. HostPanel zones are always isolated in one include.
mkdir -p /var/lib/bind/hostpanel
chown bind:bind /var/lib/bind/hostpanel
chmod 750 /var/lib/bind/hostpanel
touch /etc/bind/hostpanel-zones.conf
chmod 644 /etc/bind/hostpanel-zones.conf
if ! grep -q 'hostpanel-zones.conf' /etc/bind/named.conf.local; then
  printf '\ninclude "/etc/bind/hostpanel-zones.conf";\n' >> /etc/bind/named.conf.local
fi
if [[ "$EXISTING" == 0 ]]; then
  cp -an /etc/bind/named.conf.options /etc/bind/named.conf.options.before-hostpanel || true
  cat > /etc/bind/named.conf.options <<'BINDOPT'
options {
    directory "/var/cache/bind";
    recursion no;
    allow-recursion { none; };
    allow-query-cache { none; };
    allow-query { any; };
    listen-on { any; };
    listen-on-v6 { any; };
    minimal-responses yes;
    version "not disclosed";
};
BINDOPT
fi
named-checkconf
BIND_SERVICE=named
systemctl cat named.service >/dev/null 2>&1 || BIND_SERVICE=bind9
systemctl enable --now "$BIND_SERVICE"
systemctl reload "$BIND_SERVICE" 2>/dev/null || systemctl restart "$BIND_SERVICE"

# MariaDB security without exposing 3306 publicly.
systemctl enable --now mariadb
MARIADB_DROPIN=/etc/mysql/mariadb.conf.d/60-hostpanel-security.cnf
mkdir -p "$(dirname "$MARIADB_DROPIN")"
cat > "$MARIADB_DROPIN" <<'MARIADBSEC'
[mysqld]
bind-address = 127.0.0.1
local_infile = 0
MARIADBSEC
chmod 644 "$MARIADB_DROPIN"
systemctl restart mariadb

DB_ADMIN_USER="${DB_ADMIN_USER:-hostdbadmin}"
DB_ADMIN_PASS_INPUT="${DB_ADMIN_PASS:-}"
if [[ -r /etc/hostpanel/credentials.json ]]; then
  DB_ADMIN_USER="$(python3 - <<'PY' 2>/dev/null || echo hostdbadmin
import json
try: print(json.load(open('/etc/hostpanel/credentials.json')).get('dbAdminUser','hostdbadmin'))
except Exception: print('hostdbadmin')
PY
)"
elif [[ -r /root/hostpanel-credentials.txt ]]; then
  LEGACY_DB_USER="$(sed -n 's/^MariaDB admin user:[[:space:]]*//p' /root/hostpanel-credentials.txt | tail -n1)"
  [[ "$LEGACY_DB_USER" =~ ^[a-zA-Z0-9_]{3,32}$ ]] && DB_ADMIN_USER="$LEGACY_DB_USER"
fi
[[ "$DB_ADMIN_USER" =~ ^[a-zA-Z0-9_]{3,32}$ ]] || DB_ADMIN_USER=hostdbadmin
DB_ADMIN_PASS=""
PMA_BASIC_PASS=""
if [[ "$EXISTING" == 0 ]]; then
  DB_ADMIN_PASS="${DB_ADMIN_PASS_INPUT:-$(openssl rand -hex 24)}"
  mariadb --protocol=socket -uroot <<SQL
CREATE USER IF NOT EXISTS '${DB_ADMIN_USER}'@'localhost' IDENTIFIED BY '${DB_ADMIN_PASS}';
ALTER USER '${DB_ADMIN_USER}'@'localhost' IDENTIFIED BY '${DB_ADMIN_PASS}';
GRANT ALL PRIVILEGES ON *.* TO '${DB_ADMIN_USER}'@'localhost' WITH GRANT OPTION;
FLUSH PRIVILEGES;
SQL
  cat > /etc/hostpanel/credentials.json <<JSON
{"dbAdminUser":"${DB_ADMIN_USER}","pmaBasicUser":"pmaadmin"}
JSON
else
  [[ -f /etc/hostpanel/credentials.json ]] || printf '{"dbAdminUser":"%s","pmaBasicUser":"pmaadmin"}\n' "$DB_ADMIN_USER" > /etc/hostpanel/credentials.json
fi
chown root:hostpanel /etc/hostpanel/credentials.json
chmod 640 /etc/hostpanel/credentials.json

PHP_FPM_SERVICE="$(systemctl list-unit-files --type=service --no-legend 'php*-fpm.service' | awk 'NR==1{gsub(/\.service$/, "", $1); print $1}')"
[[ -n "$PHP_FPM_SERVICE" ]] || { echo "PHP-FPM service tidak ditemukan." >&2; exit 4; }
systemctl enable --now "$PHP_FPM_SERVICE"
PHP_FPM_SOCK="$(find /run/php -maxdepth 1 -type s -name 'php*-fpm.sock' | head -n1)"
[[ -n "$PHP_FPM_SOCK" ]] || { echo "Socket PHP-FPM tidak ditemukan." >&2; exit 4; }

mkdir -p /var/www/letsencrypt/.well-known/acme-challenge /etc/letsencrypt/renewal-hooks/deploy
chown -R www-data:www-data /var/www/letsencrypt
chmod -R 755 /var/www/letsencrypt
cat > /etc/letsencrypt/renewal-hooks/deploy/20-hostpanel-reload-nginx <<'HOOK'
#!/bin/sh
set -eu
if ! output=$(/usr/sbin/nginx -t 2>&1); then printf '%s\n' "$output" >&2; exit 1; fi
/usr/bin/systemctl reload nginx
HOOK
chmod 755 /etc/letsencrypt/renewal-hooks/deploy/20-hostpanel-reload-nginx

cat > /etc/nginx/conf.d/hostpanel-forwarded-proto.conf <<'NGINX_MAP'
map $http_x_forwarded_proto $hostpanel_forwarded_proto {
    default $http_x_forwarded_proto;
    ""      $scheme;
}
NGINX_MAP
FORWARDED_PROTO='$scheme'
[[ "$TLS_MODE" == edge ]] && FORWARDED_PROTO='$hostpanel_forwarded_proto'

# Keep existing system vhosts on repair. Create them only when missing.
if [[ ! -f "/etc/nginx/sites-available/${PANEL_DOMAIN}.conf" ]]; then
cat > "/etc/nginx/sites-available/${PANEL_DOMAIN}.conf" <<NGINX_PANEL
server {
    listen 80;
    listen [::]:80;
    server_name ${PANEL_DOMAIN};
    location ^~ /.well-known/acme-challenge/ { root /var/www/letsencrypt; default_type text/plain; try_files \$uri =404; }
    location / {
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto ${FORWARDED_PROTO};
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_pass http://127.0.0.1:3030;
    }
}
NGINX_PANEL
fi
ln -sfn "/etc/nginx/sites-available/${PANEL_DOMAIN}.conf" "/etc/nginx/sites-enabled/${PANEL_DOMAIN}.conf"

if [[ ! -f /etc/nginx/.htpasswd-phpmyadmin ]]; then
  PMA_BASIC_PASS="$(openssl rand -hex 24)"
  printf '%s\n' "$PMA_BASIC_PASS" | htpasswd -i -B -C 12 -c /etc/nginx/.htpasswd-phpmyadmin pmaadmin >/dev/null
fi
chown root:www-data /etc/nginx/.htpasswd-phpmyadmin
chmod 640 /etc/nginx/.htpasswd-phpmyadmin

if [[ -n "$PMA_DOMAIN" && ! -f "/etc/nginx/sites-available/${PMA_DOMAIN}.conf" ]]; then
cat > "/etc/nginx/sites-available/${PMA_DOMAIN}.conf" <<NGINX_PMA
server {
    listen 80;
    listen [::]:80;
    server_name ${PMA_DOMAIN};
    root /usr/share/phpmyadmin;
    index index.php;
    client_max_body_size 32m;
    auth_basic "Database Admin";
    auth_basic_user_file /etc/nginx/.htpasswd-phpmyadmin;
    location ^~ /.well-known/acme-challenge/ { auth_basic off; root /var/www/letsencrypt; default_type text/plain; try_files \$uri =404; }
    location / { try_files \$uri \$uri/ /index.php?\$args; }
    location ~ \.php$ { include fastcgi_params; fastcgi_param SCRIPT_FILENAME \$document_root\$fastcgi_script_name; fastcgi_pass unix:${PHP_FPM_SOCK}; }
    location ~* ^/(setup|libraries|templates)/ { deny all; }
    location ~ /\. { deny all; }
}
NGINX_PMA
fi
[[ -n "$PMA_DOMAIN" ]] && ln -sfn "/etc/nginx/sites-available/${PMA_DOMAIN}.conf" "/etc/nginx/sites-enabled/${PMA_DOMAIN}.conf"
[[ "$EXISTING" == 0 ]] && rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx

install -o root -g root -m 0644 /opt/hostpanel/deploy/hostpanel.service /etc/systemd/system/hostpanel.service
install -o root -g root -m 0644 /opt/hostpanel/deploy/hostpanel-backup.service /etc/systemd/system/hostpanel-backup.service
install -o root -g root -m 0644 /opt/hostpanel/deploy/hostpanel-backup.timer /etc/systemd/system/hostpanel-backup.timer
if [[ "$TLS_MODE" == local ]]; then
  install -o root -g root -m 0644 /opt/hostpanel/deploy/hostpanel-certbot-renew.service /etc/systemd/system/hostpanel-certbot-renew.service
  install -o root -g root -m 0644 /opt/hostpanel/deploy/hostpanel-certbot-renew.timer /etc/systemd/system/hostpanel-certbot-renew.timer
  systemctl disable --now certbot.timer 2>/dev/null || true
fi
systemctl daemon-reload
systemctl enable --now hostpanel hostpanel-backup.timer
[[ "$TLS_MODE" == local ]] && systemctl enable --now hostpanel-certbot-renew.timer

# Firewall management is additive; never reset provider/user firewall policy.
MANAGE_FIREWALL="${MANAGE_FIREWALL:-1}"
if [[ "$MANAGE_FIREWALL" == 1 ]]; then
  declare -A SSH_PORTS=(); SSH_PORTS["$SSH_PORT"]=1
  if [[ -n "${SSH_CONNECTION:-}" ]]; then ACTIVE_SSH_PORT="${SSH_CONNECTION##* }"; [[ "$ACTIVE_SSH_PORT" =~ ^[0-9]+$ ]] && SSH_PORTS["$ACTIVE_SSH_PORT"]=1; fi
  while read -r P; do [[ "$P" =~ ^[0-9]+$ ]] && SSH_PORTS["$P"]=1; done < <(/usr/sbin/sshd -T 2>/dev/null | awk '$1=="port"{print $2}' || true)
  for P in "${!SSH_PORTS[@]}"; do ufw allow "${P}/tcp"; done
  ufw allow 80/tcp; ufw allow 443/tcp
  if [[ "$DNS_PUBLIC" == 1 ]]; then ufw allow 53/tcp; ufw allow 53/udp; fi
  ufw --force enable
fi
systemctl enable --now fail2ban
systemctl enable --now unattended-upgrades 2>/dev/null || true

# Issue bootstrap certificates only after the public HTTP route is actually ready.
if [[ "$TLS_MODE" == local && "$AUTO_SSL" == 1 ]]; then
  if /opt/hostpanel/scripts/enable-bootstrap-ssl.sh; then
    PANEL_SCHEME=https
  else
    echo "INFO: Auto SSL ditunda. Panel tetap aktif melalui HTTP sampai DNS/routing port 80 siap." >&2
  fi
elif [[ "$TLS_MODE" == edge ]]; then
  PANEL_SCHEME=https
fi

# Only fresh installations create one-time credential material.
if [[ "$EXISTING" == 0 ]]; then
  cat > /root/hostpanel-credentials.txt <<CREDS
Nusantara Host Panel
Panel URL: ${PANEL_SCHEME}://${PANEL_DOMAIN}
phpMyAdmin URL: ${PANEL_SCHEME}://${PMA_DOMAIN}
phpMyAdmin HTTP Basic user: pmaadmin
phpMyAdmin HTTP Basic password: ${PMA_BASIC_PASS}
MariaDB admin user: ${DB_ADMIN_USER}
MariaDB admin password: ${DB_ADMIN_PASS}
MariaDB host: localhost
CREDS
  chmod 600 /root/hostpanel-credentials.txt
fi

systemctl restart hostpanel
sleep 2
curl -fsS http://127.0.0.1:3030/healthz >/dev/null

# New control plane passed its local health gate; old source tree is no longer
# needed. Persistent state lives outside /opt/hostpanel and is untouched.
CODE_COMMITTED=0
if [[ -n "${PREVIOUS_CODE:-}" && -d "$PREVIOUS_CODE" ]]; then rm -rf "$PREVIOUS_CODE"; fi
PREVIOUS_CODE=""

cat <<DONE

============================================================
Nusantara HostPanel Admin v1.0.0 siap.
Mode          : $([[ "$EXISTING" == 1 ]] && echo repair/in-place || echo fresh-install)
OS            : ${PRETTY_NAME:-$OS_ID}
Network       : ${NETWORK_MODE}
Public IPv4   : ${SERVER_IPV4}
Panel         : ${PANEL_SCHEME}://${PANEL_DOMAIN}
phpMyAdmin    : ${PMA_URL}
TLS mode      : ${TLS_MODE}
DNS public    : ${DNS_PUBLIC}
${BACKUP_DIR:+Backup config : ${BACKUP_DIR}}

Satu installer untuk fresh install maupun repair/redeploy:
  bash /opt/hostpanel/scripts/install.sh

Diagnostik:
  bash /opt/hostpanel/scripts/diagnose.sh

Catatan:
- direct = public IP langsung pada interface VPS.
- nat = provider melakukan port-forward/public endpoint ke private IP VPS.
- proxy = TLS/reverse proxy dikelola provider di depan VPS.
- DNS_PUBLIC=1 hanya jika TCP+UDP 53 benar-benar reachable dari Internet.
============================================================
DONE
