'use strict';

const audit = require('./audit');
const autonomy = require('./autonomy');
const core = require('./core');
const engine = require('./engine');
const finance = require('./finance');
const server = require('./server/index');
const services = require('./services');
const results = require('./results');
const storage = require('./storage');

if (require.main === module) {
  server.startServer();
}

module.exports = {
  ...audit,
  ...autonomy,
  ...core,
  ...engine,
  ...finance,
  ...server,
  ...services,
  ...results,
  ...storage,
  audit,
  autonomy,
  core,
  engine,
  finance,
  server,
  services,
  results,
  storage,
};
