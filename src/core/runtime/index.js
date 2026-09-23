'use strict';
const config = require('../config');
module.exports = config.runtimeMode === 'local' ? require('./local-provider') : require('./system-provider');
