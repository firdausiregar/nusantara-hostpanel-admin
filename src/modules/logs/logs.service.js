'use strict';const {run}=require('../../core/runtime');
function source(v){const x=String(v||'hostpanel');if(!/^(hostpanel|nginx|bind9|mariadb|php-fpm|app:[a-z0-9][a-z0-9-]{1,39})$/.test(x))throw new Error('Sumber log tidak valid.');return x;}
async function tail(src,lines=200){const n=Math.max(20,Math.min(Number(lines)||200,500));return(await run('logs-tail',[source(src),n],{timeout:20000,maxBuffer:1024*1024})).stdout||'';}
module.exports={source,tail};
