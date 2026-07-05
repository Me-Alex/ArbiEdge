const test = require('node:test');
const assert = require('node:assert/strict');

const { LasVegasProvider } = require('../src/providers/lasvegas-provider');
const {
  XSportProvider,
  formatXsportDate,
  normalizeXsportPayload,
} = require('../src/providers/xsport-provider');

const payload = {
  avs: {
    avs: [
      {
        p: 26270,
        a: 1758,
        bid: 71775942,
        dsl: {
          RO: 'FBC Melgar - CD Moquegua',
          EN: 'FBC Melgar - CD Moquegua',
        },
        ts: '20260629 18:00:00',
        lv: false,
        ic: 20,
        it: 190934,
        scs: [
          {
            cs: 3,
            d: 'FINAL',
            eqs: [
              { ce: 1, q: 270 },
              { ce: 2, q: 335 },
              { ce: 3, q: 245 },
            ],
          },
          {
            cs: 15,
            d: 'DOUBLE CHANCE',
            eqs: [
              { ce: 1, q: 150 },
              { ce: 2, q: 245 },
            ],
          },
          {
            cs: 16,
            d: 'DOUBLE CHANCE',
            eqs: [
              { ce: 1, q: 270 },
              { ce: 2, q: 142 },
            ],
          },
          {
            cs: 17,
            d: 'DOUBLE CHANCE',
            eqs: [
              { ce: 1, q: 335 },
              { ce: 2, q: 128 },
            ],
          },
        ],
      },
    ],
  },
  dts: {
    RO_190934: 'Copa de la Liga - Gr. H',
  },
};

test('normalizes XSport football odds and LasVegas event links', () => {
  const events = normalizeXsportPayload(payload, {
    bookmaker: 'LasVegas',
    fetchedAt: '2026-06-29T10:00:00.000Z',
    eventOrigin: 'https://www.lasvegas.ro',
  });

  assert.deepEqual(events, [
    {
      id: 'lasvegas:26270:1758',
      externalIds: {
        xsportFixture: '26270:1758',
        xsportPalinsesto: '26270',
        xsportEvent: '1758',
        sportradar: '71775942',
      },
      sport: 'Football',
      competition: 'Copa de la Liga - Gr. H',
      startsAt: '2026-06-29T18:00:00.000Z',
      homeTeam: 'FBC Melgar',
      awayTeam: 'CD Moquegua',
      bookmakers: [
        {
          name: 'LasVegas',
          lastUpdate: '2026-06-29T10:00:00.000Z',
          eventUrl:
            'https://www.lasvegas.ro/sport/fotbal/copa-de-la-liga-gr-h/fbc-melgar-cd-moquegua_1_20_190934_26270_1758',
          bookmakerUrl: 'https://www.lasvegas.ro/sport',
          markets: {
            h2h: { home: 2.7, draw: 3.35, away: 2.45 },
            doubleChance: { homeDraw: 1.5, drawAway: 1.42, homeAway: 1.28 },
          },
        },
      ],
    },
  ]);
});

test('normalizes XSport events with vs-separated fixture labels', () => {
  const nextPayload = structuredClone(payload);
  nextPayload.avs.avs[0].dsl = {
    RO: 'FBC Melgar vs CD Moquegua',
    EN: 'FBC Melgar vs CD Moquegua',
  };

  const [event] = normalizeXsportPayload(nextPayload, {
    bookmaker: 'LasVegas',
    fetchedAt: '2026-06-29T10:00:00.000Z',
    eventOrigin: 'https://www.lasvegas.ro',
  });

  assert.equal(event.homeTeam, 'FBC Melgar');
  assert.equal(event.awayTeam, 'CD Moquegua');
});

test('loads XSport payloads for each configured lookahead day', async () => {
  const requests = [];
  const provider = new XSportProvider({
    name: 'LasVegas',
    apiBaseUrl: 'https://api.example.test',
    eventOrigin: 'https://www.lasvegas.ro',
    systemCode: 'LASVEGAS',
    lookaheadDays: 2,
    maxDetailEvents: 0,
    now: () => new Date('2026-06-29T10:00:00Z'),
    fetchImpl: async (url, options) => {
      requests.push({ url: url.toString(), options });
      return new Response(JSON.stringify(payload), { status: 200 });
    },
  });

  const events = await provider.getOdds();

  assert.equal(requests.length, 2);
  assert.ok(requests[0].url.includes('data=20260629'));
  assert.ok(requests[1].url.includes('data=20260630'));
  assert.ok(requests[0].url.includes('idSport=1'));
  assert.ok(requests[0].url.includes('idAggregata=1'));
  assert.equal(requests[0].options.headers.accept, '*/*');
  assert.equal(events.length, 2);
});

test('keeps XSport events when one lookahead day returns invalid data', async () => {
  const requests = [];
  const provider = new XSportProvider({
    name: 'LasVegas',
    apiBaseUrl: 'https://api.example.test',
    eventOrigin: 'https://www.lasvegas.ro',
    systemCode: 'LASVEGAS',
    lookaheadDays: 2,
    maxDetailEvents: 0,
    now: () => new Date('2026-06-29T10:00:00Z'),
    fetchImpl: async (url, options) => {
      requests.push({ url: url.toString(), options });
      const date = new URL(url).searchParams.get('data');
      if (date === '20260630') {
        return new Response('<html>temporarily unavailable</html>', { status: 200 });
      }
      return new Response(JSON.stringify(payload), { status: 200 });
    },
  });

  const events = await provider.getOdds();

  assert.equal(requests.length, 2);
  assert.equal(events.length, 1);
  assert.equal(events[0].bookmakers[0].name, 'LasVegas');
});

