'use strict';const db=require('../../core/database');
module.exports={
 list:(ws)=>db.prepare(`SELECT z.*,COUNT(r.id) AS record_count FROM dns_zones z LEFT JOIN dns_records r ON r.zone_id=z.id WHERE z.workspace_id=? GROUP BY z.id ORDER BY z.id DESC`).all(ws),
 zone:(id,ws)=>db.prepare('SELECT * FROM dns_zones WHERE id=? AND workspace_id=?').get(id,ws),
 records:(id)=>db.prepare('SELECT * FROM dns_records WHERE zone_id=? ORDER BY name,type,id').all(id),
 recordsForSync:(id)=>db.prepare('SELECT name,type,value,ttl,priority FROM dns_records WHERE zone_id=? ORDER BY id').all(id),
 createZone:(domain,ws)=>db.prepare('INSERT INTO dns_zones (workspace_id,domain) VALUES (?,?)').run(ws,domain),
 deleteZone:(id,ws)=>db.prepare('DELETE FROM dns_zones WHERE id=? AND workspace_id=?').run(id,ws),
 addRecord:(zoneId,name,type,value,ttl,priority)=>db.prepare('INSERT INTO dns_records (zone_id,name,type,value,ttl,priority) VALUES (?,?,?,?,?,?)').run(zoneId,name,type,value,ttl,priority),
 record:(zoneId,id)=>db.prepare('SELECT * FROM dns_records WHERE id=? AND zone_id=?').get(id,zoneId),
 deleteRecord:(id)=>db.prepare('DELETE FROM dns_records WHERE id=?').run(id),
 restoreRecord:(r)=>db.prepare('INSERT INTO dns_records (id,zone_id,name,type,value,ttl,priority,created_at) VALUES (?,?,?,?,?,?,?,?)').run(r.id,r.zone_id,r.name,r.type,r.value,r.ttl,r.priority,r.created_at),
 conflict:(zoneId,name)=>db.prepare('SELECT id,type FROM dns_records WHERE zone_id=? AND name=? LIMIT 1').get(zoneId,name),
 cname:(zoneId,name)=>db.prepare("SELECT id FROM dns_records WHERE zone_id=? AND name=? AND type='CNAME' LIMIT 1").get(zoneId,name),
};
