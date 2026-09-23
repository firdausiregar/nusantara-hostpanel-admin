#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
BACKUP_DIR="${BACKUP_DIR:-/var/backups/hostpanel}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="$BACKUP_DIR/$STAMP"
mkdir -p "$DEST"
chmod 700 "$BACKUP_DIR" "$DEST"

# Recovery manifest: intentionally contains no credentials.
cat > "$DEST/MANIFEST.txt" <<MANIFEST
Nusantara HostPanel Admin backup
Created: $(date -u +%Y-%m-%dT%H:%M:%SZ)
Hostname: $(hostname)
Includes: HostPanel state/config, Nginx, BIND, Let's Encrypt store, app source, MariaDB dump
Excludes from app source: node_modules
MANIFEST

# Panel metadata + server configuration. /etc/hostpanel contains permission-restricted
# app env files, so this entire backup directory stays root-only (0700 / umask 077).
tar -czf "$DEST/hostpanel-config.tgz" \
  /etc/hostpanel /var/lib/hostpanel \
  /etc/nginx/sites-available /etc/nginx/sites-enabled \
  /etc/bind /var/lib/bind/hostpanel \
  /etc/letsencrypt 2>/dev/null || true

# Preserve non-Git/manual application source too. Dependencies are reproducible and can
# be very large, therefore node_modules is intentionally excluded.
if [[ -d /nusantara-hostpanel/apps ]]; then
  tar --exclude='*/node_modules' -czf "$DEST/apps-source.tgz" /nusantara-hostpanel/apps 2>/dev/null || true
fi

# MariaDB root normally authenticates through the local Unix socket.
if command -v mariadb-dump >/dev/null 2>&1; then
  mariadb-dump --all-databases --single-transaction --routines --events --triggers | gzip -9 > "$DEST/mariadb-all.sql.gz"
fi

(
  cd "$DEST"
  files=(MANIFEST.txt hostpanel-config.tgz)
  [[ -f apps-source.tgz ]] && files+=(apps-source.tgz)
  [[ -f mariadb-all.sql.gz ]] && files+=(mariadb-all.sql.gz)
  sha256sum "${files[@]}" > SHA256SUMS
)
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime "+$RETENTION_DAYS" -exec rm -rf -- {} +
