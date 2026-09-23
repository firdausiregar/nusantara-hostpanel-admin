'use strict';
const db=require('../../core/database');
function list(workspaceId,limit=100){return db.prepare('SELECT * FROM notifications WHERE workspace_id=? ORDER BY id DESC LIMIT ?').all(workspaceId,Math.max(1,Math.min(Number(limit)||100,200)));}
function unreadCount(workspaceId){return Number(db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE workspace_id=? AND read_at IS NULL').get(workspaceId)?.n||0);}
function create(workspaceId,{level='info',type='system',title,message,resourceType=null,resourceId=null}){return Number(db.prepare('INSERT INTO notifications (workspace_id,level,type,title,message,resource_type,resource_id) VALUES (?,?,?,?,?,?,?)').run(workspaceId,level,type,String(title||'Notification').slice(0,160),String(message||'').slice(0,4000),resourceType,resourceId).lastInsertRowid);}
function markRead(workspaceId,id){db.prepare('UPDATE notifications SET read_at=COALESCE(read_at,CURRENT_TIMESTAMP) WHERE workspace_id=? AND id=?').run(workspaceId,id);}
function markAllRead(workspaceId){return db.prepare('UPDATE notifications SET read_at=COALESCE(read_at,CURRENT_TIMESTAMP) WHERE workspace_id=? AND read_at IS NULL').run(workspaceId);}
function remove(workspaceId,id){return db.prepare('DELETE FROM notifications WHERE workspace_id=? AND id=?').run(workspaceId,id);}
function removeRead(workspaceId){return db.prepare('DELETE FROM notifications WHERE workspace_id=? AND read_at IS NOT NULL').run(workspaceId);}
function removeAll(workspaceId){return db.prepare('DELETE FROM notifications WHERE workspace_id=?').run(workspaceId);}
function removeSelected(workspaceId,ids){const safe=[...new Set((ids||[]).map(Number).filter(n=>Number.isInteger(n)&&n>0))].slice(0,200);if(!safe.length)return{changes:0};const placeholders=safe.map(()=>'?').join(',');return db.prepare(`DELETE FROM notifications WHERE workspace_id=? AND id IN (${placeholders})`).run(workspaceId,...safe);}
function channels(workspaceId){return db.prepare('SELECT id,workspace_id,type,name,config_enc,enabled,created_at,updated_at FROM notification_channels WHERE workspace_id=? ORDER BY id DESC').all(workspaceId);}
function channel(workspaceId,id){return db.prepare('SELECT * FROM notification_channels WHERE workspace_id=? AND id=?').get(workspaceId,id);}
function addChannel(workspaceId,type,name,configEnc){return db.prepare('INSERT INTO notification_channels (workspace_id,type,name,config_enc) VALUES (?,?,?,?)').run(workspaceId,type,name,configEnc);}
function toggle(workspaceId,id,enabled){db.prepare('UPDATE notification_channels SET enabled=?,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND id=?').run(enabled?1:0,workspaceId,id);}
function removeChannel(workspaceId,id){db.prepare('DELETE FROM notification_channels WHERE workspace_id=? AND id=?').run(workspaceId,id);}
module.exports={list,unreadCount,create,markRead,markAllRead,remove,removeRead,removeAll,removeSelected,channels,channel,addChannel,toggle,removeChannel};
