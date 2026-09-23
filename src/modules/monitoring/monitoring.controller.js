'use strict';
const service=require('./monitoring.service');
async function index(req,res){let metrics=null;let services=[];let error='';try{({metrics,services}=await service.snapshot());}catch(e){error=e.message||'Gagal membaca metrik server.';}res.render('monitoring/index',{title:'Monitoring',metrics,services,error});}
module.exports={index};
