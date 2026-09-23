'use strict';
const express=require('express');
const {requirePlatformAdmin}=require('../../middleware/auth');
const c=require('./services.controller');
const router=express.Router();
router.use(requirePlatformAdmin);
router.get('/',c.index);
router.post('/:name/:action',c.action);
module.exports=router;
