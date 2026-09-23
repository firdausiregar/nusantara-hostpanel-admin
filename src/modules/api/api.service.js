'use strict';const security=require('../security/security.model');const {hashToken}=require('../../core/security/tokens');
function authenticate(header){const m=String(header||'').match(/^Bearer\s+(.+)$/i);if(!m)return null;const row=security.findTokenByHash(hashToken(m[1]));if(row)security.touchToken(row.id);return row||null;}
function scopes(row){return new Set(String(row?.scopes||'').split(',').map(x=>x.trim()).filter(Boolean));}
function can(row,scope){const s=scopes(row);return s.has(scope)||s.has('*')||(scope==='read'&&s.size>0);}
module.exports={authenticate,can};
