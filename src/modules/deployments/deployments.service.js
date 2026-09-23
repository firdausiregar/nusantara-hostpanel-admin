'use strict';const model=require('./deployments.model');
function list(workspaceId,limit=100){return model.list(workspaceId,Math.max(1,Math.min(Number(limit)||100,200)));}
function listForApp(appId,workspaceId,limit=20){return model.listForApp(Number(appId),workspaceId,Math.max(1,Math.min(Number(limit)||20,100)));}
module.exports={list,listForApp};
