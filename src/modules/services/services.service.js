'use strict';
const {run}=require('../../core/runtime');const config=require('../../core/config');const model=require('./services.model');
async function list(){return model.normalize(JSON.parse((await run('status-all')).stdout||'[]'));}
async function action(name,verb){return run('service-action',[verb,name]);}
function phpMyAdminUrl(){return config.phpMyAdminUrl||'';}
module.exports={list,action,phpMyAdminUrl};
