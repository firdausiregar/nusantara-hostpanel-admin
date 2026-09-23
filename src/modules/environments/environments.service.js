'use strict';const model=require('./environments.model');const vault=require('../../core/security/vault');const {runWithInput,run}=require('../../core/runtime');
function envName(v){const x=String(v||'production');if(!['production','preview','development'].includes(x))throw new Error('Environment tidak valid.');return x;}
function key(v){const x=String(v||'').trim().toUpperCase();if(!/^[A-Z_][A-Z0-9_]{0,63}$/.test(x))throw new Error('Nama environment variable tidak valid.');return x;}
function value(v){const x=String(v??'');if(x.length>4096||/[\0\r\n]/.test(x))throw new Error('Nilai environment terlalu panjang/tidak valid.');return x;}
async function set(app,environment,name,rawValue,isSecret=true){const env=envName(environment),k=key(name),val=value(rawValue);model.upsert(app.id,env,k,vault.encrypt(val),isSecret);if(env==='production')await runWithInput('app-env-set-json',JSON.stringify({slug:app.slug,key:k,value:val}),{timeout:20000});}
async function remove(app,environment,name){const env=envName(environment),k=key(name);model.remove(app.id,env,k);if(env==='production')await runWithInput('app-env-remove-json',JSON.stringify({slug:app.slug,key:k}),{timeout:20000});}
async function unmanagedKeys(app){try{return JSON.parse((await run('app-env-keys',[app.slug])).stdout||'[]');}catch{return[];}}
function materialize(appId,environment){const env=envName(environment);return Object.fromEntries(model.values(appId,env).map((r)=>[r.name,vault.decrypt(r.value_enc)]));}
module.exports={envName,key,set,remove,unmanagedKeys,materialize};
