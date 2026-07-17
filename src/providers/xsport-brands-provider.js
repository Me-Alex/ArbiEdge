'use strict';

const { XSportProvider } = require('./xsport-provider');

/**
 * Additional Romanian XSport-family sportsbooks validated with live
 * XSportDatastore feeds. Each brand keeps its own systemCode and API host.
 */
const XSPORT_BRANDS = Object.freeze([
  {
    name: 'Winboss',
    apiBaseUrl: 'https://exalogic.winboss.ro',
    eventOrigin: 'https://winboss.ro',
    systemCode: 'WINBOSS',
  },
  {
    name: 'PowerBet',
    apiBaseUrl: 'https://exalogic.powerbet.ro',
    eventOrigin: 'https://online.powerbet.ro',
    systemCode: 'POWERBETRO',
  },
  {
    name: 'Magnumbet',
    apiBaseUrl: 'https://sport.magnumbet.ro',
    eventOrigin: 'https://magnumbet.ro',
    systemCode: 'MAGNUMBET',
  },
  {
    name: 'Excelbet',
    apiBaseUrl: 'https://exalogic.excelbet.ro',
    eventOrigin: 'https://excelbet.ro',
    systemCode: 'EXCELBET',
  },
]);

function createXsportBrandProviders(options = {}) {
  return XSPORT_BRANDS.map(
    (brand) =>
      new XSportProvider({
        ...brand,
        ...options,
      }),
  );
}

module.exports = {
  XSPORT_BRANDS,
  createXsportBrandProviders,
};
