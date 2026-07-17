const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MATCH_MARKET_TYPE_ID,
  UfoProvider,
  normalizeUfoPayload,
} = require('../src/providers/ufo-provider');

function fixture(overrides = {}) {
  return {
    id: 'fixture-1',
    sportId: 'ufo:sprt:00',
    status: 'ACTIVE',
    tournamentId: 'tournament-1',
    startDatetime: '2026-07-15T18:00:00Z',
    sportSeoName: 'fotbal',
    categorySeoName: 'romania',
    tournamentSeoName: 'liga-1',
    seoName: 'cfr-cluj-fcsb',
    sportradarIds: ['sr:match:1'],
    participants: [
      { type: 'HOME', name: 'CFR Cluj' },
      { type: 'AWAY', name: 'FCSB' },
    ],
    marketTypeIds: [MATCH_MARKET_TYPE_ID],
    ...overrides,
  };
}

function h2hMarket(overrides = {}) {
  return {
    id: 'market-1',
    fixtureId: 'fixture-1',
    marketTypeId: MATCH_MARKET_TYPE_ID,
    outcomes: [
      { name: '1', odds: 2.1 },
      { name: 'X', odds: 3.3 },
      { name: '2', odds: 3.7 },
    ],
    ...overrides,
  };
}

test('normalizeUfoPayload converts active football fixtures into normalized events', () => {
  const events = normalizeUfoPayload({
    tournaments: [{ id: 'tournament-1', name: 'Liga 1' }],
    fixtures: [
      fixture(),
      fixture({ id: 'inactive', status: 'INACTIVE' }),
    ],
    markets: [h2hMarket()],
  }, {
    bookmaker: 'Casa Pariurilor',
    fetchedAt: '2026-07-13T10:00:00.000Z',
  });

  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    id: 'casa-pariurilor:fixture-1',
    externalIds: {
      'casa-pariurilorFixture': 'fixture-1',
      sportradar: 'sr:match:1',
    },
    sport: 'Football',
    competition: 'Liga 1',
    startsAt: '2026-07-15T18:00:00.000Z',
    homeTeam: 'CFR Cluj',
    awayTeam: 'FCSB',
    bookmakers: [{
      name: 'Casa Pariurilor',
      lastUpdate: '2026-07-13T10:00:00.000Z',
      eventUrl: 'https://www.casapariurilor.ro/pariuri-online/fotbal/romania/liga-1/cfr-cluj-fcsb?filter=all&tab=offer',
      bookmakerUrl: 'https://www.casapariurilor.ro/pariuri-online/fotbal',
      markets: {
        h2h: { home: 2.1, draw: 3.3, away: 3.7 },
      },
    }],
  });
});

test('normalizes UFO period DC, asian half totals, clean sheets, and RO score labels', () => {
  const events = normalizeUfoPayload({
    tournaments: [{ id: 'tournament-1', name: 'Liga 1' }],
    fixtures: [fixture()],
    markets: [
      h2hMarket(),
      {
        id: 'm-dc',
        fixtureId: 'fixture-1',
        marketTypeId: 'ufo:mtyp:test-dc1h',
        syntheticGroupKey: '1st_half_double_chance',
        outcomes: [
          { name: '1X', odds: 1.32 },
          { name: '12', odds: 1.38 },
          { name: 'X2', odds: 1.5 },
        ],
      },
      {
        id: 'm-as',
        fixtureId: 'fixture-1',
        marketTypeId: 'ufo:mtyp:test-as1h',
        syntheticGroupKey: '1st_half_asian_total_goals',
        outcomes: [
          { name: 'Peste 0.5', odds: 1.7 },
          { name: 'Sub 0.5', odds: 2.1 },
        ],
      },
      {
        id: 'm-cs',
        fixtureId: 'fixture-1',
        marketTypeId: 'ufo:mtyp:test-cs',
        syntheticGroupKey: 'away_clean_sheet',
        outcomes: [
          { name: 'Da', odds: 3.2 },
          { name: 'Nu', odds: 1.3 },
        ],
      },
      {
        id: 'm-hs',
        fixtureId: 'fixture-1',
        marketTypeId: 'ufo:mtyp:test-hs',
        syntheticGroupKey: 'gazdele_marcheaza',
        outcomes: [
          { name: 'Da', odds: 1.4 },
          { name: 'Nu', odds: 2.8 },
        ],
      },
    ],
  }, {
    bookmaker: 'Casa Pariurilor',
    fetchedAt: '2026-07-13T10:00:00.000Z',
  });

  const markets = events[0].bookmakers[0].markets;
  assert.deepEqual(markets.firstHalfDoubleChance, {
    homeDraw: 1.32,
    homeAway: 1.38,
    drawAway: 1.5,
  });
  assert.deepEqual(markets.firstHalfAsianTotalGoals_0_5, { over: 1.7, under: 2.1 });
  assert.deepEqual(markets.market_clean_sheet_away, { yes: 3.2, no: 1.3 });
  assert.deepEqual(markets.market_marcheaza_home, { yes: 1.4, no: 2.8 });
});

test('UfoProvider fetches fixture pages and overview markets before normalizing odds', async () => {
  const requests = [];
  const provider = new UfoProvider({
    name: 'Casa Pariurilor',
    baseUrl: 'https://book.test',
    now: () => new Date('2026-07-13T10:00:00Z'),
    fetchImpl: async (url) => {
      const requestUrl = url.toString();
      requests.push(requestUrl);
      if (requestUrl.includes('/structure/api/')) {
        return new Response(JSON.stringify({
          pagingInfo: { pageCount: 1 },
          tournaments: [{ id: 'tournament-1', name: 'Liga 1' }],
          fixtures: [fixture()],
        }), { status: 200 });
      }
      return new Response(JSON.stringify([h2hMarket()]), { status: 200 });
    },
  });

  const events = await provider.getOdds();

  assert.equal(events.length, 1);
  assert.equal(events[0].bookmakers[0].name, 'Casa Pariurilor');
  assert.equal(requests.some((url) => url.includes('/structure/api/v1_0/sport/ufo:sprt:00/matches')), true);
  assert.equal(requests.some((url) => url.includes('/markets/api/v1_0/fixtures/markets/overview')), true);
  assert.equal(requests.some((url) => url.includes('fixtureIds=fixture-1')), true);
  assert.equal(requests.some((url) => url.includes(`marketTypeIds=${encodeURIComponent(MATCH_MARKET_TYPE_ID)}`)), true);
});
