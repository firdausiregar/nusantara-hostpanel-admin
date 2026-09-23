'use strict';
const assert=require('node:assert/strict');
const permissions=require('../src/core/security/permissions');
const navigation=require('../src/core/security/navigation');

function links(p){return navigation.build({permissions:p,dnsPublic:true,unreadNotifications:2}).flatMap(([,items])=>items.map(([href])=>href));}
const ws=(role,status='active')=>({membership_role:role,status});
const operator={id:2,role:'operator'};
const admin={id:1,role:'admin'};

const viewer=permissions.resolve(operator,ws('viewer'));
assert.equal(viewer.canDevelop,false);assert.equal(viewer.canWorkspaceAdmin,false);assert.equal(viewer.canPlatformOperate,false);
for(const hidden of ['/team','/billing','/previews','/integrations','/logs','/ssl','/monitoring','/backups','/services','/database','/settings','/updates'])assert(!links(viewer).includes(hidden),`viewer must not see ${hidden}`);
for(const visible of ['/','/workspaces','/apps','/deployments','/domains','/dns','/security','/docs'])assert(links(viewer).includes(visible),`viewer should see ${visible}`);

const developer=permissions.resolve(operator,ws('developer'));
assert.equal(developer.canDevelop,true);assert.equal(developer.canWorkspaceAdmin,false);assert(links(developer).includes('/previews'));assert(links(developer).includes('/logs'));assert(!links(developer).includes('/database'));assert(!links(developer).includes('/services'));

const workspaceAdmin=permissions.resolve(operator,ws('admin'));
assert.equal(workspaceAdmin.canWorkspaceAdmin,true);assert(links(workspaceAdmin).includes('/team'));assert(links(workspaceAdmin).includes('/billing'));assert(links(workspaceAdmin).includes('/database'));assert(!links(workspaceAdmin).includes('/ssl'));assert(!links(workspaceAdmin).includes('/monitoring'));assert(!links(workspaceAdmin).includes('/settings'));

const platformAdmin=permissions.resolve(admin,ws('viewer'));
assert.equal(platformAdmin.isPlatformAdmin,true);for(const visible of ['/team','/billing','/ssl','/monitoring','/backups','/services','/database','/settings','/updates'])assert(links(platformAdmin).includes(visible),`platform admin should see ${visible}`);

const suspended=permissions.resolve(operator,ws('admin','suspended'));
assert.equal(suspended.suspended,true);assert.equal(suspended.canMutate,false);assert.equal(suspended.canAdminMutate,false);
const fs=require('node:fs');
function source(file){return fs.readFileSync(require('node:path').join(__dirname,'..',file),'utf8');}
assert(source('src/modules/billing/billing.routes.js').includes("r.get('/',requireAdmin,c.index)"));
assert(source('src/modules/database/database.routes.js').includes("r.get('/',requireAdmin,c.index)"));
assert(source('src/modules/integrations/integrations.routes.js').includes("r.get('/',requireDeveloper,c.index)"));
assert(source('src/modules/alerts/alerts.routes.js').includes("r.get('/',requireDeveloper,c.index)"));
assert(source('src/modules/updates/updates.routes.js').includes("r.get('/',requirePlatformAdmin,c.index)"));
assert(source('src/modules/team/team.routes.js').includes("requireAuth,requireWorkspace,requireAdmin"));
assert(source('src/views/partials/topbar.ejs').includes("permissions?.canDevelop"));
assert(!source('src/views/partials/app-end.ejs').includes("['/monitoring','MN','Monitor']"));
assert(source('src/views/dashboard.ejs').includes("permissions?.isPlatformAdmin"));

console.log('rbac-basics: ok');
