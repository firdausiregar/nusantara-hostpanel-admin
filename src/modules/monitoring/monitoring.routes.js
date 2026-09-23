'use strict';
const express=require('express');
const {requirePlatformAdmin}=require('../../middleware/auth');
const c=require('./monitoring.controller');
const r=express.Router();
r.use(requirePlatformAdmin);
r.get('/',c.index);
module.exports=r;
