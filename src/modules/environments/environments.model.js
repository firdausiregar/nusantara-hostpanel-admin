'use strict';const db=require('../../core/database');
module.exports={
 app:(id,ws)=>db.prepare('SELECT * FROM apps WHERE id=? AND workspace_id=?').get(id,ws),
 list:(appId,env='production')=>db.prepare('SELECT id,name,is_secret,created_at,updated_at FROM app_env_vars WHERE app_id=? AND environment=? ORDER BY name').all(appId,env),
 get:(appId,env,name)=>db.prepare('SELECT * FROM app_env_vars WHERE app_id=? AND environment=? AND name=?').get(appId,env,name),
 upsert:(appId,env,name,valueEnc,isSecret)=>db.prepare(`INSERT INTO app_env_vars (app_id,environment,name,value_enc,is_secret) VALUES (?,?,?,?,?) ON CONFLICT(app_id,environment,name) DO UPDATE SET value_enc=excluded.value_enc,is_secret=excluded.is_secret,updated_at=CURRENT_TIMESTAMP`).run(appId,env,name,valueEnc,isSecret?1:0),
 remove:(appId,env,name)=>db.prepare('DELETE FROM app_env_vars WHERE app_id=? AND environment=? AND name=?').run(appId,env,name),
 values:(appId,env)=>db.prepare('SELECT * FROM app_env_vars WHERE app_id=? AND environment=? ORDER BY name').all(appId,env),
};
