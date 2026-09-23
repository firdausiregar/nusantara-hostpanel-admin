'use strict';const {runWithInput,run}=require('../../core/runtime');
function name(v){const x=String(v||'').trim().toLowerCase();if(!/^[a-z0-9][a-z0-9-]{0,31}$/.test(x))throw new Error('Nama job tidak valid.');return x;}
function command(v){const x=String(v||'').trim();if(!x||x.length>500||/[;&|`$<>\\\n\r]/.test(x))throw new Error('Command job tidak aman.');return x;}
function schedule(v){const x=String(v||'daily').trim();if(['hourly','daily','weekly'].includes(x))return x;if(!/^\*-\*-\*\s+(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(x))throw new Error('Schedule gunakan hourly/daily/weekly atau format "*-*-* HH:MM:SS".');return x;}
function payload(b){return{name:name(b.name),command:command(b.command),schedule:schedule(b.schedule)}}
async function sync(app,p){return runWithInput('cron-upsert-json',JSON.stringify({slug:app.slug,workingDir:app.working_dir,nodeRuntime:app.node_runtime||'system',...p}),{timeout:30000});}async function remove(app,p){return run('cron-remove',[app.slug,p.name]);}async function status(app){try{return JSON.parse((await run('cron-status',[app.slug])).stdout||'[]');}catch{return[];}}
module.exports={payload,sync,remove,status};
