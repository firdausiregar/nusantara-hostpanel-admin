#!/usr/bin/env bash
set -Eeuo pipefail
if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo 'Jalankan sebagai root: sudo bash scripts/repair-assets.sh' >&2
  exit 1
fi
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT_DIR/public/css/app.css"
DST=/opt/hostpanel/public/css/app.css
if [[ ! -s "$SRC" ]] || [[ $(wc -c < "$SRC") -lt 4096 ]]; then
  echo "CSS bundle sumber tidak valid: $SRC" >&2
  exit 2
fi
grep -q '\.btn-primary' "$SRC" || { echo 'CSS bundle tidak memiliki komponen HostPanel.' >&2; exit 2; }
install -d -o root -g hostpanel -m 0750 /opt/hostpanel/public /opt/hostpanel/public/css
install -o root -g hostpanel -m 0640 "$SRC" "$DST"
echo "CSS dipulihkan: $DST ($(wc -c < "$DST") bytes)"
if systemctl is-active --quiet hostpanel 2>/dev/null; then
  systemctl restart hostpanel
  sleep 1
fi
if curl -fsS http://127.0.0.1:3030/css/app.css | grep -q '\.btn-primary'; then
  echo 'OK: /css/app.css tersedia dari HostPanel.'
else
  echo 'WARNING: file sudah dipasang tetapi endpoint CSS belum tervalidasi. Cek: systemctl status hostpanel --no-pager -l' >&2
  exit 3
fi
