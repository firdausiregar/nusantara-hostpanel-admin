'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const source = fs.readFileSync(require('node:path').join(__dirname,'../scripts/hostpanelctl.js'),'utf8');
const functionSource = source.slice(source.indexOf('function appUpsertPayload('),source.indexOf('function appUpsertFromStdin('));
for (const startMode of ['node','npm','command']) {
  let unit = '';
  const context = {
    fs: {existsSync:()=>true,statSync:()=>({isDirectory:()=>true,isFile:()=>true}),realpathSync:x=>x},
    path: require('node:path'), APP_ENV_DIR:'/etc/hostpanel/apps',
    safeSlug:x=>x,safePath:x=>x,safePort:Number,safeEntry:x=>x,
    ensureAppUser:()=> 'app-test',runtimeWorkingDirectory:x=>x,
    resolveNodeRuntime:(_,name)=>'/usr/bin/'+name,
    mkdir:()=>{},cmd:()=>{},systemdQuote:x=>JSON.stringify(x),
    writeAtomic:(file,content)=>{if(file.endsWith('.service'))unit=content;},
    console:{log:()=>{}},fail:message=>{throw Error(message);}
  };
  vm.runInNewContext(functionSource,context);
  context.appUpsertPayload({slug:'test',workingDir:'/apps/test',port:4101,startMode,startCommand:'node server.js',environmentAction:'preserve'});
  const start = unit.split('\n').find(x=>x.startsWith('ExecStart='));
  assert.ok(start.startsWith('ExecStart="/usr/bin/env" "PORT=4101" "HOST=127.0.0.1" '),start);
}
assert.ok(source.includes("const exec=['/usr/bin/env',\x60PORT=\x24{port}\x60,'HOST=127.0.0.1',...previewExecTokens(p,target)]"));
const output = execFileSync('/usr/bin/env',['PORT=4101','HOST=127.0.0.1',process.execPath,'-e','process.stdout.write(JSON.stringify({port:process.env.PORT,host:process.env.HOST,custom:process.env.CUSTOM}))'],{env:{...process.env,PORT:'3000',HOST:'wrong-host',CUSTOM:'preserved'},encoding:'utf8'});
assert.deepEqual(JSON.parse(output),{port:'4101',host:'127.0.0.1',custom:'preserved'});
console.log('Runtime port regressions passed (node/npm/command/preview; inherited environment).');
