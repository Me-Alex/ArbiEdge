const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAXBET_EVENTS_URL,
  MAXBET_PAGE_URL,
  MaxBetProvider,
  extractMaxBetEventsPayload,
  normalizeMaxBetPayload,
} = require('../src/providers/maxbet-provider');

const payload = {
  events: [
    {
      a: 10287484,
      q: '72408722',
      b: 2,
      c: 650,
      d: 'China',
      f: 1634,
      g: 'Super League (F)',
      j: 'Guangdong Meizhou Hakka FC - Wuhan Jiangda',
      l: 1,
      n: '2026-06-29T11:00:00.000Z',
      o: [
        {
          b: 2,
          d: 1,
          c: 'Final',
          h: [
            { c: 1, e: '1', g: 5.8 },
            { c: 1, e: 'X', g: 3.6 },
            { c: 1, e: '2', g: 1.49 },
            { c: 1, e: '1X', g: 1.7 },
            { c: 1, e: '12', g: 1.14 },
            { c: 1, e: 'X2', g: 1.07 },
          ],
        },
        {
          b: 1547,
          d: 1,
          c: 'Total goluri',
          g: ['2.5'],
          h: [
            { c: 1, e: 'Peste 2.5', g: 1.98 },
            { c: 1, e: 'Sub 2.5', g: 1.68 },
          ],
        },
        {
          b: 1709,
          d: 1,
          c: 'Ambele marcheaza',
          h: [
            { c: 1, e: 'Da', g: 1.69 },
            { c: 1, e: 'Nu', g: 1.96 },
          ],
        },
        {
          b: 2160,
          d: 1,
          c: 'Par/Impar',
          h: [
            { c: 1, e: 'Par', g: 1.77 },
            { c: 1, e: 'Impar', g: 1.86 },
          ],
        },
      ],
      p: [
        { c: 1, d: 'F/Guangdong Meizhou H.' },
        { c: 2, d: 'F/Wuhan Jianghan Univ.' },
      ],
    },
  ],
};

function htmlWithState(body = payload, url = MAXBET_EVENTS_URL) {
  return `<html><body><script id="ng-state" type="application/json">${JSON.stringify({
    123: {
      b: { data: body },
      h: {},
      s: 200,
      st: 'OK',
      u: url,
      rt: 'json',
    },
  })}</script></body></html>`;
}

function htmlWithStates(bodies, url = MAXBET_EVENTS_URL) {
  const state = Object.fromEntries(
    bodies.map((body, index) => [
      String(index + 1),
      {
        b: { data: body },
        h: {},
        s: 200,
        st: 'OK',
        u: url,
        rt: 'json',
      },
    ]),
  );
  return `<html><body><script id="ng-state" type="application/json">${JSON.stringify(state)}</script></body></html>`;
}

test('extracts MaxBet events from Angular state', () => {
  assert.deepEqual(extractMaxBetEventsPayload(htmlWithState()), payload);
});

test('normalizes MaxBet clean sheets and team totals', () => {
  const teamPayload = {
    events: [
      {
        a: 2,
        q: '2',
        b: 2,
        c: 1,
        d: 'RO',
        f: 1,
        g: 'Liga 1',
        j: 'Alpha - Beta',
        l: 1,
        n: '2026-07-18T19:00:00.000Z',
        o: [
          {
            b: 2,
            d: 1,
            c: 'Final',
            h: [
              { c: 1, e: '1', g: 2.1 },
              { c: 1, e: 'X', g: 3.2 },
              { c: 1, e: '2', g: 3.4 },
            ],
          },
          {
            b: 9101,
            d: 1,
            c: 'Fara gol primit gazde',
            h: [
              { c: 1, e: 'Da', g: 2.5 },
              { c: 1, e: 'Nu', g: 1.48 },
            ],
          },
          {
            b: 9102,
            d: 1,
            c: 'Total goluri oaspeti',
            g: ['1.5'],
            h: [
              { c: 1, e: 'Peste 1.5', g: 2.2 },
              { c: 1, e: 'Sub 1.5', g: 1.65 },
            ],
          },
        ],
        p: [
          { c: 1, d: 'Alpha' },
          { c: 2, d: 'Beta' },
        ],
      },
    ],
  };

  const [event] = normalizeMaxBetPayload(teamPayload, '2026-07-18T10:00:00.000Z');
  assert.ok(event);
  assert.deepEqual(event.bookmakers[0].markets.market_clean_sheet_home, { yes: 2.5, no: 1.48 });
  assert.deepEqual(event.bookmakers[0].markets.market_total_goluri_away_1_5, { over: 2.2, under: 1.65 });
});

