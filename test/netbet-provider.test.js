const test = require('node:test');
const assert = require('node:assert/strict');

const {
  NETBET_EVENTS_URL,
  NETBET_MARKETS_URL,
  NetBetProvider,
  extractNetBetEvents,
  normalizeNetBetMarkets,
  normalizeNetBetPayload,
} = require('../src/providers/netbet-provider');

test('normalizes NetBet team to score and clean sheet markets', () => {
  const markets = normalizeNetBetMarkets([
    {
      market_type: 9001,
      market_code: 'home_to_score',
      name: 'Gazdele marcheaza',
      outcomes: [
        { kind: 'Yes', name: 'Da', odds: 1.4, status: true, visible: true, suspended: false },
        { kind: 'No', name: 'Nu', odds: 2.8, status: true, visible: true, suspended: false },
      ],
    },
    {
      market_type: 9002,
      market_code: 'away_clean_sheet',
      name: 'Fara gol primit oaspeti',
      outcomes: [
        { kind: 'Yes', name: 'Da', odds: 3.1, status: true, visible: true, suspended: false },
        { kind: 'No', name: 'Nu', odds: 1.35, status: true, visible: true, suspended: false },
      ],
    },
  ], { homeTeam: 'Alpha', awayTeam: 'Beta' });

  assert.deepEqual(markets.market_marcheaza_home, { yes: 1.4, no: 2.8 });
  assert.deepEqual(markets.market_clean_sheet_away, { yes: 3.1, no: 1.35 });
});

test('normalizes NetBet Asian handicap and period DNB without swallowing FT DNB', () => {
  const markets = normalizeNetBetMarkets([
    {
      market_type: 9101,
      market_code: 'asian_handicap',
      name: 'Handicap asiatic',
      outcomes: [
        { kind: 'Home', name: 'Home (-0.5)', odds: 1.9, status: true, visible: true, suspended: false },
        { kind: 'Away', name: 'Away (+0.5)', odds: 1.9, status: true, visible: true, suspended: false },
      ],
    },
    {
      market_type: 9102,
      market_code: '1st_half_dnb',
      name: 'Fara egal pauza',
      outcomes: [
        { kind: 'W1', name: '1', odds: 1.45, status: true, visible: true, suspended: false },
        { kind: 'W2', name: '2', odds: 2.7, status: true, visible: true, suspended: false },
      ],
    },
  ], { homeTeam: 'Alpha', awayTeam: 'Beta' });

  assert.deepEqual(markets.asianHandicap_minus_0_5, { home: 1.9, away: 1.9 });
  assert.deepEqual(markets.firstHalfDrawNoBet, { home: 1.45, away: 2.7 });
  assert.equal(markets.drawNoBet, undefined);
});

