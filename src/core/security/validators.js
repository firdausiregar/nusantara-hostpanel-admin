'use strict';

function databaseName(value) {
  const v = String(value || '').trim();
  if (!/^[a-zA-Z0-9_]{1,64}$/.test(v)) throw new Error('Nama database hanya boleh huruf, angka, dan underscore (maks. 64).');
  return v;
}
function databaseUser(value) {
  const v = String(value || '').trim();
  if (!/^[a-zA-Z0-9_]{3,32}$/.test(v)) throw new Error('Username database hanya boleh huruf, angka, underscore (3-32).');
  return v;
}
function gitRepo(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  if (!/^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(?:\.git)?$/.test(v)) throw new Error('Repository harus HTTPS GitHub. Public maupun private didukung; private membutuhkan token terenkripsi.');
  return v;
}
function gitBranch(value) {
  const v = String(value || 'main').trim();
  if (!/^[a-zA-Z0-9._\/-]{1,100}$/.test(v) || v.includes('..') || v.startsWith('/') || v.endsWith('/')) throw new Error('Branch Git tidak valid.');
  return v;
}
function npmScript(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  if (!/^[a-zA-Z0-9:_-]{1,64}$/.test(v)) throw new Error('Nama npm script tidak valid.');
  return v;
}
function healthPath(value) {
  const v = String(value || '/').trim();
  if (!/^\/[a-zA-Z0-9._~!$&'()*+,;=:@%\/-]{0,200}$/.test(v) || v.includes('..')) throw new Error('Health path tidak valid.');
  return v;
}
function optionalInteger(value,min,max,label='Nilai') {
  const raw=String(value??'').trim();
  if(!raw)return 0;
  if(!/^\d+$/.test(raw))throw new Error(`${label} harus angka bulat.`);
  const n=Number(raw);
  if(!Number.isSafeInteger(n)||n<min||n>max)throw new Error(`${label} harus antara ${min} dan ${max}.`);
  return n;
}
function gitToken(value){const v=String(value||'').trim();if(!v)return '';if(v.length<20||v.length>255||/[\r\n\0]/.test(v))throw new Error('Git token tidak valid.');return v;}
function nodeRuntime(value){const v=String(value||'system').trim();if(!/^(system|node20|node22|node24)$/.test(v))throw new Error('Node runtime tidak didukung.');return v;}
function installCommand(value){const v=String(value||'npm ci').trim();if(!['npm ci','npm install','pnpm install --frozen-lockfile','yarn install --immutable'].includes(v))throw new Error('Install command tidak diizinkan.');return v;}
function domainSuffix(value){const v=String(value||'').trim().toLowerCase().replace(/^\*\./,'');if(!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(v))throw new Error('Preview domain suffix tidak valid.');return v;}
module.exports = { databaseName, databaseUser, gitRepo, gitBranch, npmScript, healthPath, optionalInteger, gitToken, nodeRuntime, installCommand, domainSuffix };
