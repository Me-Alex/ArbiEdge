const test = require('node:test');
const assert = require('node:assert/strict');

const {
  FORTUNA_MATCHES_URL,
  FortunaProvider,
  normalizeFortunaPayload,
} = require('../src/providers/fortuna-provider');
const { ProviderError } = require('../src/providers/the-odds-api-provider');

test('normalizes Fortuna period DC, asian half totals, clean sheets, and team scores', () => {
  const extended = structuredClone(payload);
  extended.markets.push(
    {
      fixtureId: 'ufo:mtch:1tn-00j',
      marketTypeId: 'ufo:mtyp:test-dc1h',
      syntheticGroupKey: '1st_half_double_chance',
      outcomes: [
        { name: '1X', odds: 1.35 },
        { name: '12', odds: 1.4 },
        { name: 'X2', odds: 1.55 },
      ],
    },
    {
      fixtureId: 'ufo:mtch:1tn-00j',
      marketTypeId: 'ufo:mtyp:test-as1h',
      syntheticGroupKey: '1st_half_asian_total_goals',
      outcomes: [
        { name: 'Peste 1.5', odds: 1.9 },
        { name: 'Sub 1.5', odds: 1.85 },
      ],
    },
    {
      fixtureId: 'ufo:mtch:1tn-00j',
      marketTypeId: 'ufo:mtyp:test-cs',
      syntheticGroupKey: 'home_clean_sheet',
      outcomes: [
        { name: 'Da', odds: 2.4 },
        { name: 'Nu', odds: 1.5 },
      ],
    },
    {
      fixtureId: 'ufo:mtch:1tn-00j',
      marketTypeId: 'ufo:mtyp:test-hs',
      syntheticGroupKey: 'gazdele_marcheaza',
      outcomes: [
        { name: 'Da', odds: 1.35 },
        { name: 'Nu', odds: 3.1 },
      ],
    },
  );

  const [event] = normalizeFortunaPayload(extended, '2026-06-29T10:00:00.000Z', drawNoBetPayload);
  const markets = event.bookmakers[0].markets;
  assert.deepEqual(markets.firstHalfDoubleChance, {
    homeDraw: 1.35,
    homeAway: 1.4,
    drawAway: 1.55,
  });
  assert.deepEqual(markets.firstHalfAsianTotalGoals_1_5, { over: 1.9, under: 1.85 });
  assert.deepEqual(markets.market_clean_sheet_home, { yes: 2.4, no: 1.5 });
  assert.deepEqual(markets.market_marcheaza_home, { yes: 1.35, no: 3.1 });
});

const payload = {
  tournaments: [
    {
      id: 'ufo:tour:00-2h1',
      name: 'FIFA World Cup',
    },
  ],
  fixtures: [
    {
      id: 'ufo:mtch:1tn-00j',
      sportId: 'ufo:sprt:00',
      tournamentId: 'ufo:tour:00-2h1',
      name: 'Uruguay - Capul Verde',
      sportSeoName: 'fotbal',
      categorySeoName: 'international-10',
      tournamentSeoName: 'fifa-world-cup',
      seoName: 'uruguay-capul-verde',
      participants: [
        { name: 'Capul Verde', type: 'AWAY' },
        { name: 'Uruguay', type: 'HOME' },
      ],
      startDatetime: 1782079200000,
      marketTypeIds: ['ufo:mtyp:00-00', 'ufo:mtyp:00-03'],
      status: 'ACTIVE',
    },
    {
      id: 'tennis-event',
      sportId: 'ufo:sprt:0x',
      tournamentId: 'tennis-tournament',
      name: 'Player A - Player B',
      participants: [],
      startDatetime: 1782079200000,
      status: 'ACTIVE',
    },
  ],
  markets: [
    {
      fixtureId: 'ufo:mtch:1tn-00j',
      marketTypeId: 'ufo:mtyp:00-00',
      syntheticGroupKey: 'match',
      outcomes: [
        { name: '2', odds: 9.1 },
        { name: 'X', odds: 4.45 },
        { name: '1', odds: 1.41 },
      ],
    },
    {
      fixtureId: 'ufo:mtch:1tn-00j',
      marketTypeId: 'ufo:mtyp:00-1c',
      syntheticGroupKey: 'both_teams_to_score',
      name: 'Ambele marcheaza',
      outcomes: [
        { name: 'Nu', odds: 2.43 },
        { name: 'Da', odds: 1.48 },
      ],
    },
    {
      fixtureId: 'ufo:mtch:1tn-00j',
      marketTypeId: 'ufo:mtyp:00-2n',
      syntheticGroupKey: 'both_teams_to_score_in_1st_half',
      name: 'Prima repriza: ambele marcheaza',
      outcomes: [
        { name: 'Nu', odds: 1.28 },
        { name: 'Da', odds: 3.35 },
      ],
    },
  ],
};

