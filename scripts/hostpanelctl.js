#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const os = require('node:os');
const http = require('node:http');
const { execFileSync } = require('node:child_process');

if (process.geteuid && process.geteuid() !== 0) {
  console.error('hostpanelctl harus dijalankan sebagai root.');
  process.exit(77);
}

const ETC = '/etc/hostpanel';
const ZONE_META_DIR = path.join(ETC, 'zones');
const APP_ENV_DIR = path.join(ETC, 'apps');
const BIND_ZONE_DIR = '/var/lib/bind/hostpanel';
const BIND_INCLUDE = '/etc/bind/hostpanel-zones.conf';
const NGINX_AVAILABLE = '/etc/nginx/sites-available';
const NGINX_ENABLED = '/etc/nginx/sites-enabled';
const CREDENTIAL_META = path.join(ETC, 'credentials.json');
const PMA_HTPASSWD = '/etc/nginx/.htpasswd-phpmyadmin';
const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const DNS_OWNER_LABEL = '[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?';
const OWNER_RE = new RegExp(`^(?:@|\\*|\\*\\.${DNS_OWNER_LABEL}(?:\\.${DNS_OWNER_LABEL})*|${DNS_OWNER_LABEL}(?:\\.${DNS_OWNER_LABEL})*)$`, 'i');

function fail(message, code = 1) { console.error(message); process.exit(code); }
function resolveBin(name, candidates) {
  for (const file of candidates) if (fs.existsSync(file)) return file;
  fail(`${name} tidak ditemukan. Pastikan paket bind9-utils terpasang.`);
}
function namedCheckconfPath() { return resolveBin('named-checkconf', ['/usr/bin/named-checkconf', '/usr/sbin/named-checkconf']); }
function namedCheckzonePath() { return resolveBin('named-checkzone', ['/usr/bin/named-checkzone', '/usr/sbin/named-checkzone']); }
function cmd(file, args = [], opts = {}) { return execFileSync(file, args, { encoding: 'utf8', stdio: opts.capture ? ['ignore','pipe','pipe'] : 'pipe', timeout: opts.timeout || 30000, cwd: opts.cwd || undefined, env: opts.env || undefined }).trim(); }
function cmdInput(file, args = [], input = '', opts = {}) { return execFileSync(file, args, { encoding: 'utf8', input, stdio: ['pipe', opts.capture ? 'pipe' : 'pipe', opts.capture ? 'pipe' : 'pipe'], timeout: opts.timeout || 30000 }).trim(); }
function mkdir(p, mode = 0o750) { fs.mkdirSync(p, { recursive: true, mode }); }
function safeDomain(raw) { const v = String(raw || '').toLowerCase().replace(/\.$/, ''); if (!DOMAIN_RE.test(v)) fail('Domain tidak valid.'); return v; }
function safeSlug(raw) { const v = String(raw || '').toLowerCase(); if (!SLUG_RE.test(v)) fail('Slug tidak valid.'); return v; }
function safePort(raw) { const n = Number(raw); if (!Number.isInteger(n) || n < 1024 || n > 65535) fail('Port tidak valid.'); return n; }
function safePath(raw) { const input = String(raw || ''); if (!/^\/srv\/apps\/[a-zA-Z0-9._/-]+$/.test(input) || input.includes('..')) fail('Working directory harus berupa path aman di bawah /nusantara-hostpanel/apps/.'); const v = path.posix.normalize(input); if (!v.startsWith('/nusantara-hostpanel/apps/')) fail('Working directory tidak valid.'); return v; }
function safeEntry(raw) { const v = String(raw || ''); if (!/^[a-zA-Z0-9._/-]{1,120}$/.test(v) || v.startsWith('/') || v.includes('..')) fail('Entry file tidak valid.'); return v; }
function writeAtomic(file, content, mode = 0o640) { mkdir(path.dirname(file)); const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, content, { mode }); fs.renameSync(tmp, file); }
function loadAgent() { try { return JSON.parse(fs.readFileSync(path.join(ETC, 'agent.json'), 'utf8')); } catch { return { nameservers: [], serverIPv4: '', secondaryIPs: [] }; } }
function loadPanelEnv() {
  const file = path.join(ETC, 'hostpanel.env');
  const out = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const i = trimmed.indexOf('=');
      if (i < 1) continue;
      out[trimmed.slice(0, i)] = trimmed.slice(i + 1);
    }
  } catch {}
  return out;
}
function loadCredentialMeta() {
  const fallback = { dbAdminUser: 'hostdbadmin', pmaBasicUser: 'pmaadmin' };
  try {
    const parsed = JSON.parse(fs.readFileSync(CREDENTIAL_META, 'utf8'));
    const dbAdminUser = /^[a-zA-Z0-9_]{3,32}$/.test(String(parsed.dbAdminUser || '')) ? String(parsed.dbAdminUser) : fallback.dbAdminUser;
    const pmaBasicUser = /^[a-zA-Z0-9_.-]{3,32}$/.test(String(parsed.pmaBasicUser || '')) ? String(parsed.pmaBasicUser) : fallback.pmaBasicUser;
    return { dbAdminUser, pmaBasicUser };
  } catch { return fallback; }
}
function randomSecret() { return crypto.randomBytes(24).toString('hex'); }
function redactLegacyCredential(label) {
  const file = '/root/hostpanel-credentials.txt';
  try {
    const text = fs.readFileSync(file, 'utf8');
    const next = text.replace(new RegExp(`^${label}:.*$`, 'm'), `${label}: <rotated-in-panel-not-stored>`);
    fs.writeFileSync(file, next, { mode: 0o600 });
  } catch {}
}

function fqdn(v) { return `${String(v).replace(/\.$/, '')}.`; }
function shServiceActive(name) { try { cmd('/usr/bin/systemctl', ['is-active', '--quiet', name]); return true; } catch { return false; } }
function detectPhpService() {
  try {
    const out = cmd('/usr/bin/systemctl', ['list-unit-files', '--type=service', '--no-legend', 'php*-fpm.service']);
    const first = out.split('\n').map(x => x.trim().split(/\s+/)[0]).find(Boolean);
    return first ? first.replace(/\.service$/, '') : null;
  } catch { return null; }
}
function detectBindService() {
  for (const candidate of ['named', 'bind9']) {
    try {
      cmd('/usr/bin/systemctl', ['cat', `${candidate}.service`]);
      return candidate;
    } catch {}
  }
  return null;
}
function normalizeService(name) {
  const v = String(name || '');
  if (v === 'php-fpm') return detectPhpService() || fail('PHP-FPM service tidak ditemukan.');
  if (v === 'bind9') return detectBindService() || fail('BIND9/named service tidak ditemukan.');
  if (['nginx','mariadb'].includes(v)) return v;
  if (/^hostapp-[a-z0-9][a-z0-9-]{1,39}$/.test(v)) return v;
  fail('Service tidak diizinkan.');
}
function nginxTestReload() { cmd('/usr/sbin/nginx', ['-t']); cmd('/usr/bin/systemctl', ['reload', 'nginx']); }

function proxyLocation(port, forwardedProto) {
  return `  location / {\n    proxy_http_version 1.1;\n    proxy_set_header Host $host;\n    proxy_set_header X-Real-IP $remote_addr;\n    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n    proxy_set_header X-Forwarded-Host $host;\n    proxy_set_header X-Forwarded-Proto ${forwardedProto};\n    proxy_set_header Upgrade $http_upgrade;\n    proxy_set_header Connection "upgrade";\n    proxy_read_timeout 60s;\n    proxy_send_timeout 60s;\n    proxy_pass http://127.0.0.1:${port};\n  }`;
}

function acmeLocation() {
  return `  location ^~ /.well-known/acme-challenge/ {\n    root /var/www/letsencrypt;\n    default_type text/plain;\n    try_files $uri =404;\n  }`;
}

function nginxHttpConfig(domain, port, tlsMode) {
  const forwardedProto = tlsMode === 'edge' ? '$hostpanel_forwarded_proto' : '$scheme';
  return `server {\n  listen 80;\n  listen [::]:80;\n  server_name ${domain};\n\n  client_max_body_size 25m;\n\n${acmeLocation()}\n\n${proxyLocation(port, forwardedProto)}\n}\n`;
}

function nginxLocalTlsConfig(domain, port, certDir = `/etc/letsencrypt/live/${domain}`) {
  return `server {\n  listen 80;\n  listen [::]:80;\n  server_name ${domain};\n\n${acmeLocation()}\n\n  location / {\n    return 301 https://$host$request_uri;\n  }\n}\n\nserver {\n  listen 443 ssl http2;\n  listen [::]:443 ssl http2;\n  server_name ${domain};\n\n  ssl_certificate ${certDir}/fullchain.pem;\n  ssl_certificate_key ${certDir}/privkey.pem;\n  ssl_session_timeout 1d;\n  ssl_session_cache shared:SSL:10m;\n  ssl_protocols TLSv1.0.0 TLSv1.3;\n\n  client_max_body_size 25m;\n\n${proxyLocation(port, '$scheme')}\n}\n`;
}

function detectPhpSocket() {
  const dir = '/run/php';
  if (!fs.existsSync(dir)) fail('Direktori /run/php tidak ditemukan.');
  const socket = fs.readdirSync(dir).filter((name) => /^php.*-fpm\.sock$/.test(name)).sort().map((name) => path.join(dir, name))[0];
  if (!socket) fail('Socket PHP-FPM tidak ditemukan.');
  return socket;
}

function phpMyAdminHttpConfig(domain) {
  const socket = detectPhpSocket();
  return `server {\n  listen 80;\n  listen [::]:80;\n  server_name ${domain};\n  root /usr/share/phpmyadmin;\n  index index.php;\n  client_max_body_size 32m;\n\n  auth_basic "Database Admin";\n  auth_basic_user_file ${PMA_HTPASSWD};\n\n  location ^~ /.well-known/acme-challenge/ {\n    auth_basic off;\n    root /var/www/letsencrypt;\n    default_type text/plain;\n    try_files $uri =404;\n  }\n\n  location / { try_files $uri $uri/ /index.php?$args; }\n  location ~ \\.php$ {\n    include fastcgi_params;\n    fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;\n    fastcgi_pass unix:${socket};\n  }\n  location ~* ^/(setup|libraries|templates)/ { deny all; }\n  location ~ /\\. { deny all; }\n}\n`;
}

function phpMyAdminTlsConfig(domain, certDir = `/etc/letsencrypt/live/${domain}`) {
  const socket = detectPhpSocket();
  return `server {\n  listen 80;\n  listen [::]:80;\n  server_name ${domain};\n\n  location ^~ /.well-known/acme-challenge/ {\n    auth_basic off;\n    root /var/www/letsencrypt;\n    default_type text/plain;\n    try_files $uri =404;\n  }\n  location / { return 301 https://$host$request_uri; }\n}\n\nserver {\n  listen 443 ssl http2;\n  listen [::]:443 ssl http2;\n  server_name ${domain};\n  root /usr/share/phpmyadmin;\n  index index.php;\n  client_max_body_size 32m;\n\n  ssl_certificate ${certDir}/fullchain.pem;\n  ssl_certificate_key ${certDir}/privkey.pem;\n  ssl_session_timeout 1d;\n  ssl_session_cache shared:SSL:10m;\n  ssl_protocols TLSv1.0.0 TLSv1.3;\n\n  auth_basic "Database Admin";\n  auth_basic_user_file ${PMA_HTPASSWD};\n\n  location / { try_files $uri $uri/ /index.php?$args; }\n  location ~ \\.php$ {\n    include fastcgi_params;\n    fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;\n    fastcgi_pass unix:${socket};\n  }\n  location ~* ^/(setup|libraries|templates)/ { deny all; }\n  location ~ /\\. { deny all; }\n}\n`;
}


function certificateNames(certFile) {
  try {
    const text = cmd('/usr/bin/openssl', ['x509','-in',certFile,'-noout','-subject','-ext','subjectAltName'], { capture: true });
    const san = [...text.matchAll(/DNS:([^,\s]+)/g)].map(m => m[1].trim().toLowerCase());
    const cn = text.match(/subject=.*?CN\s*=\s*([^,\n]+)/i)?.[1]?.trim().toLowerCase();
    return [...new Set((san.length ? san : cn ? [cn] : []).filter(Boolean))];
  } catch {
    return [];
  }
}

function certificatePatternCoversDomain(pattern, domain) {
  pattern = String(pattern || '').toLowerCase().replace(/\.$/, '');
  domain = String(domain || '').toLowerCase().replace(/\.$/, '');
  if (pattern === domain) return true;
  if (!pattern.startsWith('*.')) return false;
  const base = pattern.slice(2);
  if (!domain.endsWith(`.${base}`)) return false;
  const left = domain.slice(0, -(base.length + 1));
  return Boolean(left) && !left.includes('.');
}

function findCertificateForDomain(domain) {
  domain = safeDomain(domain);
  const liveDir = '/etc/letsencrypt/live';
  if (!fs.existsSync(liveDir)) return null;
  const matches = [];
  for (const name of fs.readdirSync(liveDir)) {
    if (name === 'README') continue;
    const certDir = path.join(liveDir, name);
    const cert = path.join(certDir, 'fullchain.pem');
    const key = path.join(certDir, 'privkey.pem');
    if (!fs.existsSync(cert) || !fs.existsSync(key)) continue;
    const names = certificateNames(cert);
    const exact = names.includes(domain);
    const wildcard = names.some(item => item.startsWith('*.') && certificatePatternCoversDomain(item, domain));
    if (exact || wildcard) matches.push({ name, certDir, cert, key, names, exact });
  }
  matches.sort((a, b) => Number(b.exact) - Number(a.exact) || a.name.localeCompare(b.name));
  return matches[0] || null;
}

function nginxProxyUpsert(domain, port) {
  domain = safeDomain(domain); port = safePort(port);
  const env = loadPanelEnv();
  const tlsMode = ['local','edge','off'].includes(env.TLS_MODE) ? env.TLS_MODE : 'local';
  const file = path.join(NGINX_AVAILABLE, `${domain}.conf`);
  const old = fs.existsSync(file) ? fs.readFileSync(file) : null;
  const matchingCertificate = tlsMode === 'local' ? findCertificateForDomain(domain) : null;
  const config = matchingCertificate
    ? nginxLocalTlsConfig(domain, port, matchingCertificate.certDir)
    : nginxHttpConfig(domain, port, tlsMode);
  writeAtomic(file, config, 0o644);
  const link = path.join(NGINX_ENABLED, `${domain}.conf`);
  if (!fs.existsSync(link)) fs.symlinkSync(file, link);
  try { nginxTestReload(); }
  catch (e) {
    if (old) fs.writeFileSync(file, old); else { try { fs.unlinkSync(file); } catch {} try { fs.unlinkSync(link); } catch {} }
    fail(`Konfigurasi Nginx gagal: ${e.stderr || e.message}`);
  }
  console.log(JSON.stringify({
    ok: true,
    domain,
    https: Boolean(matchingCertificate),
    certificateName: matchingCertificate ? matchingCertificate.name : null,
    certificate: matchingCertificate ? matchingCertificate.cert : null,
    source: matchingCertificate ? (matchingCertificate.exact ? 'existing-exact' : 'existing-wildcard') : 'http'
  }));
}


