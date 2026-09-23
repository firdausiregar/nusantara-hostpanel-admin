'use strict';
const express=require('express');
const rateLimit=require('express-rate-limit');
const c=require('./webhooks.controller');
const r=express.Router();
const limiter=rateLimit({windowMs:15*60*1000,limit:180,standardHeaders:'draft-8',legacyHeaders:false,skipSuccessfulRequests:false});
r.post('/github/:publicId',limiter,express.raw({type:'application/json',limit:'1mb'}),c.receive);
module.exports=r;
