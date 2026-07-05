const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BETONE_CONTENT_URL,
  BETONE_EVENT_URL,
  BetOneProvider,
  extractBetOneFixtures,
  mergeBetOneDetail,
  normalizeBetOnePayload,
} = require('../src/providers/betone-provider');

const fixture = {
  eventCode: '3202',
  eventId: 9473929,
  fixtureId: 102292,
  fixtureDate: '2026-06-29T17:00:00Z',
  homeTeam: 'Brazilia',
  awayTeam: 'Japonia',
  eventTitle: 'FOTBAL · CM 2026',
  outcomes: [
    { marketId: 6, name: '1', value: 1.72 },
    { marketId: 6, name: 'X', value: 3.65 },
    { marketId: 6, name: '2', value: 5.35 },
  ],
};

const contentPayload = {
  isSuccess: true,
  content: {
    contentType: 'Prematch',
    offerContent: [
      {
        name: 'FOTBAL',
        imgKey: 'soccer',
        competitions: [
          {
            name: 'CM 2026 1/16',
            fullName: 'CM 2026 1/16',
            categoryName: 'International',
            events: [fixture],
          },
        ],
      },
    ],
  },
};

const eventPayload = {
  isSuccess: true,
  content: {
    contentType: 'Prematch',
    eventCode: '3202',
    eventId: 9473929,
    fixtureId: 102292,
    eventDate: '2026-06-29T17:00:00Z',
    sportName: 'FOTBAL',
    categoryName: 'International',
    competitionName: 'CM 2026',
    homeTeamName: 'Brazilia',
    awayTeamName: 'Japonia',
    markets: [
      {
        marketId: 6,
        marketName: 'Final',
        outcomes: [
          { name: '1', value: 1.72 },
          { name: 'X', value: 3.65 },
          { name: '2', value: 5.35 },
          { name: '1X', value: 1.18 },
          { name: 'X2', value: 2.13 },
          { name: '12', value: 1.3 },
        ],
      },
      {
        marketId: 4607,
        marketName: 'Ambele Marcheaza',
        outcomes: [
          { name: 'GG', value: 1.9 },
          { name: 'NG', value: 1.9 },
        ],
      },
      {
        marketId: 3960,
        marketName: 'Total Goluri (TG)',
        outcomes: [
          { name: '2+', value: 1.36 },
          { name: '0-1', value: 3.2 },
          { name: '3+', value: 2.1 },
          { name: '0-2', value: 1.74 },
        ],
      },
      {
        marketId: 2550,
        marketName: 'Total Goluri Asiatice (TG)',
        outcomes: [
          { name: 'Peste 2.75', value: 1.84 },
          { name: 'Sub 2.75', value: 1.86 },
        ],
      },
      {
        marketId: 2607,
        marketName: 'Total Goluri Asiatice PR (TG)',
        outcomes: [
          { name: 'Peste 1.25', value: 2.05 },
          { name: 'Sub 1.25', value: 1.69 },
        ],
      },
      {
        marketId: 389,
        marketName: 'Final fara Egal',
        outcomes: [
          { name: '1', value: 1.25 },
          { name: '2', value: 3.6 },
        ],
      },
      {
        marketId: 722,
        marketName: 'Handicap',
        outcomes: [
          { name: 'H1 0', value: 1.25 },
          { name: 'H2 0', value: 3.6 },
          { name: 'H1 -0.25', value: 1.45 },
          { name: 'H2 0.25', value: 2.55 },
        ],
      },
      {
        marketId: 572,
        marketName: 'Total Cornere',
        outcomes: [
          { name: 'Sub 9.5', value: 1.65 },
          { name: 'Peste 9.5', value: 2.1 },
        ],
      },
    ],
  },
};

test('extracts BetOne football fixtures from the content payload', () => {
  const events = extractBetOneFixtures(contentPayload);

  assert.equal(events.length, 1);
  assert.equal(events[0].competitionName, 'CM 2026 1/16');
  assert.equal(events[0].sportName, 'FOTBAL');
});

test('extracts BetOne fixtures with alternate team name fields and separators', () => {
  const payload = structuredClone(contentPayload);
  payload.content.offerContent[0].competitions[0].events = [
    {
      ...fixture,
      fixtureId: 111,
      homeTeam: undefined,
      awayTeam: undefined,
      homeTeamName: 'Franta',
      awayTeamName: 'Romania',
    },
    {
      ...fixture,
      fixtureId: 222,
      homeTeam: undefined,
      awayTeam: undefined,
      homeTeamName: undefined,
      awayTeamName: undefined,
      name: 'Argentina - Brazil',
    },
  ];

  const events = extractBetOneFixtures(payload);

  assert.deepEqual(
    events.map((event) => [event.fixtureId, event.homeTeam, event.awayTeam]),
    [
      [111, 'Franta', 'Romania'],
      [222, 'Argentina', 'Brazil'],
    ],
  );
});

