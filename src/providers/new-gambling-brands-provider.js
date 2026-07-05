const {
  DigitainBrandGroupProvider,
  NEW_GAMBLING_EVENTS_URL,
} = require('./digitain-brand-group-provider');

const NEW_GAMBLING_BRANDS = Object.freeze([
  { name: 'Bet7', origin: 'https://www.bet7.ro' },
  { name: 'EliteSlots', origin: 'https://www.eliteslots.ro' },
]);

class NewGamblingBrandsProvider extends DigitainBrandGroupProvider {
  constructor(options = {}) {
    super({
      name: 'New Gambling Solutions brands',
      eventsUrl: NEW_GAMBLING_EVENTS_URL,
      brands: NEW_GAMBLING_BRANDS,
      ...options,
    });
  }
}

module.exports = {
  NEW_GAMBLING_BRANDS,
  NewGamblingBrandsProvider,
};
