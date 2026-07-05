const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BETFAIR_FOOTBALL_URL,
  BetfairProvider,
  betfairTeamsFromHref,
  extractBetfairRows,
  normalizeBetfairFootballHtml,
  resolveBetfairStartTime,
} = require('../src/providers/betfair-provider');

const footballHtml = `
  <main>
    <h1>Fotbal</h1>
    <section>
      <h2>Meciuri care urmează</h2>
      <a href="/pariuri/fotbal/fotbal/cupa-mondial%C4%83/brazilia-v-japonia/e-35760639">
        Cupa Mondială Astăzi , 20:00 Brazilia Japonia
      </a>
      <span>Brazilia</span><span>1.66</span>
      <span>Egal</span><span>3.70</span>
      <span>Japonia</span><span>5.00</span>
      <a href="/pariuri/fotbal/fotbal/cupa-mondial%C4%83/germania-v-paraguay/e-35760640">
        Cupa Mondială Astăzi , 23:30 Germania Paraguay
      </a>
      <span>Germania</span><span>1.32</span>
      <span>Egal</span><span>5.00</span>
      <span>Paraguay</span><span>8.50</span>
    </section>
    <section>
      <p>Selectare piață: Cote meci</p>
      <a href="/pariuri/fotbal/fotbal/u19-campionatul-european/italia-u19-v-serbia-u19/e-35770001">
        Italia U19 Serbia U19 Astăzi 18:00
      </a>
      <span>1.38</span><span>4.50</span><span>5.50</span>
      <a href="/pariuri/fotbal/fotbal/cupa-mondial%C4%83/c%C3%B4te-d%E2%80%99ivoire-v-norvegia/e-35760642">
        Côte d’Ivoire Norvegia 30 iun. 20:00
      </a>
      <span>3.50</span><span>3.50</span><span>1.90</span>
    </section>
  </main>
`;

test('extracts Betfair football rows from rendered sportsbook markup', () => {
  const rows = extractBetfairRows(footballHtml);

  assert.deepEqual(
    rows.map((row) => ({
      eventId: row.eventId,
      competition: row.competition,
      dateLabel: row.dateLabel,
      time: row.time,
      homeTeam: row.homeTeam,
      awayTeam: row.awayTeam,
      odds: row.odds,
    })),
    [
      {
        eventId: '35760639',
        competition: 'Cupa Mondială',
        dateLabel: 'Astăzi',
        time: '20:00',
        homeTeam: 'Brazilia',
        awayTeam: 'Japonia',
        odds: { home: 1.66, draw: 3.7, away: 5 },
      },
      {
        eventId: '35760640',
        competition: 'Cupa Mondială',
        dateLabel: 'Astăzi',
        time: '23:30',
        homeTeam: 'Germania',
        awayTeam: 'Paraguay',
        odds: { home: 1.32, draw: 5, away: 8.5 },
      },
      {
        eventId: '35770001',
        competition: 'Betfair Football',
        dateLabel: 'Astăzi',
        time: '18:00',
        homeTeam: 'Italia U19',
        awayTeam: 'Serbia U19',
        odds: { home: 1.38, draw: 4.5, away: 5.5 },
      },
      {
        eventId: '35760642',
        competition: 'Betfair Football',
        dateLabel: '30 iun.',
        time: '20:00',
        homeTeam: 'Côte D’Ivoire',
        awayTeam: 'Norvegia',
        odds: { home: 3.5, draw: 3.5, away: 1.9 },
      },
    ],
  );
});

test('normalizes Betfair football events with event links', () => {
  const events = normalizeBetfairFootballHtml(footballHtml, {
    fetchedAt: '2026-06-29T10:00:00.000Z',
    now: new Date('2026-06-29T10:00:00.000Z'),
  });

  assert.equal(events.length, 4);
  assert.deepEqual(events[0], {
    id: 'betfair:35770001',
    externalIds: { betfairEventId: '35770001' },
    sport: 'Football',
    competition: 'Betfair Football',
    startsAt: '2026-06-29T15:00:00.000Z',
    homeTeam: 'Italia U19',
    awayTeam: 'Serbia U19',
    bookmakers: [
      {
        name: 'Betfair',
        lastUpdate: '2026-06-29T10:00:00.000Z',
        eventUrl: 'https://www.betfair.ro/pariuri/fotbal/fotbal/u19-campionatul-european/italia-u19-v-serbia-u19/e-35770001',
        bookmakerUrl: BETFAIR_FOOTBALL_URL,
        markets: {
          h2h: { home: 1.38, draw: 4.5, away: 5.5 },
        },
      },
    ],
  });
  assert.equal(events[1].id, 'betfair:35760639');
  assert.equal(events[3].startsAt, '2026-06-30T17:00:00.000Z');
});

test('resolves Betfair Romanian date labels in Europe/Bucharest', () => {
  const now = new Date('2026-06-29T10:00:00.000Z');

  assert.equal(resolveBetfairStartTime('Astăzi', '20:00', now).toISOString(), '2026-06-29T17:00:00.000Z');
  assert.equal(resolveBetfairStartTime('Mâine', '04:00', now).toISOString(), '2026-06-30T01:00:00.000Z');
  assert.equal(resolveBetfairStartTime('30 iun.', '20:00', now).toISOString(), '2026-06-30T17:00:00.000Z');
});

test('loads Betfair from the public football page', async () => {
  const requests = [];
  const provider = new BetfairProvider({
    now: () => new Date('2026-06-29T10:00:00.000Z'),
    fetchImpl: async (url, options) => {
      requests.push({ url: url.toString(), options });
      return new Response(footballHtml, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    },
  });

  const events = await provider.getOdds();

  assert.equal(requests[0].url, BETFAIR_FOOTBALL_URL);
  assert.equal(requests[0].options.headers.accept, 'text/html');
  assert.equal(events[0].bookmakers[0].name, 'Betfair');
});

test('extracts Betfair teams from event slugs', () => {
  assert.deepEqual(
    betfairTeamsFromHref('/pariuri/fotbal/fotbal/cupa-mondial%C4%83/c%C3%B4te-d%E2%80%99ivoire-v-norvegia/e-35760642'),
    { homeTeam: 'Côte D’Ivoire', awayTeam: 'Norvegia' },
  );
});
