'use strict';
const service=require('./services.service');const audit=require('../../lib/audit');
async function index(req,res){let services=[];let servicesError='';try{services=await service.list();}catch(error){servicesError=error.message||'Gagal membaca status layanan.';}res.render('services/index',{title:'Layanan Server',services,servicesError,phpMyAdminUrl:service.phpMyAdminUrl()});}
async function action(req,res){const name=String(req.params.name||'');const verb=String(req.params.action||'');try{await service.action(name,verb);audit(req,'service.action',name,verb);req.flash('success',`${name}: ${verb} berhasil.`);}catch(error){req.flash('error',error.message||'Aksi service gagal.');}res.redirect('/services');}
module.exports={index,action};
