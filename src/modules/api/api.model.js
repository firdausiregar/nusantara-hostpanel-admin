'use strict';const db=require('../../core/database');
module.exports={
 app:(id,ws)=>db.prepare('SELECT * FROM apps WHERE id=? AND workspace_id=?').get(id,ws),
 apps:(ws)=>db.prepare('SELECT id,name,slug,port,status,last_deployed_commit,last_deployed_at,health_path FROM apps WHERE workspace_id=? ORDER BY id DESC').all(ws),
 domains:(ws)=>db.prepare('SELECT id,hostname,target_port,app_id,ssl_enabled,nginx_enabled FROM domains WHERE workspace_id=? ORDER BY id DESC').all(ws),
};
