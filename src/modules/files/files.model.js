'use strict';const apps=require('../apps/apps.model');function app(id,workspaceId){return apps.find(id,workspaceId);}module.exports={app};
