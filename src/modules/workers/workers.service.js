'use strict';const {runWithInput,run}=require('../../core/runtime');const extra=require('../../core/security/validators');
function name(v){const x=String(v||'').trim().toLowerCase();if(!/^[a-z0-9][a-z0-9-]{0,31}$/.test(x))throw new Error('Nama worker hanya huruf kecil, angka, minus.');return x;}
function command(v){const x=String(v||'').trim();if(!x||x.length>500||/[;&|`$<>\\\n\r]/.test(x))throw new Error('Command worker tidak valid / mengandung operator shell.');return x;}
function payload(body){const kind=['worker','queue','scheduler'].includes(String(body.kind))?String(body.kind):'worker';const instances=extra.optionalInteger(body.instances||1,1,8,'Instances')||1;const memoryLimitMb=extra.optionalInteger(body.memory_limit_mb||0,0,65536,'Memory limit');const restartPolicy=['always','on-failure','no'].includes(String(body.restart_policy||'on-failure'))?String(body.restart_policy||'on-failure'):'on-failure';return{name:name(body.name),kind,command:command(body.command),instances,enabled:true,restartPolicy,memoryLimitMb};}
async function sync(app,p){return runWithInput('worker-upsert-json',JSON.stringify({slug:app.slug,workingDir:app.working_dir,nodeRuntime:app.node_runtime||'system',...p}),{timeout:30000});}
async function remove(app,p){return run('worker-remove',[app.slug,p.name]);}
async function status(app){try{return JSON.parse((await run('worker-status',[app.slug])).stdout||'[]');}catch{return[];}}
module.exports={payload,sync,remove,status};
