const test = require('node:test');
const assert = require('node:assert/strict');

const { DigitainProvider, normalizeDigitainPayload } = require('../src/providers/digitain-provider');
const { DigitainBrandGroupProvider } = require('../src/providers/digitain-brand-group-provider');
const {
  EIGHT_EIGHT_EIGHT_EVENTS_URL,
  EightEightEightProvider,
} = require('../src/providers/eight-eight-eight-provider');
const { MRPLAY_EVENTS_URL, MrPlayProvider } = require('../src/providers/mrplay-provider');
const {
  NEW_GAMBLING_BRANDS,
  NewGamblingBrandsProvider,
} = require('../src/providers/new-gambling-brands-provider');

const payload = {
  data: {
    events: [
      {
        idMatch: '38638787',
        idSport: '1',
        idCategory: '1239',
        idTournament: '52530',
        active: true,
        bettingStatus: true,
        matchDateTime: 1782675000000,
        tournamentName: { 2: 'Brazil. Seria D', 42: 'Brazilia - Serie D' },
        team1Name: { 2: 'Manauara', 42: 'Manauara' },
        team2Name: { 2: 'Independencia', 42: 'Independencia' },
        matchBets: [
          {
            idBet: '1',
            mbActive: true,
            mbDisplayName: { 2: 'Result', 42: 'Final' },
            mbOutcomes: [
              { mboActive: true, mboType: { 2: '1', 42: '1' }, mboOddValue: 1.13 },
              { mboActive: true, mboType: { 2: 'X', 42: 'X' }, mboOddValue: 6.14 },
              { mboActive: true, mboType: { 2: '2', 42: '2' }, mboOddValue: 15.61 },
            ],
          },
        ],
      },
    ],
  },
};

test('normalizes Digitain football odds for a configured bookmaker', () => {
  const events = normalizeDigitainPayload(payload, {
    bookmaker: '888',
    fetchedAt: '2026-06-21T20:00:00.000Z',
  });

  assert.deepEqual(events, [
    {
      id: '888:38638787',
      externalIds: { digitainMatch: '38638787' },
      sport: 'Football',
      competition: 'Brazilia - Serie D',
      startsAt: '2026-06-28T19:30:00.000Z',
      homeTeam: 'Manauara',
      awayTeam: 'Independencia',
      bookmakers: [
        {
          name: '888',
          lastUpdate: '2026-06-21T20:00:00.000Z',
          bookmakerUrl: 'https://www.888.ro/sport',
          markets: {
            h2h: {
              home: 1.13,
              draw: 6.14,
              away: 15.61,
            },
          },
        },
      ],
    },
  ]);
});

test('loads a configured Digitain provider with brand origin headers', async () => {
  const requests = [];
  const provider = new DigitainProvider({
    name: 'Brand',
    eventsUrl: 'https://example.test/events',
    origin: 'https://brand.test',
    now: () => new Date('2026-06-21T20:00:00Z'),
    fetchImpl: async (url, options) => {
      requests.push({ url: url.toString(), options });
      return new Response(JSON.stringify(payload), { status: 200 });
    },
  });

  const events = await provider.getOdds();

  assert.equal(requests[0].url, 'https://example.test/events');
  assert.equal(requests[0].options.headers.origin, 'https://brand.test');
  assert.equal(requests[0].options.headers.referer, 'https://brand.test/');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    timeFrom: '2026-06-21T20:00:00Z',
    timeTo: '2026-06-29T20:00:00Z',
    sportId: '1',
    firstCall: true,
  });
  assert.equal(events[0].bookmakers[0].name, 'Brand');
  assert.equal(
    events[0].bookmakers[0].eventUrl,
    'https://brand.test/bets/match/pre-match/1/1239/52530/38638787',
  );
});

test('uses configured Digitain lookahead days for the event window', async () => {
  let requestBody;
  const provider = new DigitainProvider({
    name: 'Brand',
    eventsUrl: 'https://example.test/events',
    origin: 'https://brand.test',
    lookaheadDays: 30,
    now: () => new Date('2026-06-21T20:00:00Z'),
    fetchImpl: async (url, options) => {
      requestBody = JSON.parse(options.body);
      return new Response(JSON.stringify(payload), { status: 200 });
    },
  });

  await provider.getOdds();

  assert.equal(requestBody.timeTo, '2026-07-21T20:00:00Z');
});

