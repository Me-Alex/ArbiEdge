'use strict';

const { BetconstructProvider } = require('./betconstruct-provider');

const MANHATTAN_SOCKET_URL = 'wss://eu-swarm-reverse.betconstruct.com/';
const MANHATTAN_SITE_ID = 18768464;
const MANHATTAN_RELEASE_DATE = '07/07/2026-13:00';

class ManhattanProvider extends BetconstructProvider {
  constructor(options = {}) {
    super({
      name: 'Manhattan',
      socketUrl: MANHATTAN_SOCKET_URL,
      siteId: MANHATTAN_SITE_ID,
      releaseDate: MANHATTAN_RELEASE_DATE,
      language: 'ron',
      pageUrl: 'https://www.manhattan.ro/ro/sports/pre-match',
      configUrl: 'https://www.manhattan.ro/conf.json',
      ...options,
    });
  }
}

module.exports = {
  MANHATTAN_RELEASE_DATE,
  MANHATTAN_SITE_ID,
  MANHATTAN_SOCKET_URL,
  ManhattanProvider,
};
