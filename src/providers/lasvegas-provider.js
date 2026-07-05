const { XSportProvider } = require('./xsport-provider');

const LASVEGAS_API_BASE_URL = 'https://exalogic.lasvegas.ro';

class LasVegasProvider extends XSportProvider {
  constructor(options = {}) {
    super({
      name: 'LasVegas',
      apiBaseUrl: LASVEGAS_API_BASE_URL,
      eventOrigin: 'https://www.lasvegas.ro',
      systemCode: 'LASVEGAS',
      ...options,
    });
  }
}

module.exports = {
  LASVEGAS_API_BASE_URL,
  LasVegasProvider,
};
