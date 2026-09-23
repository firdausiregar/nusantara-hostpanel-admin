'use strict';const crypto=require('node:crypto');const model=require('./webhooks.model');const vault=require('../../core/security/vault');const apps=require('../apps/apps.model');const previews=require('../previews/previews.model');const jobs=require('../../core/jobs');
function secureEqual(a,b){const aa=Buffer.from(String(a||'')),bb=Buffer.from(String(b||''));return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb);}
function create(appId){const publicId=crypto.randomBytes(12).toString('base64url');const secret=crypto.randomBytes(32).toString('base64url');model.upsert(appId,publicId,vault.encrypt(secret));return{publicId,secret};}
function verify(publicId,raw,signature,event){const hook=model.getByPublicId(publicId);if(!hook)throw new Error('Webhook tidak ditemukan.');if(!['push','ping','pull_request'].includes(event))throw new Error('Event GitHub tidak didukung.');const secret=vault.decrypt(hook.secret_enc);const expected=`sha256=${crypto.createHmac('sha256',secret).update(raw).digest('hex')}`;if(!secureEqual(expected,signature))throw new Error('Signature webhook tidak valid.');return hook;}
function enqueue(hook,payload,event='push'){
  const app=apps.find(hook.app_id,hook.workspace_id);if(!app)return{queued:false,reason:'app_missing'};
  if(event==='pull_request'){
    if(!app.preview_enabled)return{queued:false,reason:'preview_disabled'};
    const action=String(payload?.action||''),branch=String(payload?.pull_request?.head?.ref||'');if(!branch)return{queued:false,reason:'branch_missing'};
    if(['opened','reopened','synchronize'].includes(action)){const sha=String(payload?.pull_request?.head?.sha||'').slice(0,40),jobId=jobs.enqueue(hook.workspace_id,'preview_create',{appId:app.id,branch,userId:null,ttlDays:7,sha,trigger:'github-pr'},4,{idempotencyKey:`preview:${app.id}:${branch}:${sha||action}`,priority:80,timeoutSec:1200});return{queued:true,jobId,preview:true};}
    if(action==='closed'){const item=previews.byAppBranch(app.id,branch);if(!item)return{queued:false,reason:'preview_missing'};const jobId=jobs.enqueue(hook.workspace_id,'preview_remove',{previewId:item.id,trigger:'github-pr-close'},3,{idempotencyKey:`preview-remove:${item.id}`,priority:70,timeoutSec:300});return{queued:true,jobId,preview:true};}
    return{queued:false,reason:'pr_action_ignored'};
  }
  if(!hook.auto_deploy)return{queued:false,reason:'auto_deploy_disabled'};const branch=String(payload?.ref||'').replace(/^refs\/heads\//,'');if(branch!==hook.git_branch)return{queued:false,reason:'branch_mismatch'};const after=String(payload?.after||'').slice(0,40);const jobId=jobs.enqueue(hook.workspace_id,'deploy',{appId:app.id,trigger:'github-webhook',after},4,{idempotencyKey:`deploy:${app.id}:${after||branch}`,priority:50,timeoutSec:1200});return{queued:true,jobId};
}
module.exports={create,verify,enqueue,getByApp:model.getByApp,disable:model.disable};
