const { settlePick, findMatchingEvent, getMarketPrices, classifyMarket } = require('../src/ai-pick-settler');

const pick = {
  loggedAt: '2026-01-01T00:00:00Z',
  action: 'created',
  entry: {
    id: 'p1', event: 'Team A vs Team B',
    market: 'totalGoals_2_5', selection: 'Over @ Avg', odds: 2.5,
  },
};
const prev = [
  {
    homeTeam: 'Team A', awayTeam: 'Team B',
    bookmakers: [
      { name: 'A', markets: { totalGoals_2_5: { over: 1.02, under: 30.0 } } },
    ],
  },
];

console.log('market from pick:', pick.entry.market);
console.log('classifyMarket:', classifyMarket(pick.entry.market));
const matched = findMatchingEvent(pick.entry.event, prev);
console.log('matched event:', matched ? 'yes' : 'no');
if (matched) {
  console.log('prices:', JSON.stringify(getMarketPrices(matched, classifyMarket(pick.entry.market))));
}
const result = settlePick(pick, [], prev);
console.log('result:', JSON.stringify(result, null, 2));
