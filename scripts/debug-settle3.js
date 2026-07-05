// Patch settlePick to debug
const mod = require('../src/ai-pick-settler');

const origSettlePick = mod.settlePick;
mod.settlePick = function(pick, liveEvents, previousEvents) {
  const entry = pick.entry || {};
  const market = entry.market || '';
  const event = entry.event || '';
  const pm = mod.findMatchingEvent(event, previousEvents || []);
  console.log('[PATCHED] previousMatch:', pm ? 'found' : 'null');
  if (pm) {
    const mf = mod.classifyMarket(market);
    const cp = mod.getMarketPrices(pm, mf);
    console.log('[PATCHED] marketFamily:', mf, 'closingPrices:', cp);
  }
  return origSettlePick.call(this, pick, liveEvents, previousEvents);
};

const pick = {
  loggedAt: '2026-01-01T00:00:00Z',
  action: 'created',
  entry: {
    id: 'p1', event: 'Team A vs Team B',
    market: 'totalGoals_2_5', selection: 'Over @ Avg', odds: 2.5,
  },
};
const prev = [{
  homeTeam: 'Team A', awayTeam: 'Team B',
  bookmakers: [{ name: 'A', markets: { totalGoals_2_5: { over: 1.02, under: 30.0 } } }],
}];

const result = mod.settlePick(pick, [], prev);
console.log('result:', JSON.stringify(result, null, 2));
