'use strict';
const crypto = require('node:crypto');
const config = require('../config');

function keyBytes() {
  const raw = String(config.masterKey || '');
  if (/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  try {
    const decoded = Buffer.from(raw, 'base64');
    if (decoded.length === 32) return decoded;
  } catch {}
  if (config.env !== 'production') return crypto.createHash('sha256').update(raw || config.sessionSecret || 'hostpanel-local').digest();
  throw new Error('HOSTPANEL_MASTER_KEY production harus 32-byte base64 atau 64 hex.');
}

function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBytes(), iv);
  const body = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${body.toString('base64url')}`;
}
function decrypt(payload) {
  const [version, ivRaw, tagRaw, bodyRaw] = String(payload || '').split('.');
  if (version !== 'v1' || !ivRaw || !tagRaw || bodyRaw == null) throw new Error('Ciphertext vault tidak valid.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBytes(), Buffer.from(ivRaw, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(bodyRaw, 'base64url')), decipher.final()]).toString('utf8');
}
function fingerprint(value) { return crypto.createHmac('sha256', keyBytes()).update(String(value)).digest('hex'); }
module.exports = { encrypt, decrypt, fingerprint };
