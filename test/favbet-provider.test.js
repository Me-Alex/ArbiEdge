'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { ProviderError } = require('../src/providers/the-odds-api-provider');
const {
  FAVBET_RPC_URL,
  FavbetProvider,
  normalizeFavbetPayload,
} = require('../src/providers/favbet-provider');

const event = {
  event_id: 43277348,
  event_name: 'Tranmere Rovers - Rochdale',
  event_dt: 1785592800,
  event_status_type: 'notstarted',
  service_id: 0,
  sport_id: 1,
  category_name: 'Anglia',
  tournament_name: 'EFL Cup',
  participants: [
    { participant_number: 1, participant_name: 'Tranmere Rovers' },
    { participant_number: 2, participant_name: 'Rochdale' },
  ],
  head_markets: [
    market(1, 1, [outcome(1, 2.57), outcome(2, 3.58), outcome(3, 2.47)]),
    market(40, 1, [outcome(4, 1.49), outcome(5, 1.25), outcome(6, 1.45)]),
    market(50, 1, [outcome(10, 1.75, '2.5'), outcome(11, 2, '2.5')]),
    market(1226, 1, [outcome(10, 1.54, '2.25'), outcome(11, 2.32, '2.25')]),
    market(1227, 1, [outcome(1, 2.18, '-0.25'), outcome(3, 1.62, '+0.25')]),
    market(190, 1, [outcome(1, 1.89, '0.0'), outcome(3, 1.84, '0.0')]),
    market(740, 1, [
      outcome(10, 2.25, '1.5', { outcome_short_name: '1 P (1.5)' }),
      outcome(11, 1.59, '1.5', { outcome_short_name: '1 S (1.5)' }),
    ]),
    market(779, 1, [outcome(20, 1.64), outcome(21, 2.16)]),
    market(1385, 1, [outcome(802, 2.12), outcome(803, 1.85), outcome(804, 2.07)]),
    market(1, 7, [outcome(1, 3.16), outcome(2, 2.32), outcome(3, 3.08)]),
    market(50, 7, [outcome(10, 2.47, '1.5'), outcome(11, 1.48, '1.5')]),
    market(1, 8, [outcome(1, 2.94), outcome(2, 2.6), outcome(3, 2.88)]),
    market(50, 1, [outcome(10, 4, '4.5'), outcome(11, 1, '4.5')]),
    { ...market(50, 1, [outcome(10, 1.8, '3.5'), outcome(11, 1.9, '3.5')]), market_suspend: true },
  ],
};

test('normalizes Favbet public Lineout event and numeric market identifiers', () => {
  const events = normalizeFavbetPayload(
    { jsonrpc: '2.0', id: 1, result: [event] },
    '2026-07-14T10:00:00.000Z',
  );

  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    id: 'favbet:43277348',
    externalIds: { favbetEvent: '43277348' },
    sport: 'Football',
    competition: 'Anglia - EFL Cup',
    startsAt: '2026-08-01T14:00:00.000Z',
    homeTeam: 'Tranmere Rovers',
    awayTeam: 'Rochdale',
    bookmakers: [{
      name: 'Favbet',
      lastUpdate: '2026-07-14T10:00:00.000Z',
      eventUrl: 'https://www.favbet.ro/ro/sports/event/soccer/43277348',
      bookmakerUrl: 'https://www.favbet.ro/ro/sports/sport/soccer',
      markets: {
        h2h: { home: 2.57, draw: 3.58, away: 2.47 },
        doubleChance: { homeDraw: 1.49, homeAway: 1.25, drawAway: 1.45 },
        totalGoals_2_5: { over: 1.75, under: 2 },
        asianTotalGoals_2_25: { over: 1.54, under: 2.32 },
        asianHandicap_minus_0_25: { home: 2.18, away: 1.62 },
        asianHandicap_0: { home: 1.89, away: 1.84 },
        market_total_goluri_home_1_5: { over: 2.25, under: 1.59 },
        bothTeamsToScore: { yes: 1.64, no: 2.16 },
        halfTimeOrFullTime: { home: 2.12, draw: 1.85, away: 2.07 },
        firstHalfH2h: { home: 3.16, draw: 2.32, away: 3.08 },
        firstHalfTotalGoals_1_5: { over: 2.47, under: 1.48 },
        secondHalfH2h: { home: 2.94, draw: 2.6, away: 2.88 },
      },
    }],
  });
});

test('ignores Favbet non-football, live, completed, and incomplete events', () => {
  const variants = [
    { ...event, event_id: 1, sport_id: 2 },
    { ...event, event_id: 2, service_id: 1 },
    { ...event, event_id: 3, event_status_type: 'finished' },
    { ...event, event_id: 4, head_markets: [market(1, 1, [outcome(1, 2), outcome(2, 3)])] },
  ];

  assert.deepEqual(normalizeFavbetPayload({ result: variants }), []);
});

test('posts the current Favbet JSON-RPC football request', async () => {
  let request;
  const provider = new FavbetProvider({
    maxEvents: 321,
    now: () => new Date('2026-07-14T10:00:00.000Z'),
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: [event] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  const events = await provider.getOdds();

  assert.equal(request.url, FAVBET_RPC_URL);
  assert.equal(request.options.method, 'POST');
  assert.equal(request.body.method, 'frontend/event/get');
  assert.equal(request.body.params.by.lang, 'ro');
  assert.equal(request.body.params.by.sport_id, 1);
  assert.equal(request.body.params.by.service_id, 0);
  assert.equal(request.body.params.by.head_markets, true);
  assert.equal(request.body.params.by.limit, 321);
  assert.equal(events.length, 1);
});

test('reports Favbet HTTP and JSON-RPC failures as provider errors', async () => {
  const httpProvider = new FavbetProvider({
    fetchImpl: async () => new Response('Bad gateway', { status: 502 }),
  });
  await assert.rejects(
    httpProvider.getOdds(),
    (error) => error instanceof ProviderError && error.status === 502,
  );

  const rpcProvider = new FavbetProvider({
    fetchImpl: async () => new Response(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      error: { message: 'invalid request' },
    }), { status: 200 }),
  });
  await assert.rejects(
    rpcProvider.getOdds(),
    (error) => error instanceof ProviderError && /invalid request/.test(error.message),
  );
});

function market(marketTemplateId, resultTypeId, outcomes) {
  return {
    market_template_id: marketTemplateId,
    result_type_id: resultTypeId,
    market_suspend: false,
    outcomes,
  };
}

function outcome(outcomeTypeId, coefficient, line = null, additional = {}) {
  return {
    outcome_type_id: outcomeTypeId,
    outcome_coef: coefficient,
    outcome_param: line,
    outcome_visible: true,
    ...additional,
  };
}
