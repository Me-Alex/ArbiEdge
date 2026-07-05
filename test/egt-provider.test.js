const test = require('node:test');
const assert = require('node:assert/strict');

const {
  EGT_MARKET_TEMPLATES,
  EgtProvider,
  footballTournamentIds,
  normalizeEgtPayload,
} = require('../src/providers/egt-provider');
const {
  VIVA_GAMES_BRANDS,
  createVivaGamesProviders,
} = require('../src/providers/viva-games-provider');

const sportsPayload = [
  {
    id: 1001,
    name: 'Fotbal',
    data: [
      {
        id: 10004,
        name: 'International',
        data: [
          { id: 19000000016, name: 'Cupa Mondiala 2026', eventsCount: 2 },
          { id: 19000000017, name: 'Empty league', eventsCount: 0 },
        ],
      },
    ],
  },
];

const eventsPayload = {
  events: {
    50006873979: {
      sportEventId: 50006873979,
      eventId: 50006873979,
      eventTitle: 'Brazilia vs. Japonia',
      eventPath: 'Brazil vs. Japan',
      sportEventType: 'match',
      sportId: 1001,
      tournamentId: 19000000016,
      tournamentName: 'Cupa Mondiala 2026',
      categoryName: 'International',
      homeTeam: 'Brazilia',
      awayTeam: 'Japonia',
      hasActiveMarkets: true,
      isProducerDown: false,
      startTime: '2026-06-29T19:00:00Z',
      radarMatchId: 53452557,
      markets: [
        {
          marketTemplateId: EGT_MARKET_TEMPLATES.h2h,
          marketStatus: 'Active',
          outcomes: [
            { isActive: true, columnName: '1', odds: 1.7 },
            { isActive: true, columnName: 'X', odds: 3.6 },
            { isActive: true, columnName: '2', odds: 5.5 },
          ],
        },
        {
          marketTemplateId: EGT_MARKET_TEMPLATES.doubleChance,
          marketStatus: 'Active',
          outcomes: [
            { isActive: true, columnName: '1X', odds: 1.14 },
            { isActive: true, columnName: '12', odds: 1.25 },
            { isActive: true, columnName: 'X2', odds: 2.05 },
          ],
        },
        {
          marketTemplateId: EGT_MARKET_TEMPLATES.drawNoBet,
          marketStatus: 'Active',
          outcomes: [
            { isActive: true, columnName: '1', odds: 1.24 },
            { isActive: true, columnName: '2', odds: 3.6 },
          ],
        },
        {
          marketTemplateId: EGT_MARKET_TEMPLATES.totalGoals,
          marketStatus: 'Active',
          marketSpecifier: '2.5',
          outcomes: [
            { isActive: true, columnName: 'Peste', odds: 2.12, specifier: '2.5' },
            { isActive: true, columnName: 'Sub', odds: 1.78, specifier: '2.5' },
          ],
        },
        {
          marketTemplateId: EGT_MARKET_TEMPLATES.bothTeamsToScore,
          marketStatus: 'Active',
          outcomes: [
            { isActive: true, columnName: 'Da', odds: 2.07 },
            { isActive: true, columnName: 'Nu', odds: 1.8 },
          ],
        },
        {
          marketTemplateId: EGT_MARKET_TEMPLATES.asianHandicap,
          marketStatus: 'Active',
          marketSpecifier: '-0.75',
          outcomes: [
            { isActive: true, columnName: '1', shortName: '-0.75', odds: 1.88 },
            { isActive: true, columnName: '2', shortName: '+0.75', odds: 1.93 },
          ],
        },
      ],
    },
  },
  eventIds: [50006873979],
};

test('extracts active EGT football tournament ids', () => {
  assert.deepEqual(footballTournamentIds(sportsPayload), [19000000016]);
});

test('extracts nested EGT football tournament ids', () => {
  const nestedSports = [
    {
      id: 1001,
      name: 'Fotbal',
      children: [
        {
          id: 10,
          name: 'Europe',
          children: [
            {
              id: 20,
              name: 'Romania',
              leagues: [
                { id: 19000000020, name: 'Liga 1', eventsCount: 12 },
                { id: 19000000021, name: 'Liga 2', eventCount: 4 },
              ],
            },
          ],
        },
      ],
    },
  ];

  assert.deepEqual(footballTournamentIds(nestedSports), [19000000020, 19000000021]);
});