test('loads XSport event details for additional LasVegas markets', async () => {
  const detail = {
    p: 26270,
    a: 1758,
    ts: '20260629 18:00:00',
    sh: true,
    scs: [
      ...payload.avs.avs[0].scs,
      {
        cs: 14,
        d: '1ST HALF',
        eqs: [
          { ce: 1, q: 220 },
          { ce: 2, q: 195 },
          { ce: 3, q: 310 },
        ],
      },
      {
        cs: 7989,
        d: 'TOTAL GOALS',
        h: 250,
        eqs: [
          { ce: 1, q: 184 },
          { ce: 2, q: 180 },
        ],
      },
      {
        cs: 18,
        d: 'BOTH TEAMS TO SCORE',
        eqs: [
          { ce: 1, q: 169 },
          { ce: 2, q: 196 },
        ],
      },
      {
        cs: 19,
        d: 'ODD/EVEN',
        eqs: [
          { ce: 1, q: 177 },
          { ce: 2, q: 187 },
        ],
      },
      {
        cs: 1749,
        d: 'HOME TOTAL',
        h: 150,
        eqs: [
          { ce: 1, q: 134 },
          { ce: 2, q: 280 },
        ],
      },
      {
        cs: 1750,
        d: 'AWAY TOTAL',
        h: 150,
        eqs: [
          { ce: 1, q: 174 },
          { ce: 2, q: 191 },
        ],
      },
      {
        cs: 60011,
        d: 'DRAW NO BET',
        eqs: [
          { ce: 1, q: 250 },
          { ce: 2, q: 143 },
        ],
      },
      {
        cs: 60016,
        d: 'ASIAN HANDICAP',
        h: 50,
        eqs: [
          { ce: 1, q: 172 },
          { ce: 2, q: 186 },
        ],
      },
      {
        cs: 8,
        d: 'HANDICAP',
        h: -100,
        eqs: [
          { ce: 1, q: 211 },
          { ce: 2, q: 410 },
          { ce: 3, q: 260 },
        ],
      },
      {
        cs: 975,
        d: 'TOTAL CORNERS',
        h: 950,
        eqs: [
          { ce: 1, q: 210 },
          { ce: 2, q: 165 },
        ],
      },
    ],
  };
  const requests = [];
  const provider = new XSportProvider({
    name: 'LasVegas',
    apiBaseUrl: 'https://api.example.test',
    eventOrigin: 'https://www.lasvegas.ro',
    systemCode: 'LASVEGAS',
    lookaheadDays: 1,
    now: () => new Date('2026-06-29T10:00:00Z'),
    fetchImpl: async (url, options) => {
      requests.push({ url: url.toString(), options });
      if (url.pathname.endsWith('/getEvento')) {
        return new Response(JSON.stringify(detail), { status: 200 });
      }
      return new Response(JSON.stringify(payload), { status: 200 });
    },
  });

  const [event] = await provider.getOdds();
  const markets = event.bookmakers[0].markets;

  assert.equal(requests.length, 2);
  assert.ok(requests[1].url.includes('idAggregata=-1'));
  assert.deepEqual(markets.firstHalfH2h, { home: 2.2, draw: 1.95, away: 3.1 });
  assert.deepEqual(markets.totalGoals_2_5, { under: 1.84, over: 1.8 });
  assert.deepEqual(markets.bothTeamsToScore, { yes: 1.69, no: 1.96 });
  assert.deepEqual(markets.market_total_goluri_impar_par, { odd: 1.77, even: 1.87 });
  assert.deepEqual(markets.market_total_goluri_home_1_5, { under: 1.34, over: 2.8 });
  assert.deepEqual(markets.market_total_goluri_away_1_5, { under: 1.74, over: 1.91 });
  assert.deepEqual(markets.drawNoBet, { home: 2.5, away: 1.43 });
  assert.deepEqual(markets.asianHandicap_plus_0_5, { home: 1.72, away: 1.86 });
  assert.deepEqual(markets.handicap_minus_1, { home: 2.11, draw: 4.1, away: 2.6 });
  assert.deepEqual(markets.totalCorners_9_5, { under: 2.1, over: 1.65 });
});

test('formats XSport dates as UTC calendar days', () => {
  assert.equal(formatXsportDate(new Date('2026-06-29T23:30:00Z')), '20260629');
});

test('configures LasVegas with the public XSport endpoint', async () => {
  const requests = [];
  const provider = new LasVegasProvider({
    lookaheadDays: 1,
    maxDetailEvents: 0,
    now: () => new Date('2026-06-29T10:00:00Z'),
    fetchImpl: async (url, options) => {
      requests.push({ url: url.toString(), options });
      return new Response(JSON.stringify(payload), { status: 200 });
    },
  });

  await provider.getOdds();

  assert.equal(provider.name, 'LasVegas');
  assert.ok(requests[0].url.startsWith('https://exalogic.lasvegas.ro/XSportDatastore/'));
  assert.ok(requests[0].url.includes('systemCode=LASVEGAS'));
});
