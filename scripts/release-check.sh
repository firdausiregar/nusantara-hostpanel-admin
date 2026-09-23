#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo '[1/6] Architecture + JavaScript syntax'
npm run check

echo '[2/6] Security + RBAC regression tests'
npm run test:security
npm run test:rbac
npm run test:integrations

echo '[3/6] Bash syntax'
for file in scripts/*.sh; do bash -n "$file"; done

echo '[4/6] Frontend asset bundle'
npm run check:assets
npm run check:migrations

echo '[5/6] Secret/runtime artifact scan'
if grep -RInE --exclude-dir=node_modules --exclude-dir=.git --exclude='*.md' --exclude='.env.example' --exclude='.env.local.example' \
  '(BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|SESSION_SECRET=[^$[:space:]]{12,}|PASSWORD=[^$[:space:]]{8,})' .; then
  echo 'Potential committed secret detected. Review the matches above.' >&2
  exit 1
fi

echo '[6/6] Version/repository sanity'
node - <<'NODE'
const fs=require('node:fs');
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
const cfg=fs.readFileSync('src/core/config/index.js','utf8');
if(!cfg.includes(`release: '${pkg.version}'`)) throw new Error('package.json and config release differ');
if(!String(pkg.repository?.url||'').includes('firdausiregar/nusantara-hostpanel-admin')) throw new Error('Unexpected repository URL');
console.log(`Release ${pkg.version} repository metadata OK.`);
NODE

echo 'Release checks passed.'

echo "== Local runtime smoke =="
npm run smoke:local
