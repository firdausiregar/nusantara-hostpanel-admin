'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawn,execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const envFile=path.join(root,'.env.local');
if(!fs.existsSync(envFile)) execFileSync(process.execPath,[path.join(__dirname,'setup.js')],{cwd:root,stdio:'inherit'});
const bin=(name)=>process.platform==='win32'?`${name}.cmd`:name;
const children=[];
function start(command,args){const child=spawn(bin(command),args,{cwd:root,stdio:'inherit',env:{...process.env,NODE_ENV:'development',HOSTPANEL_RUNTIME_MODE:'local'}});children.push(child);child.on('exit',(code)=>{if(code&&code!==0)console.error(`${command} exited with ${code}`);});return child;}
start('npx',['@tailwindcss/cli','-i','./public/css/input.css','-o','./public/css/app.css','--watch']);
start('npx',['nodemon','src/app.js']);
function shutdown(){for(const child of children){try{child.kill('SIGTERM');}catch{}}process.exit(0);}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
