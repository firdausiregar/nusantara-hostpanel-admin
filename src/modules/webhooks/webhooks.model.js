'use strict';const db=require('../../core/database');
function getByPublicId(id){return db.prepare(`SELECT h.*,a.workspace_id,a.git_branch,a.auto_deploy,a.preview_enabled,a.preview_domain_suffix,a.name AS app_name FROM webhooks h JOIN apps a ON a.id=h.app_id WHERE h.public_id=? AND h.enabled=1`).get(id);}
function getByApp(appId,ws){return db.prepare('SELECT h.id,h.public_id,h.provider,h.enabled,h.created_at FROM webhooks h JOIN apps a ON a.id=h.app_id WHERE h.app_id=? AND a.workspace_id=?').get(appId,ws);}
function upsert(appId,publicId,secretEnc){return db.prepare(`INSERT INTO webhooks (app_id,provider,public_id,secret_enc,enabled) VALUES (?,'github',?,?,1) ON CONFLICT(app_id) DO UPDATE SET public_id=excluded.public_id,secret_enc=excluded.secret_enc,enabled=1`).run(appId,publicId,secretEnc);}
function disable(appId,ws){return db.prepare('UPDATE webhooks SET enabled=0 WHERE app_id=? AND EXISTS(SELECT 1 FROM apps a WHERE a.id=webhooks.app_id AND a.workspace_id=?)').run(appId,ws);}
module.exports={getByPublicId,getByApp,upsert,disable};
