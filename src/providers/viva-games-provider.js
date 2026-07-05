const { EgtProvider } = require('./egt-provider');

const VIVA_GAMES_BRANDS = Object.freeze([
  {
    name: 'VivaBet',
    origin: 'https://vivabet.ro',
    apiBaseUrl: 'https://vivabet-ro-api.egt-digital.com',
  },
  {
    name: 'LuckySeven',
    origin: 'https://luckyseven.ro',
    apiBaseUrl: 'https://luckyseven-ro-api.egt-digital.com',
  },
  {
    name: 'OneCasino',
    origin: 'https://onecasino.ro',
    apiBaseUrl: 'https://onecasino-ro-api.egt-digital.com',
  },
  {
    name: 'MaxWin',
    origin: 'https://maxwin.ro',
    apiBaseUrl: 'https://mxro-api.egt-digital.com',
  },
  {
    name: 'Prowin',
    origin: 'https://prowin.ro',
    apiBaseUrl: 'https://pwro-api.egt-digital.com',
  },
  {
    name: 'VipBet',
    origin: 'https://vipbet.ro',
    apiBaseUrl: 'https://vpro-api.egt-digital.com',
  },
]);

function createVivaGamesProviders(options = {}) {
  return VIVA_GAMES_BRANDS.map(
    (brand) =>
      new EgtProvider({
        ...brand,
        ...options,
      }),
  );
}

module.exports = {
  VIVA_GAMES_BRANDS,
  createVivaGamesProviders,
};
