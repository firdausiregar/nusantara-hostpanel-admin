'use strict';

const fs = require('node:fs');
const path = require('node:path');

function loadLocalEnv() {
  if ((process.env.NODE_ENV || 'development') === 'production') return;
  for (const file of ['.env.local', '.env']) {
    const full = path.join(process.cwd(), file);
    if (!fs.existsSync(full)) continue;
    for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const i = trimmed.indexOf('=');
      if (i < 1) continue;
      const key = trimmed.slice(0, i).trim();
      if (Object.prototype.hasOwnProperty.call(process.env, key)) continue;
      let value = trimmed.slice(i + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      process.env[key] = value;
    }
    break;
  }
}
loadLocalEnv();

const env = process.env.NODE_ENV || 'development';
const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');

function parseTrustProxy(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  if (/^\d+$/.test(raw)) return Number(raw);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw;
}

const platformRaw = String(process.env.NETWORK_MODE || process.env.PLATFORM || (env === 'production' ? 'direct' : 'direct')).trim().toLowerCase();
const platform = platformRaw === 'helipod' ? 'nat' : platformRaw;
const tlsMode = String(process.env.TLS_MODE || (env === 'production' ? 'local' : 'off')).trim().toLowerCase();
const runtimeMode = String(process.env.HOSTPANEL_RUNTIME_MODE || (env === 'production' ? 'system' : 'local')).trim().toLowerCase();

function hostnameFromUrl(value) {
  try { return new URL(String(value || '')).hostname.toLowerCase(); } catch { return ''; }
}

if (!['direct', 'nat', 'proxy'].includes(platform)) throw new Error('NETWORK_MODE harus direct, nat, atau proxy.');
if (!['local', 'edge', 'off'].includes(tlsMode)) throw new Error('TLS_MODE harus local, edge, atau off.');
if (!['system', 'local'].includes(runtimeMode)) throw new Error('HOSTPANEL_RUNTIME_MODE harus system atau local.');

module.exports = Object.freeze({
  env,
  port: Number(process.env.PORT || 3030),
  bindHost: process.env.BIND_HOST || '127.0.0.1',
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY || 0),
  sessionSecret: process.env.SESSION_SECRET || 'development-only-change-me',
  masterKey: process.env.HOSTPANEL_MASTER_KEY || process.env.SESSION_SECRET || 'local-development-vault-key',
  dataDir,
  dbPath: path.join(dataDir, 'hostpanel.sqlite'),
  panelName: process.env.PANEL_NAME || 'Nusantara HostPanel',
  panelDomain: process.env.PANEL_DOMAIN || '',
  phpMyAdminUrl: process.env.PHPMYADMIN_URL || '',
  phpMyAdminDomain: hostnameFromUrl(process.env.PHPMYADMIN_URL || ''),
  certbotEmail: process.env.CERTBOT_EMAIL || '',
  smtp: Object.freeze({ host: process.env.SMTP_HOST || '', port: Number(process.env.SMTP_PORT || 587), secure: String(process.env.SMTP_SECURE || '0') === '1', user: process.env.SMTP_USER || '', pass: process.env.SMTP_PASS || '', from: process.env.SMTP_FROM || '' }),
  github: Object.freeze({ clientId: process.env.GITHUB_CLIENT_ID || '', clientSecret: process.env.GITHUB_CLIENT_SECRET || '', callbackUrl: process.env.GITHUB_CALLBACK_URL || '', oauthScope: process.env.GITHUB_OAUTH_SCOPE || 'read:user user:email', appId: process.env.GITHUB_APP_ID || '', appSlug: process.env.GITHUB_APP_SLUG || '', appPrivateKeyPath: process.env.GITHUB_APP_PRIVATE_KEY_PATH || '', appSetupUrl: process.env.GITHUB_APP_SETUP_URL || '' }),
  midtrans: Object.freeze({ enabled: Boolean(process.env.MIDTRANS_SERVER_KEY && process.env.MIDTRANS_CLIENT_KEY), environment: String(process.env.MIDTRANS_ENV || 'sandbox').toLowerCase()==='production'?'production':'sandbox', serverKey: process.env.MIDTRANS_SERVER_KEY || '', clientKey: process.env.MIDTRANS_CLIENT_KEY || '', merchantId: process.env.MIDTRANS_MERCHANT_ID || '', recurring: String(process.env.MIDTRANS_RECURRING || '0')==='1' }),
  docsUrl: process.env.DOCS_URL || 'https://firdausiregar.github.io/nusantara-hostpanel-admin/',
  controlBinary: process.env.HOSTPANEL_CTL || '/usr/local/sbin/hostpanelctl',
  platform,
  networkMode: platform,
  tlsMode,
  dnsPublic: String(process.env.DNS_PUBLIC || (env === 'production' ? '1' : '0')) === '1',
  runtimeMode,
  localDevelopment: runtimeMode === 'local',
  repoUrl: 'https://github.com/firdausiregar/nusantara-hostpanel-admin',
  release: '1.2.0',
});
