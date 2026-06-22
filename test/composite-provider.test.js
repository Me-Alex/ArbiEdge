const test = require('node:test');
const assert = require('node:assert/strict');

const { CompositeProvider } = require('../src/providers/composite-provider');

const baseEvent = {
  id: 'first:1',
  externalIds: { sportradar: '123' },
  sport: 'Football',
  competition: 'World Cup',
  startsAt: '2026-06-22T10:00:00.000Z',
  homeTeam: 'Romania',
  awayTeam: 'Brazil',
  bookmakers: [{ name: 'First', markets: { h2h: { home: 2, draw: 3, away: 4 } } }],
};

test('merges bookmaker quotes for the same Sportradar fixture', async () => {
  const second = structuredClone(baseEvent);
  second.id = 'second:9';
  second.bookmakers[0].name = 'Second';

  const provider = new CompositeProvider([
    { name: 'First', getOdds: async () => [baseEvent] },
    { name: 'Second', getOdds: async () => [second] },
  ]);

  const result = await provider.getOdds();

  assert.equal(result.events.length, 1);
  assert.deepEqual(
    result.events[0].bookmakers.map((bookmaker) => bookmaker.name),
    ['First', 'Second'],
  );
  assert.deepEqual(result.providers, [
    { name: 'First', ok: true, events: 1 },
    { name: 'Second', ok: true, events: 1 },
  ]);
});

test('keeps successful providers when another provider fails', async () => {
  const provider = new CompositeProvider([
    { name: 'First', getOdds: async () => [baseEvent] },
    { name: 'Broken', getOdds: async () => { throw new Error('blocked'); } },
  ]);

  const result = await provider.getOdds();

  assert.equal(result.events.length, 1);
  assert.deepEqual(result.providers[1], {
    name: 'Broken',
    ok: false,
    events: 0,
    error: 'blocked',
  });
});
