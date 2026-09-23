'use strict';
const db=require('../../core/database');
const crypto=require('node:crypto');
function members(workspaceId){return db.prepare(`SELECT u.id,u.email,u.display_name,u.last_login_at,wm.role,wm.created_at FROM workspace_members wm JOIN users u ON u.id=wm.user_id WHERE wm.workspace_id=? ORDER BY CASE wm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'developer' THEN 2 ELSE 3 END,u.email`).all(workspaceId);}
function invites(workspaceId){return db.prepare("SELECT id,email,role,expires_at,created_at FROM workspace_invites WHERE workspace_id=? AND accepted_at IS NULL AND expires_at>datetime('now') ORDER BY id DESC").all(workspaceId);}
function createInvite(workspaceId,email,role,createdBy,token){const hash=crypto.createHash('sha256').update(token).digest('hex');return db.prepare("INSERT INTO workspace_invites (workspace_id,email,role,token_hash,expires_at,created_by) VALUES (?,?,?,?,datetime('now','+7 days'),?)").run(workspaceId,email,role,hash,createdBy);}
function findInvite(token){const hash=crypto.createHash('sha256').update(String(token||'')).digest('hex');return db.prepare("SELECT i.*,w.name AS workspace_name FROM workspace_invites i JOIN workspaces w ON w.id=i.workspace_id WHERE i.token_hash=? AND i.accepted_at IS NULL AND i.expires_at>datetime('now')").get(hash);}
function acceptInvite(invite,userId){return db.transaction(()=>{db.prepare('INSERT OR REPLACE INTO workspace_members (workspace_id,user_id,role) VALUES (?,?,?)').run(invite.workspace_id,userId,invite.role);db.prepare('UPDATE workspace_invites SET accepted_at=CURRENT_TIMESTAMP WHERE id=?').run(invite.id);})();}
function userByEmail(email){return db.prepare('SELECT * FROM users WHERE email=?').get(email);}
function addUser(email,hash){return Number(db.prepare("INSERT INTO users (email,password_hash,role) VALUES (?,?,'operator')").run(email,hash).lastInsertRowid);}
function setRole(workspaceId,userId,role){return db.prepare("UPDATE workspace_members SET role=? WHERE workspace_id=? AND user_id=? AND role<>'owner'").run(role,workspaceId,userId);}
function remove(workspaceId,userId){return db.prepare("DELETE FROM workspace_members WHERE workspace_id=? AND user_id=? AND role<>'owner'").run(workspaceId,userId);}
module.exports={members,invites,createInvite,findInvite,acceptInvite,userByEmail,addUser,setRole,remove};
