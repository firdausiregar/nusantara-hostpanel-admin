const db = require('../db');

function audit(req, action, resource, detail = '') {
  db.prepare(`INSERT INTO audit_logs (user_id, workspace_id, action, resource, detail, ip) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(req.session?.user?.id || null, req.workspace?.id || null, action, resource || null, String(detail || '').slice(0, 1000), req.ip || null);
}

module.exports = audit;
