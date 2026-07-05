const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BETMEN_PAGE_URL,
  BetmenProvider,
  extractBetmenRows,
  normalizeBetmenAgencyHtml,
  resolveBetmenStartTime,
} = require('../src/providers/betmen-provider');

const agencyHtml = `
  <main>
    <h1>Betmen - pariuri sportive</h1>
    <section>
      <h2>TOP</h2>
      <p>Ora Cod Eveniment 1 X 2 1X X2 12</p>
      <a>du. 22:00</a>
      <a>6662</a>
      <a>Africa De Sud - Canada</a>
      <span>5.00</span><span>3.60</span><span>1.70</span>
      <span>2.11</span><span>1.16</span><span>1.29</span>
      <p>Se disputa pe SoFi Stadium, Inglewood</p>
      <a>lu. 23:30</a>
      <a>4942</a>
      <a>Germania - Paraguay</a>
      <span>1.38</span><span>4.75</span><span>8.00</span>
      <span>1.08</span><span>3.00</span><span>1.17</span>
      <a>du. 08:00</a>
      <a>2318</a>
      <a>Oyama Sc - Cobaltore Ona</a>
      <span>12.00</span><span>7.50</span><span>1.11</span>
      <span>4.75</span><span>-</span><span>-</span>
    </section>
  </main>
`;

test('extracts Betmen agency odds rows from server-rendered sports markup', () => {
  const rows = extractBetmenRows(agencyHtml);

  assert.deepEqual(rows, [
    {
      weekday: 'du',
      time: '22:00',
      code: '6662',
      homeTeam: 'Africa De Sud',
      awayTeam: 'Canada',
      odds: {
        home: 5,
        draw: 3.6,
        away: 1.7,
        homeDraw: 2.11,
        drawAway: 1.16,
        homeAway: 1.29,
      },
    },
    {
      weekday: 'lu',
      time: '23:30',
      code: '4942',
      homeTeam: 'Germania',
      awayTeam: 'Paraguay',
      odds: {
        home: 1.38,
        draw: 4.75,
        away: 8,
        homeDraw: 1.08,
        drawAway: 3,
        homeAway: 1.17,
      },
    },
    {
      weekday: 'du',
      time: '08:00',
      code: '2318',
      homeTeam: 'Oyama Sc',
      awayTeam: 'Cobaltore Ona',
      odds: {
        home: 12,
        draw: 7.5,
        away: 1.11,
        homeDraw: 4.75,
        drawAway: null,
        homeAway: null,
      },
    },
  ]);
});

test('extracts Betmen agency rows with vs-separated fixture names', () => {
  const rows = extractBetmenRows(`
    <a>du. 22:00</a>
    <a>6662</a>
    <a>Africa De Sud vs Canada</a>
    <span>5.00</span><span>3.60</span><span>1.70</span>
    <span>2.11</span><span>1.16</span><span>1.29</span>
  `);

  assert.equal(rows[0].homeTeam, 'Africa De Sud');
  assert.equal(rows[0].awayTeam, 'Canada');
});

test('normalizes Betmen agency football odds', () => {
  const events = normalizeBetmenAgencyHtml(agencyHtml, {
    fetchedAt: '2026-06-29T10:00:00.000Z',
    now: new Date('2026-06-29T10:00:00.000Z'),
  });

  assert.equal(events.length, 3);
  assert.deepEqual(events[0], {
    id: 'betmen:4942:germania:paraguay',
    externalIds: { betmenCode: '4942' },
    sport: 'Football',
    competition: 'Betmen Football',
    startsAt: '2026-06-29T20:30:00.000Z',
    homeTeam: 'Germania',
    awayTeam: 'Paraguay',
    bookmakers: [
      {
        name: 'Betmen',
        lastUpdate: '2026-06-29T10:00:00.000Z',
        eventUrl: BETMEN_PAGE_URL,
        bookmakerUrl: BETMEN_PAGE_URL,
        markets: {
          h2h: { home: 1.38, draw: 4.75, away: 8 },
          doubleChance: { homeDraw: 1.08, drawAway: 3, homeAway: 1.17 },
        },
      },
    ],
  });
  assert.equal(events[2].id, 'betmen:6662:africa-de-sud:canada');
  assert.deepEqual(events[1].bookmakers[0].markets, {
    h2h: { home: 12, draw: 7.5, away: 1.11 },
  });
});

test('resolves Betmen Romanian weekday times in Europe/Bucharest', () => {
  const now = new Date('2026-06-29T10:00:00.000Z');

  assert.equal(resolveBetmenStartTime('lu', '23:30', now).toISOString(), '2026-06-29T20:30:00.000Z');
  assert.equal(resolveBetmenStartTime('du', '22:00', now).toISOString(), '2026-07-05T19:00:00.000Z');
});

test('loads Betmen from the public agency sports page', async () => {
  const requests = [];
  const provider = new BetmenProvider({
    now: () => new Date('2026-06-29T10:00:00.000Z'),
    fetchImpl: async (url, options) => {
      requests.push({ url: url.toString(), options });
      return new Response(agencyHtml, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    },
  });

  const events = await provider.getOdds();

  assert.equal(requests[0].url, BETMEN_PAGE_URL);
  assert.equal(requests[0].options.headers.accept, 'text/html');
  assert.equal(events[0].bookmakers[0].name, 'Betmen');
});
