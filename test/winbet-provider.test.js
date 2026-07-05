const test = require('node:test');
const assert = require('node:assert/strict');

const { EGT_MARKET_TEMPLATES } = require('../src/providers/egt-provider');
const {
  WINBET_API_BASE_URL,
  WINBET_ORIGIN,
  WinbetProvider,
} = require('../src/providers/winbet-provider');

const sportsPayload = [
  {
    id: 1001,
    name: 'Fotbal',
    data: [
      {
        id: 10004,
        name: 'International',
        data: [{ id: 19000000016, name: 'Cupa Mondiala 2026', eventsCount: 1 }],
      },
    ],
  },
];

const eventsPayload = {
  events: {
    50006873979: {
      sportEventId: 50006873979,
      eventTitle: 'Brazilia vs. Japonia',
      eventPath: 'Brazil vs. Japan',
      sportEventType: 'match',
      sportId: 1001,
      tournamentName: 'Cupa Mondiala 2026',
      homeTeam: 'Brazilia',
      awayTeam: 'Japonia',
      hasActiveMarkets: true,
      isProducerDown: false,
      startTime: '2026-06-29T19:00:00Z',
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
      ],
    },
  },
};

test('configures Winbet with its Romanian EGT endpoint', async () => {
  const requests = [];
  const provider = new WinbetProvider({
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

  assert.equal(provider.name, 'Winbet');
  assert.equal(requests[0].url, `${WINBET_API_BASE_URL}/api/sportsapi/public/sports`);
  assert.equal(requests[0].options.headers['x-platform-origin'], WINBET_ORIGIN);
  assert.equal(events[0].bookmakers[0].name, 'Winbet');
  assert.equal(events[0].bookmakers[0].bookmakerUrl, 'https://winbet.ro/sports');
  assert.equal(
    events[0].bookmakers[0].eventUrl,
    'https://winbet.ro/sports/event/brazil-vs-japan-50006873979',
  );
});
