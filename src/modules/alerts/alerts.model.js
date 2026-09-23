'use strict';const db=require('../../core/database');
function rules(ws){return db.prepare('SELECT * FROM alert_rules WHERE workspace_id=? ORDER BY enabled DESC,id').all(ws);}
function events(ws){return db.prepare('SELECT e.*,r.name AS rule_name,r.metric FROM alert_events e LEFT JOIN alert_rules r ON r.id=e.rule_id WHERE e.workspace_id=? ORDER BY e.id DESC LIMIT 100').all(ws);}
function create(ws,p){return db.prepare('INSERT INTO alert_rules (workspace_id,name,metric,operator,threshold,duration_min,severity,cooldown_min) VALUES (?,?,?,?,?,?,?,?)').run(ws,p.name,p.metric,p.operator,p.threshold,p.durationMin,p.severity,p.cooldownMin);}
function remove(id,ws){return db.prepare('DELETE FROM alert_rules WHERE id=? AND workspace_id=?').run(id,ws);}
function enabled(ws,metric){return db.prepare('SELECT * FROM alert_rules WHERE workspace_id=? AND metric=? AND enabled=1 ORDER BY id').all(ws,metric);}
function open(ws,fingerprint){return db.prepare("SELECT * FROM alert_events WHERE workspace_id=? AND fingerprint=? AND status='open' ORDER BY id DESC LIMIT 1").get(ws,fingerprint);}
function last(ws,fingerprint){return db.prepare('SELECT * FROM alert_events WHERE workspace_id=? AND fingerprint=? ORDER BY id DESC LIMIT 1').get(ws,fingerprint);}
function openEvent(rule,ws,fingerprint,value,message){return Number(db.prepare("INSERT INTO alert_events (rule_id,workspace_id,status,fingerprint,value,message) VALUES (?,?,'open',?,?,?)").run(rule.id,ws,fingerprint,value,message).lastInsertRowid);}
function resolve(id){db.prepare("UPDATE alert_events SET status='resolved',resolved_at=CURRENT_TIMESTAMP WHERE id=?").run(id);}
function sample(ws,metric,value,resourceType='server',resourceId='local'){db.prepare('INSERT INTO metric_samples (workspace_id,metric,resource_type,resource_id,value) VALUES (?,?,?,?,?)').run(ws,metric,resourceType,resourceId,Number(value));}
function samples(ws,metric,limit=72){return db.prepare('SELECT value,sampled_at FROM metric_samples WHERE workspace_id=? AND metric=? ORDER BY id DESC LIMIT ?').all(ws,metric,Math.max(1,Math.min(Number(limit)||72,500))).reverse();}
function windowSamples(ws,metric,resourceType,resourceId,minutes){const span=Math.max(1,Math.min(Number(minutes)||1,1440));return db.prepare("SELECT value,sampled_at FROM metric_samples WHERE workspace_id=? AND metric=? AND resource_type=? AND resource_id=? AND sampled_at>=datetime('now', ?) ORDER BY id ASC").all(ws,metric,resourceType,String(resourceId),`-${span} minutes`);}
function workspaces(){return db.prepare("SELECT id FROM workspaces WHERE status='active'").all();}
module.exports={rules,events,create,remove,enabled,open,last,openEvent,resolve,sample,samples,windowSamples,workspaces};