const drawNoBetPayload = {
  'ufo:mtch:1tn-00j': [
    {
      fixtureId: 'ufo:mtch:1tn-00j',
      marketTypeId: 'ufo:mtyp:00-03',
      syntheticGroupKey: 'draw_no_bet',
      outcomes: [
        { name: '1', odds: 1.12 },
        { name: '2', odds: 6.4 },
      ],
    },
  ],
};

const marketsOverviewPayload = {
  'ufo:mtch:1tn-00j': [
    payload.markets[0],
    drawNoBetPayload['ufo:mtch:1tn-00j'][0],
  ],
};

test('normalizes current Fortuna football match and draw-no-bet odds', () => {
  const fetchedAt = '2026-06-21T20:00:00.000Z';

  const events = normalizeFortunaPayload(payload, fetchedAt, drawNoBetPayload);

  assert.deepEqual(events, [
    {
      id: 'fortuna:ufo:mtch:1tn-00j',
      externalIds: { fortunaFixture: 'ufo:mtch:1tn-00j' },
      sport: 'Football',
      competition: 'FIFA World Cup',
      startsAt: '2026-06-21T22:00:00.000Z',
      homeTeam: 'Uruguay',
      awayTeam: 'Capul Verde',
      bookmakers: [
        {
          name: 'Fortuna',
          lastUpdate: fetchedAt,
          eventUrl: 'https://efortuna.ro/pariuri-online/fotbal/international-10/fifa-world-cup/uruguay-capul-verde?filter=all&tab=offer',
          bookmakerUrl: 'https://efortuna.ro/pariuri-online/fotbal',
          markets: {
            h2h: {
              home: 1.41,
              draw: 4.45,
              away: 9.1,
            },
            drawNoBet: {
              home: 1.12,
              away: 6.4,
            },
            bothTeamsToScore: {
              yes: 1.48,
              no: 2.43,
            },
            firstHalfBothTeamsToScore: {
              yes: 3.35,
              no: 1.28,
            },
          },
        },
      ],
    },
  ]);
});

test('keeps Fortuna events that have useful non-result markets without 1X2', () => {
  const nonResultPayload = structuredClone(payload);
  nonResultPayload.markets = nonResultPayload.markets.filter(
    (market) => market.marketTypeId !== 'ufo:mtyp:00-00',
  );

  const [event] = normalizeFortunaPayload(nonResultPayload, '2026-06-21T20:00:00.000Z');

  assert.equal(event.id, 'fortuna:ufo:mtch:1tn-00j');
  assert.equal(event.bookmakers[0].markets.h2h, undefined);
  assert.deepEqual(event.bookmakers[0].markets.bothTeamsToScore, { yes: 1.48, no: 2.43 });
});

test('ignores inactive, non-football, and incomplete fixtures', () => {
  const invalid = structuredClone(payload);
  invalid.fixtures[0].status = 'SUSPENDED';

  assert.deepEqual(
    normalizeFortunaPayload(invalid, '2026-06-21T20:00:00.000Z'),
    [],
  );
});

