'use strict';

const RANK=Object.freeze({viewer:1,developer:2,admin:3,owner:4});

function roleRank(role){return RANK[String(role||'').toLowerCase()]||0;}
function isPlatformAdmin(user){return Boolean(user&&user.role==='admin');}
function resolve(user,workspace){
  const platformAdmin=isPlatformAdmin(user);
  const workspaceRole=workspace?.membership_role||null;
  const rank=platformAdmin?RANK.owner:roleRank(workspaceRole);
  const suspended=Boolean(workspace&&workspace.status==='suspended'&&!platformAdmin);
  return Object.freeze({
    authenticated:Boolean(user),
    isPlatformAdmin:platformAdmin,
    workspaceRole,
    suspended,
    canViewWorkspace:platformAdmin||rank>=RANK.viewer,
    canDevelop:platformAdmin||rank>=RANK.developer,
    canWorkspaceAdmin:platformAdmin||rank>=RANK.admin,
    canOwnWorkspace:platformAdmin||rank>=RANK.owner,
    canMutate:!suspended&&(platformAdmin||rank>=RANK.developer),
    canAdminMutate:!suspended&&(platformAdmin||rank>=RANK.admin),
    canPlatformOperate:platformAdmin,
  });
}

module.exports={RANK,roleRank,isPlatformAdmin,resolve};