test('normalizes BetOne detailed markets and direct event links', () => {
  const events = normalizeBetOnePayload([eventPayload], '2026-06-29T10:00:00.000Z');

  assert.deepEqual(events, [
    {
      id: 'betone:102292',
      externalIds: {
        betoneFixture: '102292',
        betoneEvent: '9473929',
      },
      sport: 'Football',
      competition: 'CM 2026',
      startsAt: '2026-06-29T17:00:00.000Z',
      homeTeam: 'Brazilia',
      awayTeam: 'Japonia',
      bookmakers: [
        {
          name: 'BetOne',
          lastUpdate: '2026-06-29T10:00:00.000Z',
          eventUrl: 'https://sportsbook.betone.ro/event/102292',
          bookmakerUrl: 'https://sportsbook.betone.ro/',
          markets: {
            h2h: { home: 1.72, draw: 3.65, away: 5.35 },
            doubleChance: { homeDraw: 1.18, drawAway: 2.13, homeAway: 1.3 },
            bothTeamsToScore: { yes: 1.9, no: 1.9 },
            totalGoals_1_5: { over: 1.36, under: 3.2 },
            totalGoals_2_5: { over: 2.1, under: 1.74 },
            asianTotalGoals_2_75: { over: 1.84, under: 1.86 },
            firstHalfAsianTotalGoals_1_25: { over: 2.05, under: 1.69 },
            drawNoBet: { home: 1.25, away: 3.6 },
            handicap_0: { home: 1.25, away: 3.6 },
            handicap_minus_0_25: { home: 1.45, away: 2.55 },
            totalCorners_9_5: { under: 1.65, over: 2.1 },
          },
        },
      ],
    },
  ]);
});

test('keeps extra BetOne markets through the generic normalizer', () => {
  const payload = structuredClone(eventPayload);
  payload.content.markets.push({
    marketId: 999999,
    marketName: 'Home total goals',
    outcomes: [
      { name: 'Peste 1.5', value: 2.72 },
      { name: 'Sub 1.5', value: 1.49 },
    ],
  });

  const [event] = normalizeBetOnePayload([payload], '2026-06-29T10:00:00.000Z');

  assert.deepEqual(event.bookmakers[0].markets.market_total_goluri_home_1_5, {
    over: 2.72,
    under: 1.49,
  });
});

test('keeps BetOne fixture ids when event details omit them', () => {
  const detailWithoutFixtureId = {
    ...eventPayload,
    content: {
      ...eventPayload.content,
    },
  };
  delete detailWithoutFixtureId.content.fixtureId;

  const events = normalizeBetOnePayload(
    [mergeBetOneDetail(fixture, detailWithoutFixtureId)],
    '2026-06-29T10:00:00.000Z',
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].id, 'betone:102292');
  assert.equal(events[0].bookmakers[0].eventUrl, 'https://sportsbook.betone.ro/event/102292');
});

test('normalizes BetOne events with dash-separated names when team fields are missing', () => {
  const payload = structuredClone(eventPayload);
  delete payload.content.homeTeamName;
  delete payload.content.awayTeamName;
  payload.content.name = 'Franta - Romania';

  const [event] = normalizeBetOnePayload([payload], '2026-06-29T10:00:00.000Z');

  assert.equal(event.homeTeam, 'Franta');
  assert.equal(event.awayTeam, 'Romania');
});

test('loads BetOne content and enriches fixtures with event markets', async () => {
  const requests = [];
  const provider = new BetOneProvider({
    now: () => new Date('2026-06-29T10:00:00Z'),
    maxDetailEvents: 1,
    fetchImpl: async (url, options) => {
      requests.push({ url: url.toString(), options });
      const body = url.toString().startsWith(BETONE_CONTENT_URL)
        ? contentPayload
        : eventPayload;
      return new Response(JSON.stringify(body), { status: 200 });
    },
  });

  const events = await provider.getOdds();

  assert.equal(requests.length, 2);
  assert.ok(requests[0].url.startsWith(BETONE_CONTENT_URL));
  assert.ok(requests[0].url.includes('structureId=001001'));
  assert.ok(requests[1].url.startsWith(BETONE_EVENT_URL));
  assert.ok(requests[1].url.includes('fixtureId=102292'));
  assert.ok(requests[1].url.includes('includeOutcomes=true'));
  assert.equal(requests[0].options.headers.origin, 'https://sportsbook.betone.ro');
  assert.equal(events[0].bookmakers[0].name, 'BetOne');
});