test('loads Digitain list events in smaller windows to avoid request caps', async () => {
  const requestBodies = [];
  const provider = new DigitainProvider({
    name: 'Brand',
    eventsUrl: 'https://example.test/events',
    origin: 'https://brand.test',
    lookaheadDays: 15,
    windowDays: 7,
    windowConcurrency: 1,
    now: () => new Date('2026-06-21T20:00:00Z'),
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      requestBodies.push(body);
      return new Response(
        JSON.stringify(digitainPayloadForEvent(
          `window-${requestBodies.length}`,
          Date.parse(body.timeFrom) + 60 * 60 * 1000,
        )),
        { status: 200 },
      );
    },
  });

  const events = await provider.getOdds();

  assert.deepEqual(
    requestBodies.map((body) => [body.timeFrom, body.timeTo]),
    [
      ['2026-06-21T20:00:00Z', '2026-06-28T20:00:00Z'],
      ['2026-06-28T20:00:00Z', '2026-07-05T20:00:00Z'],
      ['2026-07-05T20:00:00Z', '2026-07-06T20:00:00Z'],
    ],
  );
  assert.deepEqual(
    events.map((event) => event.externalIds.digitainMatch),
    ['window-1', 'window-2', 'window-3'],
  );
});

test('loads detailed Digitain markets when the list event is truncated', async () => {
  const listPayload = structuredClone(payload);
  listPayload.data.events[0].marketCount = 10;

  const detailPayload = structuredClone(payload);
  detailPayload.data.events[0].matchBets.push({
    idBet: '3',
    mbActive: true,
    mbDisplayName: { 2: 'Total goals', 42: 'Total goluri' },
    mbOutcomes: [
      { mboActive: true, mboType: { 2: 'Over', 42: 'Peste' }, argument: 2.5, mboOddValue: 1.91 },
      { mboActive: true, mboType: { 2: 'Under', 42: 'Sub' }, argument: 2.5, mboOddValue: 1.82 },
    ],
  });

  const requests = [];
  const provider = new DigitainProvider({
    name: 'Brand',
    eventsUrl: 'https://example.test/events',
    origin: 'https://brand.test',
    now: () => new Date('2026-06-21T20:00:00Z'),
    fetchImpl: async (url, options) => {
      requests.push({ url: url.toString(), options });
      const body = JSON.parse(options.body);
      return new Response(JSON.stringify(body.ids ? detailPayload : listPayload), {
        status: 200,
      });
    },
  });

  const events = await provider.getOdds();

  assert.equal(requests.length, 2);
  assert.deepEqual(JSON.parse(requests[1].options.body), { ids: ['38638787'] });
  assert.deepEqual(events[0].bookmakers[0].markets.totalGoals_2_5, {
    over: 1.91,
    under: 1.82,
  });
});

