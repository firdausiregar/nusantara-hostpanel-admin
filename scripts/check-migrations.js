#!/usr/bin/env node
'use strict';
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {spawnSync}=require('node:child_process');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'hostpanel-migrations-'));
const env={...process.env,NODE_ENV:'development',HOSTPANEL_RUNTIME_MODE:'local',DATA_DIR:tmp,SESSION_SECRET:'migration-check-session-secret-0123456789',HOSTPANEL_MASTER_KEY:Buffer.alloc(32,7).toString('hex')};
const code=`const db=require(require('node:path').join(process.cwd(),'src/core/database'));const rows=db.prepare('SELECT id FROM schema_migrations ORDER BY id').all();if(rows.length<5)throw new Error('migration count terlalu sedikit');const required=['workspaces','workspace_members','releases','app_env_vars','process_definitions','cron_jobs','database_resources','backup_runs','notifications','job_queue'];for(const t of required){if(!db.prepare(\"SELECT 1 FROM sqlite_master WHERE type='table' AND name=?\").get(t))throw new Error('missing table '+t);}console.log('Migration check OK ('+rows.length+' migrations).');`;
const out=spawnSync(process.execPath,['-e',code],{cwd:path.resolve(__dirname,'..'),env,encoding:'utf8'});fs.rmSync(tmp,{recursive:true,force:true});if(out.stdout)process.stdout.write(out.stdout);if(out.stderr)process.stderr.write(out.stderr);process.exit(out.status??1);
