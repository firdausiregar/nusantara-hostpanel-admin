'use strict';
const { run } = require('../../core/runtime');
async function runtimeSummary() {
  let services=[]; let servicesError=''; let metrics=null;
  try { services=JSON.parse((await run('status-all')).stdout||'[]'); } catch (error) { servicesError=error.message||'Gagal membaca status layanan.'; services=[{name:'nginx',active:null},{name:'bind9',active:null},{name:'php-fpm',active:null},{name:'mariadb',active:null}]; }
  try { metrics=JSON.parse((await run('metrics-summary')).stdout||'{}'); } catch {}
  return { services, servicesError, metrics };
}
module.exports = { runtimeSummary };
