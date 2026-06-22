const test = require('node:test');
const assert = require('node:assert/strict');

const {
  FortunaProvider,
  normalizeFortunaPayload,
} = require('../src/providers/fortuna-provider');
const { ProviderError } = require('../src/providers/the-odds-api-provider');

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
      participants: [
        { name: 'Capul Verde', type: 'AWAY' },
        { name: 'Uruguay', type: 'HOME' },
      ],
      startDatetime: 1782079200000,
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

test('normalizes current Fortuna football match and draw-no-bet odds', () => {
  const fetchedAt = '2026-06-21T20:00:00.000Z';

  const events = normalizeFortunaPayload(payload, fetchedAt, drawNoBetPayload);

  assert.deepEqual(events, [
    {
      id: 'fortuna:ufo:mtch:1tn-00j',
      externalIds: {},
      sport: 'Football',
      competition: 'FIFA World Cup',
      startsAt: '2026-06-21T22:00:00.000Z',
      homeTeam: 'Uruguay',
      awayTeam: 'Capul Verde',
      bookmakers: [
        {
          name: 'Fortuna',
          lastUpdate: fetchedAt,
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
          },
        },
      ],
    },
  ]);
});

test('ignores inactive, non-football, and incomplete fixtures', () => {
  const invalid = structuredClone(payload);
  invalid.fixtures[0].status = 'SUSPENDED';

  assert.deepEqual(
    normalizeFortunaPayload(invalid, '2026-06-21T20:00:00.000Z'),
    [],
  );
});

test('loads and normalizes the current public Fortuna endpoint', async () => {
  const requestedUrls = [];
  const provider = new FortunaProvider({
    now: () => new Date('2026-06-21T20:00:00Z'),
    fetchImpl: async (url) => {
      requestedUrls.push(url.toString());
      const responsePayload = url.toString().includes('/markets/')
        ? drawNoBetPayload
        : payload;
      return new Response(JSON.stringify(responsePayload), { status: 200 });
    },
  });

  const events = await provider.getOdds();

  assert.equal(
    requestedUrls[0],
    'https://api.efortuna.ro/offer/structure/api/v1_0/widget/upcoming',
  );
  assert.match(requestedUrls[1], /fixtures\/markets\/overview/);
  assert.match(requestedUrls[1], /marketTypeIds=ufo%3Amtyp%3A00-03/);
  assert.equal(events.length, 1);
  assert.equal(events[0].bookmakers[0].name, 'Fortuna');
  assert.deepEqual(events[0].bookmakers[0].markets.drawNoBet, {
    home: 1.12,
    away: 6.4,
  });
});

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
