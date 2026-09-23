'use strict';

function columns(db, table) {
  try { return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name)); }
  catch { return new Set(); }
}
function ensureColumn(db, table, column, ddl) {
  if (!columns(db, table).has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

const migrations = [
  {
    id: '001_legacy_baseline',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'admin' CHECK(role IN ('admin','operator')),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          last_login_at TEXT
        );
        CREATE TABLE IF NOT EXISTS apps (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          slug TEXT NOT NULL UNIQUE,
          working_dir TEXT NOT NULL,
          entry_file TEXT NOT NULL DEFAULT 'server.js',
          port INTEGER NOT NULL UNIQUE,
          service_name TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'unknown',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS domains (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          hostname TEXT NOT NULL UNIQUE,
          target_port INTEGER,
          app_id INTEGER,
          ssl_enabled INTEGER NOT NULL DEFAULT 0,
          nginx_enabled INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(app_id) REFERENCES apps(id) ON DELETE SET NULL
        );
        CREATE TABLE IF NOT EXISTS dns_zones (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          domain TEXT NOT NULL UNIQUE,
          dnssec_enabled INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS dns_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          zone_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('A','AAAA','CNAME','MX','TXT','NS','CAA','SRV')),
          value TEXT NOT NULL,
          ttl INTEGER NOT NULL DEFAULT 300,
          priority INTEGER,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(zone_id) REFERENCES dns_zones(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS audit_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          action TEXT NOT NULL,
          resource TEXT,
          detail TEXT,
          ip TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
        );
        CREATE TABLE IF NOT EXISTS deployments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          app_id INTEGER NOT NULL,
          source TEXT NOT NULL DEFAULT 'manual',
          status TEXT NOT NULL CHECK(status IN ('queued','running','success','failed')) DEFAULT 'queued',
          commit_sha TEXT,
          branch TEXT,
          message TEXT,
          started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          finished_at TEXT,
          FOREIGN KEY(app_id) REFERENCES apps(id) ON DELETE CASCADE
        );
      `);
      ensureColumn(db,'domains','tls_mode',"tls_mode TEXT NOT NULL DEFAULT 'local'");
      ensureColumn(db,'domains','ssl_last_error','ssl_last_error TEXT');
      ensureColumn(db,'domains','ssl_retry_after','ssl_retry_after TEXT');
      ensureColumn(db,'domains','ssl_last_attempt_at','ssl_last_attempt_at TEXT');
      ensureColumn(db,'domains','ssl_last_preflight_at','ssl_last_preflight_at TEXT');
      ensureColumn(db,'domains','ssl_last_preflight_ok','ssl_last_preflight_ok INTEGER NOT NULL DEFAULT 0');
      ensureColumn(db,'apps','start_mode',"start_mode TEXT NOT NULL DEFAULT 'node'");
      ensureColumn(db,'apps','start_command','start_command TEXT');
      ensureColumn(db,'apps','npm_script',"npm_script TEXT NOT NULL DEFAULT 'start'");
      ensureColumn(db,'apps','restart_policy',"restart_policy TEXT NOT NULL DEFAULT 'on-failure'");
      ensureColumn(db,'apps','git_repo','git_repo TEXT');
      ensureColumn(db,'apps','git_branch',"git_branch TEXT NOT NULL DEFAULT 'main'");
      ensureColumn(db,'apps','build_script','build_script TEXT');
      ensureColumn(db,'apps','health_path',"health_path TEXT NOT NULL DEFAULT '/'");
      ensureColumn(db,'apps','last_deployed_commit','last_deployed_commit TEXT');
      ensureColumn(db,'apps','last_deployed_at','last_deployed_at TEXT');
      ensureColumn(db,'apps','memory_limit_mb','memory_limit_mb INTEGER NOT NULL DEFAULT 0');
      ensureColumn(db,'apps','cpu_quota_percent','cpu_quota_percent INTEGER NOT NULL DEFAULT 0');
      ensureColumn(db,'apps','tasks_max','tasks_max INTEGER NOT NULL DEFAULT 0');
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_dns_records_zone ON dns_records(zone_id);
        CREATE INDEX IF NOT EXISTS idx_domains_app ON domains(app_id);
        CREATE INDEX IF NOT EXISTS idx_deployments_app ON deployments(app_id, id DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
      `);
    },
  },
  {
    id: '010_saas_workspaces',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS workspaces (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          slug TEXT NOT NULL UNIQUE,
          plan TEXT NOT NULL DEFAULT 'self-hosted',
          owner_user_id INTEGER,
          max_apps INTEGER NOT NULL DEFAULT 0,
          max_domains INTEGER NOT NULL DEFAULT 0,
          max_databases INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE SET NULL
        );
        CREATE TABLE IF NOT EXISTS workspace_members (
          workspace_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('owner','admin','developer','viewer')),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY(workspace_id,user_id),
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS workspace_invites (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id INTEGER NOT NULL,
          email TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('admin','developer','viewer')),
          token_hash TEXT NOT NULL UNIQUE,
          expires_at TEXT NOT NULL,
          accepted_at TEXT,
          created_by INTEGER,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
          FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL
        );
      `);
      ensureColumn(db,'apps','workspace_id','workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE');
      ensureColumn(db,'domains','workspace_id','workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE');
      ensureColumn(db,'dns_zones','workspace_id','workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE');
      ensureColumn(db,'audit_logs','workspace_id','workspace_id INTEGER REFERENCES workspaces(id) ON DELETE SET NULL');
      ensureColumn(db,'deployments','workspace_id','workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE');
      const firstUser = db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get();
      let ws = db.prepare("SELECT id FROM workspaces WHERE slug='default'").get();
      if (!ws) {
        const info = db.prepare('INSERT INTO workspaces (name,slug,owner_user_id) VALUES (?,?,?)').run('Default Workspace','default',firstUser?.id || null);
        ws = { id: Number(info.lastInsertRowid) };
      }
      if (firstUser) db.prepare("INSERT OR IGNORE INTO workspace_members (workspace_id,user_id,role) VALUES (?,?, 'owner')").run(ws.id,firstUser.id);
      db.prepare('UPDATE apps SET workspace_id=? WHERE workspace_id IS NULL').run(ws.id);
      db.prepare('UPDATE domains SET workspace_id=? WHERE workspace_id IS NULL').run(ws.id);
      db.prepare('UPDATE dns_zones SET workspace_id=? WHERE workspace_id IS NULL').run(ws.id);
      db.prepare('UPDATE deployments SET workspace_id=? WHERE workspace_id IS NULL').run(ws.id);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_apps_workspace ON apps(workspace_id,id DESC);
        CREATE INDEX IF NOT EXISTS idx_domains_workspace ON domains(workspace_id,id DESC);
        CREATE INDEX IF NOT EXISTS idx_dns_zones_workspace ON dns_zones(workspace_id,id DESC);
        CREATE INDEX IF NOT EXISTS idx_deployments_workspace ON deployments(workspace_id,id DESC);
      `);
    },
  },
  {
    id: '020_security_identity',
    up(db) {
      ensureColumn(db,'users','totp_secret_enc','totp_secret_enc TEXT');
      ensureColumn(db,'users','totp_enabled','totp_enabled INTEGER NOT NULL DEFAULT 0');
      ensureColumn(db,'users','recovery_codes_enc','recovery_codes_enc TEXT');
      ensureColumn(db,'users','disabled_at','disabled_at TEXT');
      ensureColumn(db,'users','display_name','display_name TEXT');
      db.exec(`
        CREATE TABLE IF NOT EXISTS auth_sessions (
          id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL,
          workspace_id INTEGER,
          ip TEXT,
          user_agent TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          revoked_at TEXT,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id,created_at DESC);
        CREATE TABLE IF NOT EXISTS security_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          event TEXT NOT NULL,
          severity TEXT NOT NULL DEFAULT 'info' CHECK(severity IN ('info','warn','critical')),
          ip TEXT,
          user_agent TEXT,
          detail TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_security_events_created ON security_events(created_at DESC);
        CREATE TABLE IF NOT EXISTS api_tokens (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          workspace_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          token_prefix TEXT NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          scopes TEXT NOT NULL DEFAULT 'read',
          last_used_at TEXT,
          expires_at TEXT,
          revoked_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );
      `);
    },
  },
  {
    id: '030_projects_platform',
    up(db) {
      ensureColumn(db,'apps','node_runtime',"node_runtime TEXT NOT NULL DEFAULT 'system'");
      ensureColumn(db,'apps','deploy_strategy',"deploy_strategy TEXT NOT NULL DEFAULT 'atomic'");
      ensureColumn(db,'apps','auto_deploy','auto_deploy INTEGER NOT NULL DEFAULT 0');
      ensureColumn(db,'apps','preview_enabled','preview_enabled INTEGER NOT NULL DEFAULT 0');
      ensureColumn(db,'apps','preview_domain_suffix','preview_domain_suffix TEXT');
      ensureColumn(db,'apps','install_command',"install_command TEXT NOT NULL DEFAULT 'npm ci'");
      ensureColumn(db,'apps','release_keep','release_keep INTEGER NOT NULL DEFAULT 5');
      ensureColumn(db,'deployments','environment',"environment TEXT NOT NULL DEFAULT 'production'");
      ensureColumn(db,'deployments','release_id','release_id TEXT');
      ensureColumn(db,'deployments','previous_release_id','previous_release_id TEXT');
      ensureColumn(db,'deployments','trigger',"trigger TEXT NOT NULL DEFAULT 'manual'");
      ensureColumn(db,'deployments','actor_user_id','actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL');
      ensureColumn(db,'deployments','log_excerpt','log_excerpt TEXT');
      db.exec(`
        CREATE TABLE IF NOT EXISTS app_environments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          app_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          kind TEXT NOT NULL CHECK(kind IN ('production','preview','development')),
          branch TEXT,
          domain TEXT,
          port INTEGER,
          active_release_id TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(app_id,name),
          FOREIGN KEY(app_id) REFERENCES apps(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS releases (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          app_id INTEGER NOT NULL,
          deployment_id INTEGER,
          environment TEXT NOT NULL DEFAULT 'production',
          release_id TEXT NOT NULL,
          path TEXT NOT NULL,
          commit_sha TEXT,
          status TEXT NOT NULL CHECK(status IN ('built','active','failed','rolled_back')) DEFAULT 'built',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          activated_at TEXT,
          UNIQUE(app_id,release_id),
          FOREIGN KEY(app_id) REFERENCES apps(id) ON DELETE CASCADE,
          FOREIGN KEY(deployment_id) REFERENCES deployments(id) ON DELETE SET NULL
        );
        CREATE TABLE IF NOT EXISTS app_env_vars (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          app_id INTEGER NOT NULL,
          environment TEXT NOT NULL DEFAULT 'production',
          name TEXT NOT NULL,
          value_enc TEXT NOT NULL,
          is_secret INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(app_id,environment,name),
          FOREIGN KEY(app_id) REFERENCES apps(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS process_definitions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          app_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'worker' CHECK(kind IN ('worker','queue','scheduler')),
          command TEXT NOT NULL,
          instances INTEGER NOT NULL DEFAULT 1,
          enabled INTEGER NOT NULL DEFAULT 1,
          restart_policy TEXT NOT NULL DEFAULT 'on-failure',
          memory_limit_mb INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(app_id,name),
          FOREIGN KEY(app_id) REFERENCES apps(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS cron_jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          app_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          schedule TEXT NOT NULL,
          command TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          last_run_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(app_id,name),
          FOREIGN KEY(app_id) REFERENCES apps(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS git_credentials (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          app_id INTEGER NOT NULL UNIQUE,
          provider TEXT NOT NULL DEFAULT 'github',
          username TEXT,
          token_enc TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(app_id) REFERENCES apps(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS webhooks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          app_id INTEGER NOT NULL UNIQUE,
          provider TEXT NOT NULL DEFAULT 'github',
          public_id TEXT UNIQUE,
          secret_enc TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(app_id) REFERENCES apps(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_releases_app ON releases(app_id,id DESC);
        CREATE INDEX IF NOT EXISTS idx_env_vars_app ON app_env_vars(app_id,environment);
        CREATE INDEX IF NOT EXISTS idx_process_app ON process_definitions(app_id);
        CREATE INDEX IF NOT EXISTS idx_cron_app ON cron_jobs(app_id);
      `);
    },
  },
  {
    id: '040_operations',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS database_resources (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id INTEGER NOT NULL,
          app_id INTEGER,
          db_name TEXT NOT NULL UNIQUE,
          db_user TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
          FOREIGN KEY(app_id) REFERENCES apps(id) ON DELETE SET NULL
        );
        CREATE TABLE IF NOT EXISTS backup_policies (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id INTEGER NOT NULL UNIQUE,
          enabled INTEGER NOT NULL DEFAULT 1,
          schedule TEXT NOT NULL DEFAULT 'daily',
          retention_days INTEGER NOT NULL DEFAULT 7,
          offsite_remote TEXT,
          encrypt INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS notifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id INTEGER NOT NULL,
          level TEXT NOT NULL DEFAULT 'info' CHECK(level IN ('info','success','warn','critical')),
          type TEXT NOT NULL DEFAULT 'system',
          title TEXT NOT NULL,
          message TEXT NOT NULL,
          resource_type TEXT,
          resource_id TEXT,
          read_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS notification_channels (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id INTEGER NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('webhook','telegram','email')),
          name TEXT NOT NULL,
          config_enc TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS health_incidents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          app_id INTEGER NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('open','resolved')) DEFAULT 'open',
          message TEXT,
          opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          resolved_at TEXT,
          FOREIGN KEY(app_id) REFERENCES apps(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_notifications_workspace ON notifications(workspace_id,id DESC);
        CREATE INDEX IF NOT EXISTS idx_database_resources_workspace ON database_resources(workspace_id,id DESC);
        CREATE INDEX IF NOT EXISTS idx_health_incidents_app ON health_incidents(app_id,status);
      `);
    },
  },
  {
    id: '050_production_platform',
    up(db) {
      ensureColumn(db,'workspaces','status',"status TEXT NOT NULL DEFAULT 'active'");
      ensureColumn(db,'workspaces','max_storage_mb','max_storage_mb INTEGER NOT NULL DEFAULT 0');
      ensureColumn(db,'apps','template',"template TEXT NOT NULL DEFAULT 'existing'");
      ensureColumn(db,'apps','health_interval_sec','health_interval_sec INTEGER NOT NULL DEFAULT 300');
      ensureColumn(db,'apps','last_health_at','last_health_at TEXT');
      ensureColumn(db,'apps','last_health_ok','last_health_ok INTEGER');
      ensureColumn(db,'apps','last_health_latency_ms','last_health_latency_ms INTEGER');
      ensureColumn(db,'domains','redirect_https','redirect_https INTEGER NOT NULL DEFAULT 1');
      ensureColumn(db,'domains','canonical_mode',"canonical_mode TEXT NOT NULL DEFAULT 'none'");
      ensureColumn(db,'domains','websocket_enabled','websocket_enabled INTEGER NOT NULL DEFAULT 1');
      ensureColumn(db,'domains','upload_limit_mb','upload_limit_mb INTEGER NOT NULL DEFAULT 25');
      ensureColumn(db,'domains','proxy_timeout_sec','proxy_timeout_sec INTEGER NOT NULL DEFAULT 60');
      ensureColumn(db,'domains','maintenance_mode','maintenance_mode INTEGER NOT NULL DEFAULT 0');
      ensureColumn(db,'domains','custom_headers_json',"custom_headers_json TEXT NOT NULL DEFAULT '{}'");
      db.exec(`
        CREATE TABLE IF NOT EXISTS job_queue (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id INTEGER,
          type TEXT NOT NULL,
          payload_json TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','success','failed')),
          attempts INTEGER NOT NULL DEFAULT 0,
          max_attempts INTEGER NOT NULL DEFAULT 3,
          available_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          locked_at TEXT,
          finished_at TEXT,
          error TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_job_queue_ready ON job_queue(status,available_at,id);
        CREATE TABLE IF NOT EXISTS backup_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id INTEGER,
          name TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'server',
          status TEXT NOT NULL DEFAULT 'success' CHECK(status IN ('running','success','failed')),
          size_bytes INTEGER NOT NULL DEFAULT 0,
          verified INTEGER NOT NULL DEFAULT 0,
          offsite_status TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL
        );
        CREATE TABLE IF NOT EXISTS workspace_settings (
          workspace_id INTEGER NOT NULL,
          key TEXT NOT NULL,
          value_enc TEXT,
          value_text TEXT,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY(workspace_id,key),
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );
      `);
    },
  },

  {
    id: '060_platform_maturity',
    up(db) {
      ensureColumn(db,'users','email_verified_at','email_verified_at TEXT');
      ensureColumn(db,'users','password_changed_at','password_changed_at TEXT');
      ensureColumn(db,'workspaces','billing_email','billing_email TEXT');
      ensureColumn(db,'workspaces','trial_ends_at','trial_ends_at TEXT');
      ensureColumn(db,'releases','node_runtime','node_runtime TEXT');
      ensureColumn(db,'releases','lockfile_hash','lockfile_hash TEXT');
      ensureColumn(db,'releases','artifact_sha256','artifact_sha256 TEXT');
      ensureColumn(db,'releases','build_duration_ms','build_duration_ms INTEGER');
      ensureColumn(db,'deployments','idempotency_key','idempotency_key TEXT');
      ensureColumn(db,'job_queue','idempotency_key','idempotency_key TEXT');
      ensureColumn(db,'job_queue','priority','priority INTEGER NOT NULL DEFAULT 100');
      ensureColumn(db,'job_queue','timeout_sec','timeout_sec INTEGER NOT NULL DEFAULT 900');
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_job_queue_idempotency ON job_queue(workspace_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_job_queue_priority ON job_queue(status,available_at,priority,id);

        CREATE TABLE IF NOT EXISTS integration_connections (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id INTEGER NOT NULL,
          provider TEXT NOT NULL CHECK(provider IN ('github')),
          account_login TEXT,
          token_enc TEXT NOT NULL,
          metadata_json TEXT NOT NULL DEFAULT '{}',
          connected_by INTEGER,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(workspace_id,provider),
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
          FOREIGN KEY(connected_by) REFERENCES users(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS preview_deployments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id INTEGER NOT NULL,
          app_id INTEGER NOT NULL,
          branch TEXT NOT NULL,
          slug TEXT NOT NULL UNIQUE,
          hostname TEXT,
          port INTEGER NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','building','active','failed','stopped')),
          release_path TEXT,
          commit_sha TEXT,
          expires_at TEXT,
          created_by INTEGER,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(app_id,branch),
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
          FOREIGN KEY(app_id) REFERENCES apps(id) ON DELETE CASCADE,
          FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_previews_workspace ON preview_deployments(workspace_id,status,id DESC);

        CREATE TABLE IF NOT EXISTS alert_rules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          metric TEXT NOT NULL CHECK(metric IN ('memory_percent','disk_percent','load_per_cpu','app_unhealthy','ssl_days','backup_failed','job_failed')),
          operator TEXT NOT NULL DEFAULT 'gte' CHECK(operator IN ('gte','lte','eq')),
          threshold REAL NOT NULL DEFAULT 0,
          duration_min INTEGER NOT NULL DEFAULT 5,
          severity TEXT NOT NULL DEFAULT 'warn' CHECK(severity IN ('info','warn','critical')),
          enabled INTEGER NOT NULL DEFAULT 1,
          cooldown_min INTEGER NOT NULL DEFAULT 60,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS alert_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          rule_id INTEGER,
          workspace_id INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
          fingerprint TEXT NOT NULL,
          value REAL,
          message TEXT NOT NULL,
          opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          resolved_at TEXT,
          UNIQUE(workspace_id,fingerprint,status),
          FOREIGN KEY(rule_id) REFERENCES alert_rules(id) ON DELETE SET NULL,
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_alert_events_workspace ON alert_events(workspace_id,status,id DESC);

        CREATE TABLE IF NOT EXISTS metric_samples (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id INTEGER,
          metric TEXT NOT NULL,
          resource_type TEXT NOT NULL DEFAULT 'server',
          resource_id TEXT NOT NULL DEFAULT 'local',
          value REAL NOT NULL,
          sampled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_metric_samples_lookup ON metric_samples(workspace_id,metric,resource_type,resource_id,id DESC);

        CREATE TABLE IF NOT EXISTS billing_plans (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          code TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          monthly_price_cents INTEGER NOT NULL DEFAULT 0,
          currency TEXT NOT NULL DEFAULT 'IDR',
          max_apps INTEGER NOT NULL DEFAULT 0,
          max_domains INTEGER NOT NULL DEFAULT 0,
          max_databases INTEGER NOT NULL DEFAULT 0,
          max_storage_mb INTEGER NOT NULL DEFAULT 0,
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS subscriptions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id INTEGER NOT NULL UNIQUE,
          plan_id INTEGER,
          status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('trialing','active','past_due','grace','suspended','cancelled')),
          provider TEXT NOT NULL DEFAULT 'manual',
          provider_customer_id TEXT,
          provider_subscription_id TEXT,
          current_period_start TEXT,
          current_period_end TEXT,
          grace_ends_at TEXT,
          cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
          FOREIGN KEY(plan_id) REFERENCES billing_plans(id) ON DELETE SET NULL
        );
        CREATE TABLE IF NOT EXISTS invoices (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id INTEGER NOT NULL,
          subscription_id INTEGER,
          number TEXT NOT NULL UNIQUE,
          amount_cents INTEGER NOT NULL DEFAULT 0,
          currency TEXT NOT NULL DEFAULT 'IDR',
          status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('draft','open','paid','void','uncollectible')),
          due_at TEXT,
          paid_at TEXT,
          provider_invoice_id TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
          FOREIGN KEY(subscription_id) REFERENCES subscriptions(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS password_reset_tokens (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          expires_at TEXT NOT NULL,
          used_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS email_verification_tokens (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          expires_at TEXT NOT NULL,
          used_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        INSERT OR IGNORE INTO billing_plans (code,name,monthly_price_cents,currency,max_apps,max_domains,max_databases,max_storage_mb)
        VALUES ('self-hosted','Self-hosted',0,'IDR',0,0,0,0),('starter','Starter',0,'IDR',3,5,2,2048),('pro','Pro',0,'IDR',20,50,20,20480);
      `);
    },
  },


  {
    id: '061_job_reliability',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS job_dead_letters (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          original_job_id INTEGER,
          workspace_id INTEGER,
          type TEXT NOT NULL,
          payload_json TEXT NOT NULL DEFAULT '{}',
          attempts INTEGER NOT NULL DEFAULT 0,
          error TEXT,
          failed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_job_dead_letters_workspace ON job_dead_letters(workspace_id,id DESC);
      `);
    },
  },


  {
    id: '070_full_integrations_i18n',
    up(db) {
      ensureColumn(db,'users','locale',"locale TEXT NOT NULL DEFAULT 'id'");
      // Expand integration provider constraint introduced by migration 060.
      db.exec(`
        ALTER TABLE integration_connections RENAME TO integration_connections_legacy_070;
        CREATE TABLE integration_connections (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id INTEGER NOT NULL,
          provider TEXT NOT NULL CHECK(provider IN ('github','github_app')),
          account_login TEXT,
          token_enc TEXT NOT NULL DEFAULT '',
          metadata_json TEXT NOT NULL DEFAULT '{}',
          connected_by INTEGER,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(workspace_id,provider),
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
          FOREIGN KEY(connected_by) REFERENCES users(id) ON DELETE SET NULL
        );
        INSERT INTO integration_connections (id,workspace_id,provider,account_login,token_enc,metadata_json,connected_by,created_at,updated_at)
          SELECT id,workspace_id,provider,account_login,token_enc,metadata_json,connected_by,created_at,updated_at FROM integration_connections_legacy_070;
        DROP TABLE integration_connections_legacy_070;

        CREATE TABLE IF NOT EXISTS billing_transactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id INTEGER NOT NULL,
          plan_id INTEGER,
          invoice_id INTEGER,
          provider TEXT NOT NULL DEFAULT 'midtrans',
          order_id TEXT NOT NULL UNIQUE,
          gross_amount INTEGER NOT NULL,
          currency TEXT NOT NULL DEFAULT 'IDR',
          snap_token TEXT,
          redirect_url TEXT,
          transaction_id TEXT,
          transaction_status TEXT NOT NULL DEFAULT 'created',
          fraud_status TEXT,
          payment_type TEXT,
          raw_json TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          settled_at TEXT,
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
          FOREIGN KEY(plan_id) REFERENCES billing_plans(id) ON DELETE SET NULL,
          FOREIGN KEY(invoice_id) REFERENCES invoices(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_billing_transactions_workspace ON billing_transactions(workspace_id,id DESC);
        CREATE INDEX IF NOT EXISTS idx_billing_transactions_status ON billing_transactions(transaction_status,id DESC);

        CREATE TABLE IF NOT EXISTS billing_provider_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider TEXT NOT NULL,
          event_key TEXT NOT NULL UNIQUE,
          order_id TEXT,
          payload_json TEXT NOT NULL,
          processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS billing_payment_methods (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id INTEGER NOT NULL,
          provider TEXT NOT NULL DEFAULT 'midtrans',
          type TEXT,
          token_enc TEXT NOT NULL,
          metadata_json TEXT NOT NULL DEFAULT '{}',
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_payment_methods_workspace ON billing_payment_methods(workspace_id,active,id DESC);
      `);
    },
  },

];

module.exports = { migrations, ensureColumn };
