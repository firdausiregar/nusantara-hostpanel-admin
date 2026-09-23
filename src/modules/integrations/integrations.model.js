'use strict';
const db=require('../../core/database');
function get(workspaceId,provider='github'){return db.prepare('SELECT * FROM integration_connections WHERE workspace_id=? AND provider=?').get(workspaceId,provider);}
function upsert(workspaceId,provider,accountLogin,tokenEnc,userId,metadata={}){db.prepare(`INSERT INTO integration_connections (workspace_id,provider,account_login,token_enc,metadata_json,connected_by) VALUES (?,?,?,?,?,?) ON CONFLICT(workspace_id,provider) DO UPDATE SET account_login=excluded.account_login,token_enc=excluded.token_enc,metadata_json=excluded.metadata_json,connected_by=excluded.connected_by,updated_at=CURRENT_TIMESTAMP`).run(workspaceId,provider,accountLogin||null,tokenEnc,JSON.stringify(metadata||{}),userId||null);}
function remove(workspaceId,provider='github'){return db.prepare('DELETE FROM integration_connections WHERE workspace_id=? AND provider=?').run(workspaceId,provider);}
module.exports={get,upsert,remove};
