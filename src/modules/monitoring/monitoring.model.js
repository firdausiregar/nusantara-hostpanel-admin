'use strict';
function normalizeMetrics(value={}){
  return {
    hostname:String(value.hostname||'unknown'),
    uptimeSeconds:Number(value.uptimeSeconds||0),
    loadavg:Array.isArray(value.loadavg)?value.loadavg.map(Number).slice(0,3):[0,0,0],
    cpuCount:Number(value.cpuCount||0),
    memory:{total:Number(value.memory?.total||0),used:Number(value.memory?.used||0),free:Number(value.memory?.free||0)},
    disk:{total:Number(value.disk?.total||0),used:Number(value.disk?.used||0),free:Number(value.disk?.free||0),percent:Number(value.disk?.percent||0)},
    networkMode:String(value.networkMode||'unknown'),
    runtimeMode:String(value.runtimeMode||'unknown')
  };
}
function normalizeServices(value){return (Array.isArray(value)?value:[]).map((x)=>({name:String(x?.name||''),active:x?.active===true?true:x?.active===false?false:null,enabled:x?.enabled===true?true:x?.enabled===false?false:null}));}
module.exports={normalizeMetrics,normalizeServices};
