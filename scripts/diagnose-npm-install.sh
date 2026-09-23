#!/usr/bin/env bash
set -u
printf '%s\n' '== Node/npm =='
/usr/local/bin/node --version 2>/dev/null || node --version 2>/dev/null || true
/usr/local/bin/npm --version 2>/dev/null || npm --version 2>/dev/null || true
printf '\n%s\n' '== Active install/build processes =='
ps -eo pid,ppid,stat,etime,%cpu,%mem,cmd | grep -E 'npm|node-gyp|prebuild|make|g\+\+|better-sqlite3|sqlite3' | grep -v grep || true
printf '\n%s\n' '== npm registry =='
(/usr/bin/curl -fsSI --max-time 10 https://registry.npmjs.org/ | head -n 1) || echo 'registry.npmjs.org unreachable'
printf '\n%s\n' '== Latest npm log =='
LOG="$(find /root/.npm/_logs -maxdepth 1 -type f -name '*-debug-0.log' -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n1 | cut -d' ' -f2-)"
if [[ -n "${LOG:-}" && -f "$LOG" ]]; then
  echo "$LOG"
  tail -n 80 "$LOG"
else
  echo 'No root npm debug log found.'
fi
