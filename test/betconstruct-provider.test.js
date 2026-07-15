'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const {
  BetconstructProvider,
  buildFootballRequest,
  buildSessionRequest,
  fetchBetconstructPayload,
  normalizeBetconstructMarkets,
  normalizeBetconstructPayload,
  resolveBetconstructConfig,
} = require('../src/providers/betconstruct-provider');
const { ManhattanProvider } = require('../src/providers/manhattan-provider');
const { SpinProvider } = require('../src/providers/spin-provider');
const { VictoryBetProvider } = require('../src/providers/victorybet-provider');

function fixturePayload() {
  return {
    sport: {
      1: {
        region: {
          10: {
            competition: {
              20: {
                name: 'K League 2',
                game: {
                  30: {
                    id: 30,
                    team1_id: 101,
                    team2_id: 102,
                    team1_name: 'Suwon',
                    team2_name: 'Seoul E-Land',
                    start_ts: Date.parse('2026-07-18T10:30:00.000Z') / 1000,
                    market: fixtureMarkets(),
                  },
                },
              },
              21: {
                name: 'Liga Campionilor - Antepost',
                game: {
                  31: {
                    id: 31,
                    team1_id: 201,
                    team2_id: 202,
                    team1_name: 'Special Home',
                    team2_name: 'Special Away',
                    start_ts: Date.parse('2026-07-19T10:30:00.000Z') / 1000,
                    market: fixtureMarkets(),
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

function fixtureMarkets() {
  return {
    1: {
      type: 'P1XP2',
      event: {
        1: { type: 'P1', price: 2.7 },
        2: { type: 'X', price: 3.3 },
        3: { type: 'P2', price: 2.2 },
      },
    },
    2: {
      type: '1X12X2',
      event: {
        1: { type: '1X', price: 1.55 },
        2: { type: '12', price: 1.3 },
        3: { type: 'X2', price: 1.4 },
      },
    },
    3: {
      type: 'OverUnder',
      name: 'Total Goluri',
      base: 2.5,
      event: {
        1: { type: 'Over', price: 1.62 },
        2: { type: 'Under', price: 2.05 },
      },
    },
    4: {
      type: 'AsianHandicap',
      event: {
        1: { type: 'Home', base: -0.5, price: 1.9 },
        2: { type: 'Away', base: 0.5, price: 1.8 },
      },
    },
    5: {
      type: 'BothTeamsToScore',
      event: {
        1: { name: 'Da', type: 'Yes', price: 1.52 },
        2: { name: 'Nu', type: 'No', price: 2.24 },
      },
    },
    6: {
      type: 'Team1OverUnder',
      base: 1.5,
      event: {
        1: { name: 'Peste', type: 'Over', price: 2.17 },
        2: { name: 'Sub', type: 'Under', price: 1.55 },
      },
    },
    7: {
      type: 'Team2ScoreYes/No',
      event: {
        1: { name: 'Da', type: 'Yes', price: 1.18 },
        2: { name: 'Nu', type: 'No', price: 3.88 },
      },
    },
  };
}

class FakeSocket extends EventEmitter {
  constructor(payload) {
    super();
    this.payload = payload;
    this.readyState = 1;
    queueMicrotask(() => this.emit('open'));
  }

  send(value) {
    const request = JSON.parse(value);
    if (request.rid === 1) {
      queueMicrotask(() => this.emit('message', JSON.stringify({ rid: 1, code: 0 })));
    }
    if (request.rid === 2) {
      queueMicrotask(() => this.emit('message', JSON.stringify({
        rid: 2,
        code: 0,
        data: { data: this.payload },
      })));
    }
  }

  close() {
    this.readyState = 3;
    queueMicrotask(() => this.emit('close', 1000));
  }
}

test('builds anonymous BetConstruct session and football catalogue requests', () => {
  assert.deepEqual(buildSessionRequest({
    siteId: 123,
    releaseDate: 'release',
    language: 'ron',
    source: 42,
  }), {
    command: 'request_session',
    params: {
      language: 'ron',
      release_date: 'release',
      site_id: 123,
      source: 42,
    },
    rid: 1,
  });

  const request = buildFootballRequest();
  assert.equal(request.command, 'get');
  assert.equal(request.params.source, 'betting');
  assert.equal(request.params.where.sport.alias, 'Soccer');
  assert.equal(request.params.where.game.type, 0);
});

test('normalizes core BetConstruct football market families', () => {
  const markets = normalizeBetconstructMarkets(fixtureMarkets(), {
    homeTeam: 'Suwon',
    awayTeam: 'Seoul E-Land',
  });

  assert.deepEqual(markets.h2h, { home: 2.7, draw: 3.3, away: 2.2 });
  assert.deepEqual(markets.doubleChance, {
    homeDraw: 1.55,
    homeAway: 1.3,
    drawAway: 1.4,
  });
  assert.deepEqual(markets.totalGoals_2_5, { over: 1.62, under: 2.05 });
  assert.deepEqual(markets.asianHandicap_minus_0_5, { home: 1.9, away: 1.8 });
  assert.deepEqual(markets.bothTeamsToScore, { yes: 1.52, no: 2.24 });
  assert.deepEqual(markets.market_total_goluri_home_1_5, { over: 2.17, under: 1.55 });
  assert.deepEqual(markets.market_marcheaza_away, { yes: 1.18, no: 3.88 });
});

test('normalizes real matches and rejects antepost competitions', () => {
  const events = normalizeBetconstructPayload(fixturePayload(), {
    bookmaker: 'ExampleBet',
    bookmakerUrl: 'https://example.test/sports',
    fetchedAt: '2026-07-14T10:00:00.000Z',
    maxEvents: 10,
    now: new Date('2026-07-14T10:00:00.000Z'),
    siteId: 123,
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].id, 'betconstruct:123:30');
  assert.equal(events[0].competition, 'K League 2');
  assert.equal(events[0].bookmakers[0].name, 'ExampleBet');
  assert.equal(events[0].bookmakers[0].bookmakerUrl, 'https://example.test/sports');
});

test('fetchBetconstructPayload completes the anonymous WebSocket exchange', async () => {
  const payload = fixturePayload();
  const result = await fetchBetconstructPayload({
    socketUrl: 'wss://example.test',
    siteId: 123,
    releaseDate: 'release',
    language: 'ron',
    timeoutMs: 1000,
    webSocketFactory: () => new FakeSocket(payload),
  });
  assert.deepEqual(result, payload);
});

test('BetconstructProvider and Romanian subclasses expose stable configuration', async () => {
  const payload = fixturePayload();
  const provider = new BetconstructProvider({
    name: 'ExampleBet',
    socketUrl: 'wss://example.test',
    siteId: 123,
    releaseDate: 'release',
    language: 'ron',
    pageUrl: 'https://example.test/sports',
    maxEvents: 5,
    now: () => new Date('2026-07-14T10:00:00.000Z'),
    webSocketFactory: () => new FakeSocket(payload),
  });
  const events = await provider.getOdds();

  assert.equal(events.length, 1);
  assert.equal(new VictoryBetProvider().name, 'VictoryBet');
  assert.equal(new ManhattanProvider().name, 'Manhattan');
  const spin = new SpinProvider();
  assert.equal(spin.name, 'Spin');
  assert.equal(spin.systemCode, 'SPIN.RO');
});

test('resolves and refreshes public BetConstruct runtime configuration safely', async () => {
  assert.deepEqual(resolveBetconstructConfig({ nested: {
    site_id: '123', release_date: 'release', websocket: 'wss://eu-swarm.example.test/', language: 'ron',
  } }), {
    siteId: 123, releaseDate: 'release', socketUrl: 'wss://eu-swarm.example.test/', language: 'ron',
  });
  const provider = new BetconstructProvider({
    name: 'Configurable', socketUrl: 'wss://old.test/', siteId: 1, releaseDate: 'old', language: 'ro',
    pageUrl: 'https://example.test', configUrl: 'https://example.test/conf.json',
    fetchImpl: async () => ({ ok: true, json: async () => ({ site_id: 2, release_date: 'new' }) }),
  });
  await provider.refreshConfig({ force: true });
  assert.equal(provider.siteId, 2);
  assert.equal(provider.releaseDate, 'new');
});

test('prefers the sportsbook swarm socket over unrelated public sockets', () => {
  assert.equal(resolveBetconstructConfig({
    jackpot: { socketUrl: 'wss://rgs-wss.victorybet.ro/jackpot' },
    sport: { suggestedEvent: { socketUrl: 'wss://rocket-bet.example.test/live/v2/ws' } },
    swarm: { socketUrl: 'wss://eu-swarm-reverse.victorybet.ro/' },
  }).socketUrl, 'wss://eu-swarm-reverse.victorybet.ro/');
});
