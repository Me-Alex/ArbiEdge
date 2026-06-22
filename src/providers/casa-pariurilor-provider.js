const { UfoProvider } = require('./ufo-provider');

const CASA_BASE_URL = 'https://api.casapariurilor.ro/offer';
const CASA_UPCOMING_URL = `${CASA_BASE_URL}/structure/api/v1_0/widget/upcoming`;

class CasaPariurilorProvider extends UfoProvider {
  constructor(options = {}) {
    super({ ...options, name: 'Casa Pariurilor', baseUrl: CASA_BASE_URL });
  }
}

module.exports = { CASA_UPCOMING_URL, CasaPariurilorProvider };
