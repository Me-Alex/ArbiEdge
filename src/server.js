'use strict';

const serverModule = require('./server/server');

if (require.main === module) {
  serverModule.startServer();
}

module.exports = serverModule;