test('normalizes extra Digitain markets for arbitrage scanning', () => {
  const extraPayload = structuredClone(payload);
  extraPayload.data.events[0].matchBets.push(
    {
      idBet: '37',
      mbActive: true,
      mbDisplayName: { 2: 'Double chance', 42: 'Sansa dubla' },
      mbOutcomes: [
        { mboActive: true, mboType: { 2: '1X', 42: '1X' }, mboOddValue: 1.2 },
        { mboActive: true, mboType: { 2: '12', 42: '12' }, mboOddValue: 1.34 },
        { mboActive: true, mboType: { 2: 'X2', 42: 'X2' }, mboOddValue: 2.1 },
      ],
    },
    {
      idBet: '554',
      mbActive: true,
      mbDisplayName: { 2: '1st half - Double chance', 42: 'Prima repriza - Sansa dubla' },
      mbOutcomes: [
        { mboActive: true, mboType: { 2: '1X', 42: '1X' }, mboOddValue: 1.25 },
        { mboActive: true, mboType: { 2: '12', 42: '12' }, mboOddValue: 1.58 },
        { mboActive: true, mboType: { 2: 'X2', 42: 'X2' }, mboOddValue: 1.31 },
      ],
    },
    {
      idBet: '3',
      mbActive: true,
      mbDisplayName: { 2: 'Total goals', 42: 'Total goluri' },
      mbOutcomes: [
        { mboActive: true, mboType: { 2: 'Over', 42: 'Peste' }, argument: 2.5, mboOddValue: 1.91 },
        { mboActive: true, mboType: { 2: 'Under', 42: 'Sub' }, argument: 2.5, mboOddValue: 1.82 },
      ],
    },
    {
      idBet: '26',
      mbActive: true,
      mbDisplayName: { 2: 'Both teams to score', 42: 'Ambele echipe marcheaza (GG)' },
      mbOutcomes: [
        { mboActive: true, mboType: { 2: 'Yes', 42: 'Da' }, mboOddValue: 1.47 },
        { mboActive: true, mboType: { 2: 'No', 42: 'Nu' }, mboOddValue: 2.57 },
      ],
    },
    {
      idBet: '748',
      mbActive: true,
      mbDisplayName: { 2: 'Next goal', 42: 'Urmatorul gol' },
      mbOutcomes: [
        { mboActive: true, mboType: { 2: '1', 42: '1' }, mboOddValue: 2.7 },
        { mboActive: true, mboType: { 2: '2', 42: '2' }, mboOddValue: 3.1 },
        { mboActive: true, mboType: { 2: 'None', 42: 'Niciunul' }, mboOddValue: 4.4 },
      ],
    },
    {
      idBet: '584',
      mbActive: true,
      mbDisplayName: { 2: 'Total goals: Manauara', 42: 'Total goluri: Manauara' },
      mbOutcomes: [
        { mboActive: true, mboType: { 2: 'Over', 42: 'Peste' }, argument: 1.5, mboOddValue: 2.15 },
        { mboActive: true, mboType: { 2: 'Under', 42: 'Sub' }, argument: 1.5, mboOddValue: 1.62 },
      ],
    },
    {
      idBet: '585',
      mbActive: true,
      mbDisplayName: { 2: 'Home total goals', 42: 'Home total goluri' },
      mbOutcomes: [
        { mboActive: true, mboType: { 2: 'Over', 42: 'Peste' }, argument: 2.5, mboOddValue: 4.2 },
        { mboActive: true, mboType: { 2: 'Under', 42: 'Sub' }, argument: 2.5, mboOddValue: 1.18 },
      ],
    },
    {
      idBet: '28',
      mbActive: true,
      mbDisplayName: { 2: 'Away to score', 42: 'Away sa marcheze' },
      mbOutcomes: [
        { mboActive: true, mboType: { 2: 'Yes', 42: 'Da' }, mboOddValue: 1.55 },
        { mboActive: true, mboType: { 2: 'No', 42: 'Nu' }, mboOddValue: 2.35 },
      ],
    },
    {
      idBet: '586',
      mbActive: true,
      mbDisplayName: { 2: 'Total goals odd/even', 42: 'Total goluri par/impar' },
      mbOutcomes: [
        { mboActive: true, mboType: { 2: 'Odd', 42: 'Impar' }, mboOddValue: 1.9 },
        { mboActive: true, mboType: { 2: 'Even', 42: 'Par' }, mboOddValue: 1.85 },
      ],
    },
    {
      idBet: '262063',
      mbActive: true,
      mbDisplayName: {
        2: 'Both teams to score in both halves',
        42: 'Ambele echipe sa marcheze in ambele reprize',
      },
      mbOutcomes: [
        { mboActive: true, mboType: { 2: 'Yes', 42: 'Da' }, mboOddValue: 8.1 },
        { mboActive: true, mboType: { 2: 'No', 42: 'Nu' }, mboOddValue: 1.06 },
      ],
    },
  );

  const [event] = normalizeDigitainPayload(extraPayload, {
    bookmaker: 'Winner',
    fetchedAt: '2026-06-21T20:00:00.000Z',
  });

  assert.deepEqual(event.bookmakers[0].markets.doubleChance, {
    homeDraw: 1.2,
    homeAway: 1.34,
    drawAway: 2.1,
  });
  assert.deepEqual(event.bookmakers[0].markets.firstHalfDoubleChance, {
    homeDraw: 1.25,
    homeAway: 1.58,
    drawAway: 1.31,
  });
  assert.deepEqual(event.bookmakers[0].markets.totalGoals_2_5, {
    over: 1.91,
    under: 1.82,
  });
  assert.deepEqual(event.bookmakers[0].markets.bothTeamsToScore, {
    yes: 1.47,
    no: 2.57,
  });
  assert.deepEqual(event.bookmakers[0].markets.market_urmatorul_gol, {
    home: 2.7,
    away: 3.1,
    none: 4.4,
  });
  assert.deepEqual(event.bookmakers[0].markets.market_total_goluri_home_1_5, {
    over: 2.15,
    under: 1.62,
  });
  assert.deepEqual(event.bookmakers[0].markets.market_total_goluri_home_2_5, {
    over: 4.2,
    under: 1.18,
  });
  assert.deepEqual(event.bookmakers[0].markets.market_marcheaza_away, {
    yes: 1.55,
    no: 2.35,
  });
  assert.deepEqual(event.bookmakers[0].markets.market_total_goluri_impar_par, {
    odd: 1.9,
    even: 1.85,
  });
  assert.deepEqual(event.bookmakers[0].markets.market_ambele_echipe_sa_marcheze_in_ambele_reprize, {
    yes: 8.1,
    no: 1.06,
  });
});

