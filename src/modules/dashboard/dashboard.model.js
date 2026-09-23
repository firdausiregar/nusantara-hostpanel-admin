'use strict';
const db = require('../../core/database');
function scope(global,workspaceId,column='workspace_id'){return global?{sql:'',args:[]}:{sql:` WHERE ${column}=?`,args:[workspaceId]};}
function summary(workspaceId,global=false){
  const app=scope(global,workspaceId,'workspace_id'),domain=scope(global,workspaceId,'workspace_id'),zone=scope(global,workspaceId,'workspace_id');
  const deployment=scope(global,workspaceId,'workspace_id');
  const sslWhere=global?' WHERE ssl_enabled=1':' WHERE workspace_id=? AND ssl_enabled=1';
  return{
    apps:db.prepare(`SELECT COUNT(*) AS n FROM apps${app.sql}`).get(...app.args).n,
    domains:db.prepare(`SELECT COUNT(*) AS n FROM domains${domain.sql}`).get(...domain.args).n,
    zones:db.prepare(`SELECT COUNT(*) AS n FROM dns_zones${zone.sql}`).get(...zone.args).n,
    ssl:db.prepare(`SELECT COUNT(*) AS n FROM domains${sslWhere}`).get(...(global?[]:[workspaceId])).n,
    deployments:db.prepare(`SELECT COUNT(*) AS n FROM deployments${deployment.sql}${global?' WHERE':' AND'} status='success'`).get(...deployment.args).n,
  };
}
function recentLogs(workspaceId,global=false){return global?db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 10').all():db.prepare('SELECT * FROM audit_logs WHERE workspace_id=? ORDER BY id DESC LIMIT 10').all(workspaceId);}
function recentDeployments(workspaceId,global=false){return global?db.prepare(`SELECT d.*,a.name AS app_name,a.slug AS app_slug FROM deployments d JOIN apps a ON a.id=d.app_id ORDER BY d.id DESC LIMIT 6`).all():db.prepare(`SELECT d.*,a.name AS app_name,a.slug AS app_slug FROM deployments d JOIN apps a ON a.id=d.app_id WHERE d.workspace_id=? ORDER BY d.id DESC LIMIT 6`).all(workspaceId);}
module.exports={summary,recentLogs,recentDeployments};
