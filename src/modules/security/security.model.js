'use strict';const db=require('../../core/database');
module.exports={
 user:(id)=>db.prepare('SELECT * FROM users WHERE id=?').get(id),
 update2fa:(id,secretEnc,enabled,recoveryEnc)=>db.prepare('UPDATE users SET totp_secret_enc=?,totp_enabled=?,recovery_codes_enc=? WHERE id=?').run(secretEnc||null,enabled?1:0,recoveryEnc||null,id),
 sessions:(id)=>db.prepare('SELECT * FROM auth_sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 50').all(id),
 events:(id)=>db.prepare('SELECT * FROM security_events WHERE user_id=? OR user_id IS NULL ORDER BY id DESC LIMIT 100').all(id),
 tokens:(id,ws)=>db.prepare('SELECT id,name,token_prefix,scopes,last_used_at,expires_at,revoked_at,created_at FROM api_tokens WHERE user_id=? AND workspace_id=? ORDER BY id DESC').all(id,ws),
 insertToken:(userId,ws,name,prefix,hash,scopes,expiresAt)=>db.prepare('INSERT INTO api_tokens (user_id,workspace_id,name,token_prefix,token_hash,scopes,expires_at) VALUES (?,?,?,?,?,?,?)').run(userId,ws,name,prefix,hash,scopes,expiresAt||null),
 revokeToken:(id,userId,ws)=>db.prepare('UPDATE api_tokens SET revoked_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND workspace_id=?').run(id,userId,ws),
 findTokenByHash:(hash)=>db.prepare("SELECT t.*,u.email,u.role AS platform_role,wm.role AS workspace_role FROM api_tokens t JOIN users u ON u.id=t.user_id LEFT JOIN workspace_members wm ON wm.workspace_id=t.workspace_id AND wm.user_id=t.user_id WHERE t.token_hash=? AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at>CURRENT_TIMESTAMP) AND u.disabled_at IS NULL").get(hash),
 touchToken:(id)=>db.prepare('UPDATE api_tokens SET last_used_at=CURRENT_TIMESTAMP WHERE id=?').run(id),
};
