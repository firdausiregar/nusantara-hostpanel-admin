'use strict';
const model=require('./dns.model');
const {run,runWithInput}=require('../../core/runtime');
const config=require('../../core/config');
const domainsModel=require('../domains/domains.model');

async function sync(zoneId,workspaceId){const zone=model.zone(zoneId,workspaceId);if(!zone)throw new Error('Zone tidak ditemukan.');const payload={domain:zone.domain,dnssec:Boolean(zone.dnssec_enabled),records:model.recordsForSync(zoneId)};const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url');await run('zone-sync',[zone.domain,encoded]);}
async function remove(domain){return run('zone-remove',[domain]);}
function directWildcardCovers(host,base){if(host===base)return true;if(!host.endsWith(`.${base}`))return false;const left=host.slice(0,-(base.length+1));return Boolean(left)&&!left.includes('.');}
async function issueWildcard(zone,workspaceId,input){
  if(config.tlsMode!=='local'&&config.runtimeMode!=='local')throw new Error('Wildcard SSL lokal membutuhkan TLS_MODE=local.');
  if(!config.certbotEmail&&config.runtimeMode!=='local')throw new Error('CERTBOT_EMAIL belum dikonfigurasi.');
  const provider=String(input.provider||'').trim();
  if(provider==='local-bind'&&!config.dnsPublic&&config.runtimeMode!=='local')throw new Error('BIND9 lokal belum ditandai public. DNS-01 wildcard membutuhkan authoritative DNS yang dapat diakses Internet pada UDP/TCP 53.');
  const payload={domain:zone.domain,email:config.certbotEmail||'dev@example.test',provider,apiToken:input.api_token||'',server:input.server||'',port:Number(input.port||53),keyName:input.key_name||'',secret:input.secret||'',algorithm:input.algorithm||'HMAC-SHA256',propagationSeconds:Number(input.propagation_seconds||30)};
  const out=JSON.parse((await runWithInput('certbot-wildcard-json',JSON.stringify(payload),{timeout:360000})).stdout||'{}');
  // Re-render all exact/direct-child vhosts in this workspace so they immediately reuse the wildcard certificate.
  for(const d of domainsModel.list(workspaceId)){
    if(!directWildcardCovers(d.hostname,zone.domain)||!d.target_port)continue;
    try{await run('certbot-activate-existing',[d.hostname,d.target_port],{timeout:30000});domainsModel.markAttempt(d.id,workspaceId,{sslEnabled:1});}catch{}
  }
  return out;
}
module.exports={sync,remove,issueWildcard};
