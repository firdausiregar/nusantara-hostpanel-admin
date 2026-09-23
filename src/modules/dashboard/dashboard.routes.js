'use strict';
const express=require('express'); const {requireAuth}=require('../../middleware/auth'); const c=require('./dashboard.controller');
const router=express.Router(); router.use(requireAuth); router.get('/',c.index); module.exports=router;