test('normalizes Digitain clean-sheet markets from labels', () => {
  const cleanPayload = structuredClone(payload);
  cleanPayload.data.events[0].matchBets.push({
    idBet: '900',
    mbActive: true,
    mbDisplayName: { 2: 'Home clean sheet', 42: 'Fara gol primit gazde' },
    mbOutcomes: [
      { mboActive: true, mboType: { 2: 'Yes', 42: 'Da' }, mboOddValue: 2.45 },
      { mboActive: true, mboType: { 2: 'No', 42: 'Nu' }, mboOddValue: 1.5 },
    ],
  });

  const [event] = normalizeDigitainPayload(cleanPayload, {
    bookmaker: 'Winner',
    fetchedAt: '2026-06-21T20:00:00.000Z',
  });

  assert.deepEqual(event.bookmakers[0].markets.market_clean_sheet_home, {
    yes: 2.45,
    no: 1.5,
  });
});

test('configures 888 with its public Romanian Digitain endpoint', async () => {
  const requests = [];
  const provider = new EightEightEightProvider({
    fetchImpl: async (url, options) => {
      requests.push({ url: url.toString(), options });
      return new Response(JSON.stringify(payload), { status: 200 });
    },
  });

  await provider.getOdds();

  assert.equal(requests[0].url, EIGHT_EIGHT_EIGHT_EVENTS_URL);
  assert.equal(requests[0].options.headers.origin, 'https://www.888.ro');
});

test('configures MrPlay with its public Romanian Digitain endpoint', async () => {
  const requests = [];
  const provider = new MrPlayProvider({
    fetchImpl: async (url, options) => {
      requests.push({ url: url.toString(), options });
      return new Response(JSON.stringify(payload), { status: 200 });
    },
  });

  await provider.getOdds();

  assert.equal(requests[0].url, MRPLAY_EVENTS_URL);
  assert.equal(requests[0].options.headers.origin, 'https://www.mrplay.ro');
});

test('loads a Digitain feed once for a group of licensed Romanian brands', async () => {
  const requests = [];
  const provider = new DigitainBrandGroupProvider({
    name: 'Brand group',
    eventsUrl: 'https://example.test/events',
    brands: [
      { name: 'Bet7', origin: 'https://www.bet7.ro' },
      { name: 'HotSpins', origin: 'https://www.hotspins.ro' },
    ],
    now: () => new Date('2026-06-21T20:00:00Z'),
    fetchImpl: async (url, options) => {
      requests.push({ url: url.toString(), options });
      return new Response(JSON.stringify(payload), { status: 200 });
    },
  });

  const events = await provider.getOdds();

  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.headers.origin, 'https://www.bet7.ro');
  assert.equal(events.length, 1);
  assert.deepEqual(
    events[0].bookmakers.map((bookmaker) => ({
      name: bookmaker.name,
      eventUrl: bookmaker.eventUrl,
      bookmakerUrl: bookmaker.bookmakerUrl,
    })),
    [
      {
        name: 'Bet7',
        eventUrl: 'https://www.bet7.ro/bets/match/pre-match/1/1239/52530/38638787',
        bookmakerUrl: 'https://www.bet7.ro/sport',
      },
      {
        name: 'HotSpins',
        eventUrl: 'https://www.hotspins.ro/bets/match/pre-match/1/1239/52530/38638787',
        bookmakerUrl: 'https://www.hotspins.ro/sport',
      },
    ],
  );
});

test('configures the verified New Gambling Solutions brand batch', async () => {
  const requests = [];
  const provider = new NewGamblingBrandsProvider({
    fetchImpl: async (url, options) => {
      requests.push({ url: url.toString(), options });
      return new Response(JSON.stringify(payload), { status: 200 });
    },
  });

  const events = await provider.getOdds();

  assert.equal(requests.length, 1);
  assert.deepEqual(
    events[0].bookmakers.map((bookmaker) => bookmaker.name),
    NEW_GAMBLING_BRANDS.map((brand) => brand.name),
  );
});

function digitainPayloadForEvent(idMatch, matchDateTime) {
  const next = structuredClone(payload);
  next.data.events[0].idMatch = idMatch;
  next.data.events[0].matchDateTime = matchDateTime;
  next.data.events[0].team1Name = { 42: `Home ${idMatch}` };
  next.data.events[0].team2Name = { 42: `Away ${idMatch}` };
  return next;
}
