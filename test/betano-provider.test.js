const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BetanoProvider,
  isActiveBetanoMarket,
  isActiveBetanoSelection,
  normalizeBetanoEvent,
  resolveBetanoTeams,
  teamNamesCompatible,
} = require('../src/providers/betano-provider');

test('normalizes browser-collected Betano markets', async () => {
  const provider = new BetanoProvider({
    transport: {
      collect: async () => [{
        id: '77',
        url: '/sport/fotbal/cupa-mondiala/uruguay-capul-verde/77/',
        betRadarId: 555,
        name: 'Uruguay - Capul Verde',
        startTime: 1782079200000,
        competition: 'Cupa Mondială',
        markets: [
          {
            type: 'MRES',
            selections: [
              { name: '1', price: 1.44 },
              { name: 'X', price: 4.15 },
              { name: '2', price: 8.75 },
            ],
          },
          {
            type: 'DNOB',
            selections: [
              { name: 'Uruguay', price: 1.12 },
              { name: 'Capul Verde', price: 6.4 },
            ],
          },
          {
            type: 'NGOL',
            name: 'Urmatorul gol',
            selections: [
              { name: '1', price: 2.9 },
              { name: '2', price: 3.3 },
              { name: 'Niciunul', price: 4.5 },
            ],
          },
          {
            type: 'TOTG',
            name: 'Total goluri',
            selections: [
              { name: 'Peste 2.5', price: 1.92 },
              { name: 'Sub 2.5', price: 1.88 },
            ],
          },
          {
            type: 'TCAR',
            name: 'Total cartonase galbene peste/sub',
            selections: [
              { name: 'Over', line: 4.5, price: 2.12 },
              { name: 'Under', line: 4.5, price: 1.72 },
            ],
          },
          {
            type: 'BTSC',
            name: 'Ambele marcheaza',
            selections: [
              { name: 'Da', price: 1.72 },
              { name: 'Nu', price: 2.05 },
            ],
          },
          {
            type: 'DBLC',
            name: 'Sansa dubla',
            selections: [
              { name: '1X', price: 1.12 },
              { name: '12', price: 1.22 },
              { name: 'X2', price: 2.75 },
            ],
          },
          {
            type: 'TTHG',
            name: 'Total goluri gazde',
            selections: [
              { name: 'Peste 1.5', price: 2.1 },
              { name: 'Sub 1.5', price: 1.7 },
            ],
          },
        ],
      }],
    },
  });

  const events = await provider.getOdds();

  assert.equal(events[0].externalIds.sportradar, '555');
  assert.equal(
    events[0].bookmakers[0].eventUrl,
    'https://ro.betano.com/sport/fotbal/cupa-mondiala/uruguay-capul-verde/77/',
  );
  assert.equal(events[0].bookmakers[0].bookmakerUrl, 'https://ro.betano.com/sport/fotbal/');
  assert.deepEqual(events[0].bookmakers[0].markets.drawNoBet, {
    home: 1.12,
    away: 6.4,
  });
  assert.deepEqual(events[0].bookmakers[0].markets.market_urmatorul_gol, {
    home: 2.9,
    away: 3.3,
    none: 4.5,
  });
  assert.deepEqual(events[0].bookmakers[0].markets.totalGoals_2_5, {
    over: 1.92,
    under: 1.88,
  });
  assert.deepEqual(events[0].bookmakers[0].markets.totalCards_4_5, {
    over: 2.12,
    under: 1.72,
  });
  assert.deepEqual(events[0].bookmakers[0].markets.bothTeamsToScore, {
    yes: 1.72,
    no: 2.05,
  });
  assert.deepEqual(events[0].bookmakers[0].markets.doubleChance, {
    homeDraw: 1.12,
    homeAway: 1.22,
    drawAway: 2.75,
  });
  assert.deepEqual(events[0].bookmakers[0].markets.market_total_goluri_home_1_5, {
    over: 2.1,
    under: 1.7,
  });
});

test('normalizes browser-collected Betano events with vs-separated names', async () => {
  const provider = new BetanoProvider({
    transport: {
      collect: async () => [{
        id: '78',
        url: '/sport/fotbal/cupa-mondiala/uruguay-capul-verde/78/',
        name: 'Uruguay vs Capul Verde',
        startTime: 1782079200000,
        competition: 'Cupa Mondiala',
        markets: [{
          type: 'MRES',
          selections: [
            { name: '1', price: 1.44 },
            { name: 'X', price: 4.15 },
            { name: '2', price: 8.75 },
          ],
        }],
      }],
    },
  });

  const [event] = await provider.getOdds();

  assert.equal(event.homeTeam, 'Uruguay');
  assert.equal(event.awayTeam, 'Capul Verde');
});

test('keeps browser-collected Betano events with useful non-result markets without 1X2', async () => {
  const provider = new BetanoProvider({
    transport: {
      collect: async () => [{
        id: '79',
        url: '/sport/fotbal/cupa-mondiala/uruguay-capul-verde/79/',
        name: 'Uruguay - Capul Verde',
        startTime: 1782079200000,
        competition: 'Cupa Mondiala',
        markets: [{
          type: 'TOTG',
          name: 'Total goluri',
          selections: [
            { name: 'Peste 2.5', price: 1.92 },
            { name: 'Sub 2.5', price: 1.88 },
          ],
        }],
      }],
    },
  });

  const [event] = await provider.getOdds();

  assert.equal(event.id, 'betano:79');
  assert.equal(event.bookmakers[0].markets.h2h, undefined);
  assert.deepEqual(event.bookmakers[0].markets.totalGoals_2_5, {
    over: 1.92,
    under: 1.88,
  });
});

test('reports an unavailable browser session when Betano returns no events', async () => {
  const provider = new BetanoProvider({
    transport: { collect: async () => [] },
  });

  await assert.rejects(provider.getOdds(), /no events/i);
});

test('Betano normalization rejects contradictory team identity and inactive markets', () => {
  assert.equal(teamNamesCompatible('Paris SG', 'Paris SG'), true);
  assert.equal(teamNamesCompatible('Paris', 'Paris SG'), true);
  assert.equal(teamNamesCompatible('Paris', 'London'), false);
  assert.deepEqual(resolveBetanoTeams({
    name: 'Paris - London',
    homeTeam: 'Paris',
    awayTeam: 'London',
  }), ['Paris', 'London']);
  assert.deepEqual(resolveBetanoTeams({
    name: 'Paris - London',
    homeTeam: 'Madrid',
    awayTeam: 'Rome',
  }), []);
  assert.equal(isActiveBetanoMarket({ suspended: true }), false);
  assert.equal(isActiveBetanoMarket({ status: 'open' }), true);
  assert.equal(isActiveBetanoSelection({ active: false }), false);
  assert.equal(isActiveBetanoSelection({ status: 'open' }), true);

  const event = normalizeBetanoEvent({
    id: 'blocked-market',
    name: 'Paris - London',
    startTime: '2027-01-15T08:00:00Z',
    markets: [{
      type: 'MRES',
      suspended: true,
      selections: [
        { name: '1', price: 2.1 },
        { name: 'X', price: 3.2 },
        { name: '2', price: 3.6 },
      ],
    }],
  }, '2026-07-14T12:00:00Z');
  assert.equal(event, null);
});
