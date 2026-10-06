'use strict';
function normalize(item={}){return{name:String(item.name||''),createdAt:String(item.createdAt||''),sizeBytes:Number(item.sizeBytes||0),verified:Boolean(item.verified),simulated:Boolean(item.simulated)};}
function normalizeList(items){return(Array.isArray(items)?items:[]).map(normalize);}
module.exports={normalize,normalizeList};