test('normalizes MaxBet period DNB, DC, and second-half totals', () => {
  const periodPayload = {
    events: [
      {
        a: 1,
        q: '1',
        b: 2,
        c: 1,
        d: 'RO',
        f: 1,
        g: 'Liga 1',
        j: 'Team A - Team B',
        l: 1,
        n: '2026-07-18T18:00:00.000Z',
        o: [
          {
            b: 9001,
            d: 1,
            c: 'Fara egal pauza',
            h: [
              { c: 1, e: '1', g: 1.45 },
              { c: 1, e: '2', g: 2.7 },
            ],
          },
          {
            b: 9002,
            d: 1,
            c: 'Sansa dubla a doua repriza',
            h: [
              { c: 1, e: '1X', g: 1.35 },
              { c: 1, e: '12', g: 1.4 },
              { c: 1, e: 'X2', g: 1.5 },
            ],
          },
          {
            b: 9003,
            d: 1,
            c: 'Total goluri a doua repriza',
            g: ['1.5'],
            h: [
              { c: 1, e: 'Peste 1.5', g: 1.9 },
              { c: 1, e: 'Sub 1.5', g: 1.85 },
            ],
          },
        ],
        p: [
          { c: 1, d: 'Team A' },
          { c: 2, d: 'Team B' },
        ],
      },
    ],
  };

  const [event] = normalizeMaxBetPayload(periodPayload, '2026-07-18T10:00:00.000Z');
  assert.ok(event, 'expected normalized MaxBet event with period markets');
  assert.deepEqual(event.bookmakers[0].markets.firstHalfDrawNoBet, { home: 1.45, away: 2.7 });
  assert.deepEqual(event.bookmakers[0].markets.secondHalfDoubleChance, {
    homeDraw: 1.35,
    homeAway: 1.4,
    drawAway: 1.5,
  });
  assert.deepEqual(event.bookmakers[0].markets.secondHalfTotalGoals_1_5, { over: 1.9, under: 1.85 });
});

test('extracts MaxBet events when Angular state caches a query-string URL', () => {
  assert.deepEqual(
    extractMaxBetEventsPayload(htmlWithState(payload, `${MAXBET_EVENTS_URL}?lang=ro`)),
    payload,
  );
});

test('prefers full MaxBet legacy odds payload when Angular state has smaller event previews', () => {
  const previewPayload = {
    events: [
      {
        id: 10312912,
        sportId: 2,
        name: 'Mexico - England',
        startsAt: '2026-07-06T00:00:00.000Z',
        markets: [],
        competitors: [],
      },
    ],
  };
  const secondPreviewPayload = {
    events: Array.from({ length: 7 }, (_, index) => ({
      id: 10306771 + index,
      sportId: 2,
      name: `Preview ${index}`,
      startsAt: '2026-07-06T00:00:00.000Z',
      markets: [],
      competitors: [],
    })),
  };

  assert.deepEqual(
    extractMaxBetEventsPayload(htmlWithStates([previewPayload, secondPreviewPayload, payload])),
    payload,
  );
});

test('normalizes MaxBet football markets', () => {
  const events = normalizeMaxBetPayload(payload, '2026-06-29T10:00:00.000Z');

  assert.deepEqual(events, [
    {
      id: 'maxbet:10287484',
      externalIds: {
        maxbetEvent: '10287484',
        nsoftRootEvent: '72408722',
      },
      sport: 'Football',
      competition: 'Super League (F)',
      startsAt: '2026-06-29T11:00:00.000Z',
      homeTeam: 'Guangdong Meizhou H.',
      awayTeam: 'Wuhan Jianghan Univ.',
      bookmakers: [
        {
          name: 'MaxBet',
          lastUpdate: '2026-06-29T10:00:00.000Z',
          eventUrl: 'https://www.maxbet.ro/ro/pariuri-sportive/eveniment/10287484',
          bookmakerUrl: 'https://www.maxbet.ro/ro/pariuri-sportive',
          markets: {
            h2h: { home: 5.8, draw: 3.6, away: 1.49 },
            doubleChance: { homeDraw: 1.7, homeAway: 1.14, drawAway: 1.07 },
            totalGoals_2_5: { over: 1.98, under: 1.68 },
            bothTeamsToScore: { yes: 1.69, no: 1.96 },
            market_total_goluri_impar_par: { even: 1.77, odd: 1.86 },
          },
        },
      ],
    },
  ]);
});

test('keeps MaxBet events that have useful non-result markets without 1X2', () => {
  const nextPayload = structuredClone(payload);
  nextPayload.events[0].o = nextPayload.events[0].o.filter((market) => market.b !== 2);

  const [event] = normalizeMaxBetPayload(nextPayload, '2026-06-29T10:00:00.000Z');

  assert.equal(event.id, 'maxbet:10287484');
  assert.equal(event.bookmakers[0].markets.h2h, undefined);
  assert.deepEqual(event.bookmakers[0].markets.totalGoals_2_5, { over: 1.98, under: 1.68 });
});

test('loads MaxBet from the server-rendered sports page', async () => {
  const requests = [];
  const provider = new MaxBetProvider({
    now: () => new Date('2026-06-29T10:00:00Z'),
    fetchImpl: async (url, options) => {
      requests.push({ url: url.toString(), options });
      return new Response(htmlWithState(), {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    },
  });

  const events = await provider.getOdds();

  assert.equal(requests[0].url, MAXBET_PAGE_URL);
  assert.equal(requests[0].options.headers.accept, 'text/html');
  assert.equal(events[0].bookmakers[0].name, 'MaxBet');
});

test('falls back to the direct MaxBet events feed when page state is missing', async () => {
  const requests = [];
  const provider = new MaxBetProvider({
    now: () => new Date('2026-06-29T10:00:00Z'),
    fetchImpl: async (url, options) => {
      requests.push({ url: url.toString(), options });
      if (url.toString() === MAXBET_PAGE_URL) {
        return new Response('<html><body></body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      return new Response(JSON.stringify({ data: payload }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  const events = await provider.getOdds();

  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, MAXBET_PAGE_URL);
  assert.equal(requests[1].url, MAXBET_EVENTS_URL);
  assert.equal(requests[1].options.headers.accept, 'application/json');
  assert.equal(events[0].id, 'maxbet:10287484');
});
