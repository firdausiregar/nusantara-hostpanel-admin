'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const dataDir=path.join(root,'data');
const envFile=path.join(root,'.env.local');
fs.mkdirSync(dataDir,{recursive:true});
if(!fs.existsSync(envFile)){
  const secret=crypto.randomBytes(48).toString('hex');
  const master=crypto.randomBytes(32).toString('base64');
  fs.writeFileSync(envFile,`NODE_ENV=development\nPORT=3030\nBIND_HOST=127.0.0.1\nSESSION_SECRET=${secret}\nHOSTPANEL_MASTER_KEY=${master}\nDATA_DIR=${dataDir.replace(/\\/g,'/')}\nPANEL_NAME=Nusantara HostPanel Dev\nNETWORK_MODE=direct\nTLS_MODE=off\nDNS_PUBLIC=0\nHOSTPANEL_RUNTIME_MODE=local\n`,{mode:0o600});
  console.log('Created .env.local with a random development session secret.');
}
console.log('Local development state prepared. Open http://127.0.0.1:3030/setup after npm run dev.');
