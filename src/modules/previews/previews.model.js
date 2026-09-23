'use strict';const db=require('../../core/database');
function list(workspaceId){return db.prepare(`SELECT p.*,a.name AS app_name,a.slug AS app_slug FROM preview_deployments p JOIN apps a ON a.id=p.app_id WHERE p.workspace_id=? ORDER BY p.id DESC`).all(workspaceId);}
function find(id,workspaceId){return db.prepare(`SELECT p.*,a.name AS app_name,a.slug AS app_slug,a.working_dir,a.git_repo,a.git_branch,a.build_script,a.install_command,a.node_runtime,a.start_mode,a.entry_file,a.npm_script,a.start_command,a.restart_policy,a.health_path,a.memory_limit_mb FROM preview_deployments p JOIN apps a ON a.id=p.app_id WHERE p.id=? AND p.workspace_id=?`).get(id,workspaceId);}
function app(id,workspaceId){return db.prepare('SELECT * FROM apps WHERE id=? AND workspace_id=?').get(id,workspaceId);}
function byAppBranch(appId,branch){return db.prepare('SELECT * FROM preview_deployments WHERE app_id=? AND branch=?').get(appId,branch);}
function nextPort(){const used=new Set(db.prepare('SELECT port FROM apps UNION SELECT port FROM preview_deployments WHERE status<>\'stopped\'').all().map(r=>Number(r.port)));for(let p=20000;p<30000;p++)if(!used.has(p))return p;throw new Error('Port preview 20000-29999 habis.');}
function create(p){return Number(db.prepare(`INSERT INTO preview_deployments (workspace_id,app_id,branch,slug,hostname,port,status,expires_at,created_by) VALUES (?,?,?,?,?,?,'building',datetime('now',?),?)`).run(p.workspaceId,p.appId,p.branch,p.slug,p.hostname||null,p.port,`+${p.ttlDays} days`,p.userId||null).lastInsertRowid);}
function active(id,data){db.prepare(`UPDATE preview_deployments SET status='active',release_path=?,commit_sha=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(data.path||null,data.commit||null,id);}
function failed(id){db.prepare(`UPDATE preview_deployments SET status='failed',updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(id);}
function stopped(id){db.prepare(`UPDATE preview_deployments SET status='stopped',updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(id);}
function remove(id,workspaceId){return db.prepare('DELETE FROM preview_deployments WHERE id=? AND workspace_id=?').run(id,workspaceId);}
function expired(limit=10){return db.prepare("SELECT p.*,a.working_dir,a.slug AS app_slug FROM preview_deployments p JOIN apps a ON a.id=p.app_id WHERE p.status='active' AND p.expires_at IS NOT NULL AND datetime(p.expires_at)<=datetime('now') ORDER BY p.id LIMIT ?").all(limit);}
module.exports={list,find,app,byAppBranch,nextPort,create,active,failed,stopped,remove,expired};
