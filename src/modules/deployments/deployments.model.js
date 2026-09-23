'use strict';const db=require('../../core/database');
function list(workspaceId,limit=100){return db.prepare(`SELECT d.*,a.name AS app_name,a.slug AS app_slug FROM deployments d JOIN apps a ON a.id=d.app_id WHERE d.workspace_id=? ORDER BY d.id DESC LIMIT ?`).all(workspaceId,limit);}
function listForApp(appId,workspaceId,limit=20){return db.prepare(`SELECT d.*,a.name AS app_name,a.slug AS app_slug FROM deployments d JOIN apps a ON a.id=d.app_id WHERE d.app_id=? AND d.workspace_id=? ORDER BY d.id DESC LIMIT ?`).all(appId,workspaceId,limit);}
module.exports={list,listForApp};
