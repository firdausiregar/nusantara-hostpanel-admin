'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('../config');

const stateFile = path.join(config.dataDir, 'local-runtime.json');
function load() { try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return { apps: {}, services: {}, backups: [], databases: [], workers:{}, cron:{}, env:{}, files:{}, dbDumps:{}, previews:{} }; } }
function save(state) { fs.mkdirSync(config.dataDir, { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(state, null, 2)); }
function json(value) { return { ok: true, stdout: JSON.stringify(value), stderr: '' }; }
function fakeCerts() { return [{ name: 'local.test', domains: ['local.test','*.local.test'], expiresAt: new Date(Date.now()+80*86400000).toISOString(), daysRemaining: 80, renewalAuthenticator: 'local-simulator', renewalAuto: true }]; }

async function run(action, args = []) {
  const state = load();
  if (action === 'status-all') return json(['nginx','bind9','php-fpm','mariadb'].map((name) => ({ name, active: state.services[name] !== false })));
  if (action === 'service-action') { const verb=String(args[0]), name=String(args[1]); state.services[name]=verb!=='stop'; if(name.startsWith('hostapp-')){const slug=name.slice(8); if(state.apps[slug]){state.apps[slug].active=verb!=='stop'; if(verb==='restart'||verb==='start')state.apps[slug].startedAt=new Date().toISOString();}} save(state); return json({ ok: true }); }
  if (action === 'app-status-all') return json(Object.values(state.apps).map((app) => ({ slug: app.slug, activeState: app.active === false ? 'inactive' : 'active', subState: app.active === false ? 'dead' : 'running', pid: app.active === false ? 0 : 10000 + app.port, startedAt: app.startedAt || new Date().toISOString() })));
  if (action === 'app-logs') return { ok: true, stdout: `[local simulator] ${args[0]}\nAplikasi berjalan dalam mode development. Tidak ada journal systemd pada laptop.`, stderr: '' };
  if (action === 'app-remove') { delete state.apps[String(args[0])]; save(state); return json({ ok: true }); }
  if (action === 'nginx-proxy-upsert') return json({ ok: true, https: false, simulated: true });
  if (action === 'nginx-remove' || action === 'zone-sync' || action === 'zone-remove') return json({ ok: true, simulated: true });
  if (action === 'certbot-preflight') return json({ ok: true, domain: args[0], resolved: '127.0.0.1', simulated: true });
  if (['certbot-staging-test','certbot-system-staging'].includes(action)) return json({ ok: true, staging: true, simulated: true });
  if (['certbot-issue','certbot-system-issue','certbot-activate-existing','certbot-system-activate-existing'].includes(action)) return json({ ok: true, simulated: true, certificateName: 'local.test', source: 'local-simulator' });
  if (action === 'ssl-status') return json({ tlsMode: 'off', timerName: 'local-simulator', timerActive: true, timerEnabled: true, nextRun: '', certbotVersion: 'local-simulator', certificates: fakeCerts() });
  if (['certbot-renew','certbot-dry-run'].includes(action)) return { ok: true, stdout: 'local-simulator:ok', stderr: '' };
  if (action === 'credentials-status') return json({ dbAdminUser: 'localadmin', pmaBasicUser: 'local', pmaControlUser: 'phpmyadmin', simulated: true });
  if (action === 'security-audit') return json({ score: 100, mode: 'local-simulator', checks: [{ label: 'Privilege boundary', status: 'pass', detail: 'Tidak ada sudo/systemd pada local runtime.' }, { label: 'Local runtime isolation', status: 'pass', detail: 'Semua operasi privileged disimulasikan di data/local-runtime.json.' }] });
  if (['db-admin-rotate','pma-basic-rotate'].includes(action)) return json({ username: action.startsWith('db-') ? 'localadmin' : 'pmaadmin', password: crypto.randomBytes(18).toString('base64url'), host: 'localhost', simulated: true });
  if (action === 'pma-control-repair') return json({ username: 'phpmyadmin', database: 'phpmyadmin', simulated: true });
  if (action === 'metrics-summary') {
    const total = os.totalmem(); const free = os.freemem();
    return json({ hostname: os.hostname(), uptimeSeconds: os.uptime(), loadavg: os.loadavg(), cpuCount: os.cpus().length, memory: { total, used: total-free, free }, disk: { total: 100*1024**3, used: 28*1024**3, free: 72*1024**3, percent: 28 }, networkMode: 'local', runtimeMode: 'local' });
  }
  if (action === 'backup-list') return json(state.backups || []);
  if (action === 'backup-create') { const stamp = new Date().toISOString().replace(/[:.]/g,'-'); const item={ name: stamp, createdAt:new Date().toISOString(), sizeBytes: 1024*1024*4, verified:true, simulated:true }; state.backups.unshift(item); save(state); return json(item); }
  if (action === 'backup-verify') return json({ ok: true, name: args[0], verified: true, simulated: true });
  if (action === 'backup-restore-schedule') return json({ok:true,name:String(args[0]),unit:'local-restore-simulator',simulated:true});
  if (action === 'backup-offsite') return json({ok:true,name:String(args[0]),remote:String(args[1]),destination:`${args[1]}:nusantara-hostpanel/local/${args[0]}`,simulated:true});
  if (action === 'db-list') return json(state.databases || []);
  if (action === 'db-create') { const name=String(args[0]); if (!state.databases.find((d)=>d.name===name)) state.databases.push({ name, sizeBytes:0, users:[] }); save(state); return json({ name, created:true, simulated:true }); }
  if (action === 'db-user-create') { const [database,user]=args.map(String); const item=state.databases.find((d)=>d.name===database); if (item && !item.users.includes(user)) item.users.push(user); save(state); return json({ database, username:user, password:crypto.randomBytes(18).toString('base64url'), host:'localhost', simulated:true }); }
  if (action === 'db-drop') { if(String(args[0])!==String(args[1])) throw new Error('Konfirmasi nama database tidak cocok.'); state.databases=state.databases.filter((d)=>d.name!==String(args[0])); save(state); return json({ ok:true, simulated:true }); }
  if (action === 'app-health') return json({ ok: true, statusCode: 200, latencyMs: 12, simulated: true });
  if (action === 'app-bootstrap-git') return json({ ok: true, commit: crypto.randomBytes(6).toString('hex'), branch: args[3] || 'main', simulated: true, message: 'Local Git import simulation completed.' });
  if (action === 'app-deploy') return json({ ok: true, commit: crypto.randomBytes(6).toString('hex'), branch: args[3] || 'main', simulated: true, message: 'Local deployment simulation completed.' });
  if (action === 'app-metrics-all') return json(Object.values(state.apps).map((a)=>({slug:a.slug,memoryBytes:a.active===false?0:32*1024*1024,tasks:a.active===false?0:8,restarts:0,cpuUsageNSec:0,pid:a.active===false?0:10000+a.port})));
  if (action === 'app-env-keys') return json(Object.keys((state.env||{})[String(args[0])]||{}).sort());
  if (action === 'worker-status') return json(Object.values((state.workers||{})[String(args[0])]||{}).flatMap((w)=>Array.from({length:w.instances||1},(_,i)=>({unit:`hostworker-${args[0]}-${w.name}-${i+1}`,active:w.enabled!==false}))));
  if (action === 'cron-status') return json(Object.values((state.cron||{})[String(args[0])]||{}).map((j)=>({unit:`hostcron-${args[0]}-${j.name}`,active:j.enabled!==false})));
  if (action === 'worker-remove') { state.workers=state.workers||{}; if(state.workers[String(args[0])])delete state.workers[String(args[0])][String(args[1])];save(state);return json({ok:true,simulated:true}); }
  if (action === 'cron-remove') { state.cron=state.cron||{}; if(state.cron[String(args[0])])delete state.cron[String(args[0])][String(args[1])];save(state);return json({ok:true,simulated:true}); }
  if (action === 'logs-tail') return {ok:true,stdout:`[local simulator] ${args[0]}
${new Date().toISOString()} simulated log line`,stderr:''};
  if (action === 'db-dump-list') return json(((state.dbDumps||{})[String(args[0])]||[]));
  if (action === 'db-dump') { const db=String(args[0]),stamp=new Date().toISOString().replace(/[-:T.]/g,'').slice(0,14),item={name:`${db}-${stamp.slice(0,8)}-${stamp.slice(8)}.sql.gz`,sizeBytes:4096,createdAt:new Date().toISOString(),simulated:true};state.dbDumps=state.dbDumps||{};(state.dbDumps[db]||(state.dbDumps[db]=[])).unshift(item);save(state);return json(item); }
  if (action === 'db-dump-restore') return json({ok:true,database:String(args[0]),name:String(args[1]),simulated:true});
  if (action === 'app-release-activate') return json({ok:true,releaseId:String(args[2]),path:`${args[1]}/releases/${args[2]}`,simulated:true});
  if (action === 'preview-remove') { state.previews=state.previews||{}; delete state.previews[String(args[0])]; save(state); return json({ok:true,preview:String(args[0]),simulated:true}); }
  if (action === 'preview-logs') return {ok:true,stdout:`[local simulator] preview ${args[0]}\n${new Date().toISOString()} simulated preview log line`,stderr:''};
  if (action === 'runtime-list') return json(['system','node20','node22','node24'].map((id)=>({id,available:true,node:process.execPath})));
  throw new Error(`Action ${action} belum disimulasikan pada HOSTPANEL_RUNTIME_MODE=local.`);
}

async function runWithInput(action, input) {
  const state = load();
  const payload = JSON.parse(String(input || '{}'));
  if (action === 'nginx-proxy-upsert-json') return json({ok:true,domain:payload.hostname,https:false,canonical:payload.canonicalMode==='www'?`www.${payload.hostname}`:payload.canonicalMode==='non-www'?String(payload.hostname||'').replace(/^www\./,''):payload.hostname,simulated:true});
  if (action === 'app-upsert-json') { state.apps[payload.slug] = { ...payload, active: true, startedAt: new Date().toISOString() }; save(state); return json({ ok: true, simulated: true }); }
  if (action === 'app-deploy-json') { const releaseId=`${new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')}-${crypto.randomBytes(6).toString('hex')}`;const commit=crypto.randomBytes(20).toString('hex');state.apps[payload.slug]={...(state.apps[payload.slug]||{}),...payload,active:true,startedAt:new Date().toISOString(),currentRelease:releaseId};save(state);return json({ok:true,commit,branch:payload.gitBranch||'main',releaseId,path:`${payload.workingDir}/releases/${releaseId}`,previousReleaseId:'',health:{ok:true,statusCode:200,latencyMs:11},simulated:true}); }
  if (action === 'preview-deploy-json') { state.previews=state.previews||{}; const commit=crypto.randomBytes(20).toString('hex'); const item={...payload,commit,active:true,startedAt:new Date().toISOString(),simulated:true}; state.previews[payload.previewSlug]=item; save(state); return json({ok:true,commit,previewSlug:payload.previewSlug,path:`${payload.workingDir}/previews/${payload.previewSlug}`,health:{ok:true,statusCode:200,latencyMs:9},simulated:true}); }
  if (action === 'app-template-create-json') return json({ok:true,template:payload.template,simulated:true});
  if (action === 'certbot-wildcard-json') return json({ok:true,domain:payload.domain,provider:payload.provider,certificateName:payload.domain,domains:[payload.domain,`*.${payload.domain}`],autoRenew:true,simulated:true});
  if (action === 'app-env-set-json') { state.env=state.env||{};state.env[payload.slug]=state.env[payload.slug]||{};state.env[payload.slug][payload.key]=payload.value;save(state);return json({ok:true,key:payload.key,simulated:true}); }
  if (action === 'app-env-remove-json') { state.env=state.env||{};if(state.env[payload.slug])delete state.env[payload.slug][payload.key];save(state);return json({ok:true,key:payload.key,simulated:true}); }
  if (action === 'worker-upsert-json') { state.workers=state.workers||{};state.workers[payload.slug]=state.workers[payload.slug]||{};state.workers[payload.slug][payload.name]=payload;save(state);return json({ok:true,instances:payload.instances||1,simulated:true}); }
  if (action === 'cron-upsert-json') { state.cron=state.cron||{};state.cron[payload.slug]=state.cron[payload.slug]||{};state.cron[payload.slug][payload.name]=payload;save(state);return json({ok:true,simulated:true}); }
  const fkey=(p)=>`${p.slug}:${p.path||p.dir||''}`;
  if (action === 'files-list-json') { state.files=state.files||{};const prefix=`${payload.slug}:${payload.path?payload.path.replace(/\/$/,'')+'/':''}`;const items=[];const seen=new Set();for(const key of Object.keys(state.files)){if(!key.startsWith(prefix))continue;const rest=key.slice(prefix.length);if(!rest||rest.includes('/'))continue;if(!seen.has(rest)){seen.add(rest);items.push({name:rest,type:'file',sizeBytes:Buffer.byteLength(state.files[key]||''),mtime:new Date().toISOString()});}}return json({path:payload.path||'',items}); }
  if (action === 'files-read-json') { state.files=state.files||{};const key=fkey(payload);if(!(key in state.files))throw new Error('File simulator tidak ditemukan.');return json({path:payload.path,content:state.files[key],sizeBytes:Buffer.byteLength(state.files[key])}); }
  if (action === 'files-write-json') { state.files=state.files||{};state.files[fkey(payload)]=String(payload.content||'');save(state);return json({ok:true,path:payload.path}); }
  if (action === 'files-delete-json') { state.files=state.files||{};delete state.files[fkey(payload)];save(state);return json({ok:true,path:payload.path}); }
  if (action === 'files-upload-json') { state.files=state.files||{};const path=[payload.dir,payload.name].filter(Boolean).join('/');state.files[`${payload.slug}:${path}`]=Buffer.from(payload.data||'','base64').toString('utf8');save(state);return json({ok:true,path,sizeBytes:Buffer.from(payload.data||'','base64').length}); }
  throw new Error(`Action ${action} belum disimulasikan pada local runtime.`);
}

module.exports = { run, runWithInput };
