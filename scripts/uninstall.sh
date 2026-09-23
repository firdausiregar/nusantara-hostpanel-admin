#!/usr/bin/env bash
set -Eeuo pipefail
[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "Jalankan sebagai root" >&2; exit 1; }
systemctl disable --now hostpanel 2>/dev/null || true
rm -f /etc/systemd/system/hostpanel.service /etc/sudoers.d/hostpanel /usr/local/sbin/hostpanelctl
systemctl daemon-reload
printf 'Panel service dihapus. Data /var/lib/hostpanel, /etc/hostpanel, Nginx/BIND zones, aplikasi, database, dan paket server sengaja TIDAK dihapus.\n'