test('normalizes EGT football markets and event links', () => {
  const events = normalizeEgtPayload(eventsPayload, {
    bookmaker: 'VivaBet',
    fetchedAt: '2026-06-29T10:00:00.000Z',
    origin: 'https://vivabet.ro',
  });

  assert.deepEqual(events, [
    {
      id: 'vivabet:50006873979',
      externalIds: {
        egtEvent: '50006873979',
        sportradar: '53452557',
      },
      sport: 'Football',
      competition: 'Cupa Mondiala 2026',
      startsAt: '2026-06-29T19:00:00.000Z',
      homeTeam: 'Brazilia',
      awayTeam: 'Japonia',
      bookmakers: [
        {
          name: 'VivaBet',
          lastUpdate: '2026-06-29T10:00:00.000Z',
          eventUrl: 'https://vivabet.ro/sports/event/brazil-vs-japan-50006873979',
          bookmakerUrl: 'https://vivabet.ro/sports',
          markets: {
            h2h: { home: 1.7, draw: 3.6, away: 5.5 },
            doubleChance: { homeDraw: 1.14, homeAway: 1.25, drawAway: 2.05 },
            drawNoBet: { home: 1.24, away: 3.6 },
            totalGoals_2_5: { over: 2.12, under: 1.78 },
            bothTeamsToScore: { yes: 2.07, no: 1.8 },
            asianHandicap_minus_0_75: { home: 1.88, away: 1.93 },
          },
        },
      ],
    },
  ]);
});

test('normalizes EGT events with fixture names when team fields are missing', () => {
  const payload = structuredClone(eventsPayload);
  delete payload.events[50006873979].homeTeam;
  delete payload.events[50006873979].awayTeam;
  payload.events[50006873979].eventTitle = 'Brazilia vs. Japonia';

  const [event] = normalizeEgtPayload(payload, {
    bookmaker: 'VivaBet',
    fetchedAt: '2026-06-29T10:00:00.000Z',
    origin: 'https://vivabet.ro',
  });

  assert.equal(event.homeTeam, 'Brazilia');
  assert.equal(event.awayTeam, 'Japonia');
});

test('keeps EGT events that have useful non-result markets without 1X2', () => {
  const payload = structuredClone(eventsPayload);
  payload.events[50006873979].markets = payload.events[50006873979].markets.filter(
    (market) => Number(market.marketTemplateId) !== EGT_MARKET_TEMPLATES.h2h,
  );

  const [event] = normalizeEgtPayload(payload, {
    bookmaker: 'VivaBet',
    fetchedAt: '2026-06-29T10:00:00.000Z',
    origin: 'https://vivabet.ro',
  });

  assert.equal(event.id, 'vivabet:50006873979');
  assert.equal(event.bookmakers[0].markets.h2h, undefined);
  assert.deepEqual(event.bookmakers[0].markets.totalGoals_2_5, { over: 2.12, under: 1.78 });
});

test('keeps extra EGT markets through the generic normalizer', () => {
  const payload = structuredClone(eventsPayload);
  payload.events[50006873979].markets.push({
    marketTemplateId: 199999,
    marketName: 'Home total goals',
    marketStatus: 'Active',
    marketSpecifier: '1.5',
    outcomes: [
      { isActive: true, columnName: 'Peste', odds: 2.9, specifier: '1.5' },
      { isActive: true, columnName: 'Sub', odds: 1.42, specifier: '1.5' },
    ],
  });

  const [event] = normalizeEgtPayload(payload, {
    bookmaker: 'VivaBet',
    fetchedAt: '2026-06-29T10:00:00.000Z',
    origin: 'https://vivabet.ro',
  });

  assert.deepEqual(event.bookmakers[0].markets.market_total_goluri_home_1_5, {
    over: 2.9,
    under: 1.42,
  });
});

test('loads EGT sports and event payloads with platform headers', async () => {
  const requests = [];
  const provider = new EgtProvider({
    name: 'VivaBet',
    apiBaseUrl: 'https://api.example.test',
    origin: 'https://vivabet.ro',
    now: () => new Date('2026-06-29T10:00:00Z'),
    fetchImpl: async (url, options) => {
      requests.push({ url: url.toString(), options });
      const body = url.toString().includes('/sportsapi/public/sports')
        ? sportsPayload
        : eventsPayload;
      return new Response(JSON.stringify(body), { status: 200 });
    },
  });

  const events = await provider.getOdds();

  assert.equal(requests.length, 2);
  assert.equal(requests[0].options.headers['x-platform-device'], 'ONLINE');
  assert.equal(requests[0].options.headers['x-platform-origin'], 'https://vivabet.ro');
  assert.equal(requests[1].options.method, 'POST');
  assert.ok(requests[1].url.includes('/sport-events/v2/tournaments/events/1001?'));
  assert.deepEqual(JSON.parse(requests[1].options.body), [19000000016]);
  assert.equal(events[0].bookmakers[0].name, 'VivaBet');
});

test('creates configured Viva Games EGT providers', () => {
  const providers = createVivaGamesProviders({ timeoutMs: 1234 });

  assert.deepEqual(
    providers.map((provider) => provider.name),
    VIVA_GAMES_BRANDS.map((brand) => brand.name),
  );
  assert.equal(providers[0].timeoutMs, 1234);
});
