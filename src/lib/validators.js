const net = require('node:net');
const path = require('node:path');

const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const DNS_OWNER_LABEL = '[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?';
const RECORD_NAME_RE = new RegExp(`^(?:@|\\*|\\*\\.${DNS_OWNER_LABEL}(?:\\.${DNS_OWNER_LABEL})*|${DNS_OWNER_LABEL}(?:\\.${DNS_OWNER_LABEL})*)$`, 'i');

function domain(value) {
  const v = String(value || '').trim().toLowerCase().replace(/\.$/, '');
  if (!DOMAIN_RE.test(v)) throw new Error('Domain tidak valid.');
  return v;
}

function slug(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!SLUG_RE.test(v)) throw new Error('Slug hanya boleh huruf kecil, angka, dan tanda minus.');
  return v;
}

function port(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1024 || n > 65535) throw new Error('Port harus 1024-65535.');
  return n;
}

function ttl(value) {
  const n = Number(value || 300);
  if (!Number.isInteger(n) || n < 60 || n > 86400) throw new Error('TTL harus 60-86400 detik.');
  return n;
}

function recordName(value) {
  const v = String(value || '@').trim().toLowerCase();
  if (!RECORD_NAME_RE.test(v)) throw new Error('Nama record DNS tidak valid.');
  return v;
}

function dnsValue(type, value) {
  const v = String(value || '').trim();
  if (!v || v.length > 512 || /[\r\n]/.test(v)) throw new Error('Nilai DNS tidak valid.');
  if (type === 'A' && net.isIP(v) !== 4) throw new Error('Record A harus IPv4.');
  if (type === 'AAAA' && net.isIP(v) !== 6) throw new Error('Record AAAA harus IPv6.');
  if (['CNAME', 'NS'].includes(type) && !DOMAIN_RE.test(v.replace(/\.$/, ''))) throw new Error(`${type} harus hostname valid.`);
  if (type === 'MX' && !DOMAIN_RE.test(v.replace(/\.$/, ''))) throw new Error('MX harus hostname mail server.');
  if (type === 'SRV') {
    const parts = v.split(/\s+/);
    if (![3,4].includes(parts.length)) throw new Error('SRV gunakan value: weight port target, dengan Priority di kolom Priority; format lama priority weight port target juga diterima.');
    const nums = parts.slice(0, -1).map(Number);
    if (nums.some(n => !Number.isInteger(n) || n < 0 || n > 65535)) throw new Error('Angka SRV harus 0-65535.');
    if (parts.length === 3 && nums[1] === 0) throw new Error('Port SRV harus 1-65535.');
    if (parts.length === 4 && nums[2] === 0) throw new Error('Port SRV harus 1-65535.');
    if (!DOMAIN_RE.test(parts.at(-1).replace(/\.$/, ''))) throw new Error('Target SRV harus hostname valid.');
  }
  return v;
}

function workingDir(value) {
  const raw = String(value || '').trim();
  if (!/^\/srv\/apps\/[a-zA-Z0-9._/-]+$/.test(raw) || raw.includes('..')) throw new Error('Folder aplikasi wajib berupa path aman di bawah /nusantara-hostpanel/apps/.');
  const v = path.posix.normalize(raw);
  if (!v.startsWith('/nusantara-hostpanel/apps/')) throw new Error('Folder aplikasi tidak valid.');
  return v;
}

function entryFile(value) {
  const v = String(value || 'server.js').trim();
  if (!/^[a-zA-Z0-9._/-]{1,120}$/.test(v) || v.startsWith('/') || v.includes('..')) throw new Error('Entry file tidak valid.');
  return v;
}

function priority(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error('Priority harus 0-65535.');
  return n;
}

module.exports = { domain, slug, port, ttl, recordName, dnsValue, workingDir, entryFile, priority };
