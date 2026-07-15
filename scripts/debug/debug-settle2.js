const { settlePick, findMatchingEvent, getMarketPrices, classifyMarket } = require('../src/ai-pick-settler');

// Monkey-patch getMarketPrices to log
const origGetMarketPrices = getMarketPrices;
// Actually let me just inline the debug by modifying settlePick
// Better: trace step by step

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

// Step 1: match
const previousMatch = findMatchingEvent(pick.entry.event, prev);
console.log('previousMatch:', previousMatch ? 'found' : 'null');
console.log('previousMatch.bookmakers:', previousMatch?.bookmakers?.map(b => Object.keys(b.markets || {})));

// Step 2: classify
const mf = classifyMarket(pick.entry.market);
console.log('marketFamily:', mf);

// Step 3: get prices
if (previousMatch) {
  // Manually iterate
  for (const bm of previousMatch.bookmakers) {
    console.log('  bm:', bm.name, 'markets:', Object.keys(bm.markets || {}));
    for (const mk of Object.keys(bm.markets || {})) {
      console.log('    mk:', mk, 'classify:', classifyMarket(mk), '===?', classifyMarket(mk) === mf);
    }
  }
  const prices = getMarketPrices(previousMatch, mf);
  console.log('prices:', prices);
}
