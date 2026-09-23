'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const express=require('express');
const helmet=require('helmet');
const session=require('express-session');
const BetterSqliteSessionStore=require('./core/session/sqlite-store');
const config=require('./core/config');
const db=require('./core/database');
const flash=require('./middleware/flash');
const csrf=require('./middleware/csrf');
const workspace=require('./core/security/workspace');
const notifications=require('./modules/notifications/notifications.service');
const permissionPolicy=require('./core/security/permissions');
const navigation=require('./core/security/navigation');
const i18n=require('./core/i18n');
const uiIcons=require('./core/ui-icons');

if(config.env==='production'){
  if(config.sessionSecret.length<32)throw new Error('SESSION_SECRET production wajib minimal 32 karakter.');
  if(!process.env.HOSTPANEL_MASTER_KEY)throw new Error('HOSTPANEL_MASTER_KEY wajib dikonfigurasi terpisah pada production.');
}
fs.mkdirSync(config.dataDir,{recursive:true,mode:0o750});
const publicDir=path.join(__dirname,'..','public');
const cssAsset=path.join(publicDir,'css','app.css');
if(!fs.existsSync(cssAsset)||fs.statSync(cssAsset).size<4096)throw new Error(`Asset CSS production hilang atau tidak valid: ${cssAsset}.`);

const app=express();
app.disable('x-powered-by');
if(config.trustProxy)app.set('trust proxy',config.trustProxy);
app.set('view engine','ejs');
app.set('views',path.join(__dirname,'views'));
app.use((req,res,next)=>{req.id=crypto.randomUUID();res.setHeader('X-Request-Id',req.id);next();});
app.use(helmet({hsts:false,referrerPolicy:{policy:'no-referrer'},contentSecurityPolicy:{directives:{defaultSrc:["'self'"],imgSrc:["'self'",'data:'],styleSrc:["'self'"],scriptSrc:["'self'"],fontSrc:["'self'"],connectSrc:["'self'"],formAction:["'self'"],frameAncestors:["'none'"],baseUri:["'self'"],objectSrc:["'none'"]}}}));
const hsts=helmet.hsts({maxAge:31536000,includeSubDomains:false});
app.use((req,res,next)=>req.secure?hsts(req,res,next):next());

// Signed GitHub webhooks need the original bytes and intentionally bypass session/CSRF.
app.use('/hooks',require('./modules/webhooks/webhooks.public.routes'));
app.use('/hooks/midtrans',require('./modules/billing/billing.public.routes'));

app.use(express.urlencoded({extended:false,limit:'128kb'}));
app.use(express.json({limit:'256kb'}));
app.use(express.static(publicDir,{maxAge:config.env==='production'?'1d':0,etag:true}));
app.use(session({name:'hostpanel.sid',secret:config.sessionSecret,resave:false,saveUninitialized:false,rolling:true,store:new BetterSqliteSessionStore(),cookie:{httpOnly:true,sameSite:'strict',secure:'auto',maxAge:8*60*60*1000}}));
app.use(flash);
app.use(workspace.attach);

// Public machine-readable API contract; operational API itself remains token authenticated.
app.get('/api/openapi.yaml',(req,res)=>res.type('application/yaml').sendFile(path.join(__dirname,'..','docs','openapi.yaml')));

// Token-authenticated API is not protected by browser CSRF. Token scope is enforced inside the API module.
app.use('/api',require('./modules/api/api.routes'));

