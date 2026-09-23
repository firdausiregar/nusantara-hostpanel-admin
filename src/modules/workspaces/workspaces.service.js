'use strict';
const model=require('./workspaces.model');
function slugify(v){const s=String(v||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40);if(!/^[a-z0-9][a-z0-9-]{1,39}$/.test(s))throw new Error('Slug workspace tidak valid.');return s;}
function create(user,body){const name=String(body.name||'').trim().slice(0,80);if(!name)throw new Error('Nama workspace wajib diisi.');return model.create(name,slugify(body.slug||name),user.id);}
function nonNegativeInt(v,label,max=1000000){const n=Number(v||0);if(!Number.isInteger(n)||n<0||n>max)throw new Error(`${label} tidak valid.`);return n;}
function updatePolicy(id,body){const plan=String(body.plan||'self-hosted').trim().toLowerCase();if(!/^[a-z0-9][a-z0-9_-]{1,31}$/.test(plan))throw new Error('Nama plan tidak valid.');const status=String(body.status||'active');if(!['active','suspended'].includes(status))throw new Error('Status workspace tidak valid.');return model.updatePolicy(Number(id),{plan,status,maxApps:nonNegativeInt(body.max_apps,'Quota apps',100000),maxDomains:nonNegativeInt(body.max_domains,'Quota domains',100000),maxDatabases:nonNegativeInt(body.max_databases,'Quota databases',100000),maxStorageMb:nonNegativeInt(body.max_storage_mb,'Quota storage',100000000)});}
module.exports={listForUser:model.listForUser,getForUser:model.getForUser,create,updatePolicy};