const detailEvent = {
  id: '1-30082331',
  sport_slug: 'football',
  translated_sport_slug: 'fotbal',
  competition_slug: 'china-super-league',
  competition_name: 'Super League',
  starts_at: '2026-07-03T12:00:00.000000Z',
  competitors: [
    { name: 'Yunnan Yukun', is_home: true, team_id: 828906 },
    { name: 'Henan', is_home: false, team_id: 6513 },
  ],
  name: 'Yunnan Yukun vs Henan',
  is_live: false,
  is_suspended: false,
  sportradar: { match_id: 'sr:match:68995220' },
  markets: [
    {
      market_type: 5498,
      market_code: 'default',
      name: 'Rezultat Final',
      outcomes: [
        { kind: 'W1', name: 'Home', odds: 2.3, status: true, visible: true, suspended: false },
        { kind: 'X', name: 'X', odds: 3.33, status: true, visible: true, suspended: false },
        { kind: 'W2', name: 'Away', odds: 2.54, status: true, visible: true, suspended: false },
      ],
    },
    {
      market_type: 5499,
      name: 'Sansa Dubla',
      outcomes: [
        { kind: '1X', name: '1X', odds: 1.43, status: true, visible: true, suspended: false },
        { kind: '12', name: '12', odds: 1.28, status: true, visible: true, suspended: false },
        { kind: 'X2', name: 'X2', odds: 1.52, status: true, visible: true, suspended: false },
      ],
    },
    {
      market_type: 5500,
      market_code: 'total_goals',
      name: 'Total Goluri',
      outcomes: [
        { kind: 'Over', name: 'Peste (2.5)', odds: 1.47, status: true, visible: true, suspended: false },
        { kind: 'Under', name: 'Sub (2.5)', odds: 2.35, status: true, visible: true, suspended: false },
        { kind: 'Over', name: 'Peste (3)', odds: 1.75, status: true, visible: true, suspended: false },
        { kind: 'Under', name: 'Sub (3)', odds: 1.87, status: true, visible: true, suspended: false },
      ],
    },
    {
      market_type: 5508,
      market_code: 'btts',
      name: 'Ambele Marcheaza (GG)',
      outcomes: [
        { kind: 'Yes', name: 'Da', odds: 1.4, status: true, visible: true, suspended: false },
        { kind: 'No', name: 'Nu', odds: 2.56, status: true, visible: true, suspended: false },
      ],
    },
    {
      market_type: 5518,
      name: 'Prima Repriza Rezultat',
      outcomes: [
        { kind: 'W1', name: 'Home', odds: 2.67, status: true, visible: true, suspended: false },
        { kind: 'X', name: 'X', odds: 2.32, status: true, visible: true, suspended: false },
        { kind: 'W2', name: 'Away', odds: 2.91, status: true, visible: true, suspended: false },
      ],
    },
    {
      market_type: 5520,
      name: 'Prima Repriza Total Goluri',
      outcomes: [
        { kind: 'Over', name: 'Peste (1.5)', odds: 2.14, status: true, visible: true, suspended: false },
        { kind: 'Under', name: 'Sub (1.5)', odds: 1.57, status: true, visible: true, suspended: false },
      ],
    },
    {
      market_type: 10047,
      name: 'Total Goluri Asiatice',
      outcomes: [
        { kind: 'Over', name: 'Peste (3.25)', odds: 1.96, status: true, visible: true, suspended: false },
        { kind: 'Under', name: 'Sub (3.25)', odds: 1.68, status: true, visible: true, suspended: false },
      ],
    },
    {
      market_type: 5504,
      name: 'Handicap 1X2',
      outcomes: [
        { kind: 'Home', name: 'Home (-1)', odds: 3.05, status: true, visible: true, suspended: false },
        { kind: 'X', name: 'X (-1)', odds: 3.4, status: true, visible: true, suspended: false },
        { kind: 'Away', name: 'Away (1)', odds: 1.8, status: true, visible: true, suspended: false },
      ],
    },
  ],
};

const listPayload = {
  tree: [
    {
      competitions: [
        {
          id: 1813,
          name: 'Super League',
          slug: 'china-super-league',
          events: [detailEvent],
        },
      ],
    },
  ],
};

test('extracts NetBet football events from the inventory tree', () => {
  const events = extractNetBetEvents(listPayload);

  assert.equal(events.length, 1);
  assert.equal(events[0].competition_name, 'Super League');
  assert.equal(events[0].competition_slug, 'china-super-league');
});