app.use(csrf.expose);
app.use(csrf.verify);
app.use((req,res,next)=>{
  res.locals.currentPath=req.path;
  res.locals.user=req.session.user||null;
  res.locals.locale=i18n.detect(req);
  res.locals.t=i18n.translator(res.locals.locale);
  res.locals.supportedLocales=i18n.supported;
  res.locals.panelName=config.panelName;
  res.locals.platform=config.platform;
  res.locals.tlsMode=config.tlsMode;
  res.locals.dnsPublic=config.dnsPublic;
  res.locals.runtimeMode=config.runtimeMode;
  res.locals.localDevelopment=config.localDevelopment;
  res.locals.release=config.release;
  res.locals.repoUrl=config.repoUrl;
  res.locals.securitySessionId=req.session.securitySessionId||'';
  res.locals.unreadNotifications=req.workspace?notifications.unreadCount(req.workspace.id):0;
  const permissions=permissionPolicy.resolve(req.session.user||null,req.workspace||null);
  res.locals.permissions=permissions;
  res.locals.isPlatformAdmin=permissions.isPlatformAdmin;
  res.locals.iconSvg=uiIcons.icon;
  res.locals.navGroups=navigation.build({permissions,dnsPublic:config.dnsPublic,unreadNotifications:res.locals.unreadNotifications,t:res.locals.t});
  res.locals.mobileNav=navigation.mobile(permissions);
  res.locals.formatBytes=(value)=>{const n=Number(value||0);if(!Number.isFinite(n)||n<=0)return'0 B';const u=['B','KB','MB','GB','TB'];const i=Math.min(u.length-1,Math.floor(Math.log(n)/Math.log(1024)));return`${(n/(1024**i)).toFixed(i?1:0)} ${u[i]}`;};
  res.locals.formatUptime=(seconds)=>{let s=Math.max(0,Number(seconds||0));const d=Math.floor(s/86400);s%=86400;const h=Math.floor(s/3600);const m=Math.floor((s%3600)/60);return[d?`${d}d`:'',h?`${h}h`:'',`${m}m`].filter(Boolean).join(' ');};
  next();
});

app.get('/healthz',(req,res)=>res.json({ok:true,version:config.release,runtimeMode:config.runtimeMode,networkMode:config.networkMode,tlsMode:config.tlsMode,assets:{css:true},database:{ok:Boolean(db)}}));

app.use('/',require('./modules/auth/auth.routes'));
app.use('/locale',require('./modules/localization/localization.routes'));
app.use('/',require('./modules/team/team.routes'));
app.use('/',require('./modules/webhooks/webhooks.routes'));
app.use('/',require('./modules/dashboard/dashboard.routes'));
app.use('/workspaces',require('./modules/workspaces/workspaces.routes'));
app.use('/apps',require('./modules/apps/apps.routes'));
app.use('/integrations',require('./modules/integrations/integrations.routes'));
app.use('/previews',require('./modules/previews/previews.routes'));
app.use('/deployments',require('./modules/deployments/deployments.routes'));
app.use('/environments',require('./modules/environments/environments.routes'));
app.use('/workers',require('./modules/workers/workers.routes'));
app.use('/cron',require('./modules/cron/cron.routes'));
app.use('/files',require('./modules/files/files.routes'));
app.use('/domains',require('./modules/domains/domains.routes'));
app.use('/dns',require('./modules/dns/dns.routes'));
app.use('/ssl',require('./modules/ssl/ssl.routes'));
app.use('/services',require('./modules/services/services.routes'));
app.use('/monitoring',require('./modules/monitoring/monitoring.routes'));
app.use('/alerts',require('./modules/alerts/alerts.routes'));
app.use('/logs',require('./modules/logs/logs.routes'));
app.use('/notifications',require('./modules/notifications/notifications.routes'));
app.use('/backups',require('./modules/backups/backups.routes'));
app.use('/database',require('./modules/database/database.routes'));
app.use('/security',require('./modules/security/security.routes'));
app.use('/billing',require('./modules/billing/billing.routes'));
app.use('/docs',require('./modules/docs/docs.routes'));
app.use('/updates',require('./modules/updates/updates.routes'));
app.use('/settings',require('./modules/settings/settings.routes'));

app.use((req,res)=>res.status(404).render('error',{title:'404',error:'Halaman tidak ditemukan.'}));
app.use((err,req,res,next)=>{console.error(`[${req.id||'-'}]`,err);if(res.headersSent)return next(err);res.status(err.status||500).render('error',{title:'Terjadi kesalahan',error:config.env==='production'?'Terjadi kesalahan internal.':err.message});});

const server=app.listen(config.port,config.bindHost,()=>{
  console.log(`${config.panelName} v${config.release} listening on http://${config.bindHost}:${config.port} (${config.runtimeMode})`);
  if(config.env==='production'||String(process.env.BACKGROUND_TASKS||'')==='1')require('./core/background').start();
});
server.requestTimeout=30_000;
server.headersTimeout=35_000;
server.keepAliveTimeout=5_000;
module.exports=app;
