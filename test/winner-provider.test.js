const test = require('node:test');
const assert = require('node:assert/strict');

const {
  WINNER_EVENTS_URL,
  WinnerProvider,
  normalizeWinnerPayload,
} = require('../src/providers/winner-provider');
const { ProviderError } = require('../src/providers/the-odds-api-provider');

const payload = {
  data: {
    events: [
      {
        idMatch: '38658987',
        idSport: '1',
        idCategory: '1239',
        idTournament: '52530',
        active: true,
        bettingStatus: true,
        matchDateTime: 1782648000000,
        tournamentName: { 2: 'Lithuania. 2nd League', 42: 'Lituania - Liga 2' },
        team1Name: { 2: 'Suduva Marijampole II', 42: 'Suduva Marijampole II' },
        team2Name: { 2: 'FK Neptunas Klaipeda II', 42: 'FK Neptunas Klaipeda II' },
        matchBets: [
          {
            idBet: '1',
            mbActive: true,
            mbDisplayName: { 2: 'Result', 42: 'Final' },
            mbOutcomes: [
              {
                mboActive: true,
                mboType: { 2: '1', 42: '1' },
                mboOddValue: 1.93,
              },
              {
                mboActive: true,
                mboType: { 2: 'X', 42: 'X' },
                mboOddValue: 4.03,
              },
              {
                mboActive: true,
                mboType: { 2: '2', 42: '2' },
                mboOddValue: 2.85,
              },
            ],
          },
        ],
      },
    ],
  },
};

test('normalizes Winner football final-result odds', () => {
  const events = normalizeWinnerPayload(payload, '2026-06-21T20:00:00.000Z');

  assert.deepEqual(events, [
    {
      id: 'winner:38658987',
      externalIds: { digitainMatch: '38658987' },
      sport: 'Football',
      competition: 'Lituania - Liga 2',
      startsAt: '2026-06-28T12:00:00.000Z',
      homeTeam: 'Suduva Marijampole II',
      awayTeam: 'FK Neptunas Klaipeda II',
      bookmakers: [
        {
          name: 'Winner',
          lastUpdate: '2026-06-21T20:00:00.000Z',
          eventUrl: 'https://www.winner.ro/bets/match/pre-match/1/1239/52530/38658987',
          bookmakerUrl: 'https://www.winner.ro/sport/fotbal',
          markets: {
            h2h: {
              home: 1.93,
              draw: 4.03,
              away: 2.85,
            },
          },
        },
      ],
    },
  ]);
});

test('loads Winner through the public Digitain event endpoint', async () => {
  const requests = [];
  const provider = new WinnerProvider({
    now: () => new Date('2026-06-21T20:00:00Z'),
    fetchImpl: async (url, options) => {
      requests.push({ url: url.toString(), options });
      return new Response(JSON.stringify(payload), { status: 200 });
    },
  });

  const events = await provider.getOdds();

  assert.equal(requests[0].url, WINNER_EVENTS_URL);
  assert.equal(requests[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    timeFrom: '2026-06-21T20:00:00Z',
    timeTo: '2026-06-29T20:00:00Z',
    sportId: '1',
    firstCall: true,
  });
  assert.equal(events[0].bookmakers[0].name, 'Winner');
});

test('throws a provider error when Winner rejects the request', async () => {
  const provider = new WinnerProvider({
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
