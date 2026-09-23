'use strict';const service=require('./docs.service');function index(req,res){res.render('docs/index',{title:'Documentation',links:service.links()});}module.exports={index};