test('keeps full-match special markets separate from period-specific markets', () => {
  const doubleChancePayload = structuredClone(payload);
  doubleChancePayload.markets.push(
    {
      fixtureId: 'ufo:mtch:1tn-00j',
      marketTypeId: 'ufo:mtyp:00-01',
      syntheticGroupKey: 'match_-_double_chance',
      name: 'Meci - sansa dubla',
      outcomes: [
        { name: '12', odds: 1.48 },
        { name: '1X', odds: 1.63 },
        { name: 'X2', odds: 1.19 },
      ],
    },
    {
      fixtureId: 'ufo:mtch:1tn-00j',
      marketTypeId: 'ufo:mtyp:00-2f',
      syntheticGroupKey: '1st_half_-_double_chance',
      name: 'Prima repriza - sansa dubla',
      outcomes: [
        { name: '12', odds: 3.75 },
        { name: '1X', odds: 1.12 },
        { name: 'X2', odds: 1.03 },
      ],
    },
    {
      fixtureId: 'ufo:mtch:1tn-00j',
      marketTypeId: 'ufo:mtyp:00-0b',
      syntheticGroupKey: 'handicap_/_asian_handicap',
      name: 'Handicap / Handicap asiatic +0.5',
      outcomes: [
        { name: 'Capul Verde -0.5', odds: 2.14 },
        { name: 'Uruguay +0.5', odds: 1.66 },
      ],
    },
    {
      fixtureId: 'ufo:mtch:1tn-00j',
      marketTypeId: 'ufo:mtyp:00-2h',
      syntheticGroupKey: '1st_half_handicap',
      name: 'Prima repriza: handicap',
      outcomes: [
        { name: '1 -0.5', odds: 2.2 },
        { name: '2 +0.5', odds: 1.6 },
      ],
    },
    {
      fixtureId: 'ufo:mtch:1tn-00j',
      marketTypeId: 'ufo:mtyp:00-99',
      syntheticGroupKey: '1st_half_total_corners',
      name: 'Prima repriza total cornere',
      outcomes: [
        { name: '+ 4.5', odds: 2.05 },
        { name: '- 4.5', odds: 1.72 },
      ],
    },
  );

  const [event] = normalizeFortunaPayload(
    doubleChancePayload,
    '2026-06-21T20:00:00.000Z',
  );

  assert.deepEqual(event.bookmakers[0].markets.doubleChance, {
    homeAway: 1.48,
    homeDraw: 1.63,
    drawAway: 1.19,
  });
  assert.deepEqual(event.bookmakers[0].markets.firstHalfDoubleChance, {
    homeAway: 3.75,
    homeDraw: 1.12,
    drawAway: 1.03,
  });
  assert.deepEqual(event.bookmakers[0].markets.asianHandicap_plus_0_5, {
    home: 1.66,
    away: 2.14,
  });
  assert.deepEqual(event.bookmakers[0].markets.market_prima_repriza_handicap, {
    '1_minus0_5': 2.2,
    '2_plus0_5': 1.6,
  });
  assert.equal(event.bookmakers[0].markets.handicap_plus_0_5, undefined);
  assert.equal(event.bookmakers[0].markets.asianHandicap_minus_0_5, undefined);
  assert.deepEqual(event.bookmakers[0].markets.firstHalfTotalCorners_4_5, {
    over: 2.05,
    under: 1.72,
  });
  assert.equal(event.bookmakers[0].markets.totalCorners_4_5, undefined);
});

test('loads and normalizes the current public Fortuna endpoint', async () => {
  const requestedUrls = [];
  const provider = new FortunaProvider({
    now: () => new Date('2026-06-21T20:00:00Z'),
    fetchImpl: async (url) => {
      requestedUrls.push(url.toString());
      const responsePayload = url.toString().includes('/markets/')
        ? marketsOverviewPayload
        : payload;
      return new Response(JSON.stringify(responsePayload), { status: 200 });
    },
  });

  const events = await provider.getOdds();

  assert.match(requestedUrls[0], new RegExp(escapeRegExp(FORTUNA_MATCHES_URL)));
  assert.match(requestedUrls[0], /filter=all/);
  assert.match(requestedUrls[1], /fixtures\/markets\/overview/);
  assert.match(requestedUrls[1], /ufo%3Amtyp%3A00-00/);
  assert.match(requestedUrls[1], /ufo%3Amtyp%3A00-03/);
  assert.equal(events.length, 1);
  assert.equal(events[0].bookmakers[0].name, 'Fortuna');
  assert.deepEqual(events[0].bookmakers[0].markets.drawNoBet, {
    home: 1.12,
    away: 6.4,
  });
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('throws a provider error when Fortuna rejects the request', async () => {
  const provider = new FortunaProvider({
    fetchImpl: async () => new Response('Bad gateway', { status: 502 }),
  });

  await assert.rejects(
    provider.getOdds(),
    (error) =>
      error instanceof ProviderError &&
      error.status === 502 &&
      error.message.includes('502'),
  );
});
