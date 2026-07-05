const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SuperbetProvider,
  normalizeSuperbetPayload,
} = require('../src/providers/superbet-provider');

const payload = {
  error: false,
  data: [{
    eventId: 44,
    betradarId: '555',
    matchName: 'Uruguay·Capul Verde',
    utcDate: '2026-06-21T22:00:00Z',
    odds: [
      { marketName: 'Final', name: '1', price: 1.42, status: 'active' },
      { marketName: 'Final', name: 'X', price: 4.5, status: 'active' },
      { marketName: 'Final', name: '2', price: 9.5, status: 'active' },
      { marketUuid: 'fh-btts', marketName: 'Prima repriza - Ambele echipe marcheaza (GG)', name: 'Da', price: 4.65, status: 'active' },
      { marketUuid: 'fh-btts', marketName: 'Prima repriza - Ambele echipe marcheaza (GG)', name: 'Nu', price: 1.15, status: 'active' },
      { marketUuid: 'btts', marketName: 'Ambele echipe marcheaza (GG)', name: 'Da', price: 1.71, status: 'active' },
      { marketUuid: 'btts', marketName: 'Ambele echipe marcheaza (GG)', name: 'Nu', price: 2.03, status: 'active' },
      { marketUuid: 'fh-dnb', marketName: 'Prima repriza - Egal - Pariul se ramburseaza (DNB)', name: 'Uruguay', price: 1.34, status: 'active' },
      { marketUuid: 'fh-dnb', marketName: 'Prima repriza - Egal - Pariul se ramburseaza (DNB)', name: 'Capul Verde', price: 2.75, status: 'active' },
      { marketUuid: 'dnb', marketName: 'Egal - Pariul se ramburseaza (DNB)', name: 'Uruguay', price: 1.12, status: 'active' },
      { marketUuid: 'dnb', marketName: 'Egal - Pariul se ramburseaza (DNB)', name: 'Capul Verde', price: 6.4, status: 'active' },
      { marketUuid: 'fh-dc', marketName: 'Prima repriza - Sansa dubla', name: '1X', price: 1.25, status: 'active' },
      { marketUuid: 'fh-dc', marketName: 'Prima repriza - Sansa dubla', name: '12', price: 1.58, status: 'active' },
      { marketUuid: 'fh-dc', marketName: 'Prima repriza - Sansa dubla', name: 'X2', price: 1.31, status: 'active' },
      { marketUuid: 'dc', marketName: 'Sansa dubla', name: '1X', price: 1.08, status: 'active' },
      { marketUuid: 'dc', marketName: 'Sansa dubla', name: '12', price: 1.18, status: 'active' },
      { marketUuid: 'dc', marketName: 'Sansa dubla', name: 'X2', price: 2.44, status: 'active' },
      { marketUuid: 'tg25', marketName: 'Total goluri', specialBetValue: '2.5', name: 'Peste 2.5', price: 1.91, status: 'active' },
      { marketUuid: 'tg25', marketName: 'Total goluri', specialBetValue: '2.5', name: 'Sub 2.5', price: 1.82, status: 'active' },
      { marketUuid: 'ah025', marketName: 'Handicap asiatic', name: '1 (+0.25)', price: 1.77, status: 'active' },
      { marketUuid: 'ah025', marketName: 'Handicap asiatic', name: '2 (-0.25)', price: 2.02, status: 'active' },
    ],
  }],
};

test('normalizes active Superbet final-result odds', () => {
  const events = normalizeSuperbetPayload(payload, '2026-06-21T20:00:00.000Z');

  assert.equal(events[0].homeTeam, 'Uruguay');
  assert.equal(events[0].awayTeam, 'Capul Verde');
  assert.deepEqual(events[0].bookmakers[0].markets.h2h, {
    home: 1.42,
    draw: 4.5,
    away: 9.5,
  });
  assert.equal(events[0].externalIds.sportradar, '555');
  assert.equal(events[0].externalIds.superbetEvent, '44');
  assert.equal(events[0].bookmakers[0].eventUrl, 'https://superbet.ro/cote/fotbal/uruguay-vs-capul-verde-44');
  assert.equal(events[0].bookmakers[0].bookmakerUrl, 'https://superbet.ro/pariuri-sportive/fotbal');
  assert.deepEqual(events[0].bookmakers[0].markets.doubleChance, {
    homeDraw: 1.08,
    homeAway: 1.18,
    drawAway: 2.44,
  });
  assert.deepEqual(events[0].bookmakers[0].markets.firstHalfDoubleChance, {
    homeDraw: 1.25,
    homeAway: 1.58,
    drawAway: 1.31,
  });
  assert.deepEqual(events[0].bookmakers[0].markets.bothTeamsToScore, {
    yes: 1.71,
    no: 2.03,
  });
  assert.deepEqual(events[0].bookmakers[0].markets.market_prima_repriza_minus_ambele_echipe_marcheaza_gg, {
    yes: 4.65,
    no: 1.15,
  });
  assert.deepEqual(events[0].bookmakers[0].markets.drawNoBet, {
    home: 1.12,
    away: 6.4,
  });
  assert.deepEqual(events[0].bookmakers[0].markets.firstHalfDrawNoBet, {
    home: 1.34,
    away: 2.75,
  });
  assert.deepEqual(events[0].bookmakers[0].markets.totalGoals_2_5, {
    over: 1.91,
    under: 1.82,
  });
  assert.deepEqual(events[0].bookmakers[0].markets.asianHandicap_plus_0_25, {
    home: 1.77,
    away: 2.02,
  });
  assert.equal(events[0].bookmakers[0].markets.asianHandicap_0_25, undefined);
});

test('normalizes Superbet events with vs-separated fixture names', () => {
  const nextPayload = structuredClone(payload);
  nextPayload.data[0].matchName = 'Uruguay vs Capul Verde';

  const [event] = normalizeSuperbetPayload(nextPayload, '2026-06-21T20:00:00.000Z');

  assert.equal(event.homeTeam, 'Uruguay');
  assert.equal(event.awayTeam, 'Capul Verde');
});

test('builds current Superbet list and event-detail URLs', async () => {
  const requested = [];
  const provider = new SuperbetProvider({
    detailsConcurrency: 1,
    now: () => new Date('2026-06-21T20:00:00Z'),
    fetchImpl: async (url) => {
      requested.push(url.toString());
      return new Response(
        JSON.stringify(url.toString().includes('/events/44')
          ? { data: [payload.data[0]] }
          : payload),
        { status: 200 },
      );
    },
  });

  await provider.getOdds();
  assert.match(requested[0], /sportId=5/);
  assert.match(requested[0], /offerState=prematch/);
  assert.match(requested[1], /\/events\/44$/);
});
