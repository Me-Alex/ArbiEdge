'use strict';

const { XSportProvider } = require('./xsport-provider');

const SPIN_API_BASE_URL = 'https://exalogic.spin.ro';

class SpinProvider extends XSportProvider {
  constructor(options = {}) {
    super({
      name: 'Spin',
      apiBaseUrl: SPIN_API_BASE_URL,
      eventOrigin: 'https://spin.ro',
      systemCode: 'SPIN.RO',
      ...options,
    });
  }
}

module.exports = {
  SPIN_API_BASE_URL,
  SpinProvider,
};
