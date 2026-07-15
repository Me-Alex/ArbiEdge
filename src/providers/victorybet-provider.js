'use strict';

const { BetconstructProvider } = require('./betconstruct-provider');

const VICTORYBET_SOCKET_URL = 'wss://eu-swarm-reverse.victorybet.ro/';
const VICTORYBET_SITE_ID = 18754351;
const VICTORYBET_RELEASE_DATE = '2026-07-09 13:14:20';

class VictoryBetProvider extends BetconstructProvider {
  constructor(options = {}) {
    super({
      name: 'VictoryBet',
      socketUrl: VICTORYBET_SOCKET_URL,
      siteId: VICTORYBET_SITE_ID,
      releaseDate: VICTORYBET_RELEASE_DATE,
      language: 'rov',
      pageUrl: 'https://www.victorybet.ro/rv/pre-match',
      configUrl: 'https://www.victorybet.ro/desktop/conf.json?v=1207',
      ...options,
    });
  }
}

module.exports = {
  VICTORYBET_RELEASE_DATE,
  VICTORYBET_SITE_ID,
  VICTORYBET_SOCKET_URL,
  VictoryBetProvider,
};
