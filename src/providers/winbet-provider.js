const { EgtProvider } = require('./egt-provider');

const WINBET_API_BASE_URL = 'https://winbet-ro-api.egt-digital.com';
const WINBET_ORIGIN = 'https://winbet.ro';

class WinbetProvider extends EgtProvider {
  constructor(options = {}) {
    super({
      name: 'Winbet',
      apiBaseUrl: WINBET_API_BASE_URL,
      origin: WINBET_ORIGIN,
      ...options,
    });
  }
}

module.exports = {
  WINBET_API_BASE_URL,
  WINBET_ORIGIN,
  WinbetProvider,
};
