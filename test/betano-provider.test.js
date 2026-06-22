const test = require('node:test');
const assert = require('node:assert/strict');

const { BetanoProvider } = require('../src/providers/betano-provider');

test('normalizes browser-collected Betano markets', async () => {
  const provider = new BetanoProvider({
    transport: {
      collect: async () => [{
        id: '77',
        betRadarId: 555,
        name: 'Uruguay - Capul Verde',
        startTime: 1782079200000,
        competition: 'Cupa Mondială',
        markets: [
          {
            type: 'MRES',
            selections: [
              { name: '1', price: 1.44 },
              { name: 'X', price: 4.15 },
              { name: '2', price: 8.75 },
            ],
          },
          {
            type: 'DNOB',
            selections: [
              { name: 'Uruguay', price: 1.12 },
              { name: 'Capul Verde', price: 6.4 },
            ],
          },
        ],
      }],
    },
  });

  const events = await provider.getOdds();

  assert.equal(events[0].externalIds.sportradar, '555');
  assert.deepEqual(events[0].bookmakers[0].markets.drawNoBet, {
    home: 1.12,
    away: 6.4,
  });
});

test('reports an unavailable browser session when Betano returns no events', async () => {
  const provider = new BetanoProvider({
    transport: { collect: async () => [] },
  });

  await assert.rejects(provider.getOdds(), /no events/i);
});
