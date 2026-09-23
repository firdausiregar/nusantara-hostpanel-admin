'use strict';
const crypto=require('node:crypto');
function newToken(prefix='nhp'){const secret=crypto.randomBytes(32).toString('base64url');return `${prefix}_${secret}`;}
function hashToken(token){return crypto.createHash('sha256').update(String(token||'')).digest('hex');}
function prefix(token){return String(token||'').slice(0,14);}
module.exports={newToken,hashToken,prefix};
