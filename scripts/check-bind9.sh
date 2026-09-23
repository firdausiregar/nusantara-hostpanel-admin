#!/usr/bin/env bash
set -u

CHECKCONF="$(command -v named-checkconf 2>/dev/null || true)"
CHECKZONE="$(command -v named-checkzone 2>/dev/null || true)"
DIG="$(command -v dig 2>/dev/null || true)"
ZONE_DIR=/var/lib/bind/hostpanel
INCLUDE=/etc/bind/hostpanel-zones.conf
LOCAL=/etc/bind/named.conf.local
AGENT=/etc/hostpanel/agent.json

printf '== Nusantara Host Panel / BIND9 check ==\n'
printf 'named-checkconf: %s\n' "${CHECKCONF:-NOT FOUND}"
printf 'named-checkzone: %s\n' "${CHECKZONE:-NOT FOUND}"
printf '\n-- service --\n'
if systemctl cat named.service >/dev/null 2>&1; then SERVICE=named; else SERVICE=bind9; fi
systemctl is-active "$SERVICE" 2>/dev/null || true
systemctl status "$SERVICE" --no-pager -l 2>/dev/null | sed -n '1,18p' || true

printf '\n-- config include --\n'
if [[ -f "$LOCAL" ]]; then grep -n 'hostpanel-zones.conf' "$LOCAL" || echo 'WARN: include hostpanel-zones.conf tidak ditemukan di named.conf.local'; else echo "MISSING: $LOCAL"; fi
if [[ -f "$INCLUDE" ]]; then ls -l "$INCLUDE"; sed -n '1,220p' "$INCLUDE"; else echo "MISSING: $INCLUDE"; fi

printf '\n-- global config validation --\n'
if [[ -n "$CHECKCONF" ]]; then "$CHECKCONF" && echo 'named-checkconf: OK' || echo 'named-checkconf: FAILED'; fi

printf '\n-- agent / nameservers --\n'
if [[ -f "$AGENT" ]]; then python3 - <<'PY' "$AGENT"
import json,sys
p=sys.argv[1]
try:
    d=json.load(open(p))
    print('nameservers:', ', '.join(d.get('nameservers') or []) or '(none)')
    print('serverIPv4:', d.get('serverIPv4') or '(none)')
    print('secondaryIPs:', ', '.join(d.get('secondaryIPs') or []) or '(none)')
    print('dnsPublic:', d.get('dnsPublic'))
except Exception as e: print('ERROR:',e)
PY
else echo "MISSING: $AGENT"; fi

printf '\n-- zone directory --\n'
ls -ld "$ZONE_DIR" 2>/dev/null || echo "MISSING: $ZONE_DIR"
if [[ -d "$ZONE_DIR" ]]; then
  shopt -s nullglob
  files=("$ZONE_DIR"/db.*)
  if (( ${#files[@]} == 0 )); then echo '(belum ada zone file)'; fi
  for file in "${files[@]}"; do
    domain="${file##*/db.}"
    printf '\n[%s]\n' "$domain"
    ls -l "$file"
    if [[ -n "$CHECKZONE" ]]; then "$CHECKZONE" "$domain" "$file" || true; fi
    sed -n '1,80p' "$file"
    if [[ -n "$DIG" ]]; then "$DIG" +time=2 +tries=1 @127.0.0.1 "$domain" SOA +noall +answer 2>/dev/null || true; fi
  done
fi

printf '\n-- listeners :53 --\n'
ss -lntup 2>/dev/null | awk 'NR==1 || /:53([[:space:]]|$)/' || true
printf '\nDone. Script ini read-only.\n'
