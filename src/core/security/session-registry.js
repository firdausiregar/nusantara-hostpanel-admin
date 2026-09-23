'use strict';
const crypto=require('node:crypto');
const db=require('../database');
function clientIp(req){return String(req.ip||req.socket?.remoteAddress||'').slice(0,96);}
function userAgent(req){return String(req.get?.('user-agent')||'').slice(0,500);}
function create(req,userId,workspaceId=null){const id=crypto.randomUUID();db.prepare('INSERT INTO auth_sessions (id,user_id,workspace_id,ip,user_agent) VALUES (?,?,?,?,?)').run(id,userId,workspaceId||null,clientIp(req),userAgent(req));req.session.securitySessionId=id;return id;}
function touch(req){const id=req.session?.securitySessionId;if(!id)return true;const row=db.prepare('SELECT revoked_at FROM auth_sessions WHERE id=?').get(id);if(!row||row.revoked_at)return false;db.prepare("UPDATE auth_sessions SET last_seen_at=CURRENT_TIMESTAMP,workspace_id=? WHERE id=?").run(req.session.workspaceId||null,id);return true;}
function list(userId){return db.prepare('SELECT id,workspace_id,ip,user_agent,created_at,last_seen_at,revoked_at FROM auth_sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 50').all(userId);}
function revoke(userId,id){return db.prepare("UPDATE auth_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND revoked_at IS NULL").run(id,userId);}
function revokeOthers(userId,currentId){return db.prepare("UPDATE auth_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE user_id=? AND id<>? AND revoked_at IS NULL").run(userId,currentId||'');}
function event(userId,event,severity,req,detail=''){db.prepare('INSERT INTO security_events (user_id,event,severity,ip,user_agent,detail) VALUES (?,?,?,?,?,?)').run(userId||null,event,severity||'info',clientIp(req),userAgent(req),String(detail||'').slice(0,2000));}
module.exports={create,touch,list,revoke,revokeOthers,event};
