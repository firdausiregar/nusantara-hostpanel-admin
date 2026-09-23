'use strict';
const db=require('../../core/database');
module.exports={
 user:(id)=>db.prepare('SELECT id,email,password_hash,role,created_at,last_login_at FROM users WHERE id=?').get(id),
 updatePassword:(id,hash)=>db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash,id),
};
