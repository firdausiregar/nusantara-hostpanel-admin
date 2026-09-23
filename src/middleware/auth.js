const workspace=require('../core/security/workspace');
const sessions=require('../core/security/session-registry');
function requireAuth(req,res,next){if(!req.session.user)return res.redirect('/login');if(!sessions.touch(req)){req.session.destroy(()=>{});return res.redirect('/login?revoked=1');}next();}
function requireAdmin(req,res,next){if(!req.session.user)return res.redirect('/login');if(req.session.user.role==='admin')return next();if(req.workspace?.status==='suspended')return res.status(423).render('error',{title:'Workspace ditangguhkan',error:'Workspace sedang suspended. Aksi administrator workspace dinonaktifkan.'});if(workspace.can(req,'admin'))return next();return res.status(403).render('error',{title:'Akses ditolak',error:'Fitur ini memerlukan administrator workspace.'});}
function requirePlatformAdmin(req,res,next){if(!req.session.user)return res.redirect('/login');if(req.session.user.role!=='admin')return res.status(403).render('error',{title:'Akses ditolak',error:'Fitur ini hanya untuk administrator platform.'});next();}
const requireDeveloper=workspace.requireWorkspaceRole('developer');
const requireViewer=workspace.requireWorkspaceRole('viewer');
module.exports={requireAuth,requireAdmin,requirePlatformAdmin,requireDeveloper,requireViewer};