test('extracts NetBet events from nested inventory tree branches', () => {
  const { competition_name, competition_slug, ...nestedEvent } = detailEvent;
  const nestedPayload = {
    tree: [
      {
        name: 'Football',
        children: [
          {
            name: 'Asia',
            regions: [
              {
                competitions: [
                  {
                    name: 'Nested League',
                    slug: 'nested-league',
                    events: [{ ...nestedEvent, id: '1-999' }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  const events = extractNetBetEvents(nestedPayload);

  assert.equal(events.length, 1);
  assert.equal(events[0].competition_name, 'Nested League');
  assert.equal(events[0].competition_slug, 'nested-league');
});

test('normalizes NetBet detailed markets and event links', () => {
  const events = normalizeNetBetPayload([detailEvent], '2026-06-29T10:00:00.000Z');

  assert.deepEqual(events, [
    {
      id: 'netbet:30082331',
      externalIds: {
        netbetEvent: '30082331',
        sportradar: '68995220',
      },
      sport: 'Football',
      competition: 'Super League',
      startsAt: '2026-07-03T12:00:00.000Z',
      homeTeam: 'Yunnan Yukun',
      awayTeam: 'Henan',
      bookmakers: [
        {
          name: 'NetBet',
          lastUpdate: '2026-06-29T10:00:00.000Z',
          eventUrl:
            'https://sport.netbet.ro/fotbal/china-super-league/yunnan-yukun-vs-henan-30082331/',
          bookmakerUrl: 'https://sport.netbet.ro/fotbal/',
          markets: {
            h2h: { home: 2.3, draw: 3.33, away: 2.54 },
            doubleChance: { homeDraw: 1.43, homeAway: 1.28, drawAway: 1.52 },
            totalGoals_2_5: { over: 1.47, under: 2.35 },
            totalGoals_3: { over: 1.75, under: 1.87 },
            bothTeamsToScore: { yes: 1.4, no: 2.56 },
            firstHalfH2h: { home: 2.67, draw: 2.32, away: 2.91 },
            firstHalfTotalGoals_1_5: { over: 2.14, under: 1.57 },
            asianTotalGoals_3_25: { over: 1.96, under: 1.68 },
            handicap3Way_minus_1: { home: 3.05, draw: 3.4, away: 1.8 },
          },
        },
      ],
    },
  ]);
});

test('normalizes NetBet events with dash-separated names when competitors are missing', () => {
  const event = {
    ...detailEvent,
    competitors: [],
    teams: [],
    name: 'Franta - Romania',
  };

  const [normalized] = normalizeNetBetPayload([event], '2026-06-29T10:00:00.000Z');

  assert.equal(normalized.homeTeam, 'Franta');
  assert.equal(normalized.awayTeam, 'Romania');
});

test('keeps extra NetBet markets through the generic normalizer', () => {
  const event = structuredClone(detailEvent);
  event.markets.push({
    market_type: 999999,
    name: 'Home total goals',
    outcomes: [
      { kind: 'Over', name: 'Peste (1.5)', odds: 2.75, status: true, visible: true, suspended: false },
      { kind: 'Under', name: 'Sub (1.5)', odds: 1.48, status: true, visible: true, suspended: false },
    ],
  });

  const [normalized] = normalizeNetBetPayload([event], '2026-06-29T10:00:00.000Z');

  assert.deepEqual(normalized.bookmakers[0].markets.market_total_goluri_home_1_5, {
    over: 2.75,
    under: 1.48,
  });
});

test('loads NetBet inventory and enriches events with detailed markets', async () => {
  const requests = [];
  const provider = new NetBetProvider({
    now: () => new Date('2026-06-29T10:00:00Z'),
    maxDetailEvents: 1,
    fetchImpl: async (url, options) => {
      requests.push({ url: url.toString(), options });
      const body = url.toString().startsWith(NETBET_EVENTS_URL)
        ? listPayload
        : detailEvent;
      return new Response(JSON.stringify(body), { status: 200 });
    },
  });

  const events = await provider.getOdds();

  assert.equal(requests.length, 2);
  assert.ok(requests[0].url.startsWith(NETBET_EVENTS_URL));
  assert.ok(requests[0].url.includes('bookmaker=netbetro'));
  assert.ok(requests[0].url.includes('sport=football'));
  assert.ok(requests[1].url.startsWith(NETBET_MARKETS_URL));
  assert.ok(requests[1].url.includes('event_id=1-30082331'));
  assert.equal(requests[0].options.headers.origin, 'https://sport.netbet.ro');
  assert.equal(events[0].bookmakers[0].name, 'NetBet');
  assert.deepEqual(events[0].bookmakers[0].markets.totalGoals_2_5, {
    over: 1.47,
    under: 2.35,
  });
});
