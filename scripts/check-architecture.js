'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const js=[];
function walk(dir){
  for(const e of fs.readdirSync(dir,{withFileTypes:true})){
    const p=path.join(dir,e.name);
    if(e.isDirectory()&&!['node_modules','data'].includes(e.name))walk(p);
    else if(e.isFile()&&p.endsWith('.js'))js.push(p);
  }
}
walk(path.join(root,'src'));
walk(path.join(root,'scripts'));
for(const file of js)execFileSync(process.execPath,['--check',file],{stdio:'inherit'});

function localRequireExists(file,spec){
  if(!spec.startsWith('.'))return true;
  const base=path.resolve(path.dirname(file),spec);
  return [base,`${base}.js`,path.join(base,'index.js'),`${base}.json`].some(fs.existsSync);
}
for(const file of js){
  const text=fs.readFileSync(file,'utf8');
  for(const match of text.matchAll(/require\((['"])(\.{1,2}\/[^'"]+)\1\)/g)){
    if(!localRequireExists(file,match[2]))throw new Error(`Broken local require in ${path.relative(root,file)}: ${match[2]}`);
  }
}

for(const name of ['alerts','api','apps','auth','backups','billing','cron','dashboard','database','deployments','dns','docs','domains','environments','files','integrations','logs','monitoring','notifications','previews','security','services','settings','ssl','team','updates','webhooks','workers','workspaces']){
  const dir=path.join(root,'src','modules',name);
  if(!fs.existsSync(dir))throw new Error(`MVC module missing: ${name}`);
  for(const layer of ['model','service','controller','routes']){
    const expected=path.join(dir,`${name}.${layer}.js`);
    if(!fs.existsSync(expected))throw new Error(`MVC layer missing: ${name}/${name}.${layer}.js`);
  }
  const controller=fs.readFileSync(path.join(dir,`${name}.controller.js`),'utf8');
  const routes=fs.readFileSync(path.join(dir,`${name}.routes.js`),'utf8');
  for(const [layer,text] of [['controller',controller],['routes',routes]]){
    if(/core\/runtime|child_process|hostpanelctl|\bsudo\b/.test(text))throw new Error(`Privilege-boundary violation: ${name}.${layer} calls runtime/system primitive directly.`);
  }
}

const viewsRoot=path.join(root,'src','views');
const ejs=[];
(function walkViews(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walkViews(p);else if(e.isFile()&&e.name.endsWith('.ejs'))ejs.push(p);}})(viewsRoot);
for(const file of ejs){
  const text=fs.readFileSync(file,'utf8');
  const opens=(text.match(/<%/g)||[]).length;
  const closes=(text.match(/%>/g)||[]).length;
  if(opens!==closes)throw new Error(`Unbalanced EJS delimiters in ${path.relative(root,file)}: ${opens}/${closes}`);
  for(const match of text.matchAll(/include\((['"])([^'"]+)\1\)/g)){
    const base=path.resolve(path.dirname(file),match[2]);
    if(![base,`${base}.ejs`].some(fs.existsSync))throw new Error(`Broken EJS include in ${path.relative(root,file)}: ${match[2]}`);
  }
}
console.log(`Architecture check OK (${js.length} JS files, ${ejs.length} EJS views).`);
