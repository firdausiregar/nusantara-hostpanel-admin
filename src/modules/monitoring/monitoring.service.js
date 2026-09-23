'use strict';
const {run}=require('../../core/runtime');
const model=require('./monitoring.model');
async function snapshot(){
  const [metricsResult,servicesResult]=await Promise.all([run('metrics-summary'),run('status-all')]);
  const metrics=model.normalizeMetrics(JSON.parse(metricsResult.stdout||'{}'));
  const services=model.normalizeServices(JSON.parse(servicesResult.stdout||'[]'));
  return {metrics,services};
}
module.exports={snapshot};
