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

test('normalizes two-way basketball h2h and sport-specific point totals', async () => {
  const basketball = structuredClone(upstreamEvent);
  basketball.id = 'basketball-1';
  basketball.sport_key = 'basketball_nba';
  basketball.sport_title = 'NBA';
  basketball.bookmakers[0].markets = [{
    key: 'h2h',
    outcomes: [
      { name: 'Romania', price: 2.1 },
      { name: 'Brazil', price: 1.8 },
    ],
  }, {
    key: 'totals',
    outcomes: [
      { name: 'Over', price: 1.91, point: 224.5 },
      { name: 'Under', price: 1.95, point: 224.5 },
    ],
  }];
  const provider = new TheOddsApiProvider({
    apiKey: 'test-key',
    sportKeys: ['basketball_nba'],
    fetchImpl: async () => new Response(JSON.stringify([basketball]), { status: 200 }),
  });

  const [event] = await provider.getOdds();
  assert.equal(event.sport, 'Basketball');
  assert.deepEqual(event.bookmakers[0].markets.h2h, { home: 2.1, away: 1.8 });
  assert.deepEqual(event.bookmakers[0].markets.totalPoints_224_5, { over: 1.91, under: 1.95 });
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

test('normalizes The Odds API spreads and totals when present', async () => {
  const event = structuredClone(upstreamEvent);
  event.bookmakers[0].markets.push(
    {
      key: 'spreads',
      outcomes: [
        { name: 'Romania', price: 1.91, point: 1.5 },
        { name: 'Brazil', price: 1.95, point: -1.5 },
      ],
    },
    {
      key: 'totals',
      outcomes: [
        { name: 'Over', price: 2.02, point: 2.5 },
        { name: 'Under', price: 1.84, point: 2.5 },
      ],
    },
  );
  const provider = new TheOddsApiProvider({
    apiKey: 'test-key',
    sportKeys: ['soccer_fifa_world_cup'],
    fetchImpl: async () => new Response(JSON.stringify([event]), { status: 200 }),
  });

  const events = await provider.getOdds();

  assert.equal(events[0].bookmakers[0].markets.handicap_1_5, undefined);
  assert.deepEqual(events[0].bookmakers[0].markets.handicap_plus_1_5, {
    home: 1.91,
    away: 1.95,
  });
  assert.deepEqual(events[0].bookmakers[0].markets.totalGoals_2_5, {
    over: 2.02,
    under: 1.84,
  });
});

test('normalizes The Odds API BTTS markets when present', async () => {
  const event = structuredClone(upstreamEvent);
  event.bookmakers[0].markets = [
    {
      key: 'btts',
      outcomes: [
        { name: 'Yes', price: 1.91 },
        { name: 'No', price: 1.84 },
      ],
    },
  ];
  const provider = new TheOddsApiProvider({
    apiKey: 'test-key',
    sportKeys: ['soccer_fifa_world_cup'],
    fetchImpl: async () => new Response(JSON.stringify([event]), { status: 200 }),
  });

  const events = await provider.getOdds();

  assert.equal(events[0].bookmakers[0].markets.h2h, undefined);
  assert.deepEqual(events[0].bookmakers[0].markets.bothTeamsToScore, {
    yes: 1.91,
    no: 1.84,
  });
});

test('fetches configured event markets and merges them into base bookmakers', async () => {
  const detailEvent = structuredClone(upstreamEvent);
  detailEvent.bookmakers[0].markets = [
    {
      key: 'alternate_spreads',
      outcomes: [
        { name: 'Romania', price: 1.72, point: 0.5 },
        { name: 'Brazil', price: 2.08, point: -0.5 },
        { name: 'Romania', price: 2.2, point: 1.5 },
        { name: 'Brazil', price: 1.68, point: -1.5 },
      ],
    },
    {
      key: 'alternate_totals',
      outcomes: [
        { name: 'Over', price: 1.54, point: 1.5 },
        { name: 'Under', price: 2.38, point: 1.5 },
        { name: 'Over', price: 2.42, point: 3.5 },
        { name: 'Under', price: 1.52, point: 3.5 },
      ],
    },
    {
      key: 'btts',
      outcomes: [
        { name: 'Yes', price: 1.91 },
        { name: 'No', price: 1.84 },
      ],
    },
    {
      key: 'draw_no_bet',
      outcomes: [
        { name: 'Romania', price: 2.82 },
        { name: 'Brazil', price: 1.42 },
      ],
    },
  ];

  const requests = [];
  const provider = new TheOddsApiProvider({
    apiKey: 'test-key',
    sportKeys: ['soccer_fifa_world_cup'],
    eventMarketKeys: ['btts', 'draw_no_bet', 'alternate_spreads', 'alternate_totals'],
    fetchImpl: async (url) => {
      const requestUrl = new URL(url);
      requests.push(requestUrl);
      const isDetailRequest = requestUrl.pathname.endsWith('/events/match-1/odds');
      return new Response(JSON.stringify(isDetailRequest ? detailEvent : [upstreamEvent]), {
        status: 200,
      });
    },
  });

  const events = await provider.getOdds();

  assert.equal(requests.length, 2);
  assert.equal(requests[0].pathname, '/v4/sports/soccer_fifa_world_cup/odds/');
  assert.equal(requests[0].searchParams.get('markets'), 'h2h,spreads,totals');
  assert.equal(
    requests[1].pathname,
    '/v4/sports/soccer_fifa_world_cup/events/match-1/odds',
  );
  assert.equal(
    requests[1].searchParams.get('markets'),
    'btts,draw_no_bet,alternate_spreads,alternate_totals',
  );
  assert.equal(requests[1].searchParams.get('regions'), 'eu,uk');
  assert.deepEqual(events[0].bookmakers[0].markets.h2h, {
    home: 4.2,
    draw: 3.4,
    away: 1.8,
  });
  assert.deepEqual(events[0].bookmakers[0].markets.bothTeamsToScore, {
    yes: 1.91,
    no: 1.84,
  });
  assert.deepEqual(events[0].bookmakers[0].markets.drawNoBet, {
    home: 2.82,
    away: 1.42,
  });
  assert.deepEqual(events[0].bookmakers[0].markets.handicap_plus_0_5, {
    home: 1.72,
    away: 2.08,
  });
  assert.deepEqual(events[0].bookmakers[0].markets.handicap_plus_1_5, {
    home: 2.2,
    away: 1.68,
  });
  assert.deepEqual(events[0].bookmakers[0].markets.totalGoals_1_5, {
    over: 1.54,
    under: 2.38,
  });
  assert.deepEqual(events[0].bookmakers[0].markets.totalGoals_3_5, {
    over: 2.42,
    under: 1.52,
  });
});

test('keeps base odds when event-detail requests fail or exceed the per-sport cap', async () => {
  const baseEvents = ['match-1', 'match-2', 'match-3'].map((id, index) => {
    const event = structuredClone(upstreamEvent);
    event.id = id;
    event.commence_time = `2026-06-${21 + index}T18:00:00Z`;
    return event;
  });
  const detailEvent = structuredClone(baseEvents[1]);
  detailEvent.bookmakers[0].markets = [
    {
      key: 'btts',
      outcomes: [
        { name: 'Yes', price: 1.75 },
        { name: 'No', price: 2.05 },
      ],
    },
  ];

  const requests = [];
  const provider = new TheOddsApiProvider({
    apiKey: 'test-key',
    sportKeys: ['soccer_fifa_world_cup'],
    eventMarketKeys: ['btts'],
    maxEventDetailRequests: 2,
    eventDetailConcurrency: 1,
    fetchImpl: async (url) => {
      const requestUrl = new URL(url);
      requests.push(requestUrl);
      if (requestUrl.pathname.endsWith('/events/match-1/odds')) {
        return new Response('detail unavailable', { status: 502 });
      }
      if (requestUrl.pathname.endsWith('/events/match-2/odds')) {
        return new Response(JSON.stringify(detailEvent), { status: 200 });
      }
      if (requestUrl.pathname.includes('/events/match-3/odds')) {
        throw new Error('event cap should prevent this request');
      }
      return new Response(JSON.stringify(baseEvents), { status: 200 });
    },
  });

  const events = await provider.getOdds();
  const detailRequests = requests.filter((request) =>
    request.pathname.includes('/events/'),
  );

  assert.equal(events.length, 3);
  assert.equal(detailRequests.length, 2);
  assert.equal(events.find((event) => event.id === 'match-1').bookmakers[0].markets.bothTeamsToScore, undefined);
  assert.deepEqual(
    events.find((event) => event.id === 'match-2').bookmakers[0].markets.bothTeamsToScore,
    {
      yes: 1.75,
      no: 2.05,
    },
  );
  assert.equal(
    detailRequests.some((request) => request.pathname.includes('/events/match-3/odds')),
    false,
  );
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

test('requests multiple bookmaker regions by default', async () => {
  let requestUrl;
  const provider = new TheOddsApiProvider({
    apiKey: 'test-key',
    sportKeys: ['soccer_fifa_world_cup'],
    fetchImpl: async (url) => {
      requestUrl = new URL(url);
      return new Response(JSON.stringify([upstreamEvent]), { status: 200 });
    },
  });

  await provider.getOdds();

  assert.equal(requestUrl.searchParams.get('markets'), 'h2h,spreads,totals');
  assert.equal(requestUrl.searchParams.get('regions'), 'eu,uk');
  assert.equal(requestUrl.searchParams.get('bookmakers'), null);
});

test('requests explicit bookmakers when configured', async () => {
  let requestUrl;
  const provider = new TheOddsApiProvider({
    apiKey: 'test-key',
    sportKeys: ['soccer_fifa_world_cup'],
    regions: ['eu', 'uk'],
    bookmakers: ['pinnacle', 'betfair_ex_eu'],
    fetchImpl: async (url) => {
      requestUrl = new URL(url);
      return new Response(JSON.stringify([upstreamEvent]), { status: 200 });
    },
  });

  await provider.getOdds();

  assert.equal(
    requestUrl.searchParams.get('bookmakers'),
    'pinnacle,betfair_ex_eu',
  );
  assert.equal(requestUrl.searchParams.get('regions'), null);
});

test('optionally discovers active sports by group with a bounded request set', async () => {
  const basketball = structuredClone(upstreamEvent);
  basketball.sport_key = 'basketball_nba';
  basketball.sport_title = 'NBA';
  basketball.bookmakers[0].markets[0].outcomes = [
    { name: 'Romania', price: 2.1 },
    { name: 'Brazil', price: 1.8 },
  ];
  const requests = [];
  const provider = new TheOddsApiProvider({
    apiKey: 'test-key',
    sportKeys: [],
    discoverSports: true,
    sportGroups: ['Basketball'],
    maxSports: 2,
    fetchImpl: async (url) => {
      const request = new URL(url);
      requests.push(request);
      if (request.pathname === '/v4/sports/') {
        return new Response(JSON.stringify([
          { key: 'soccer_epl', group: 'Soccer', active: true },
          { key: 'basketball_nba', group: 'Basketball', active: true },
        ]), { status: 200 });
      }
      return new Response(JSON.stringify([basketball]), { status: 200 });
    },
  });

  const events = await provider.getOdds();
  assert.equal(events.length, 1);
  assert.equal(events[0].sport, 'Basketball');
  assert.deepEqual(requests.map((request) => request.pathname), [
    '/v4/sports/',
    '/v4/sports/basketball_nba/odds/',
  ]);
});

test('keeps successful sports when another sport endpoint fails', async () => {
  const provider = new TheOddsApiProvider({
    apiKey: 'test-key',
    sportKeys: ['soccer_bad', 'soccer_fifa_world_cup'],
    sportConcurrency: 1,
    fetchImpl: async (url) => {
      const request = new URL(url);
      if (request.pathname.includes('/soccer_bad/')) return new Response('bad', { status: 503 });
      return new Response(JSON.stringify([upstreamEvent]), { status: 200 });
    },
  });

  const events = await provider.getOdds();
  assert.equal(events.length, 1);
  assert.equal(provider.lastSportFailures.length, 1);
  assert.equal(provider.lastSportFailures[0].sportKey, 'soccer_bad');
});
