'use strict';
const db=require('../../core/database');
module.exports={
 countUsers:()=>db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
 findByEmail:(email)=>db.prepare('SELECT * FROM users WHERE email=?').get(email),
 findById:(id)=>db.prepare('SELECT * FROM users WHERE id=?').get(id),
 createAdmin(email,hash){return db.prepare('INSERT INTO users (email,password_hash,role) VALUES (?,?,?)').run(email,hash,'admin');},
 touchLogin(id){db.prepare('UPDATE users SET last_login_at=CURRENT_TIMESTAMP WHERE id=?').run(id);},
 updateHash(id,hash){db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash,id);},
 update2fa(id,{secretEnc,enabled,recoveryEnc}){db.prepare('UPDATE users SET totp_secret_enc=?,totp_enabled=?,recovery_codes_enc=? WHERE id=?').run(secretEnc||null,enabled?1:0,recoveryEnc||null,id);},
 createReset(userId,hash){db.prepare("DELETE FROM password_reset_tokens WHERE user_id=? AND used_at IS NULL").run(userId);return db.prepare("INSERT INTO password_reset_tokens (user_id,token_hash,expires_at) VALUES (?,?,datetime('now','+30 minutes'))").run(userId,hash);},
 resetToken(hash){return db.prepare("SELECT t.*,u.email FROM password_reset_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=? AND t.used_at IS NULL AND t.expires_at>datetime('now')").get(hash);},
 useReset(id,userId,passwordHash){db.transaction(()=>{db.prepare('UPDATE users SET password_hash=?,password_changed_at=CURRENT_TIMESTAMP WHERE id=?').run(passwordHash,userId);db.prepare('UPDATE password_reset_tokens SET used_at=CURRENT_TIMESTAMP WHERE id=?').run(id);db.prepare('UPDATE auth_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE user_id=? AND revoked_at IS NULL').run(userId);})();},
};
