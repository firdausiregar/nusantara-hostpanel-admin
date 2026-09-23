'use strict';
const fs=require('node:fs');const path=require('node:path');
const supported=Object.freeze(['id','en']);const catalogs={};
for(const locale of supported){try{catalogs[locale]=JSON.parse(fs.readFileSync(path.join(__dirname,'..','..','locales',`${locale}.json`),'utf8'));}catch{catalogs[locale]={};}}
function normalize(value){const v=String(value||'').trim().toLowerCase().split(/[-_]/)[0];return supported.includes(v)?v:'id';}
function translator(locale){const lang=normalize(locale);return(key,fallback='')=>(catalogs[lang]?.[key]??catalogs.id?.[key]??fallback??key);}
function detect(req){return normalize(req.session?.user?.locale||req.headers['accept-language']||'id');}
module.exports={supported,normalize,translator,detect};
