const test = require('node:test');
const assert = require('node:assert/strict');

const {
  STANLEYBET_FAMILY_EVENTS_URL,
  StanleybetFamilyProvider,
  normalizeStanleybetFamilyPayload,
  stanleybetFamilyRequestParams,
} = require('../src/providers/stanleybet-family-provider');

const payload = {
  data: {
    events: [
      {
        id: 25749110,
        displayId: 2350,
        rootEventId: '72377662',
        sportId: 4,
        active: 1,
        categoryName: 'International',
        tournamentName: 'Cupa Mondiala',
        name: 'Brazilia - Norvegia',
        startsAt: '2026-07-05T20:00:00.000Z',
        markets: [
          {
            marketId: 1,
            active: 1,
            name: 'Rezultat Final',
            outcomes: [
              { active: 1, name: '1', shortcut: '1', odd: 1.78 },
              { active: 1, name: 'X', shortcut: '0', odd: 3.75 },
              { active: 1, name: '2', shortcut: '2', odd: 4.7 },
              { active: 1, name: '1X', shortcut: '10', odd: 1.22 },
              { active: 1, name: '12', shortcut: '12', odd: 1.27 },
              { active: 1, name: 'X2', shortcut: '02', odd: 2.04 },
            ],
          },
          {
            marketId: 886,
            active: 1,
            name: 'Total goluri S/P',
            outcomes: [
              { active: 1, name: 'Sub 2.5', shortcut: '1', odd: 1.88 },
              { active: 1, name: 'Peste 2.5', shortcut: '2', odd: 1.95 },
            ],
          },
          {
            marketId: 1099,
            active: 1,
            name: 'Ambele Inscriu',
            outcomes: [
              { active: 1, name: 'Da', shortcut: '1', odd: 1.8 },
              { active: 1, name: 'Nu', shortcut: '2', odd: 1.9 },
            ],
          },
          {
            marketId: 586,
            active: 1,
            name: 'Total goluri par/impar',
            outcomes: [
              { active: 1, name: 'Par', shortcut: '1', odd: 1.85 },
              { active: 1, name: 'Impar', shortcut: '2', odd: 1.9 },
            ],
          },
        ],
      },
      {
        id: 25804430,
        sportId: 16,
        active: 1,
        name: 'Bencic, Belinda - Gauff, Coco',
        startsAt: '2026-07-05T19:25:00.000Z',
        markets: [],
      },
    ],
  },
};

test('normalizes Stanleybet-family football markets', () => {
  const events = normalizeStanleybetFamilyPayload(payload, {
    bookmaker: 'Stanleybet',
    fetchedAt: '2026-07-05T19:00:00.000Z',
    origin: 'https://www.stanleybet.ro',
  });

  assert.deepEqual(events, [
    {
      id: 'stanleybet:25749110',
      externalIds: {
        nsoftEvent: '25749110',
        nsoftRootEvent: '72377662',
      },
      sport: 'Football',
      competition: 'Cupa Mondiala',
      startsAt: '2026-07-05T20:00:00.000Z',
      homeTeam: 'Brazilia',
      awayTeam: 'Norvegia',
      bookmakers: [
        {
          name: 'Stanleybet',
          lastUpdate: '2026-07-05T19:00:00.000Z',
          eventUrl: 'https://www.stanleybet.ro/pariu-sportiv/25749110',
          bookmakerUrl: 'https://www.stanleybet.ro/pariuri-sportive/fotbal',
          markets: {
            h2h: { home: 1.78, draw: 3.75, away: 4.7 },
            doubleChance: { homeDraw: 1.22, homeAway: 1.27, drawAway: 2.04 },
            totalGoals_2_5: { under: 1.88, over: 1.95 },
            bothTeamsToScore: { yes: 1.8, no: 1.9 },
            market_total_goluri_impar_par: { even: 1.85, odd: 1.9 },
          },
        },
      ],
    },
  ]);
});

test('loads the shared NSoft feed once for Stanleybet-family brands', async () => {
  const requests = [];
  const provider = new StanleybetFamilyProvider({
    brands: [
      { name: 'Stanleybet', origin: 'https://www.stanleybet.ro' },
      { name: 'RedSevens', origin: 'https://www.redsevens.ro' },
    ],
    now: () => new Date('2026-07-05T19:00:00Z'),
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify(payload), { status: 200 });
    },
  });

  const events = await provider.getOdds();

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url.origin + requests[0].url.pathname, STANLEYBET_FAMILY_EVENTS_URL);
  assert.equal(requests[0].options.headers.origin, 'https://www.stanleybet.ro');
  assert.equal(requests[0].url.searchParams.get('timezone'), 'Europe/Bucharest');
  assert.deepEqual(
    events[0].bookmakers.map((bookmaker) => ({
      name: bookmaker.name,
      eventUrl: bookmaker.eventUrl,
      bookmakerUrl: bookmaker.bookmakerUrl,
    })),
    [
      {
        name: 'Stanleybet',
        eventUrl: 'https://www.stanleybet.ro/pariu-sportiv/25749110',
        bookmakerUrl: 'https://www.stanleybet.ro/pariuri-sportive/fotbal',
      },
      {
        name: 'RedSevens',
        eventUrl: 'https://www.redsevens.ro/pariu-sportiv/25749110',
        bookmakerUrl: 'https://www.redsevens.ro/pariuri-sportive/fotbal',
      },
    ],
  );
});

test('builds Stanleybet-family request params with Bucharest local timestamps', () => {
  const params = stanleybetFamilyRequestParams({
    now: new Date('2026-07-05T19:00:00Z'),
    lookaheadDays: 2,
  });

  assert.equal(params.get('filter[from]'), '2026-07-05T22:00:00');
  assert.equal(params.get('filter[to]'), '2026-07-07T22:00:00');
  assert.equal(params.get('timezone'), 'Europe/Bucharest');
  assert.deepEqual(JSON.parse(params.get('language')), {
    default: 'ro',
    tournament: 'ro',
    category: 'ro',
    sport: 'ro',
  });
});
