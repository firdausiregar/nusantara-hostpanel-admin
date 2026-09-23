'use strict';
const model = require('./dashboard.model');
const service = require('./dashboard.service');
const config = require('../../core/config');
async function index(req,res) {
  const global=req.session.user.role==='admin';
  const runtime = global ? await service.runtimeSummary() : {services:[],servicesError:'',metrics:null};
  const workspaceId=req.workspace?.id||0;
  res.render('dashboard',{ title:'Overview', counts:model.summary(workspaceId,global), recentLogs:model.recentLogs(workspaceId,global), recentDeployments:model.recentDeployments(workspaceId,global), dashboardScope:global?'platform':'workspace', ...runtime, configSummary:{ platform:config.platform, tlsMode:config.tlsMode, dnsPublic:config.dnsPublic, runtimeMode:config.runtimeMode } });
}
module.exports = { index };
