'use strict';const db=require('../../core/database');
module.exports={
 list:(ws)=>db.prepare(`SELECT d.*,a.name AS app_name FROM domains d LEFT JOIN apps a ON a.id=d.app_id WHERE d.workspace_id=? ORDER BY d.id DESC`).all(ws),
 count:(ws)=>db.prepare('SELECT COUNT(*) AS n FROM domains WHERE workspace_id=?').get(ws).n,
 apps:(ws)=>db.prepare('SELECT id,name,port FROM apps WHERE workspace_id=? ORDER BY name').all(ws),
 find:(id,ws)=>db.prepare('SELECT * FROM domains WHERE id=? AND workspace_id=?').get(id,ws),
 app:(id,ws)=>db.prepare('SELECT * FROM apps WHERE id=? AND workspace_id=?').get(id,ws),
 workspace:(id)=>db.prepare('SELECT * FROM workspaces WHERE id=?').get(id),
 create:(hostname,port,appId,tlsMode,ws)=>db.prepare('INSERT INTO domains (workspace_id,hostname,target_port,app_id,tls_mode) VALUES (?,?,?,?,?)').run(ws,hostname,port,appId,tlsMode),
 markProxy:(hostname,ssl,ws)=>db.prepare('UPDATE domains SET nginx_enabled=1,ssl_enabled=?,updated_at=CURRENT_TIMESTAMP WHERE hostname=? AND workspace_id=?').run(ssl,hostname,ws),
 updateSettings:(id,ws,p)=>db.prepare(`UPDATE domains SET redirect_https=?,canonical_mode=?,websocket_enabled=?,upload_limit_mb=?,proxy_timeout_sec=?,maintenance_mode=?,custom_headers_json=?,nginx_enabled=1,ssl_enabled=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?`).run(p.redirectHttps?1:0,p.canonicalMode,p.websocketEnabled?1:0,p.uploadLimitMb,p.proxyTimeoutSec,p.maintenanceMode?1:0,JSON.stringify(p.customHeaders||{}),p.sslEnabled?1:0,id,ws),
 markPreflight:(id,ws,ok,error=null)=>db.prepare('UPDATE domains SET ssl_last_preflight_at=CURRENT_TIMESTAMP,ssl_last_preflight_ok=?,ssl_last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?').run(ok?1:0,error,id,ws),
 markAttempt:(id,ws,{sslEnabled=null,error=null,retryAfter=null,clearRetry=false}={})=>{if(sslEnabled===1)return db.prepare("UPDATE domains SET ssl_enabled=1,tls_mode='local',ssl_last_error=NULL,ssl_retry_after=NULL,ssl_last_attempt_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?").run(id,ws);if(clearRetry)return db.prepare("UPDATE domains SET ssl_last_attempt_at=CURRENT_TIMESTAMP,ssl_last_error=?,ssl_retry_after=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?").run(error,id,ws);return db.prepare("UPDATE domains SET ssl_last_attempt_at=CURRENT_TIMESTAMP,ssl_last_error=?,ssl_retry_after=COALESCE(?,ssl_retry_after),updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?").run(error,retryAfter,id,ws);},
 remove:(id,ws)=>db.prepare('DELETE FROM domains WHERE id=? AND workspace_id=?').run(id,ws),
};