function safeDomainProxySettings(payload){
  const domain=safeDomain(payload.hostname),port=safePort(payload.port);
  const redirectHttps=payload.redirectHttps!==false && String(payload.redirectHttps)!=='0';
  const canonicalMode=['none','www','non-www'].includes(String(payload.canonicalMode||'none'))?String(payload.canonicalMode||'none'):'none';
  const websocketEnabled=payload.websocketEnabled!==false && String(payload.websocketEnabled)!=='0';
  const uploadLimitMb=Number(payload.uploadLimitMb||25);if(!Number.isInteger(uploadLimitMb)||uploadLimitMb<1||uploadLimitMb>2048)fail('Upload limit harus 1-2048 MB.');
  const proxyTimeoutSec=Number(payload.proxyTimeoutSec||60);if(!Number.isInteger(proxyTimeoutSec)||proxyTimeoutSec<5||proxyTimeoutSec>3600)fail('Proxy timeout harus 5-3600 detik.');
  const maintenanceMode=String(payload.maintenanceMode||'0')==='1'||payload.maintenanceMode===true;
  let customHeaders={}; if(payload.customHeaders&&typeof payload.customHeaders==='object'&&!Array.isArray(payload.customHeaders))customHeaders=payload.customHeaders;
  const allowed=new Set(['X-Frame-Options','X-Content-Type-Options','Referrer-Policy','Permissions-Policy','Content-Security-Policy','Cache-Control','Cross-Origin-Opener-Policy','Cross-Origin-Resource-Policy']);
  const headers=[]; for(const [name,valueRaw] of Object.entries(customHeaders)){if(!allowed.has(name))fail(`Header ${name} tidak diizinkan.`);const value=String(valueRaw||'').trim();if(!value||value.length>700||/[\r\n\0]/.test(value))fail(`Nilai header ${name} tidak valid.`);headers.push([name,value]);}
  return{domain,port,redirectHttps,canonicalMode,websocketEnabled,uploadLimitMb,proxyTimeoutSec,maintenanceMode,headers};
}
function canonicalDomain(domain,mode){if(mode==='www')return domain.startsWith('www.')?domain:`www.${domain}`;if(mode==='non-www')return domain.startsWith('www.')?domain.slice(4):domain;return domain;}
function headerLines(headers){return headers.map(([k,v])=>`    add_header ${k} "${v.replace(/\\/g,'\\\\').replace(/"/g,'\\"')}" always;`).join('\n');}
function advancedProxyLocation(settings,forwardedProto){
  if(settings.maintenanceMode)return `  location / {\n    add_header Retry-After "120" always;\n    return 503 "Maintenance in progress\\n";\n  }`;
  const ws=settings.websocketEnabled?'    proxy_set_header Upgrade $http_upgrade;\n    proxy_set_header Connection "upgrade";\n':'';
  const hdr=headerLines(settings.headers); const hdrBlock=hdr?`${hdr}\n`:'';
  return `  location / {\n    proxy_http_version 1.1;\n    proxy_set_header Host $host;\n    proxy_set_header X-Real-IP $remote_addr;\n    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n    proxy_set_header X-Forwarded-Host $host;\n    proxy_set_header X-Forwarded-Proto ${forwardedProto};\n${ws}    proxy_read_timeout ${settings.proxyTimeoutSec}s;\n    proxy_send_timeout ${settings.proxyTimeoutSec}s;\n${hdrBlock}    proxy_pass http://127.0.0.1:${settings.port};\n  }`;
}
function certCoversHost(match,host){return Boolean(match&&Array.isArray(match.names)&&match.names.some(name=>certificatePatternCoversDomain(name,host)));}
function nginxAdvancedConfig(settings,tlsMode){
  const canonical=canonicalDomain(settings.domain,settings.canonicalMode), aliases=[settings.domain].filter(x=>x!==canonical); if(canonical!==settings.domain&&!aliases.includes(settings.domain))aliases.push(settings.domain);
  const httpHosts=[canonical,...aliases].filter((x,i,a)=>a.indexOf(x)===i); const canonicalCert=tlsMode==='local'?findCertificateForDomain(canonical):null;
  const forwarded=tlsMode==='edge'?'$hostpanel_forwarded_proto':'$scheme'; const blocks=[];
  const aliasCheck=settings.canonicalMode!=='none'&&aliases.length?`\n  if ($host != ${canonical}) { return 301 ${tlsMode==='edge'?'$hostpanel_forwarded_proto':(canonicalCert&&settings.redirectHttps?'https':'http')}://${canonical}$request_uri; }`:'';
  let schemeRedirect=''; if(tlsMode==='local'&&canonicalCert&&settings.redirectHttps)schemeRedirect='\n  location / { return 301 https://$host$request_uri; }';
  else if(tlsMode==='edge'&&settings.redirectHttps)schemeRedirect='\n  if ($hostpanel_forwarded_proto = http) { return 301 https://$host$request_uri; }';
  const httpProxy=(tlsMode==='local'&&canonicalCert&&settings.redirectHttps)?'':`\n${advancedProxyLocation(settings,forwarded)}`;
  blocks.push(`server {\n  listen 80;\n  listen [::]:80;\n  server_name ${httpHosts.join(' ')};\n  client_max_body_size ${settings.uploadLimitMb}m;\n${acmeLocation()}${aliasCheck}${schemeRedirect}${httpProxy}\n}`);
  if(tlsMode==='local'&&canonicalCert){
    const tlsAliases=aliases.filter(h=>certCoversHost(canonicalCert,h)),tlsHosts=[canonical,...tlsAliases].filter((x,i,a)=>a.indexOf(x)===i); const tlsAliasCheck=settings.canonicalMode!=='none'&&tlsAliases.length?`\n  if ($host != ${canonical}) { return 301 https://${canonical}$request_uri; }`:'';
    blocks.push(`server {\n  listen 443 ssl http2;\n  listen [::]:443 ssl http2;\n  server_name ${tlsHosts.join(' ')};\n  ssl_certificate ${canonicalCert.certDir}/fullchain.pem;\n  ssl_certificate_key ${canonicalCert.certDir}/privkey.pem;\n  ssl_session_timeout 1d;\n  ssl_session_cache shared:SSL:10m;\n  ssl_protocols TLSv1.0.0 TLSv1.3;\n  client_max_body_size ${settings.uploadLimitMb}m;${tlsAliasCheck}\n${advancedProxyLocation(settings,'$scheme')}\n}`);
  }
  return{content:blocks.join('\n\n')+'\n',https:Boolean(canonicalCert),certificateName:canonicalCert?.name||null,canonical};
}
function nginxProxyUpsertFromStdin(){const payload=readJsonStdin('Domain proxy');const settings=safeDomainProxySettings(payload),env=loadPanelEnv(),tlsMode=['local','edge','off'].includes(env.TLS_MODE)?env.TLS_MODE:'local';const generated=nginxAdvancedConfig(settings,tlsMode),file=path.join(NGINX_AVAILABLE,`${settings.domain}.conf`),old=fs.existsSync(file)?fs.readFileSync(file):null;writeAtomic(file,generated.content,0o644);const link=path.join(NGINX_ENABLED,`${settings.domain}.conf`);if(!fs.existsSync(link))fs.symlinkSync(file,link);try{nginxTestReload();}catch(e){if(old)fs.writeFileSync(file,old);else{try{fs.unlinkSync(file)}catch{}try{fs.unlinkSync(link)}catch{}}try{nginxTestReload()}catch{}fail(`Konfigurasi Nginx gagal: ${e.stderr||e.message}`);}console.log(JSON.stringify({ok:true,domain:settings.domain,https:generated.https,certificateName:generated.certificateName,canonical:generated.canonical}));}

function nginxRemove(domain) {
  domain = safeDomain(domain);
  for (const file of [path.join(NGINX_ENABLED, `${domain}.conf`), path.join(NGINX_AVAILABLE, `${domain}.conf`)]) { try { fs.unlinkSync(file); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
  nginxTestReload();
  console.log(`nginx:${domain}:removed`);
}

function systemdQuote(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%')}"`;
}

function parseAppEnvironment(raw) {
  const lines = String(raw || '').split(/\r?\n/);
  if (lines.length > 100) fail('Environment maksimal 100 baris.');
  const output = [];
  for (const original of lines) {
    const line = original.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) fail(`Environment tidak valid: ${original}`);
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1);
    if (!/^[A-Z_][A-Z0-9_]{0,63}$/i.test(key)) fail(`Nama environment tidak valid: ${key}`);
    if (value.length > 2048 || /[\0\r\n]/.test(value)) fail(`Nilai environment ${key} tidak valid.`);
    output.push(`${key}="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  }
  return output.join('\n') + (output.length ? '\n' : '');
}

function resolveRuntime(name) {
  const map = {
    node: ['/usr/local/bin/node','/usr/bin/node'],
    npm: ['/usr/local/bin/npm','/usr/bin/npm'],
    npx: ['/usr/local/bin/npx','/usr/bin/npx'],
    pnpm: ['/usr/local/bin/pnpm','/usr/bin/pnpm'],
    yarn: ['/usr/local/bin/yarn','/usr/bin/yarn'],
    bun: ['/usr/local/bin/bun','/usr/bin/bun'],
  };
  const candidates = map[name];
  if (!candidates) fail('Runtime custom tidak diizinkan. Gunakan node/npm/npx/pnpm/yarn/bun.');
  for (const file of candidates) if (fs.existsSync(file)) return file;
  fail(`Runtime ${name} tidak ditemukan di server.`);
}

function safeCommandTokens(raw) {
  const text = String(raw || '').trim();
  if (!text || text.length > 500) fail('Start command tidak valid.');
  if (/[;&|`$<>\\\n\r]/.test(text)) fail('Start command tidak boleh mengandung operator shell.');
  const tokens = text.split(/\s+/).filter(Boolean);
  if (!tokens.length || tokens.length > 24) fail('Start command tidak valid.');
  const runtime = resolveRuntime(tokens.shift());
  for (const token of tokens) {
    if (!/^[a-zA-Z0-9_./:@=+,%\-]{1,180}$/.test(token) || token.includes('..')) fail(`Argumen start command tidak valid: ${token}`);
  }
  return [runtime, ...tokens];
}


function appUserName(slugRaw) {
  const slug = safeSlug(slugRaw);
  const hash = crypto.createHash('sha256').update(slug).digest('hex').slice(0, 6);
  const stem = slug.replace(/-/g, '_').slice(0, 20);
  return `hp_${stem}_${hash}`;
}
function ensureAppUser(slugRaw) {
  const user = appUserName(slugRaw);
  try { cmd('/usr/bin/id', ['-u', user], { capture: true }); }
  catch {
    const useradd = ['/usr/sbin/useradd','/usr/bin/useradd'].find(fs.existsSync);
    if (!useradd) fail('useradd tidak ditemukan.');
    cmd(useradd, ['--system','--no-create-home','--home-dir','/nonexistent','--shell','/usr/sbin/nologin',user]);
  }
  return user;
}
function runAsAppUser(slugRaw, file, args, opts = {}) {
  const user = ensureAppUser(slugRaw);
  const runuser = ['/usr/sbin/runuser','/usr/bin/runuser'].find(fs.existsSync);
  if (!runuser) fail('runuser tidak ditemukan.');
  return cmd(runuser, ['-u',user,'--',file,...args], opts);
}
function runtimeWorkingDirectory(baseRaw) {
  const base = safePath(baseRaw);
  const current = path.join(base, 'current');
  try {
    if (fs.existsSync(current)) {
      const real = fs.realpathSync(current);
      if (!real.startsWith(`${base}/releases/`)) fail('Symlink current keluar dari releases aplikasi.');
      return real;
    }
  } catch (error) { if (String(error.message||'').includes('keluar')) throw error; }
  return fs.realpathSync(base);
}
function resolveNodeRuntime(runtimeRaw, binary = 'node') {
  const runtime = String(runtimeRaw || 'system');
  if (runtime === 'system') return resolveRuntime(binary);
  const m = runtime.match(/^node(20|22|24)$/);
  if (!m) fail('Node runtime tidak didukung.');
  const major = m[1];
  const candidates = [
    `/opt/hostpanel/runtimes/node${major}/bin/${binary}`,
    `/opt/node${major}/bin/${binary}`,
  ];
  for (const file of candidates) if (fs.existsSync(file)) return file;
  fail(`Node ${major} belum terpasang. Jalankan scripts/install-node-runtime.sh ${major} sebagai root.`);
}

function appUpsertPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('Payload aplikasi tidak valid.');
  const slug = safeSlug(payload.slug);
  const baseDir = safePath(payload.workingDir);
  const port = safePort(payload.port);
  const mode = ['node','npm','command'].includes(String(payload.startMode)) ? String(payload.startMode) : fail('Start mode tidak valid.');
  const restartPolicy = ['always','on-failure','no'].includes(String(payload.restartPolicy || 'on-failure')) ? String(payload.restartPolicy || 'on-failure') : fail('Restart policy tidak valid.');
  if (!fs.existsSync(baseDir) || !fs.statSync(baseDir).isDirectory()) fail(`Folder ${baseDir} belum ada.`);
  const appUser = ensureAppUser(slug);
  const ownerMarker = path.join(baseDir, '.hostpanel-owner-v1');
  if (!fs.existsSync(ownerMarker)) { try { cmd('/usr/bin/chown', ['-R', `${appUser}:${appUser}`, baseDir], { timeout: 120000 }); fs.writeFileSync(ownerMarker, `${appUser}\n`, {mode:0o600}); cmd('/usr/bin/chown',[`${appUser}:${appUser}`,ownerMarker]); } catch {} }
  const workingDir = runtimeWorkingDirectory(baseDir);
  const nodeRuntime = String(payload.nodeRuntime || 'system');

  let execTokens = [];
  let entryFile = String(payload.entryFile || 'server.js');
  const npmScript = String(payload.npmScript || 'start').trim();
  const startCommand = String(payload.startCommand || '').trim();
  if (mode === 'node') {
    entryFile = safeEntry(entryFile);
    const fullEntry = path.join(workingDir, entryFile);
    if (!fs.existsSync(fullEntry) || !fs.statSync(fullEntry).isFile()) fail(`Entry file ${fullEntry} belum ada.`);
    const realEntry = fs.realpathSync(fullEntry);
    if (!(realEntry === workingDir || realEntry.startsWith(`${workingDir}/`))) fail('Entry file symlink keluar dari working directory tidak diizinkan.');
    execTokens = [resolveNodeRuntime(nodeRuntime, 'node'), realEntry];
  } else if (mode === 'npm') {
    if (!/^[a-zA-Z0-9:_-]{1,64}$/.test(npmScript)) fail('Nama npm script tidak valid.');
    if (!fs.existsSync(path.join(workingDir, 'package.json'))) fail('package.json tidak ditemukan untuk start mode npm.');
    execTokens = [resolveNodeRuntime(nodeRuntime, 'npm'), 'run', npmScript];
  } else {
    const tokens = String(startCommand || '').trim().split(/\s+/).filter(Boolean);
    if (!tokens.length || tokens.length > 24 || /[;&|`$<>\\\n\r]/.test(startCommand)) fail('Start command tidak valid.');
    const first = tokens.shift();
    if (!['node','npm','npx'].includes(first)) fail('Command mode hanya mengizinkan node/npm/npx pada production SaaS.');
    const runtime = resolveNodeRuntime(nodeRuntime, first);
    for (const token of tokens) if (!/^[a-zA-Z0-9_./:@=+,%\-]{1,180}$/.test(token) || token.includes('..')) fail(`Argumen start command tidak valid: ${token}`);
    execTokens = [runtime, ...tokens];
  }

  const envFile = `${APP_ENV_DIR}/${slug}.env`;
  mkdir(APP_ENV_DIR, 0o750);
  const environmentAction = payload.environmentAction === 'preserve' ? 'preserve' : 'replace';
  if (environmentAction === 'replace' || !fs.existsSync(envFile)) writeAtomic(envFile, parseAppEnvironment(payload.environmentText), 0o640);
  try { cmd('/usr/bin/chown', [`root:${appUser}`, envFile]); } catch {}

  const limitInt=(value,min,max,label)=>{const n=Number(value||0);if(!Number.isInteger(n)||n<min||n>max)fail(`${label} tidak valid.`);return n;};
  const memoryLimitMb=limitInt(payload.memoryLimitMb,0,65536,'Memory limit');
  const cpuQuotaPercent=limitInt(payload.cpuQuotaPercent,0,800,'CPU quota');
  const tasksMax=limitInt(payload.tasksMax,0,4096,'Tasks max');
  const unit = `/etc/systemd/system/hostapp-${slug}.service`;
  const execStart = execTokens.map(systemdQuote).join(' ');
  const restartLine = restartPolicy === 'no' ? 'Restart=no' : `Restart=${restartPolicy}`;
  const resourceLines=[memoryLimitMb?`MemoryMax=${memoryLimitMb}M`:'',cpuQuotaPercent?`CPUQuota=${cpuQuotaPercent}%`:'',tasksMax?`TasksMax=${tasksMax}`:''].filter(Boolean).join('\n');
  const content = `[Unit]\nDescription=HostPanel App ${slug}\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nUser=${appUser}\nGroup=${appUser}\nWorkingDirectory=${workingDir}\nEnvironment=NODE_ENV=production\nEnvironment=HOST=127.0.0.1\nEnvironment=PORT=${port}\nEnvironmentFile=-${envFile}\nExecStart=${execStart}\n${restartLine}\nRestartSec=3\nTimeoutStopSec=20\nKillSignal=SIGINT\nNoNewPrivileges=true\nPrivateTmp=true\nPrivateDevices=true\nProtectSystem=strict\nProtectHome=true\nProtectKernelTunables=true\nProtectKernelModules=true\nProtectKernelLogs=true\nProtectControlGroups=true\nRestrictSUIDSGID=true\nRestrictNamespaces=true\nLockPersonality=true\nReadWritePaths=${baseDir}\nLimitNOFILE=65535\n${resourceLines}${resourceLines?'\n':''}\n[Install]\nWantedBy=multi-user.target\n`;
  writeAtomic(unit, content, 0o644);
  cmd('/usr/bin/systemctl', ['daemon-reload']);
  cmd('/usr/bin/systemctl', ['enable', `hostapp-${slug}`]);
  cmd('/usr/bin/systemctl', ['restart', `hostapp-${slug}`]);
  console.log(JSON.stringify({ ok: true, service: `hostapp-${slug}`, user: appUser, startMode: mode, nodeRuntime, workingDir }));
}

function appUpsertFromStdin() {
  let payload;
  try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { fail('Payload JSON aplikasi tidak valid.'); }
  return appUpsertPayload(payload);
}

function appStatusAll() {
  const units = fs.readdirSync('/etc/systemd/system').filter((name) => /^hostapp-[a-z0-9][a-z0-9-]{1,39}\.service$/.test(name)).sort();
  const result = [];
  for (const unit of units) {
    const slug = unit.replace(/^hostapp-/, '').replace(/\.service$/, '');
    try {
      const text = cmd('/usr/bin/systemctl', ['show', unit, '--no-pager', '--property=ActiveState,SubState,MainPID,ExecMainStatus,ExecMainStartTimestamp'], { capture: true });
      const data = Object.fromEntries(text.split(/\r?\n/).filter(Boolean).map((line) => { const i=line.indexOf('='); return [line.slice(0,i), line.slice(i+1)]; }));
      result.push({ slug, service: unit.replace(/\.service$/, ''), activeState: data.ActiveState || 'unknown', subState: data.SubState || 'unknown', pid: Number(data.MainPID || 0), exitCode: Number(data.ExecMainStatus || 0), startedAt: data.ExecMainStartTimestamp || '' });
    } catch { result.push({ slug, service: unit.replace(/\.service$/, ''), activeState: 'unknown', subState: 'unknown', pid: 0, exitCode: null, startedAt: '' }); }
  }
  console.log(JSON.stringify(result));
}

function appLogs(slug, linesRaw) {
  slug = safeSlug(slug);
  const lines = Math.min(300, Math.max(20, Number(linesRaw || 100) || 100));
  const service = `hostapp-${slug}`;
  normalizeService(service);
  const out = cmd('/usr/bin/journalctl', ['-u', service, '-n', String(lines), '--no-pager', '-o', 'short-iso'], { capture: true, timeout: 15000 });
  console.log(out);
}

function appRemove(slug) {
  slug = safeSlug(slug); const service = `hostapp-${slug}`;
  try { cmd('/usr/bin/systemctl', ['disable', '--now', service]); } catch {}
  try { fs.unlinkSync(`/etc/systemd/system/${service}.service`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  try { fs.unlinkSync(`${APP_ENV_DIR}/${slug}.env`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  cmd('/usr/bin/systemctl', ['daemon-reload']);
  const user = appUserName(slug); try { cmd('/usr/sbin/userdel', [user]); } catch {}
  console.log(`${service}:removed`);
}

function currentZoneSerial(zoneFile) {
  try {
    const text = fs.readFileSync(zoneFile, 'utf8');
    const match = text.match(/\(\s*\n\s*(\d+)\s+/m);
    return match ? Number(match[1]) : 0;
  } catch { return 0; }
}

function nextZoneSerial(zoneFile) {
  const now = Math.floor(Date.now() / 1000);
  const old = currentZoneSerial(zoneFile);
  const next = Math.max(now, old + 1);
  if (!Number.isSafeInteger(next) || next > 0xffffffff) fail('SOA serial melebihi batas 32-bit.');
  return next;
}

function txtPresentation(value) {
  // Satu character-string DNS dibatasi 255 octet. Pecah konservatif di 200 byte;
  // beberapa quoted strings pada TXT akan dikonkatenasi oleh resolver.
  const chunks = [];
  let current = '';
  for (const ch of Array.from(value)) {
    if (Buffer.byteLength(current + ch, 'utf8') > 200) {
      if (!current) fail('TXT berisi karakter yang terlalu besar.');
      chunks.push(current); current = ch;
    } else current += ch;
  }
  if (current || !chunks.length) chunks.push(current);
  return chunks.map(part => `"${part.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(' ');
}

function srvPresentation(rec) {
  const parts = String(rec.value || '').trim().split(/\s+/);
  let priority, weight, port, target;
  if (parts.length === 4) {
    [priority, weight, port, target] = parts;
  } else if (parts.length === 3 && rec.priority != null) {
    priority = String(rec.priority); [weight, port, target] = parts;
  } else fail('SRV gunakan Priority + value "weight port target"; format lama "priority weight port target" juga diterima.');
  const nums = [priority, weight, port].map(Number);
  if (nums.some(n => !Number.isInteger(n) || n < 0 || n > 65535) || Number(port) === 0) fail('Nilai SRV tidak valid.');
  const cleanTarget = String(target || '').replace(/\.$/, '');
  if (!DOMAIN_RE.test(cleanTarget)) fail('Target SRV tidak valid.');
  return `${priority} ${weight} ${port} ${fqdn(cleanTarget)}`;
}

function validateRecord(rec) {
  const type = String(rec.type || '').toUpperCase();
  if (!['A','AAAA','CNAME','MX','TXT','NS','CAA','SRV'].includes(type)) fail('Tipe record tidak didukung.');
  const name = String(rec.name || '@').toLowerCase();
  if (!OWNER_RE.test(name)) fail(`Owner record tidak valid: ${name}`);
  const ttl = Number(rec.ttl || 300); if (!Number.isInteger(ttl) || ttl < 60 || ttl > 86400) fail('TTL tidak valid.');
  const value = String(rec.value || '').trim(); if (!value || value.length > 512 || /[\r\n]/.test(value)) fail('Nilai record tidak valid.');
  const priority = rec.priority == null ? null : Number(rec.priority);
  if (type === 'A' && net.isIP(value) !== 4) fail('A record bukan IPv4.');
  if (type === 'AAAA' && net.isIP(value) !== 6) fail('AAAA record bukan IPv6.');
  if (['CNAME','NS','MX'].includes(type) && !DOMAIN_RE.test(value.replace(/\.$/, ''))) fail(`${type} target tidak valid.`);
  if (type === 'CAA' && !/^\d{1,3}\s+(issue|issuewild|iodef)\s+"[^"\r\n]{1,240}"$/i.test(value)) fail('CAA gunakan format: 0 issue "letsencrypt.org"');
  if (type === 'SRV') {
    const parts = value.split(/\s+/);
    if (![3,4].includes(parts.length)) fail('SRV gunakan Priority + value: weight port target; format lama priority weight port target juga diterima.');
    const nums = parts.slice(0, -1).map(Number);
    if (nums.some(n => !Number.isInteger(n) || n < 0 || n > 65535)) fail('Angka SRV harus 0-65535.');
    const portIndex = parts.length === 4 ? 2 : 1;
    if (Number(parts[portIndex]) === 0) fail('Port SRV harus 1-65535.');
    if (!DOMAIN_RE.test(parts.at(-1).replace(/\.$/, ''))) fail('Target SRV tidak valid.');
    if (parts.length === 3 && (!Number.isInteger(priority) || priority < 0 || priority > 65535)) fail('SRV membutuhkan Priority 0-65535.');
  }
  if (type === 'MX' && (!Number.isInteger(priority) || priority < 0 || priority > 65535)) fail('MX priority tidak valid.');
  return { name, type, ttl, value, priority };
}

function recordLine(rec) {
  const r = validateRecord(rec);
  let value = r.value;
  if (['CNAME','NS'].includes(r.type)) value = fqdn(value);
  if (r.type === 'MX') value = `${r.priority} ${fqdn(value)}`;
  if (r.type === 'TXT') value = txtPresentation(value);
  if (r.type === 'SRV') value = srvPresentation(r);
  return `${r.name.padEnd(24)} ${String(r.ttl).padEnd(6)} IN ${r.type.padEnd(6)} ${value}`;
}

function rebuildBindInclude() {
  mkdir(ZONE_META_DIR); mkdir(BIND_ZONE_DIR);
  const blocks = [], keyIncludes = new Set();
  const files = fs.readdirSync(ZONE_META_DIR).filter(f => f.endsWith('.json')).sort();
  for (const f of files) {
    const meta = JSON.parse(fs.readFileSync(path.join(ZONE_META_DIR, f), 'utf8'));
    const d = safeDomain(meta.domain);
    const agent = loadAgent();
    const secondaryIPs = (agent.secondaryIPs || []).filter(ip => net.isIP(ip)).slice(0, 4);
    const transfer = secondaryIPs.length ? `\n  allow-transfer { ${secondaryIPs.join('; ')}; };\n  also-notify { ${secondaryIPs.join('; ')}; };\n  notify yes;` : '\n  allow-transfer { none; };';
    let update = '';
    if (meta.acme && meta.acme.keyFile && meta.acme.keyName) {
      const keyFile = String(meta.acme.keyFile);
      const keyName = String(meta.acme.keyName);
      if (!/^\/etc\/bind\/hostpanel-acme-[a-f0-9]{12}\.key$/.test(keyFile) || !/^hostpanel-acme-[a-f0-9]{12}$/.test(keyName)) fail('Metadata ACME BIND tidak valid.');
      keyIncludes.add(keyFile);
      update = `\n  update-policy { grant ${keyName} name _acme-challenge.${d}. TXT; };`;
    }
    blocks.push(`zone "${d}" {\n  type master;\n  file "${BIND_ZONE_DIR}/db.${d}";${transfer}${update}${meta.dnssec ? '\n  dnssec-policy default;\n  inline-signing yes;' : ''}\n};\n`);
  }
  const includes=[...keyIncludes].sort().map(file=>`include "${file}";`).join('\n');
  writeAtomic(BIND_INCLUDE, `// Generated by HostPanel. Do not edit.\n${includes ? `${includes}\n\n` : '\n'}${blocks.join('\n')}`, 0o644);
  cmd(namedCheckconfPath(), []);
}
function zoneSync(domain, encoded) {
  domain = safeDomain(domain);
  let payload; try { payload = JSON.parse(Buffer.from(String(encoded), 'base64url').toString('utf8')); } catch { fail('Payload zone tidak valid.'); }
  if (safeDomain(payload.domain) !== domain || !Array.isArray(payload.records) || payload.records.length > 500) fail('Payload zone tidak konsisten.');
  const agent = loadAgent();
  const nameservers = (agent.nameservers || []).map(safeDomain).slice(0, 2);
  if (!nameservers.length) fail('Nameserver belum dikonfigurasi di /etc/hostpanel/agent.json.');
  const zoneFile = path.join(BIND_ZONE_DIR, `db.${domain}`);
  const serial = nextZoneSerial(zoneFile);
  const hostmaster = fqdn(`hostmaster.${domain}`);
  const lines = [
    `$TTL 300`,
    `@ 300 IN SOA ${fqdn(nameservers[0])} ${hostmaster} (`,
    `  ${serial} 3600 900 1209600 300`,
    `)`,
    ...nameservers.map(ns => `@ 300 IN NS ${fqdn(ns)}`),
  ];
  if (agent.serverIPv4 && net.isIP(agent.serverIPv4) === 4) {
    for (const ns of nameservers) {
      if (ns.endsWith(`.${domain}`)) {
        const label = ns.slice(0, -(domain.length + 1));
        if (label && !label.includes('.')) lines.push(`${label} 300 IN A ${agent.serverIPv4}`);
      }
    }
  }
  for (const rec of payload.records) lines.push(recordLine(rec));
  const metaFile = path.join(ZONE_META_DIR, `${domain}.json`);
  const oldZone = fs.existsSync(zoneFile) ? fs.readFileSync(zoneFile) : null;
  const oldMeta = fs.existsSync(metaFile) ? fs.readFileSync(metaFile) : null;
  let existingMeta={}; try{existingMeta=JSON.parse(oldMeta ? oldMeta.toString('utf8') : '{}');}catch{}
  let frozen=false; try{cmd('/usr/sbin/rndc',['freeze',domain],{timeout:10000});frozen=true;try{cmd('/usr/sbin/rndc',['sync','-clean',domain],{timeout:10000});}catch{}}catch{}
  mkdir(BIND_ZONE_DIR); mkdir(ZONE_META_DIR);
  writeAtomic(zoneFile, `${lines.join('\n')}\n`, 0o640);
  writeAtomic(metaFile, JSON.stringify({ ...existingMeta, domain, dnssec: Boolean(payload.dnssec) }, null, 2) + '\n', 0o640);
  try {
    cmd(namedCheckzonePath(), [domain, zoneFile]);
    rebuildBindInclude();
    try { cmd('/usr/bin/chown', ['-R', 'bind:bind', BIND_ZONE_DIR]); } catch {}
    if(frozen){try{cmd('/usr/sbin/rndc',['thaw',domain],{timeout:10000});frozen=false;}catch{}}
    cmd('/usr/bin/systemctl', ['reload', detectBindService() || 'named']);
  } catch (e) {
    if (oldZone) {
      fs.writeFileSync(zoneFile, oldZone, { mode: 0o640 });
      try { cmd('/usr/bin/chown', ['bind:bind', zoneFile]); } catch {}
      try { fs.chmodSync(zoneFile, 0o640); } catch {}
    } else try { fs.unlinkSync(zoneFile); } catch {}
    if (oldMeta) fs.writeFileSync(metaFile, oldMeta, { mode: 0o640 }); else try { fs.unlinkSync(metaFile); } catch {}
    try { rebuildBindInclude(); } catch {}
    if(frozen){try{cmd('/usr/sbin/rndc',['thaw',domain],{timeout:10000});}catch{}}
    fail(`Zone BIND9 gagal divalidasi: ${e.stderr || e.message}`);
  }
  console.log(`zone:${domain}:ok`);
}

function zoneRemove(domain) {
  domain = safeDomain(domain);
  for (const file of [path.join(ZONE_META_DIR, `${domain}.json`), path.join(BIND_ZONE_DIR, `db.${domain}`)]) { try { fs.unlinkSync(file); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
  rebuildBindInclude();
  cmd('/usr/bin/systemctl', ['reload', detectBindService() || 'named']);
  console.log(`zone:${domain}:removed`);
}

function statusAll() {
  const php = detectPhpService();
  const list = [
    { name: 'nginx', service: 'nginx' },
    { name: 'bind9', service: detectBindService() },
    { name: 'php-fpm', service: php },
    { name: 'mariadb', service: 'mariadb' },
  ];
  console.log(JSON.stringify(list.map(x => ({ name: x.name, active: x.service ? shServiceActive(x.service) : false }))));
}

function serviceAction(action, name) {
  if (!['start','stop','restart','reload'].includes(action)) fail('Aksi service tidak diizinkan.');
  const service = normalizeService(name);
  if (action === 'reload' && !['nginx','named','bind9'].includes(service)) fail('Reload hanya diizinkan untuk Nginx/BIND9.');
  cmd('/usr/bin/systemctl', [action, service]);
  console.log(`${service}:${action}:ok`);
}


function parsePhpMyAdminConfig() {
  const file = '/etc/phpmyadmin/config-db.php';
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  const get = (name) => {
    const m = text.match(new RegExp('\\$' + name + '\\s*=\\s*[\\\"\\\']([^\\\"\\\']*)[\\\"\\\']\\s*;'));
    return m ? m[1] : '';
  };
  const user = get('dbuser');
  const password = get('dbpass');
  const database = get('dbname') || 'phpmyadmin';
  if (!/^[a-zA-Z0-9_]{1,32}$/.test(user) || !/^[a-zA-Z0-9_]{1,64}$/.test(database) || /[\r\n]/.test(password)) return null;
  return { user, password, database };
}

function pmaControlConnectionOk() {
  const cfg = parsePhpMyAdminConfig();
  if (!cfg || !cfg.password) return false;
  const tmp = `/run/hostpanel-pma-${process.pid}.cnf`;
  try {
    fs.writeFileSync(tmp, `[client]\nuser=${cfg.user}\npassword=${cfg.password}\nhost=localhost\nprotocol=socket\n`, { mode: 0o600 });
    cmd('/usr/bin/mariadb', [`--defaults-extra-file=${tmp}`, '--batch', '--skip-column-names', '-e', 'SELECT 1'], { capture: true });
    return true;
  } catch { return false; }
  finally { try { fs.unlinkSync(tmp); } catch {} }
}

function sqlLiteral(value) { return `'${String(value).replace(/'/g, "''")}'`; }
function sqlIdent(value) { if (!/^[a-zA-Z0-9_]{1,64}$/.test(String(value))) fail('Identifier SQL internal tidak valid.'); return `\`${value}\``; }

function pmaControlRepair() {
  const cfg = parsePhpMyAdminConfig();
  if (!cfg || !cfg.password) fail('Konfigurasi /etc/phpmyadmin/config-db.php tidak lengkap.');
  const user = cfg.user;
  const dbName = cfg.database;
  const pass = sqlLiteral(cfg.password);
  const sql = [
    `CREATE DATABASE IF NOT EXISTS ${sqlIdent(dbName)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`,
    `CREATE USER IF NOT EXISTS ${sqlLiteral(user)}@'localhost' IDENTIFIED BY ${pass};`,
    `ALTER USER ${sqlLiteral(user)}@'localhost' IDENTIFIED BY ${pass};`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ${sqlIdent(dbName)}.* TO ${sqlLiteral(user)}@'localhost';`,
    'FLUSH PRIVILEGES;',
    '',
  ].join('\n');
  cmdInput('/usr/bin/mariadb', ['--protocol=socket','-uroot'], sql, { capture: true });
  const createTables = '/usr/share/phpmyadmin/sql/create_tables.sql';
  try {
    const count = cmdInput('/usr/bin/mariadb', ['--protocol=socket','-uroot','--batch','--skip-column-names'], `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=${sqlLiteral(dbName)};\n`, { capture: true });
    if (Number(count.trim()) === 0 && fs.existsSync(createTables)) {
      cmdInput('/usr/bin/mariadb', ['--protocol=socket','-uroot', dbName], fs.readFileSync(createTables, 'utf8'), { capture: true, timeout: 60000 });
    }
  } catch {}
  if (!pmaControlConnectionOk()) fail('Controluser phpMyAdmin masih gagal setelah sinkronisasi. Periksa config-db.php dan MariaDB log.');
  console.log(JSON.stringify({ ok: true, username: user, database: dbName }));
}

function credentialsStatus() {
  const meta = loadCredentialMeta();
  let dbUserExists = false;
  try {
    const sql = `SELECT COUNT(*) FROM mysql.user WHERE User='${meta.dbAdminUser}' AND Host='localhost';\n`;
    const out = cmdInput('/usr/bin/mariadb', ['--protocol=socket','-uroot','--batch','--skip-column-names'], sql, { capture: true });
    dbUserExists = Number(out.trim()) > 0;
  } catch {}
  console.log(JSON.stringify({
    dbAdminUser: meta.dbAdminUser,
    pmaBasicUser: meta.pmaBasicUser,
    dbHost: 'localhost',
    dbPort: 3306,
    dbUserExists,
    pmaBasicConfigured: fs.existsSync(PMA_HTPASSWD),
    pmaControlUser: parsePhpMyAdminConfig()?.user || 'phpmyadmin',
    pmaControlDatabase: parsePhpMyAdminConfig()?.database || 'phpmyadmin',
    pmaControlOk: pmaControlConnectionOk(),
  }));
}

function dbAdminRotate() {
  const meta = loadCredentialMeta();
  const user = meta.dbAdminUser;
  if (!/^[a-zA-Z0-9_]{3,32}$/.test(user)) fail('Username database admin tidak valid.');
  const password = randomSecret();
  const sql = [
    `CREATE USER IF NOT EXISTS '${user}'@'localhost' IDENTIFIED BY '${password}';`,
    `ALTER USER '${user}'@'localhost' IDENTIFIED BY '${password}';`,
    `GRANT ALL PRIVILEGES ON *.* TO '${user}'@'localhost' WITH GRANT OPTION;`,
    'FLUSH PRIVILEGES;',
    '',
  ].join('\n');
  cmdInput('/usr/bin/mariadb', ['--protocol=socket','-uroot'], sql, { capture: true });
  redactLegacyCredential('MariaDB admin password');
  console.log(JSON.stringify({ username: user, password, host: 'localhost', port: 3306 }));
}

function pmaBasicRotate() {
  const meta = loadCredentialMeta();
  const user = meta.pmaBasicUser;
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(user)) fail('Username Basic Auth tidak valid.');
  const password = randomSecret();
  // -i reads the password from stdin, so the secret never appears in argv/process listings.
  cmdInput('/usr/bin/htpasswd', ['-i','-B','-C','12','-c',PMA_HTPASSWD,user], `${password}\n`, { capture: true });
  cmd('/usr/bin/chown', ['root:www-data', PMA_HTPASSWD]);
  cmd('/usr/bin/chmod', ['640', PMA_HTPASSWD]);
  redactLegacyCredential('phpMyAdmin HTTP Basic password');
  console.log(JSON.stringify({ username: user, password }));
}

function modeOf(file) { try { return fs.statSync(file).mode & 0o777; } catch { return null; } }
function ownerOf(file) { try { const st = fs.statSync(file); return { uid: st.uid, gid: st.gid }; } catch { return null; } }
function securityAudit() {
  const env = loadPanelEnv();
  const checks = [];
  const add = (id, label, status, detail) => checks.push({ id, label, status, detail });
  const isPass = (v) => v ? 'pass' : 'fail';

  try {
    const user = cmd('/usr/bin/systemctl', ['show','hostpanel','-p','User','--value'], { capture: true });
    add('service-user', 'Panel berjalan sebagai user non-root', isPass(user.trim() === 'hostpanel'), `systemd User=${user.trim() || '-'}`);
  } catch (e) { add('service-user','Panel berjalan sebagai user non-root','fail','Tidak dapat membaca unit hostpanel.'); }

  try {
    const ss = cmd('/usr/bin/ss', ['-lnt'], { capture: true });
    const port = Number(env.PORT || 3030);
    const localPanel = ss.includes(`127.0.0.1:${port}`) && !ss.includes(`0.0.0.0:${port}`) && !ss.includes(`[::]:${port}`);
    add('panel-bind', 'Panel hanya listen di loopback', isPass(localPanel), localPanel ? `127.0.0.1:${port}` : `Periksa listener port ${port}.`);
    const mariaPublic = /(?:0\.0\.0\.0|\[::\]|\*)\:3306\b/.test(ss);
    const mariaLocal = /127\.0\.0\.1\:3306\b/.test(ss);
    add('mariadb-bind', 'MariaDB tidak diekspos ke publik', isPass(mariaLocal && !mariaPublic), mariaLocal && !mariaPublic ? '127.0.0.1:3306' : 'MariaDB harus bind ke 127.0.0.1 saja.');
  } catch { add('panel-bind','Panel hanya listen di loopback','warn','Perintah ss tidak tersedia.'); add('mariadb-bind','MariaDB tidak diekspos ke publik','warn','Perintah ss tidak tersedia.'); }

  const envMode = modeOf('/etc/hostpanel/hostpanel.env'); const envOwner = ownerOf('/etc/hostpanel/hostpanel.env');
  add('env-perms', 'File environment terlindungi', isPass(envMode !== null && envMode <= 0o640 && envOwner?.uid === 0), envMode === null ? 'hostpanel.env tidak ditemukan.' : `mode=${envMode.toString(8)} uid=${envOwner?.uid}`);
  const helperMode = modeOf('/usr/local/sbin/hostpanelctl'); const helperOwner = ownerOf('/usr/local/sbin/hostpanelctl');
  add('helper-owner', 'Privileged helper dimiliki root dan tidak writable user', isPass(helperOwner?.uid === 0 && helperMode !== null && (helperMode & 0o022) === 0), helperMode === null ? 'hostpanelctl tidak ditemukan.' : `mode=${helperMode.toString(8)} uid=${helperOwner?.uid}`);
  const sudoMode = modeOf('/etc/sudoers.d/hostpanel'); const sudoOwner = ownerOf('/etc/sudoers.d/hostpanel');
  add('sudoers-perms', 'Sudo allowlist terlindungi', isPass(sudoOwner?.uid === 0 && sudoMode === 0o440), sudoMode === null ? 'sudoers tidak ditemukan.' : `mode=${sudoMode.toString(8)} uid=${sudoOwner?.uid}`);
  const pmaMode = modeOf(PMA_HTPASSWD); const pmaOwner = ownerOf(PMA_HTPASSWD);
  add('pma-auth', 'phpMyAdmin memakai credential file terbatas', isPass(pmaOwner?.uid === 0 && pmaMode !== null && pmaMode <= 0o640), pmaMode === null ? 'htpasswd phpMyAdmin belum ada.' : `mode=${pmaMode.toString(8)} uid=${pmaOwner?.uid}`);

  add('session-secret', 'SESSION_SECRET kuat', isPass(String(env.SESSION_SECRET || '').length >= 64), `panjang=${String(env.SESSION_SECRET || '').length} karakter (nilai tidak ditampilkan)`);
  add('production', 'NODE_ENV production', isPass(env.NODE_ENV === 'production'), `NODE_ENV=${env.NODE_ENV || '-'}`);
  add('trust-proxy', 'Trust proxy sesuai reverse proxy', ['1','true'].includes(String(env.TRUST_PROXY || '')) ? 'pass' : 'warn', `TRUST_PROXY=${env.TRUST_PROXY || '0'}`);

  try { cmd('/usr/sbin/nginx', ['-t']); add('nginx-test','Konfigurasi Nginx valid','pass','nginx -t sukses.'); }
  catch { add('nginx-test','Konfigurasi Nginx valid','fail','nginx -t gagal.'); }
  try {
    const opts = fs.readFileSync('/etc/bind/named.conf.options','utf8');
    add('bind-recursion','BIND authoritative tanpa recursion', isPass(/recursion\s+no\s*;/i.test(opts)), /recursion\s+no\s*;/i.test(opts) ? 'recursion no' : 'recursion no tidak ditemukan.');
  } catch { add('bind-recursion','BIND authoritative tanpa recursion','warn','named.conf.options tidak dapat dibaca.'); }
  try {
    const ufw = cmd('/usr/sbin/ufw', ['status'], { capture: true });
    add('ufw','Firewall UFW aktif', isPass(/^Status:\s+active/im.test(ufw)), /^Status:\s+active/im.test(ufw) ? 'aktif' : 'tidak aktif');
  } catch { add('ufw','Firewall UFW aktif','warn','Status UFW tidak dapat dibaca.'); }
  add('fail2ban','Fail2ban aktif', isPass(shServiceActive('fail2ban')), shServiceActive('fail2ban') ? 'active' : 'inactive');
  if ((env.TLS_MODE || 'local') === 'local') {
    { const t = renewalTimerName(); add('certbot-timer','Renewal SSL otomatis aktif', isPass(shServiceActive(t) && timerIsEnabled(t)), `${t} harus active+enabled.`); }
    try {
      const cb = certbotPath();
      const ver = cmd(cb, ['--version'], { capture: true });
      add('certbot-version','Certbot modern terisolasi tersedia', fs.existsSync('/opt/certbot/bin/certbot') ? 'pass' : 'warn', `${cb}: ${ver}`);
    } catch { add('certbot-version','Certbot modern terisolasi tersedia','fail','Certbot tidak ditemukan.'); }
  } else add('certbot-timer','Renewal SSL lokal','pass',`TLS_MODE=${env.TLS_MODE || 'local'}; Certbot lokal tidak diwajibkan.`);

  const failures = checks.filter(c => c.status === 'fail').length;
  const warnings = checks.filter(c => c.status === 'warn').length;
  const score = Math.max(0, Math.round(((checks.length - failures - warnings * 0.5) / Math.max(1, checks.length)) * 100));
  console.log(JSON.stringify({ score, failures, warnings, generatedAt: new Date().toISOString(), checks }));
}

function certbotPreflight(domain) {
  domain = safeDomain(domain);
  const token = `hostpanel-${process.pid}-${Date.now()}`;
  const dir = '/var/www/letsencrypt/.well-known/acme-challenge';
  const file = path.join(dir, token);
  mkdir(dir, 0o755);
  fs.writeFileSync(file, `${token}\n`, { mode: 0o644 });
  try {
    let resolved = '';
    try { resolved = cmd('/usr/bin/getent', ['ahostsv4', domain], { capture: true }).split('\n')[0] || ''; }
    catch { fail(`DNS ${domain} belum dapat di-resolve dari server. Pastikan record A/AAAA sudah benar.`); }
    let body = '';
    try {
      body = cmd('/usr/bin/curl', ['-4','-fsS','--max-time','12',`http://${domain}/.well-known/acme-challenge/${token}`], { capture: true });
    } catch (error) {
      const detail = [error.stdout, error.stderr].filter(Boolean).map(x => String(x).trim()).filter(Boolean).join(' | ');
      fail(`Preflight ACME gagal untuk ${domain}. HTTP publik port 80 belum mencapai Nginx/ACME webroot. Pastikan DNS dan routing/provider meneruskan HTTP publik port 80 ke Nginx port 80 untuk domain ini. ${detail}`.trim());
    }
    if (body.trim() !== token) {
      fail(`Preflight ACME gagal untuk ${domain}: respons challenge tidak cocok. Pastikan domain menuju server ini dan /.well-known/acme-challenge/ tidak diproxy ke aplikasi.`);
    }
    console.log(JSON.stringify({ ok: true, domain, resolved, challengeUrl: `http://${domain}/.well-known/acme-challenge/${token}` }));
  } finally {
    try { fs.unlinkSync(file); } catch {}
  }
}

function parseCertbotFailure(detail, domain) {
  const text = String(detail || '').trim();
  const rate = text.match(/too many certificates[^\n]*already issued for ["']([^"']+)["'][^\n]*retry after\s+([^\n:]+:\d{2}:\d{2}(?:\s+UTC)?)/i)
    || text.match(/retry after\s+([0-9T:+\-.Z ]+)/i);
  if (/too many certificates/i.test(text) && /retry after/i.test(text)) {
    let registeredDomain = '';
    let retryAfter = '';
    const rd = text.match(/already issued for ["']([^"']+)["']/i);
    if (rd) registeredDomain = rd[1];
    const ra = text.match(/retry after\s+([^\n]+)/i);
    if (ra) retryAfter = ra[1].trim().replace(/: see .*$/i, '').trim();
    return { type: 'rate_limit', domain, registeredDomain, retryAfter, message: text };
  }
  if (/AttributeError:\s*can't set attribute/i.test(text)) {
    return { type: 'certbot_version_bug', domain, message: 'Certbot sistem terlalu lama/bermasalah (AttributeError: can\'t set attribute). HostPanel v0.6.0 menggunakan Certbot venv di /opt/certbot; jalankan upgrade v0.6.0.' };
  }
  if (/unauthorized|invalid response|challenge/i.test(text)) return { type: 'challenge_failed', domain, message: text };
  return { type: 'certbot_error', domain, message: text || 'Certbot gagal tanpa detail.' };
}

function emitSslError(error) {
  fail(`HOSTPANEL_SSL_ERROR:${JSON.stringify(error)}`);
}

function activateExistingCertificate(domain, port) {
  domain = safeDomain(domain); port = safePort(port);
  const match = findCertificateForDomain(domain);
  if (!match) {
    fail(`Tidak ada sertifikat Let's Encrypt yang mencakup ${domain}. Panel menerima certificate exact atau wildcard satu tingkat, misalnya *.example.com untuk host.example.com.`);
  }
  const nginxFile = path.join(NGINX_AVAILABLE, `${domain}.conf`);
  const old = fs.existsSync(nginxFile) ? fs.readFileSync(nginxFile) : null;
  writeAtomic(nginxFile, nginxLocalTlsConfig(domain, port, match.certDir), 0o644);
  const link = path.join(NGINX_ENABLED, `${domain}.conf`);
  if (!fs.existsSync(link)) fs.symlinkSync(nginxFile, link);
  try { nginxTestReload(); }
  catch (error) {
    if (old) fs.writeFileSync(nginxFile, old);
    try { nginxTestReload(); } catch {}
    fail(`Sertifikat ditemukan (${match.name}), tetapi aktivasi HTTPS Nginx gagal: ${error.stderr || error.message}`);
  }
  console.log(JSON.stringify({
    ok: true,
    domain,
    certificateName: match.name,
    certificate: match.cert,
    matchedNames: match.names,
    source: match.exact ? 'existing-exact' : 'existing-wildcard'
  }));
}

function certbotAcquire(domain, email, dryRun = false) {
  domain = safeDomain(domain); email = String(email || '').trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) fail('Email Certbot tidak valid.');
  certbotPreflight(domain);
  const certbot = certbotPath();
  const args = [
    'certonly','--webroot','-w','/var/www/letsencrypt',
    '--non-interactive','--agree-tos','--no-eff-email',
    '-m',email,'-d',domain,
  ];
  if (dryRun) args.push('--dry-run','--no-directory-hooks');
  else args.push('--keep-until-expiring','--cert-name',domain);
  try {
    cmd(certbot, args, { timeout: 180000, capture: true });
  } catch (error) {
    const detail = [error.stdout, error.stderr].filter(Boolean).map(x => String(x).trim()).filter(Boolean).join('\n');
    emitSslError(parseCertbotFailure(detail || error.message, domain));
  }
  if (dryRun) return { dryRun: true };
  const cert = `/etc/letsencrypt/live/${domain}/fullchain.pem`;
  const key = `/etc/letsencrypt/live/${domain}/privkey.pem`;
  if (!fs.existsSync(cert) || !fs.existsSync(key)) fail(`Certbot selesai tetapi file sertifikat ${domain} tidak ditemukan.`);
  return { cert, key };
}

function enableRenewalTimer() {
  try { cmd('/usr/bin/systemctl', ['enable', '--now', 'hostpanel-certbot-renew.timer']); }
  catch { try { cmd('/usr/bin/systemctl', ['enable', '--now', 'certbot.timer']); } catch {} }
}

function writeNginxWithRollback(file, content) {
  const old = fs.existsSync(file) ? fs.readFileSync(file) : null;
  writeAtomic(file, content, 0o644);
  const link = path.join(NGINX_ENABLED, path.basename(file));
  if (!fs.existsSync(link)) fs.symlinkSync(file, link);
  try { nginxTestReload(); }
  catch (error) {
    if (old) fs.writeFileSync(file, old); else { try { fs.unlinkSync(file); } catch {} try { fs.unlinkSync(link); } catch {} }
    try { nginxTestReload(); } catch {}
    fail(`Konfigurasi HTTPS Nginx gagal: ${error.stderr || error.message}`);
  }
}

function certbotIssue(domain, email, port, dryRun = false) {
  domain = safeDomain(domain); port = safePort(port);
  certbotAcquire(domain, email, dryRun);
  if (dryRun) {
    console.log(JSON.stringify({ ok: true, domain, staging: true, message: 'ACME staging/dry-run berhasil; sertifikat production tidak diubah.' }));
    return;
  }
  writeNginxWithRollback(path.join(NGINX_AVAILABLE, `${domain}.conf`), nginxLocalTlsConfig(domain, port));
  enableRenewalTimer();
  console.log(JSON.stringify({ ok: true, domain, certificate: `/etc/letsencrypt/live/${domain}/fullchain.pem`, autoRenew: true }));
}

function configuredSystemDomain(kind) {
  const env = loadPanelEnv();
  if (kind === 'panel') return safeDomain(env.PANEL_DOMAIN || '');
  if (kind === 'phpmyadmin') {
    const raw = String(env.PHPMYADMIN_URL || '');
    let hostname = '';
    try { hostname = new URL(raw).hostname; } catch {}
    if (!hostname) fail('PHPMYADMIN_URL belum dikonfigurasi.');
    return safeDomain(hostname);
  }
  fail('Jenis domain sistem tidak valid.');
}

function assertSystemTarget(kind, domain) {
  const configured = configuredSystemDomain(kind);
  domain = safeDomain(domain);
  if (configured !== domain) fail(`Domain ${domain} bukan target sistem ${kind} yang dikonfigurasi.`);
  return domain;
}

function systemTargetConfig(kind, domain, port, certDir = `/etc/letsencrypt/live/${domain}`) {
  if (kind === 'panel') return nginxLocalTlsConfig(domain, safePort(port), certDir);
  if (kind === 'phpmyadmin') return phpMyAdminTlsConfig(domain, certDir);
  fail('Jenis domain sistem tidak valid.');
}

function certbotSystemIssue(kind, domain, email, port, dryRun = false) {
  domain = assertSystemTarget(kind, domain);
  if (!['panel','phpmyadmin'].includes(kind)) fail('Jenis domain sistem tidak valid.');
  certbotAcquire(domain, email, dryRun);
  if (dryRun) {
    console.log(JSON.stringify({ ok: true, kind, domain, staging: true }));
    return;
  }
  writeNginxWithRollback(path.join(NGINX_AVAILABLE, `${domain}.conf`), systemTargetConfig(kind, domain, port));
  enableRenewalTimer();
  console.log(JSON.stringify({ ok: true, kind, domain, certificate: `/etc/letsencrypt/live/${domain}/fullchain.pem`, autoRenew: true }));
}

function activateExistingSystemCertificate(kind, domain, port) {
  domain = assertSystemTarget(kind, domain);
  if (!['panel','phpmyadmin'].includes(kind)) fail('Jenis domain sistem tidak valid.');
  const match = findCertificateForDomain(domain);
  if (!match) fail(`Tidak ada sertifikat Let's Encrypt yang mencakup ${domain}.`);
  writeNginxWithRollback(
    path.join(NGINX_AVAILABLE, `${domain}.conf`),
    systemTargetConfig(kind, domain, port, match.certDir)
  );
  enableRenewalTimer();
  console.log(JSON.stringify({
    ok: true,
    kind,
    domain,
    certificateName: match.name,
    certificate: match.cert,
    matchedNames: match.names,
    source: match.exact ? 'existing-exact' : 'existing-wildcard'
  }));
}


function safeEmail(raw){const email=String(raw||'').trim();if(!/^\S+@\S+\.\S+$/.test(email)||email.length>254)fail('Email Certbot tidak valid.');return email;}
function certbotCredentialDir(){const dir='/etc/hostpanel/certbot';mkdir(dir,0o700);try{fs.chmodSync(dir,0o700);}catch{}return dir;}
function writeCertbotCredential(name,content){const file=path.join(certbotCredentialDir(),name);writeAtomic(file,content,0o600);try{fs.chmodSync(file,0o600);}catch{}return file;}
function ensureLocalBindAcme(domain){
  domain=safeDomain(domain); const hash=crypto.createHash('sha256').update(domain).digest('hex').slice(0,12);
  const keyName=`hostpanel-acme-${hash}`, keyFile=`/etc/bind/hostpanel-acme-${hash}.key`, metaFile=path.join(ZONE_META_DIR,`${domain}.json`);
  if(!fs.existsSync(metaFile))fail('Zone BIND9 lokal belum dikelola HostPanel.');
  let keyText='';
  if(!fs.existsSync(keyFile)){
    const tool=resolveBin('tsig-keygen',['/usr/sbin/tsig-keygen','/usr/bin/tsig-keygen']);
    keyText=cmd(tool,['-a','hmac-sha256',keyName],{capture:true});
    fs.writeFileSync(keyFile,`${keyText.trim()}\n`,{mode:0o640});
    try{cmd('/usr/bin/chown',['root:bind',keyFile]);}catch{}
  } else keyText=fs.readFileSync(keyFile,'utf8');
  const secret=keyText.match(/secret\s+"([A-Za-z0-9+/=]+)"\s*;/)?.[1];
  if(!secret)fail('Secret TSIG lokal tidak dapat dibaca.');
  const meta=JSON.parse(fs.readFileSync(metaFile,'utf8'));
  meta.acme={provider:'local-bind',keyName,keyFile};
  writeAtomic(metaFile,JSON.stringify(meta,null,2)+'\n',0o640);
  rebuildBindInclude();
  cmd('/usr/bin/systemctl',['reload',detectBindService()||'named']);
  const cred=writeCertbotCredential(`rfc2136-${hash}.ini`,`dns_rfc2136_server = 127.0.0.1\ndns_rfc2136_port = 53\ndns_rfc2136_name = ${keyName}.\ndns_rfc2136_secret = ${secret}\ndns_rfc2136_algorithm = HMAC-SHA256\n`);
  return{provider:'rfc2136',credentialFile:cred,server:'127.0.0.1',keyName};
}
function certbotWildcardFromStdin(){
  const p=readJsonStdin('Wildcard SSL'); const domain=safeDomain(p.domain),email=safeEmail(p.email),provider=String(p.provider||'').trim();
  const certbot=certbotPath(); let plugin='',credentialFile='',propagation=Math.max(10,Math.min(Number(p.propagationSeconds)||30,600));
  const hash=crypto.createHash('sha256').update(`${provider}:${domain}`).digest('hex').slice(0,12);
  if(provider==='cloudflare'){
    const token=String(p.apiToken||'').trim(); if(token.length<20||token.length>2048||/[\r\n\0\s]/.test(token))fail('Cloudflare API token tidak valid.');
    credentialFile=writeCertbotCredential(`cloudflare-${hash}.ini`,`dns_cloudflare_api_token = ${token}\n`); plugin='cloudflare';
  } else if(provider==='rfc2136'){
    const server=String(p.server||'').trim().replace(/\.$/,''); if(net.isIP(server)===0&&!DOMAIN_RE.test(server))fail('RFC2136 server tidak valid.');
    const port=Number(p.port||53); if(!Number.isInteger(port)||port<1||port>65535)fail('RFC2136 port tidak valid.');
    const name=String(p.keyName||'').trim().replace(/\.$/,''); if(!/^[A-Za-z0-9_.-]{1,253}$/.test(name))fail('RFC2136 key name tidak valid.');
    const secret=String(p.secret||'').trim(); if(!/^[A-Za-z0-9+/=]{16,1024}$/.test(secret))fail('RFC2136 secret tidak valid.');
    const algorithm=String(p.algorithm||'HMAC-SHA256').toUpperCase(); if(!['HMAC-SHA256','HMAC-SHA512'].includes(algorithm))fail('RFC2136 algorithm tidak didukung.');
    credentialFile=writeCertbotCredential(`rfc2136-${hash}.ini`,`dns_rfc2136_server = ${server}\ndns_rfc2136_port = ${port}\ndns_rfc2136_name = ${name}.\ndns_rfc2136_secret = ${secret}\ndns_rfc2136_algorithm = ${algorithm}\n`); plugin='rfc2136';
  } else if(provider==='local-bind'){
    const cfg=ensureLocalBindAcme(domain);credentialFile=cfg.credentialFile;plugin='rfc2136';propagation=Math.max(10,Math.min(Number(p.propagationSeconds)||20,600));
  } else fail('Provider wildcard SSL tidak didukung.');
  const args=['certonly',`--dns-${plugin}`,`--dns-${plugin}-credentials`,credentialFile,`--dns-${plugin}-propagation-seconds`,String(propagation),'--non-interactive','--agree-tos','--no-eff-email','--expand','--cert-name',domain,'-m',email,'-d',domain,'-d',`*.${domain}`];
  try{cmd(certbot,args,{timeout:300000,capture:true});}catch(error){const detail=[error.stdout,error.stderr].filter(Boolean).join('\n');emitSslError(parseCertbotFailure(detail||error.message,domain));}
  const match=findCertificateForDomain(domain);if(!match||!match.names.includes(`*.${domain}`))fail('Certbot selesai tetapi SAN wildcard tidak ditemukan.');
  enableRenewalTimer();
  console.log(JSON.stringify({ok:true,domain,provider,certificateName:match.name,domains:match.names,autoRenew:true,credentialFile}));
}
function certbotPath() {
  for (const file of ['/opt/certbot/bin/certbot', '/usr/local/bin/certbot', '/usr/bin/certbot']) if (fs.existsSync(file)) return file;
  fail('Certbot tidak ditemukan. Jalankan installer/upgrade HostPanel untuk memasang Certbot terbaru.');
}

function renewalTimerName() {
  if (fs.existsSync('/etc/systemd/system/hostpanel-certbot-renew.timer')) return 'hostpanel-certbot-renew.timer';
  return 'certbot.timer';
}

function timerIsEnabled(unit) {
  try { cmd('/usr/bin/systemctl', ['is-enabled', '--quiet', unit]); return true; } catch { return false; }
}

function certificateInfo() {
  const liveDir = '/etc/letsencrypt/live';
  if (!fs.existsSync(liveDir)) return [];
  const out = [];
  for (const name of fs.readdirSync(liveDir)) {
    if (name === 'README') continue;
    const cert = path.join(liveDir, name, 'fullchain.pem');
    if (!fs.existsSync(cert)) continue;
    try {
      const text = cmd('/usr/bin/openssl', ['x509', '-in', cert, '-noout', '-enddate', '-subject', '-ext', 'subjectAltName'], { capture: true });
      const endMatch = text.match(/^notAfter=(.+)$/m);
      const expires = endMatch ? new Date(endMatch[1].trim()) : null;
      const san = [...text.matchAll(/DNS:([^,\s]+)/g)].map(m => m[1].trim().toLowerCase());
      const cn = text.match(/subject=.*?CN\s*=\s*([^,\n]+)/i)?.[1]?.trim().toLowerCase();
      const domains = [...new Set((san.length ? san : cn ? [cn] : []).filter(Boolean))];
      const daysRemaining = expires && !Number.isNaN(expires.getTime())
        ? Math.ceil((expires.getTime() - Date.now()) / 86400000)
        : null;
      let renewalAuthenticator = '';
      let renewalAuto = true;
      try {
        const renewalFile = path.join('/etc/letsencrypt/renewal', `${name}.conf`);
        const renewalText = fs.readFileSync(renewalFile, 'utf8');
        renewalAuthenticator = renewalText.match(/^authenticator\s*=\s*(.+)$/m)?.[1]?.trim() || '';
        if (renewalAuthenticator === 'manual') {
          const hasAuthHook = /^manual_auth_hook\s*=\s*\S+/m.test(renewalText);
          renewalAuto = hasAuthHook;
        }
      } catch {}
      out.push({
        name,
        domains,
        expiresAt: expires && !Number.isNaN(expires.getTime()) ? expires.toISOString() : '',
        daysRemaining,
        renewalAuthenticator,
        renewalAuto,
      });
    } catch {}
  }
  return out.sort((a, b) => (a.daysRemaining ?? 999999) - (b.daysRemaining ?? 999999));
}

function sslStatus() {
  const env = loadPanelEnv();
  const timerName = renewalTimerName();
  const timerActive = shServiceActive(timerName);
  const timerEnabled = timerIsEnabled(timerName);
  let nextRun = '';
  let certbotVersion = '';
  try { nextRun = cmd('/usr/bin/systemctl', ['show', timerName, '-p', 'NextElapseUSecRealtime', '--value']); } catch {}
  try { certbotVersion = cmd(certbotPath(), ['--version'], { capture: true }); } catch {}
  console.log(JSON.stringify({
    tlsMode: env.TLS_MODE || 'local',
    timerName,
    timerActive,
    timerEnabled,
    nextRun,
    certbotVersion,
    certificates: certificateInfo(),
  }));
}

function certbotRenew(dryRun = false) {
  const args = ['renew', '--non-interactive'];
  if (dryRun) args.push('--dry-run'); else args.push('--quiet');
  try {
    cmd(certbotPath(), args, { timeout: 240000, capture: true });
  } catch (error) {
    const detail = [error.stdout, error.stderr].filter(Boolean).map(x => String(x).trim()).filter(Boolean).join('\n');
    emitSslError(parseCertbotFailure(detail || error.message, 'renewal'));
  }
  if (dryRun) cmd('/usr/sbin/nginx', ['-t']);
  else nginxTestReload();
  console.log(dryRun ? 'certbot:dry-run:ok' : 'certbot:renew:ok');
}


const DB_NAME_RE = /^[a-zA-Z0-9_]{1,64}$/;
const DB_USER_RE = /^[a-zA-Z0-9_]{3,32}$/;
const GITHUB_REPO_RE = /^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(?:\.git)?$/;
const GIT_BRANCH_RE = /^[a-zA-Z0-9._\/-]{1,100}$/;
const NPM_SCRIPT_RE = /^[a-zA-Z0-9:_-]{1,64}$/;

function safeDbName(raw) {
  const value = String(raw || '');
  if (!DB_NAME_RE.test(value) || ['mysql','information_schema','performance_schema','sys','phpmyadmin'].includes(value.toLowerCase())) fail('Nama database tidak diizinkan.');
  return value;
}
function safeDbUser(raw) {
  const value = String(raw || '');
  if (!DB_USER_RE.test(value) || ['root','mysql','mariadb.sys','phpmyadmin'].includes(value.toLowerCase())) fail('Username database tidak diizinkan.');
  return value;
}
function safeGitRepo(raw) {
  const value = String(raw || '');
  if (!GITHUB_REPO_RE.test(value)) fail('Repository harus HTTPS GitHub.');
  return value.endsWith('.git') ? value : `${value}.git`;
}
function safeGitBranch(raw) {
  const value = String(raw || 'main');
  if (!GIT_BRANCH_RE.test(value) || value.includes('..') || value.startsWith('/') || value.endsWith('/')) fail('Branch Git tidak valid.');
  return value;
}
function safeNpmScript(raw) {
  const value = String(raw || '');
  if (!value) return '';
  if (!NPM_SCRIPT_RE.test(value)) fail('Nama npm script tidak valid.');
  return value;
}
function runAsHostapps(file, args, opts = {}) {
  const runuser = ['/usr/sbin/runuser','/usr/bin/runuser'].find(fs.existsSync);
  if (!runuser) fail('runuser tidak ditemukan.');
  return cmd(runuser, ['-u','hostapps','--',file,...args], opts);
}
function dirSize(root) {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const file = path.join(root, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) total += dirSize(file);
      else if (entry.isFile()) total += fs.statSync(file).size;
    }
  } catch {}
  return total;
}
function metricsSummary() {
  const mem = {};
  try {
    for (const line of fs.readFileSync('/proc/meminfo','utf8').split(/\r?\n/)) {
      const m=line.match(/^([^:]+):\s+(\d+)\s+kB$/); if(m) mem[m[1]]=Number(m[2])*1024;
    }
  } catch {}
  let disk = { total:0, used:0, free:0, percent:0 };
  try {
    const line=cmd('/bin/df',['-B1','--output=size,used,avail,pcent','/'],{capture:true}).split(/\r?\n/).filter(Boolean).at(-1).trim().split(/\s+/);
    disk={ total:Number(line[0]||0), used:Number(line[1]||0), free:Number(line[2]||0), percent:Number(String(line[3]||'0').replace('%',''))||0 };
  } catch {}
  const total=mem.MemTotal||os.totalmem(), free=(mem.MemAvailable||mem.MemFree||os.freemem()), used=Math.max(0,total-free);
  console.log(JSON.stringify({ hostname:os.hostname(), uptimeSeconds:os.uptime(), loadavg:os.loadavg(), cpuCount:os.cpus().length, memory:{total,used,free}, disk, networkMode:loadAgent().networkMode||loadAgent().platform||'unknown', runtimeMode:'system' }));
}
function safeBackupName(raw){const v=String(raw||'');if(!/^\d{8}-\d{6}$/.test(v))fail('Nama backup tidak valid.');return v;}
function backupListData() {
  const root='/var/backups/hostpanel'; if(!fs.existsSync(root)) return [];
  return fs.readdirSync(root,{withFileTypes:true}).filter(x=>x.isDirectory()&&/^\d{8}-\d{6}$/.test(x.name)).map((x)=>{ const full=path.join(root,x.name); const st=fs.statSync(full); return {name:x.name,createdAt:st.mtime.toISOString(),sizeBytes:dirSize(full),verified:verifyBackupInternal(x.name,false)}; }).sort((a,b)=>b.name.localeCompare(a.name));
}
function verifyBackupInternal(name, strict=true) {
  name=String(name||''); if(!/^\d{8}-\d{6}$/.test(name)){ if(strict)fail('Nama backup tidak valid.'); return false; }
  const dir=path.join('/var/backups/hostpanel',name), sumFile=path.join(dir,'SHA256SUMS'); if(!fs.existsSync(sumFile)){ if(strict)fail('SHA256SUMS backup tidak ditemukan.'); return false; }
  try {
    for(const line of fs.readFileSync(sumFile,'utf8').split(/\r?\n/).filter(Boolean)){
      const m=line.match(/^([a-f0-9]{64})\s+\*?(.+)$/i); if(!m) throw new Error('Format checksum tidak valid.');
      const base=path.basename(m[2]); if(base!==m[2]) throw new Error('Path checksum tidak aman.');
      const file=path.join(dir,base); const digest=cmd('/usr/bin/sha256sum',[file],{capture:true}).split(/\s+/)[0]; if(digest.toLowerCase()!==m[1].toLowerCase()) throw new Error(`Checksum ${base} tidak cocok.`);
    }
    return true;
  } catch(e){ if(strict)fail(e.message); return false; }
}
function backupList(){ console.log(JSON.stringify(backupListData())); }
function backupCreate(){ const script='/opt/hostpanel/scripts/backup.sh'; if(!fs.existsSync(script))fail('Script backup tidak ditemukan.'); cmd('/bin/bash',[script],{timeout:300000}); const item=backupListData()[0]||{}; console.log(JSON.stringify(item)); }
function backupVerify(name){ const verified=verifyBackupInternal(name,true); console.log(JSON.stringify({ok:true,name,verified})); }
function backupRestoreSchedule(nameRaw){
  const name=safeBackupName(nameRaw); const dir=path.join('/var/backups/hostpanel',name);
  verifyBackupInternal(name,true);
  const configArchive=path.join(dir,'hostpanel-config.tgz');
  if(!fs.existsSync(configArchive))fail('hostpanel-config.tgz tidak ditemukan.');
  // Make a safety backup without deleting older recovery points before scheduling restore.
  const backupScript='/opt/hostpanel/scripts/backup.sh';
  if(fs.existsSync(backupScript))cmd('/bin/bash',[backupScript],{timeout:300000,env:{...process.env,RETENTION_DAYS:'36500'}});
  const unit=`hostpanel-restore-${Date.now()}`;
  const script=`#!/usr/bin/env bash\nset -Eeuo pipefail\numask 077\nDIR=${JSON.stringify(dir)}\nLOG=/var/log/hostpanel-restore.log\nexec >>\"$LOG\" 2>&1\necho \"[$(date -Is)] restore start: $DIR\"\nsystemctl stop hostpanel.service || true\ntar -xzf \"$DIR/hostpanel-config.tgz\" -C /\nif [[ -f \"$DIR/apps-source.tgz\" ]]; then tar -xzf \"$DIR/apps-source.tgz\" -C /; fi\nif [[ -f \"$DIR/mariadb-all.sql.gz\" ]]; then gzip -dc \"$DIR/mariadb-all.sql.gz\" | mariadb --protocol=socket -uroot; fi\nsystemctl daemon-reload\nnginx -t && systemctl reload nginx || true\nif command -v named-checkconf >/dev/null 2>&1; then named-checkconf && (systemctl reload named || systemctl reload bind9 || true); fi\nsystemctl restart hostpanel.service\necho \"[$(date -Is)] restore complete\"\nrm -f -- \"$0\"\n`;
  const restoreFile=`/run/${unit}.sh`; fs.writeFileSync(restoreFile,script,{mode:0o700});
  cmd('/usr/bin/systemd-run',['--unit',unit,'--on-active=3s','/bin/bash',restoreFile],{timeout:30000});
  console.log(JSON.stringify({ok:true,name,unit,message:'Restore dijadwalkan. Panel akan restart otomatis.'}));
}
function backupOffsite(nameRaw,remoteRaw){
  const name=safeBackupName(nameRaw), remote=String(remoteRaw||'').trim();
  if(!/^[a-zA-Z0-9_-]{1,64}$/.test(remote))fail('Nama remote rclone tidak valid.');
  verifyBackupInternal(name,true);
  const rclone=resolveBin('rclone',['/usr/bin/rclone','/usr/local/bin/rclone']);
  const remotes=cmd(rclone,['listremotes'],{capture:true}).split(/\r?\n/).filter(Boolean).map(x=>x.replace(/:$/,''));
  if(!remotes.includes(remote))fail(`Remote rclone ${remote} belum dikonfigurasi pada root.`);
  const host=os.hostname().replace(/[^a-zA-Z0-9._-]/g,'_');
  const source=path.join('/var/backups/hostpanel',name), destination=`${remote}:nusantara-hostpanel/${host}/${name}`;
  cmd(rclone,['copy',source,destination,'--checksum','--immutable','--transfers','2','--checkers','4'],{timeout:1800000});
  console.log(JSON.stringify({ok:true,name,remote,destination}));
}
function dbList(){
  const sql="SELECT s.SCHEMA_NAME, COALESCE(SUM(t.DATA_LENGTH+t.INDEX_LENGTH),0) FROM information_schema.SCHEMATA s LEFT JOIN information_schema.TABLES t ON t.TABLE_SCHEMA=s.SCHEMA_NAME WHERE s.SCHEMA_NAME NOT IN ('mysql','information_schema','performance_schema','sys','phpmyadmin') GROUP BY s.SCHEMA_NAME ORDER BY s.SCHEMA_NAME";
  const out=cmd('/usr/bin/mariadb',['--protocol=socket','-uroot','-N','-B','-e',sql],{capture:true});
  const databases=out.split(/\r?\n/).filter(Boolean).map((line)=>{const [name,size]=line.split('\t'); let users=[]; try{const uq=`SELECT DISTINCT GRANTEE FROM information_schema.SCHEMA_PRIVILEGES WHERE TABLE_SCHEMA='${name.replace(/'/g,"''")}'`; users=cmd('/usr/bin/mariadb',['--protocol=socket','-uroot','-N','-B','-e',uq],{capture:true}).split(/\r?\n/).filter(Boolean);}catch{} return {name,sizeBytes:Number(size||0),users};});
  console.log(JSON.stringify(databases));
}
function dbCreate(name){ name=safeDbName(name); cmdInput('/usr/bin/mariadb',['--protocol=socket','-uroot'],`CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\n`); console.log(JSON.stringify({ok:true,name,created:true})); }
function dbUserCreate(database,user){ database=safeDbName(database); user=safeDbUser(user); const password=randomSecret(); const esc=password.replace(/\\/g,'\\\\').replace(/'/g,"''"); const sql=`CREATE USER IF NOT EXISTS '${user}'@'localhost' IDENTIFIED BY '${esc}';\nALTER USER '${user}'@'localhost' IDENTIFIED BY '${esc}';\nGRANT ALL PRIVILEGES ON \`${database}\`.* TO '${user}'@'localhost';\nFLUSH PRIVILEGES;\n`; cmdInput('/usr/bin/mariadb',['--protocol=socket','-uroot'],sql); console.log(JSON.stringify({ok:true,database,username:user,password,host:'localhost'})); }
function dbDrop(name,confirm){ name=safeDbName(name); if(String(confirm||'')!==name) fail('Konfirmasi nama database tidak cocok.'); cmdInput('/usr/bin/mariadb',['--protocol=socket','-uroot'],`DROP DATABASE \`${name}\`;\n`); console.log(JSON.stringify({ok:true,name,dropped:true})); }
function appHealth(portRaw,pathRaw){
  const port=safePort(portRaw); const healthPath=String(pathRaw||'/'); if(!/^\/[a-zA-Z0-9._~!$&'()*+,;=:@%\/-]{0,200}$/.test(healthPath)||healthPath.includes('..'))fail('Health path tidak valid.');
  const started=Date.now(); const req=http.get({host:'127.0.0.1',port,path:healthPath,timeout:3000,headers:{Host:'localhost',Connection:'close'}},(res)=>{res.resume();res.on('end',()=>{const ok=res.statusCode>=200&&res.statusCode<400;console.log(JSON.stringify({ok,statusCode:res.statusCode,latencyMs:Date.now()-started}));process.exit(ok?0:2);});});
  req.on('timeout',()=>req.destroy(new Error('Health check timeout.'))); req.on('error',(e)=>fail(`Health check gagal: ${e.message}`,2));
}
function ensureGitWorkspace(workingDirRaw,repoRaw,branchRaw,buildScriptRaw){
  const workingDir=safePath(workingDirRaw), repo=safeGitRepo(repoRaw), branch=safeGitBranch(branchRaw), buildScript=safeNpmScript(buildScriptRaw);
  if(!fs.existsSync(workingDir)){
    mkdir(workingDir,0o750);
    cmd('/usr/bin/chown',['hostapps:hostapps',workingDir]);
  }
  const realWorkingDir=fs.realpathSync(workingDir);
  if(!(realWorkingDir==='/nusantara-hostpanel/apps'||realWorkingDir.startsWith('/nusantara-hostpanel/apps/'))) fail('Working directory symlink keluar dari /nusantara-hostpanel/apps tidak diizinkan.');
  const gitBin=resolveBin('git',['/usr/bin/git','/usr/local/bin/git']);
  const npmBin=resolveRuntime('npm');
  if(!fs.existsSync(path.join(realWorkingDir,'.git'))){
    if(fs.readdirSync(realWorkingDir).length) fail('Working directory harus kosong untuk import Git pertama.');
    runAsHostapps(gitBin,['clone','--origin','origin','--branch',branch,'--single-branch',repo,realWorkingDir],{timeout:180000});
  } else {
    const remote=runAsHostapps(gitBin,['-C',realWorkingDir,'remote','get-url','origin'],{capture:true});
    if(remote.replace(/\.git$/,'')!==repo.replace(/\.git$/,'')) fail('Remote origin tidak sama dengan repository yang dikonfigurasi.');
    runAsHostapps(gitBin,['-C',realWorkingDir,'fetch','--prune','origin',branch],{timeout:180000});
    runAsHostapps(gitBin,['-C',realWorkingDir,'checkout','-B',branch,'FETCH_HEAD'],{timeout:60000});
  }
  if(!fs.existsSync(path.join(realWorkingDir,'package.json'))) fail('package.json tidak ditemukan pada repository.');
  if(!fs.existsSync(path.join(realWorkingDir,'package-lock.json')) && !fs.existsSync(path.join(realWorkingDir,'npm-shrinkwrap.json'))) fail('Git deploy mewajibkan package-lock.json atau npm-shrinkwrap.json agar dependency reproducible.');
  runAsHostapps(npmBin,['ci','--no-audit','--no-fund'],{cwd:realWorkingDir,timeout:300000});
  if(buildScript) runAsHostapps(npmBin,['run',buildScript],{cwd:realWorkingDir,timeout:300000});
  runAsHostapps(npmBin,['prune','--omit=dev','--no-audit','--no-fund'],{cwd:realWorkingDir,timeout:300000});
  const commit=runAsHostapps(gitBin,['-C',realWorkingDir,'rev-parse','HEAD'],{capture:true});
  return {workingDir:realWorkingDir,repo,branch,buildScript,commit};
}
function appBootstrapGit(slugRaw,workingDirRaw,repoRaw,branchRaw,buildScriptRaw){
  const slug=safeSlug(slugRaw);
  const result=ensureGitWorkspace(workingDirRaw,repoRaw,branchRaw,buildScriptRaw);
  console.log(JSON.stringify({ok:true,slug,commit:result.commit,branch:result.branch,message:'Git project imported. Runtime service will be created next.'}));
}
function appDeploy(slugRaw,workingDirRaw,repoRaw,branchRaw,buildScriptRaw){
  const slug=safeSlug(slugRaw), workingDir=safePath(workingDirRaw);
  const gitBin=resolveBin('git',['/usr/bin/git','/usr/local/bin/git']);
  const npmBin=resolveRuntime('npm');
  let previous='';
  try { if(fs.existsSync(path.join(workingDir,'.git'))) previous=runAsHostapps(gitBin,['-C',workingDir,'rev-parse','HEAD'],{capture:true}); } catch {}
  try {
    const result=ensureGitWorkspace(workingDir,repoRaw,branchRaw,buildScriptRaw);
    cmd('/usr/bin/systemctl',['restart',`hostapp-${slug}`]);
    console.log(JSON.stringify({ok:true,commit:result.commit,branch:result.branch,message:'Git deployment completed.'}));
  } catch(error) {
    if(previous){
      try{
        runAsHostapps(gitBin,['-C',workingDir,'reset','--hard',previous],{timeout:60000});
        runAsHostapps(npmBin,['ci','--omit=dev','--no-audit','--no-fund'],{cwd:workingDir,timeout:300000});
        cmd('/usr/bin/systemctl',['restart',`hostapp-${slug}`]);
      }catch{}
    }
    throw error;
  }
}


function readJsonStdin(label='payload') {
  try { const value=JSON.parse(fs.readFileSync(0,'utf8')||'{}'); if(!value||typeof value!=='object'||Array.isArray(value)) throw new Error(); return value; }
  catch { fail(`${label} JSON tidak valid.`); }
}
function safeSmallName(raw,label='Nama') { const v=String(raw||'').trim().toLowerCase(); if(!/^[a-z0-9][a-z0-9-]{0,31}$/.test(v)) fail(`${label} tidak valid.`); return v; }
function safeEnvKey(raw){const v=String(raw||'').trim().toUpperCase();if(!/^[A-Z_][A-Z0-9_]{0,63}$/.test(v))fail('Nama environment variable tidak valid.');return v;}
function parseEnvFile(file){const out=new Map();try{for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)){if(!line.trim()||line.trim().startsWith('#'))continue;const i=line.indexOf('=');if(i<1)continue;let value=line.slice(i+1);if(value.startsWith('"')&&value.endsWith('"')){value=value.slice(1,-1).replace(/\\"/g,'"').replace(/\\\\/g,'\\');}out.set(line.slice(0,i).trim(),value);}}catch{}return out;}
function writeEnvMap(slug,map){const file=path.join(APP_ENV_DIR,`${safeSlug(slug)}.env`);mkdir(APP_ENV_DIR,0o750);const lines=[];for(const [key,value] of [...map.entries()].sort((a,b)=>a[0].localeCompare(b[0]))){safeEnvKey(key);if(String(value).length>4096||/[\0\r\n]/.test(String(value)))fail(`Nilai ${key} tidak valid.`);lines.push(`${key}="${String(value).replace(/\\/g,'\\\\').replace(/"/g,'\\"')}"`);}writeAtomic(file,lines.join('\n')+(lines.length?'\n':''),0o640);const user=ensureAppUser(slug);try{cmd('/usr/bin/chown',[`root:${user}`,file]);}catch{}return file;}
function appEnvSetFromStdin(){const p=readJsonStdin('Environment');const slug=safeSlug(p.slug),key=safeEnvKey(p.key),value=String(p.value??'');if(value.length>4096||/[\0\r\n]/.test(value))fail('Nilai environment tidak valid.');const file=path.join(APP_ENV_DIR,`${slug}.env`),map=parseEnvFile(file);map.set(key,value);writeEnvMap(slug,map);try{cmd('/usr/bin/systemctl',['restart',`hostapp-${slug}`]);}catch{}console.log(JSON.stringify({ok:true,key}));}
function appEnvRemoveFromStdin(){const p=readJsonStdin('Environment');const slug=safeSlug(p.slug),key=safeEnvKey(p.key);const file=path.join(APP_ENV_DIR,`${slug}.env`),map=parseEnvFile(file);map.delete(key);writeEnvMap(slug,map);try{cmd('/usr/bin/systemctl',['restart',`hostapp-${slug}`]);}catch{}console.log(JSON.stringify({ok:true,key}));}
function appEnvKeys(slugRaw){const slug=safeSlug(slugRaw),map=parseEnvFile(path.join(APP_ENV_DIR,`${slug}.env`));console.log(JSON.stringify([...map.keys()].sort()));}

function appMetricsAll(){const units=fs.existsSync('/etc/systemd/system')?fs.readdirSync('/etc/systemd/system').filter(n=>/^hostapp-[a-z0-9][a-z0-9-]{1,39}\.service$/.test(n)):[];const out=[];for(const unit of units){const slug=unit.slice(8,-8);try{const text=cmd('/usr/bin/systemctl',['show',unit,'--property=MemoryCurrent,TasksCurrent,NRestarts,CPUUsageNSec,MainPID','--no-pager'],{capture:true});const d=Object.fromEntries(text.split(/\r?\n/).filter(Boolean).map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1)];}));out.push({slug,memoryBytes:Number(d.MemoryCurrent||0)||0,tasks:Number(d.TasksCurrent||0)||0,restarts:Number(d.NRestarts||0)||0,cpuUsageNSec:Number(d.CPUUsageNSec||0)||0,pid:Number(d.MainPID||0)||0});}catch{out.push({slug,memoryBytes:0,tasks:0,restarts:0,cpuUsageNSec:0,pid:0});}}console.log(JSON.stringify(out));}

function safeProcessCommand(raw,nodeRuntime='system'){const text=String(raw||'').trim();if(!text||text.length>500||/[;&|`$<>\\\n\r]/.test(text))fail('Command proses tidak aman.');const parts=text.split(/\s+/).filter(Boolean);if(!parts.length||parts.length>24)fail('Command proses tidak valid.');const first=parts.shift();if(!['node','npm','npx'].includes(first))fail('Worker/cron hanya mengizinkan node/npm/npx.');const bin=resolveNodeRuntime(nodeRuntime,first);for(const token of parts)if(!/^[a-zA-Z0-9_./:@=+,%\-]{1,180}$/.test(token)||token.includes('..'))fail('Argumen worker/cron tidak valid.');return[bin,...parts];}
function workerUpsertFromStdin(){const p=readJsonStdin('Worker');const slug=safeSlug(p.slug),name=safeSmallName(p.name,'Nama worker'),base=safePath(p.workingDir),instances=Math.max(1,Math.min(Number(p.instances)||1,8)),user=ensureAppUser(slug),work=runtimeWorkingDirectory(base),exec=safeProcessCommand(p.command,p.nodeRuntime||'system').map(systemdQuote).join(' '),mem=Number(p.memoryLimitMb||0),restart=['always','on-failure','no'].includes(p.restartPolicy)?p.restartPolicy:'on-failure';for(const f of fs.readdirSync('/etc/systemd/system')){if(f.startsWith(`hostworker-${slug}-${name}-`)&&f.endsWith('.service')){try{cmd('/usr/bin/systemctl',['disable','--now',f]);}catch{}try{fs.unlinkSync(path.join('/etc/systemd/system',f));}catch{}}}for(let i=1;i<=instances;i++){const unit=`hostworker-${slug}-${name}-${i}.service`;const content=`[Unit]\nDescription=HostPanel worker ${slug}/${name} #${i}\nAfter=network-online.target hostapp-${slug}.service\n\n[Service]\nType=simple\nUser=${user}\nGroup=${user}\nWorkingDirectory=${work}\nEnvironment=NODE_ENV=production\nEnvironmentFile=-${APP_ENV_DIR}/${slug}.env\nExecStart=${exec}\nRestart=${restart==='no'?'no':restart}\nRestartSec=3\nNoNewPrivileges=true\nPrivateTmp=true\nPrivateDevices=true\nProtectSystem=strict\nProtectHome=true\nReadWritePaths=${base}\n${mem?`MemoryMax=${mem}M\n`:''}\n[Install]\nWantedBy=multi-user.target\n`;writeAtomic(path.join('/etc/systemd/system',unit),content,0o644);}cmd('/usr/bin/systemctl',['daemon-reload']);for(let i=1;i<=instances;i++)cmd('/usr/bin/systemctl',['enable','--now',`hostworker-${slug}-${name}-${i}.service`]);console.log(JSON.stringify({ok:true,instances}));}
function workerRemove(slugRaw,nameRaw){const slug=safeSlug(slugRaw),name=safeSmallName(nameRaw,'Nama worker');for(const f of fs.readdirSync('/etc/systemd/system')){if(f.startsWith(`hostworker-${slug}-${name}-`)&&f.endsWith('.service')){try{cmd('/usr/bin/systemctl',['disable','--now',f]);}catch{}try{fs.unlinkSync(path.join('/etc/systemd/system',f));}catch{}}}cmd('/usr/bin/systemctl',['daemon-reload']);console.log(JSON.stringify({ok:true}));}
function workerStatus(slugRaw){const slug=safeSlug(slugRaw),out=[];for(const f of fs.readdirSync('/etc/systemd/system').filter(x=>x.startsWith(`hostworker-${slug}-`)&&x.endsWith('.service')).sort()){let active=false;try{active=shServiceActive(f);}catch{}out.push({unit:f.replace(/\.service$/,''),active});}console.log(JSON.stringify(out));}

function onCalendar(raw){const v=String(raw||'daily');if(v==='hourly')return'hourly';if(v==='daily')return'daily';if(v==='weekly')return'weekly';if(/^\*-\*-\*\s+(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(v))return v;fail('Schedule cron tidak valid.');}
function cronUpsertFromStdin(){const p=readJsonStdin('Cron');const slug=safeSlug(p.slug),name=safeSmallName(p.name,'Nama job'),base=safePath(p.workingDir),user=ensureAppUser(slug),work=runtimeWorkingDirectory(base),exec=safeProcessCommand(p.command,p.nodeRuntime||'system').map(systemdQuote).join(' '),calendar=onCalendar(p.schedule);const service=`hostcron-${slug}-${name}.service`,timer=`hostcron-${slug}-${name}.timer`;writeAtomic(path.join('/etc/systemd/system',service),`[Unit]\nDescription=HostPanel cron ${slug}/${name}\n\n[Service]\nType=oneshot\nUser=${user}\nGroup=${user}\nWorkingDirectory=${work}\nEnvironment=NODE_ENV=production\nEnvironmentFile=-${APP_ENV_DIR}/${slug}.env\nExecStart=${exec}\nNoNewPrivileges=true\nPrivateTmp=true\nProtectSystem=strict\nProtectHome=true\nReadWritePaths=${base}\n`,0o644);writeAtomic(path.join('/etc/systemd/system',timer),`[Unit]\nDescription=Schedule ${slug}/${name}\n\n[Timer]\nOnCalendar=${calendar}\nPersistent=true\nRandomizedDelaySec=30\nUnit=${service}\n\n[Install]\nWantedBy=timers.target\n`,0o644);cmd('/usr/bin/systemctl',['daemon-reload']);cmd('/usr/bin/systemctl',['enable','--now',timer]);console.log(JSON.stringify({ok:true,timer,calendar}));}
function cronRemove(slugRaw,nameRaw){const slug=safeSlug(slugRaw),name=safeSmallName(nameRaw,'Nama job');for(const suffix of ['timer','service']){const unit=`hostcron-${slug}-${name}.${suffix}`;try{cmd('/usr/bin/systemctl',['disable','--now',unit]);}catch{}try{fs.unlinkSync(path.join('/etc/systemd/system',unit));}catch{}}cmd('/usr/bin/systemctl',['daemon-reload']);console.log(JSON.stringify({ok:true}));}
function cronStatus(slugRaw){const slug=safeSlug(slugRaw),out=[];for(const f of fs.readdirSync('/etc/systemd/system').filter(x=>x.startsWith(`hostcron-${slug}-`)&&x.endsWith('.timer')).sort()){let active=false;try{active=shServiceActive(f);}catch{}out.push({unit:f.replace(/\.timer$/,''),active});}console.log(JSON.stringify(out));}

function logUnitForSource(source){if(source==='hostpanel')return'hostpanel';if(source==='nginx')return'nginx';if(source==='mariadb')return'mariadb';if(source==='bind9')return detectBindService()||'named';if(source==='php-fpm')return detectPhpService()||fail('PHP-FPM tidak ditemukan.');const m=String(source||'').match(/^app:([a-z0-9][a-z0-9-]{1,39})$/);if(m)return`hostapp-${safeSlug(m[1])}`;fail('Sumber log tidak valid.');}
function logsTail(sourceRaw,linesRaw){const unit=logUnitForSource(String(sourceRaw||'')),lines=Math.max(20,Math.min(Number(linesRaw)||200,500));const out=cmd('/usr/bin/journalctl',['-u',unit,'-n',String(lines),'--no-pager','-o','short-iso'],{capture:true,timeout:15000});console.log(out);}

const DB_DUMP_ROOT='/var/backups/hostpanel/databases';
function safeDumpName(raw){const v=path.basename(String(raw||''));if(v!==String(raw||'')||!/^[a-zA-Z0-9_]+-\d{8}-\d{6}\.sql\.gz$/.test(v))fail('Nama dump tidak valid.');return v;}
function dbDump(databaseRaw){const database=safeDbName(databaseRaw);mkdir(DB_DUMP_ROOT,0o700);const stamp=new Date().toISOString().replace(/[-:T]/g,'').slice(0,14);const name=`${database}-${stamp.slice(0,8)}-${stamp.slice(8)}.sql.gz`,file=path.join(DB_DUMP_ROOT,name);const dump=resolveBin('mariadb-dump',['/usr/bin/mariadb-dump','/usr/bin/mysqldump']);const gzip=resolveBin('gzip',['/usr/bin/gzip','/bin/gzip']);const shell=resolveBin('sh',['/bin/sh']);cmd(shell,['-c',`umask 077; "${dump}" --protocol=socket -uroot --single-transaction --routines --triggers --events --databases "${database}" | "${gzip}" -9 > "${file}"`],{timeout:300000});console.log(JSON.stringify({ok:true,name,sizeBytes:fs.statSync(file).size}));}
function dbDumpList(databaseRaw){const database=safeDbName(databaseRaw);mkdir(DB_DUMP_ROOT,0o700);const prefix=`${database}-`;const out=fs.readdirSync(DB_DUMP_ROOT).filter(n=>n.startsWith(prefix)&&n.endsWith('.sql.gz')).sort().reverse().slice(0,50).map(name=>({name,sizeBytes:fs.statSync(path.join(DB_DUMP_ROOT,name)).size,createdAt:fs.statSync(path.join(DB_DUMP_ROOT,name)).mtime.toISOString()}));console.log(JSON.stringify(out));}
function dbDumpRestore(databaseRaw,dumpRaw){const database=safeDbName(databaseRaw),name=safeDumpName(dumpRaw);if(!name.startsWith(`${database}-`))fail('Dump bukan milik database target.');const file=path.join(DB_DUMP_ROOT,name);if(!fs.existsSync(file))fail('Dump tidak ditemukan.');const shell=resolveBin('sh',['/bin/sh']);cmdInput('/usr/bin/mariadb',['--protocol=socket','-uroot'],`DROP DATABASE IF EXISTS \`${database}\`; CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\n`);cmd(shell,['-c',`gzip -dc "${file}" | /usr/bin/mariadb --protocol=socket -uroot`],{timeout:300000});console.log(JSON.stringify({ok:true,name,database}));}

function installCommandTokens(raw,nodeRuntime){const v=String(raw||'npm ci');const allowed={'npm ci':['npm','ci','--no-audit','--no-fund'],'npm install':['npm','install','--no-audit','--no-fund'],'pnpm install --frozen-lockfile':['pnpm','install','--frozen-lockfile'],'yarn install --immutable':['yarn','install','--immutable']};const parts=allowed[v];if(!parts)fail('Install command tidak diizinkan.');const binName=parts[0];const bin=['npm','npx','node'].includes(binName)?resolveNodeRuntime(nodeRuntime,binName):resolveRuntime(binName);return[bin,...parts.slice(1)];}
function runAsAppEnv(slug,file,args,opts={},extraEnv={}){const user=ensureAppUser(slug),runuser=['/usr/sbin/runuser','/usr/bin/runuser'].find(fs.existsSync);if(!runuser)fail('runuser tidak ditemukan.');const envPairs=Object.entries(extraEnv).map(([k,v])=>`${k}=${String(v)}`);return cmd(runuser,['-u',user,'--','/usr/bin/env','PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',...envPairs,file,...args],opts);}
function gitEnvironment(token){if(!token)return{};return{GIT_TERMINAL_PROMPT:'0',GIT_ASKPASS:'/opt/hostpanel/scripts/git-askpass.sh',NHP_GIT_TOKEN:String(token),NHP_GIT_USERNAME:'x-access-token'};}
function atomicSymlink(target,link){const tmp=`${link}.next-${process.pid}`;try{fs.unlinkSync(tmp);}catch{}fs.symlinkSync(target,tmp);fs.renameSync(tmp,link);}
function currentReleaseId(base){try{const target=fs.realpathSync(path.join(base,'current'));if(target.startsWith(path.join(base,'releases')+path.sep))return path.basename(target);}catch{}return'';}
function safeReleaseId(raw){const v=String(raw||'');if(!/^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{7,40}$/.test(v))fail('Release ID tidak valid.');return v;}
function healthCheckCurl(portRaw,pathRaw){const port=safePort(portRaw),hp=String(pathRaw||'/');if(!/^\/[a-zA-Z0-9._~!$&'()*+,;=:@%\/-]{0,200}$/.test(hp)||hp.includes('..'))fail('Health path tidak valid.');const started=Date.now();try{const code=cmd('/usr/bin/curl',['-sS','-o','/dev/null','-w','%{http_code}','--max-time','5',`http://127.0.0.1:${port}${hp}`],{capture:true,timeout:8000});const status=Number(code);return{ok:status>=200&&status<400,statusCode:status,latencyMs:Date.now()-started};}catch(error){return{ok:false,statusCode:0,latencyMs:Date.now()-started,error:String(error.stderr||error.message||'health failed').slice(0,500)};}}
function lockfileHash(dir){for(const name of ['package-lock.json','pnpm-lock.yaml','yarn.lock']){const file=path.join(dir,name);if(fs.existsSync(file)&&fs.statSync(file).isFile())return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}return'';}
function appDeployFromStdin(){const buildStarted=Date.now();const p=readJsonStdin('Deployment');const slug=safeSlug(p.slug),base=safePath(p.workingDir),repo=safeGitRepo(p.gitRepo),branch=safeGitBranch(p.gitBranch),build=safeNpmScript(p.buildScript||''),nodeRuntime=String(p.nodeRuntime||'system'),keep=Math.max(2,Math.min(Number(p.releaseKeep)||5,20)),token=String(p.gitToken||'');if(token&&(token.length<20||token.length>2048||/[\r\n\0]/.test(token)))fail('Git token tidak valid.');const user=ensureAppUser(slug);mkdir(base,0o750);mkdir(path.join(base,'releases'),0o750);try{cmd('/usr/bin/chown',['-R',`${user}:${user}`,base],{timeout:120000});}catch{}const previous=currentReleaseId(base);const releaseTemp=`build-${Date.now()}-${process.pid}`,tempDir=path.join(base,'releases',releaseTemp),git=resolveBin('git',['/usr/bin/git','/usr/local/bin/git']),gitEnv=gitEnvironment(token);try{runAsAppEnv(slug,git,['clone','--origin','origin','--branch',branch,'--single-branch','--depth','1',repo,tempDir],{timeout:300000},gitEnv);if(!fs.existsSync(path.join(tempDir,'package.json')))fail('package.json tidak ditemukan pada repository.');const commit=runAsAppEnv(slug,git,['-C',tempDir,'rev-parse','HEAD'],{capture:true},gitEnv).trim();const releaseId=`${new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')}-${commit.slice(0,12)}`;const finalDir=path.join(base,'releases',releaseId);fs.renameSync(tempDir,finalDir);const install=installCommandTokens(p.installCommand||'npm ci',nodeRuntime);runAsAppEnv(slug,install[0],install.slice(1),{cwd:finalDir,timeout:600000});if(build){const npm=resolveNodeRuntime(nodeRuntime,'npm');runAsAppEnv(slug,npm,['run',build],{cwd:finalDir,timeout:600000});}if(install[0].endsWith('/npm')){const npm=resolveNodeRuntime(nodeRuntime,'npm');runAsAppEnv(slug,npm,['prune','--omit=dev','--no-audit','--no-fund'],{cwd:finalDir,timeout:600000});}atomicSymlink(finalDir,path.join(base,'current'));try{appUpsertPayload({...p,workingDir:base,environmentAction:'preserve'});}catch(error){if(previous){atomicSymlink(path.join(base,'releases',previous),path.join(base,'current'));try{appUpsertPayload({...p,workingDir:base,environmentAction:'preserve'});}catch{}}throw error;}const health=healthCheckCurl(p.port,p.healthPath||'/');if(!health.ok){if(previous){atomicSymlink(path.join(base,'releases',previous),path.join(base,'current'));appUpsertPayload({...p,workingDir:base,environmentAction:'preserve'});}fail(`Release baru gagal health check (${health.statusCode||'no-response'}), rollback otomatis dilakukan.`);}const dirs=fs.readdirSync(path.join(base,'releases'),{withFileTypes:true}).filter(x=>x.isDirectory()&&/^\d{8}T\d{6}Z-[a-f0-9]+$/.test(x.name)).map(x=>x.name).sort().reverse();for(const old of dirs.slice(keep)){if(old!==releaseId&&old!==previous)fs.rmSync(path.join(base,'releases',old),{recursive:true,force:true});}console.log(JSON.stringify({ok:true,commit,branch,releaseId,path:finalDir,previousReleaseId:previous,health,nodeRuntime,lockfileHash:lockfileHash(finalDir),buildDurationMs:Date.now()-buildStarted,message:'Atomic deployment active.'}));}catch(error){try{if(fs.existsSync(tempDir))fs.rmSync(tempDir,{recursive:true,force:true});}catch{}throw error;}}
function appReleaseActivate(slugRaw,baseRaw,releaseRaw){const slug=safeSlug(slugRaw),base=safePath(baseRaw),releaseId=safeReleaseId(releaseRaw),dir=path.join(base,'releases',releaseId);if(!fs.existsSync(dir)||!fs.statSync(dir).isDirectory())fail('Release tidak ditemukan.');atomicSymlink(dir,path.join(base,'current'));cmd('/usr/bin/systemctl',['restart',`hostapp-${slug}`]);console.log(JSON.stringify({ok:true,releaseId,path:dir}));}


function safePreviewSlug(raw){const value=String(raw||'');if(!/^[a-z0-9][a-z0-9-]{2,39}$/.test(value))fail('Preview slug tidak valid.');return value;}
function previewExecTokens(p,workingDir){const mode=['node','npm','command'].includes(String(p.startMode))?String(p.startMode):'npm',nodeRuntime=String(p.nodeRuntime||'system');if(mode==='node'){const entry=safeEntry(p.entryFile||'server.js'),full=path.join(workingDir,entry);if(!fs.existsSync(full)||!fs.statSync(full).isFile())fail(`Preview entry ${entry} tidak ditemukan.`);return[resolveNodeRuntime(nodeRuntime,'node'),full];}if(mode==='npm'){const script=safeNpmScript(p.npmScript||'start')||'start';if(!fs.existsSync(path.join(workingDir,'package.json')))fail('package.json preview tidak ditemukan.');return[resolveNodeRuntime(nodeRuntime,'npm'),'run',script];}const text=String(p.startCommand||'').trim();if(!text||/[;&|`$<>\\\n\r]/.test(text))fail('Start command preview tidak aman.');const parts=text.split(/\s+/).filter(Boolean),first=parts.shift();if(!['node','npm','npx'].includes(first))fail('Preview command hanya node/npm/npx.');for(const token of parts)if(!/^[a-zA-Z0-9_./:@=+,%\-]{1,180}$/.test(token)||token.includes('..'))fail('Argumen preview tidak valid.');return[resolveNodeRuntime(nodeRuntime,first),...parts];}
function previewDeployFromStdin(){const p=readJsonStdin('Preview');const appSlug=safeSlug(p.appSlug),previewSlug=safePreviewSlug(p.previewSlug),base=safePath(p.workingDir),repo=safeGitRepo(p.gitRepo),branch=safeGitBranch(p.branch),port=safePort(p.port),build=safeNpmScript(p.buildScript||''),nodeRuntime=String(p.nodeRuntime||'system'),token=String(p.gitToken||'');if(token&&(token.length<20||token.length>2048||/[\r\n\0]/.test(token)))fail('Git token preview tidak valid.');const user=ensureAppUser(appSlug),previewBase=path.join(base,'previews'),target=path.join(previewBase,previewSlug),tmp=`${target}.build-${process.pid}`;if(!target.startsWith(base+path.sep))fail('Preview path tidak valid.');mkdir(previewBase,0o750);try{cmd('/usr/bin/chown',['-R',`${user}:${user}`,previewBase]);}catch{}const unit=`hostpreview-${previewSlug}.service`,envDir=path.join(APP_ENV_DIR,'previews'),envFile=path.join(envDir,`${previewSlug}.env`);mkdir(envDir,0o750);const envText=parseAppEnvironment(p.environmentText||'');writeAtomic(envFile,envText,0o640);try{cmd('/usr/bin/chown',[`root:${user}`,envFile]);}catch{}try{cmd('/usr/bin/systemctl',['disable','--now',unit]);}catch{}try{fs.rmSync(tmp,{recursive:true,force:true});}catch{}const git=resolveBin('git',['/usr/bin/git','/usr/local/bin/git']),gitEnv=gitEnvironment(token);try{runAsAppEnv(appSlug,git,['clone','--origin','origin','--branch',branch,'--single-branch','--depth','1',repo,tmp],{timeout:300000},gitEnv);if(!fs.existsSync(path.join(tmp,'package.json')))fail('package.json preview tidak ditemukan.');const commit=runAsAppEnv(appSlug,git,['-C',tmp,'rev-parse','HEAD'],{capture:true},gitEnv).trim();const install=installCommandTokens(p.installCommand||'npm ci',nodeRuntime);runAsAppEnv(appSlug,install[0],install.slice(1),{cwd:tmp,timeout:600000});if(build){const npm=resolveNodeRuntime(nodeRuntime,'npm');runAsAppEnv(appSlug,npm,['run',build],{cwd:tmp,timeout:600000});}if(install[0].endsWith('/npm')){const npm=resolveNodeRuntime(nodeRuntime,'npm');runAsAppEnv(appSlug,npm,['prune','--omit=dev','--no-audit','--no-fund'],{cwd:tmp,timeout:600000});}fs.rmSync(target,{recursive:true,force:true});fs.renameSync(tmp,target);const exec=previewExecTokens(p,target).map(systemdQuote).join(' '),restart=['always','on-failure','no'].includes(String(p.restartPolicy||'on-failure'))?String(p.restartPolicy||'on-failure'):'on-failure';const content=`[Unit]\nDescription=HostPanel Preview ${previewSlug}\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nUser=${user}\nGroup=${user}\nWorkingDirectory=${target}\nEnvironment=NODE_ENV=production\nEnvironment=HOST=127.0.0.1\nEnvironment=PORT=${port}\nEnvironmentFile=-${envFile}\nExecStart=${exec}\nRestart=${restart==='no'?'no':restart}\nRestartSec=3\nTimeoutStopSec=20\nKillSignal=SIGINT\nNoNewPrivileges=true\nPrivateTmp=true\nPrivateDevices=true\nProtectSystem=strict\nProtectHome=true\nProtectKernelTunables=true\nProtectKernelModules=true\nProtectKernelLogs=true\nProtectControlGroups=true\nRestrictSUIDSGID=true\nRestrictNamespaces=true\nLockPersonality=true\nReadWritePaths=${target}\nTasksMax=128\nMemoryMax=${Math.max(128,Math.min(Number(p.memoryLimitMb)||512,4096))}M\n[Install]\nWantedBy=multi-user.target\n`;writeAtomic(`/etc/systemd/system/${unit}`,content,0o644);cmd('/usr/bin/systemctl',['daemon-reload']);cmd('/usr/bin/systemctl',['enable','--now',unit]);let health={ok:false};for(let i=0;i<12;i++){Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,500);health=healthCheckCurl(port,p.healthPath||'/');if(health.ok)break;}if(!health.ok){try{cmd('/usr/bin/systemctl',['disable','--now',unit]);}catch{}fail(`Preview gagal health check (${health.statusCode||'no-response'}).`);}console.log(JSON.stringify({ok:true,previewSlug,commit,path:target,port,health}));}catch(error){try{fs.rmSync(tmp,{recursive:true,force:true});}catch{}throw error;}}
function previewRemove(slugRaw,baseRaw){const previewSlug=safePreviewSlug(slugRaw),base=safePath(baseRaw),unit=`hostpreview-${previewSlug}.service`,target=path.join(base,'previews',previewSlug),envFile=path.join(APP_ENV_DIR,'previews',`${previewSlug}.env`);try{cmd('/usr/bin/systemctl',['disable','--now',unit]);}catch{}try{fs.unlinkSync(`/etc/systemd/system/${unit}`);}catch{}try{fs.unlinkSync(envFile);}catch{}try{fs.rmSync(target,{recursive:true,force:true});}catch{}cmd('/usr/bin/systemctl',['daemon-reload']);console.log(JSON.stringify({ok:true,previewSlug}));}
function previewLogs(slugRaw,linesRaw){const slug=safePreviewSlug(slugRaw),lines=Math.min(300,Math.max(20,Number(linesRaw||100)||100));console.log(cmd('/usr/bin/journalctl',['-u',`hostpreview-${slug}`,'-n',String(lines),'--no-pager','-o','short-iso'],{capture:true,timeout:15000}));}

function appTemplateCreateFromStdin(){const p=readJsonStdin('Template');const slug=safeSlug(p.slug),base=safePath(p.workingDir),template=String(p.template||'express');if(!['express','node-worker','static'].includes(template))fail('Template project tidak didukung.');if(fs.existsSync(base)&&fs.readdirSync(base).length)fail('Folder template harus kosong.');mkdir(base,0o750);const user=ensureAppUser(slug);if(template==='express'){writeAtomic(path.join(base,'package.json'),JSON.stringify({name:slug,version:'1.0.0',private:true,scripts:{start:'node server.js'},dependencies:{express:'^5.1.0'}},null,2)+'\n',0o640);writeAtomic(path.join(base,'server.js'),`'use strict';\nconst express=require('express');const app=express();const port=Number(process.env.PORT||3000);app.get('/healthz',(req,res)=>res.json({ok:true}));app.get('/',(req,res)=>res.send('${slug} is running'));app.listen(port,'127.0.0.1');\n`,0o640);}else if(template==='node-worker'){writeAtomic(path.join(base,'package.json'),JSON.stringify({name:slug,version:'1.0.0',private:true,scripts:{start:'node worker.js'}},null,2)+'\n',0o640);writeAtomic(path.join(base,'worker.js'),`'use strict';\nsetInterval(()=>console.log(new Date().toISOString(),'${slug} worker alive'),60000);\n`,0o640);}else{mkdir(path.join(base,'public'),0o750);writeAtomic(path.join(base,'package.json'),JSON.stringify({name:slug,version:'1.0.0',private:true,scripts:{start:'npx serve -l '+String(p.port||3000)+' public'},dependencies:{serve:'^14.2.4'}},null,2)+'\n',0o640);writeAtomic(path.join(base,'public','index.html'),`<!doctype html><html><body><h1>${slug}</h1></body></html>\n`,0o640);}cmd('/usr/bin/chown',['-R',`${user}:${user}`,base]);console.log(JSON.stringify({ok:true,template}));}

function projectFilePath(slugRaw,baseRaw,relativeRaw){const slug=safeSlug(slugRaw),base=safePath(baseRaw),relative=String(relativeRaw||'').replace(/^\/+/, '');if(relative.includes('..')||/\0/.test(relative)||relative.length>500)fail('Path file tidak valid.');const parts=relative.split('/').filter(Boolean);if(parts.some(x=>x==='.git'||x==='node_modules'||x==='.hostpanel-owner-v1'||x==='.env'))fail('Path internal/sensitif tidak dapat diakses dari File Manager.');const root=runtimeWorkingDirectory(base),target=path.resolve(root,relative||'.');if(target!==root&&!target.startsWith(root+path.sep))fail('Path keluar dari project.');return{slug,root,target,relative};}
function filesListFromStdin(){const p=readJsonStdin('Files');const x=projectFilePath(p.slug,p.workingDir,p.path||'');if(!fs.existsSync(x.target)||!fs.statSync(x.target).isDirectory())fail('Folder tidak ditemukan.');const items=fs.readdirSync(x.target,{withFileTypes:true}).filter(e=>e.name!=='.git'&&e.name!=='node_modules').slice(0,500).map(e=>{const st=fs.lstatSync(path.join(x.target,e.name));return{name:e.name,type:e.isDirectory()?'dir':e.isFile()?'file':'other',sizeBytes:e.isFile()?st.size:0,mtime:st.mtime.toISOString()};});console.log(JSON.stringify({path:x.relative,items}));}
function filesReadFromStdin(){const p=readJsonStdin('Files');const x=projectFilePath(p.slug,p.workingDir,p.path);if(!fs.existsSync(x.target)||!fs.statSync(x.target).isFile())fail('File tidak ditemukan.');const st=fs.statSync(x.target);if(st.size>1024*1024)fail('File terlalu besar untuk editor (maks 1 MB).');const content=fs.readFileSync(x.target,'utf8');if(content.includes('\0'))fail('File biner tidak dapat diedit.');console.log(JSON.stringify({path:x.relative,content,sizeBytes:st.size}));}
function filesWriteFromStdin(){const p=readJsonStdin('Files');const x=projectFilePath(p.slug,p.workingDir,p.path),content=String(p.content??'');if(!x.relative||content.length>1024*1024)fail('File/path tidak valid atau terlalu besar.');mkdir(path.dirname(x.target),0o750);writeAtomic(x.target,content,0o640);const user=ensureAppUser(x.slug);cmd('/usr/bin/chown',[`${user}:${user}`,x.target]);console.log(JSON.stringify({ok:true,path:x.relative}));}
function filesDeleteFromStdin(){const p=readJsonStdin('Files');const x=projectFilePath(p.slug,p.workingDir,p.path);if(!x.relative||['package.json','.env'].includes(x.relative))fail('Path ini tidak dapat dihapus dari File Manager.');if(!fs.existsSync(x.target))fail('Path tidak ditemukan.');fs.rmSync(x.target,{recursive:true,force:false});console.log(JSON.stringify({ok:true,path:x.relative}));}


function filesUploadFromStdin(){const p=readJsonStdin('Files');const dir=projectFilePath(p.slug,p.workingDir,p.dir||''),name=String(p.name||'').trim();if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(name)||['.env','.git'].includes(name))fail('Nama file upload tidak valid.');let data;try{data=Buffer.from(String(p.data||''),'base64');}catch{fail('Data upload tidak valid.');}if(!data.length||data.length>2*1024*1024)fail('Upload dibatasi 2 MB per file.');const target=path.join(dir.target,name);if(!target.startsWith(dir.root+path.sep))fail('Path upload tidak valid.');writeAtomic(target,data,0o640);const user=ensureAppUser(dir.slug);cmd('/usr/bin/chown',[`${user}:${user}`,target]);console.log(JSON.stringify({ok:true,path:path.posix.join(dir.relative,name),sizeBytes:data.length}));}

function runtimeList(){const out=[{id:'system',node:resolveRuntime('node'),available:true}];for(const major of ['20','22','24']){const bin=`/opt/hostpanel/runtimes/node${major}/bin/node`;out.push({id:`node${major}`,node:bin,available:fs.existsSync(bin)});}console.log(JSON.stringify(out));}

const [action, ...args] = process.argv.slice(2);
try {
  switch (action) {
    case 'runtime-list': return runtimeList();
    case 'app-metrics-all': return appMetricsAll();
    case 'app-env-keys': return appEnvKeys(args[0]);
    case 'app-env-set-json': return appEnvSetFromStdin();
    case 'app-env-remove-json': return appEnvRemoveFromStdin();
    case 'worker-upsert-json': return workerUpsertFromStdin();
    case 'worker-remove': return workerRemove(args[0],args[1]);
    case 'worker-status': return workerStatus(args[0]);
    case 'cron-upsert-json': return cronUpsertFromStdin();
    case 'cron-remove': return cronRemove(args[0],args[1]);
    case 'cron-status': return cronStatus(args[0]);
    case 'logs-tail': return logsTail(args[0],args[1]);
    case 'backup-restore-schedule': return backupRestoreSchedule(args[0]);
    case 'backup-offsite': return backupOffsite(args[0],args[1]);
    case 'db-dump': return dbDump(args[0]);
    case 'db-dump-list': return dbDumpList(args[0]);
    case 'db-dump-restore': return dbDumpRestore(args[0],args[1]);
    case 'preview-deploy-json': return previewDeployFromStdin();
    case 'preview-remove': return previewRemove(args[0],args[1]);
    case 'preview-logs': return previewLogs(args[0],args[1]);
    case 'app-deploy-json': return appDeployFromStdin();
    case 'app-release-activate': return appReleaseActivate(args[0],args[1],args[2]);
    case 'app-template-create-json': return appTemplateCreateFromStdin();
    case 'files-list-json': return filesListFromStdin();
    case 'files-read-json': return filesReadFromStdin();
    case 'files-write-json': return filesWriteFromStdin();
    case 'files-delete-json': return filesDeleteFromStdin();
    case 'files-upload-json': return filesUploadFromStdin();
    case 'metrics-summary': return metricsSummary();
    case 'backup-list': return backupList();
    case 'backup-create': return backupCreate();
    case 'backup-verify': return backupVerify(args[0]);
    case 'db-list': return dbList();
    case 'db-create': return dbCreate(args[0]);
    case 'db-user-create': return dbUserCreate(args[0], args[1]);
    case 'db-drop': return dbDrop(args[0], args[1]);
    case 'app-health': return appHealth(args[0], args[1]);
    case 'app-bootstrap-git': return appBootstrapGit(args[0], args[1], args[2], args[3], args[4]);
    case 'app-deploy': return appDeploy(args[0], args[1], args[2], args[3], args[4]);
    case 'status-all': return statusAll();
    case 'credentials-status': return credentialsStatus();
    case 'db-admin-rotate': return dbAdminRotate();
    case 'pma-basic-rotate': return pmaBasicRotate();
    case 'pma-control-repair': return pmaControlRepair();
    case 'security-audit': return securityAudit();
    case 'service-action': return serviceAction(args[0], args[1]);
    case 'nginx-proxy-upsert': return nginxProxyUpsert(args[0], args[1]);
    case 'nginx-proxy-upsert-json': return nginxProxyUpsertFromStdin();
    case 'nginx-remove': return nginxRemove(args[0]);
    case 'app-upsert-json': return appUpsertFromStdin();
    case 'app-status-all': return appStatusAll();
    case 'app-logs': return appLogs(args[0], args[1]);
    case 'app-upsert': return appUpsertPayload({ slug: args[0], workingDir: args[1], entryFile: args[2], port: args[3], startMode: 'node', restartPolicy: 'on-failure', environmentText: '' });
    case 'app-remove': return appRemove(args[0]);
    case 'zone-sync': return zoneSync(args[0], args[1]);
    case 'zone-remove': return zoneRemove(args[0]);
    case 'certbot-preflight': return certbotPreflight(args[0]);
    case 'certbot-activate-existing': return activateExistingCertificate(args[0], args[1]);
    case 'certbot-system-activate-existing': return activateExistingSystemCertificate(args[0], args[1], args[2]);
    case 'certbot-system-issue': return certbotSystemIssue(args[0], args[1], args[2], args[3], false);
    case 'certbot-system-staging': return certbotSystemIssue(args[0], args[1], args[2], args[3], true);
    case 'certbot-issue': return certbotIssue(args[0], args[1], args[2], false);
    case 'certbot-staging-test': return certbotIssue(args[0], args[1], args[2], true);
    case 'ssl-status': return sslStatus();
    case 'certbot-wildcard-json': return certbotWildcardFromStdin();
    case 'certbot-renew': return certbotRenew(false);
    case 'certbot-dry-run': return certbotRenew(true);
    default: fail('Action tidak dikenal.', 64);
  }
} catch (error) {
  { const parts = [error.stdout, error.stderr].filter(Boolean).map(x => String(x).trim()).filter(Boolean); fail(parts.join('\n') || error.message || String(error)); }
}
