const { getMarketPrices, classifyMarket } = require('../src/ai-pick-settler');
console.log('classifyMarket totalGoals_2_5:', classifyMarket('totalGoals_2_5'));
const ev = {
  homeTeam: 'Team A', awayTeam: 'Team B',
  bookmakers: [{ name: 'A', markets: { totalGoals_2_5: { over: 1.02, under: 30.0 } } }],
};
console.log('prices:', JSON.stringify(getMarketPrices(ev, 'totalLine')));
