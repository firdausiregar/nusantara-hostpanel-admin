'use strict';
const {run}=require('../../core/runtime');
const model=require('./backups.model');
async function list(){try{return model.normalizeList(JSON.parse((await run('backup-list',[],{timeout:30000})).stdout||'[]'));}catch{return[];}}
async function create(){return model.normalize(JSON.parse((await run('backup-create',[],{timeout:300000})).stdout||'{}'));}
async function verify(name){return JSON.parse((await run('backup-verify',[name],{timeout:120000})).stdout||'{}');}
async function restore(name){return JSON.parse((await run('backup-restore-schedule',[name],{timeout:360000})).stdout||'{}');}
async function offsite(name,remote){return JSON.parse((await run('backup-offsite',[name,remote],{timeout:1800000})).stdout||'{}');}
module.exports={list,create,verify,restore,offsite};
