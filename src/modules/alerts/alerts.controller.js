'use strict';const service=require('./alerts.service');const audit=require('../../lib/audit');
function index(req,res){service.ensureDefaults(req.workspace.id);res.render('alerts/index',{title:'Alerts & Rules',rules:service.rules(req.workspace.id),events:service.events(req.workspace.id),memory:service.samples(req.workspace.id,'memory_percent',48),disk:service.samples(req.workspace.id,'disk_percent',48)});}
function create(req,res){try{service.create(req.workspace.id,req.body);audit(req,'alert.rule.create',req.body.name);req.flash('success','Alert rule dibuat.');}catch(e){req.flash('error',e.message);}res.redirect('/alerts');}
function remove(req,res){service.remove(Number(req.params.id),req.workspace.id);audit(req,'alert.rule.delete',req.params.id);req.flash('success','Alert rule dihapus.');res.redirect('/alerts');}
module.exports={index,create,remove};
