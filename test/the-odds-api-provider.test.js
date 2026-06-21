const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ProviderError,
  TheOddsApiProvider,
} = require('../src/providers/the-odds-api-provider');

const upstreamEvent = {
  id: 'match-1',
  sport_key: 'soccer_fifa_world_cup',
  sport_title: 'FIFA World Cup',
  commence_time: '2026-06-21T18:00:00Z',
  home_team: 'Romania',
  away_team: 'Brazil',
  bookmakers: [
    {
      key: 'example',
      title: 'Example Sports',
      last_update: '2026-06-21T17:55:00Z',
      markets: [
        {
          key: 'h2h',
          outcomes: [
            { name: 'Romania', price: 4.2 },
            { name: 'Draw', price: 3.4 },
            { name: 'Brazil', price: 1.8 },
          ],
        },
      ],
    },
  ],
};

test('normalizes The Odds API h2h events', async () => {
  const provider = new TheOddsApiProvider({
    apiKey: 'test-key',
    sportKeys: ['soccer_fifa_world_cup'],
    fetchImpl: async () =>
      new Response(JSON.stringify([upstreamEvent]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  });

  const events = await provider.getOdds();

  assert.deepEqual(events, [
    {
      id: 'match-1',
      sport: 'Football',
      competition: 'FIFA World Cup',
      startsAt: '2026-06-21T18:00:00.000Z',
      homeTeam: 'Romania',
      awayTeam: 'Brazil',
      bookmakers: [
        {
          name: 'Example Sports',
          lastUpdate: '2026-06-21T17:55:00.000Z',
          markets: {
            h2h: {
              home: 4.2,
              draw: 3.4,
              away: 1.8,
            },
          },
        },
      ],
    },
  ]);
});

test('ignores malformed events and bookmakers without complete h2h prices', async () => {
  const incomplete = structuredClone(upstreamEvent);
  incomplete.id = 'match-2';
  incomplete.bookmakers[0].markets[0].outcomes.pop();

  const provider = new TheOddsApiProvider({
    apiKey: 'test-key',
    sportKeys: ['soccer_fifa_world_cup'],
    fetchImpl: async () =>
      new Response(JSON.stringify([null, incomplete, upstreamEvent]), {
        status: 200,
      }),
  });

  const events = await provider.getOdds();

  assert.equal(events.length, 1);
  assert.equal(events[0].id, 'match-1');
});

test('throws a provider error for non-success responses', async () => {
  const provider = new TheOddsApiProvider({
    apiKey: 'test-key',
    sportKeys: ['soccer_fifa_world_cup'],
    fetchImpl: async () => new Response('Forbidden', { status: 403 }),
  });

  await assert.rejects(
    provider.getOdds(),
    (error) =>
      error instanceof ProviderError &&
      error.status === 403 &&
      error.message.includes('403'),
  );
});
