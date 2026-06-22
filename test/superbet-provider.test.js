const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SuperbetProvider,
  normalizeSuperbetPayload,
} = require('../src/providers/superbet-provider');

const payload = {
  error: false,
  data: [{
    eventId: 44,
    betradarId: '555',
    matchName: 'Uruguay·Capul Verde',
    utcDate: '2026-06-21T22:00:00Z',
    odds: [
      { marketName: 'Final', name: '1', price: 1.42, status: 'active' },
      { marketName: 'Final', name: 'X', price: 4.5, status: 'active' },
      { marketName: 'Final', name: '2', price: 9.5, status: 'active' },
    ],
  }],
};

test('normalizes active Superbet final-result odds', () => {
  const events = normalizeSuperbetPayload(payload, '2026-06-21T20:00:00.000Z');

  assert.equal(events[0].homeTeam, 'Uruguay');
  assert.equal(events[0].awayTeam, 'Capul Verde');
  assert.deepEqual(events[0].bookmakers[0].markets.h2h, {
    home: 1.42,
    draw: 4.5,
    away: 9.5,
  });
});

test('builds a current Superbet football URL', async () => {
  let requested;
  const provider = new SuperbetProvider({
    now: () => new Date('2026-06-21T20:00:00Z'),
    fetchImpl: async (url) => {
      requested = url.toString();
      return new Response(JSON.stringify(payload), { status: 200 });
    },
  });

  await provider.getOdds();
  assert.match(requested, /sportId=5/);
  assert.match(requested, /offerState=prematch/);
});
