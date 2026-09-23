'use strict';const db=require('../../core/database');function setLocale(userId,locale){db.prepare('UPDATE users SET locale=? WHERE id=?').run(locale,userId);}module.exports={setLocale};
