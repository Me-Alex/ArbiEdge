const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CasaPariurilorProvider,
  CASA_MATCHES_URL,
} = require('../src/providers/casa-pariurilor-provider');

const payload = {
  tournaments: [{ id: 'tour', name: 'Liga 1' }],
  fixtures: [{
    id: 'match',
    sportId: 'ufo:sprt:00',
    tournamentId: 'tour',
    sportradarIds: ['987'],
    sportSeoName: 'fotbal',
    categorySeoName: 'romania',
    tournamentSeoName: 'superliga',
    seoName: 'craiova-rapid',
    participants: [
      { type: 'HOME', name: 'Craiova' },
      { type: 'AWAY', name: 'Rapid' },
    ],
    startDatetime: 1782122400000,
    marketTypeIds: [
      'ufo:mtyp:00-00',
      'ufo:mtyp:00-01',
      'ufo:mtyp:00-0b',
      'ufo:mtyp:00-12',
      'ufo:mtyp:00-1c',
      'ufo:mtyp:00-2n',
      'custom',
    ],
    status: 'ACTIVE',
  }],
  markets: [{
    fixtureId: 'match',
    marketTypeId: 'ufo:mtyp:00-00',
    outcomes: [
      { name: '1', odds: 2.1 },
      { name: 'X', odds: 3.2 },
      { name: '2', odds: 3.4 },
    ],
  }, {
    fixtureId: 'match',
    marketTypeId: 'ufo:mtyp:00-01',
    syntheticGroupKey: 'match_-_double_chance',
    name: 'Meci - sansa dubla',
    outcomes: [
      { name: '1X', odds: 1.28 },
      { name: '12', odds: 1.33 },
      { name: 'X2', odds: 1.64 },
    ],
  }, {
    fixtureId: 'match',
    marketTypeId: 'ufo:mtyp:00-2f',
    syntheticGroupKey: '1st_half_-_double_chance',
    name: 'Prima repriza - sansa dubla',
    outcomes: [
      { name: '1X', odds: 1.12 },
      { name: '12', odds: 3.75 },
      { name: 'X2', odds: 1.03 },
    ],
  }, {
    fixtureId: 'match',
    marketTypeId: 'ufo:mtyp:00-0b',
    syntheticGroupKey: 'handicap_/_asian_handicap',
    name: 'Handicap / Handicap asiatic +0.5',
    outcomes: [
      { name: 'Rapid -0.5', odds: 2.14 },
      { name: 'Craiova +0.5', odds: 1.66 },
    ],
  }, {
    fixtureId: 'match',
    marketTypeId: 'ufo:mtyp:00-2h',
    syntheticGroupKey: '1st_half_handicap',
    name: 'Prima repriza: handicap',
    outcomes: [
      { name: '1 -0.5', odds: 2.2 },
      { name: '2 +0.5', odds: 1.6 },
    ],
  }, {
    fixtureId: 'match',
    marketTypeId: 'ufo:mtyp:00-99',
    syntheticGroupKey: '1st_half_total_corners',
    name: 'Prima repriza total cornere',
    outcomes: [
      { name: '+ 4.5', odds: 2.05 },
      { name: '- 4.5', odds: 1.72 },
    ],
  }, {
    fixtureId: 'match',
    marketTypeId: 'ufo:mtyp:00-12',
    syntheticGroupKey: 'to_qualify',
    outcomes: [
      { name: '1', odds: 1.72 },
      { name: '2', odds: 2.04 },
    ],
  }, {
    fixtureId: 'match',
    marketTypeId: 'ufo:mtyp:00-1c',
    syntheticGroupKey: 'both_teams_to_score',
    name: 'Ambele marcheaza',
    outcomes: [
      { name: 'Nu', odds: 2.43 },
      { name: 'Da', odds: 1.48 },
    ],
  }, {
    fixtureId: 'match',
    marketTypeId: 'ufo:mtyp:00-2n',
    syntheticGroupKey: 'both_teams_to_score_in_1st_half',
    name: 'Prima repriza: ambele marcheaza',
    outcomes: [
      { name: 'Nu', odds: 1.28 },
      { name: 'Da', odds: 3.35 },
    ],
  }, {
    fixtureId: 'match',
    marketTypeId: 'custom',
    name: 'Urmatorul gol',
    outcomes: [
      { name: '1', odds: 2.9 },
      { name: '2', odds: 3.1 },
      { name: 'Niciunul', odds: 5.5 },
    ],
  }],
};

test('loads Casa Pariurilor through the shared UFO offer model', async () => {
  const urls = [];
  const provider = new CasaPariurilorProvider({
    now: () => new Date('2026-06-21T20:00:00Z'),
    fetchImpl: async (url) => {
      urls.push(url.toString());
      return new Response(JSON.stringify(payload), { status: 200 });
    },
  });

  const events = await provider.getOdds();

  assert.match(urls[0], new RegExp(escapeRegExp(CASA_MATCHES_URL)));
  assert.match(urls[0], /filter=all/);
  assert.match(urls[1], /fixtures\/markets\/overview/);
  assert.match(urls[1], /ufo%3Amtyp%3A00-12/);
  assert.equal(events[0].bookmakers[0].name, 'Casa Pariurilor');
  assert.equal(
    events[0].bookmakers[0].eventUrl,
    'https://www.casapariurilor.ro/pariuri-online/fotbal/romania/superliga/craiova-rapid?filter=all&tab=offer',
  );
  assert.equal(
    events[0].bookmakers[0].bookmakerUrl,
    'https://www.casapariurilor.ro/pariuri-online/fotbal',
  );
  assert.equal(events[0].externalIds.sportradar, '987');
  assert.deepEqual(events[0].bookmakers[0].markets.doubleChance, {
    homeDraw: 1.28,
    homeAway: 1.33,
    drawAway: 1.64,
  });
  assert.deepEqual(events[0].bookmakers[0].markets.firstHalfDoubleChance, {
    homeDraw: 1.12,
    homeAway: 3.75,
    drawAway: 1.03,
  });
  assert.deepEqual(events[0].bookmakers[0].markets.asianHandicap_plus_0_5, {
    home: 1.66,
    away: 2.14,
  });
  assert.deepEqual(events[0].bookmakers[0].markets.market_prima_repriza_handicap, {
    '1_minus0_5': 2.2,
    '2_plus0_5': 1.6,
  });
  assert.equal(events[0].bookmakers[0].markets.handicap_plus_0_5, undefined);
  assert.equal(events[0].bookmakers[0].markets.asianHandicap_minus_0_5, undefined);
  assert.deepEqual(events[0].bookmakers[0].markets.firstHalfTotalCorners_4_5, {
    over: 2.05,
    under: 1.72,
  });
  assert.equal(events[0].bookmakers[0].markets.totalCorners_4_5, undefined);
  assert.deepEqual(events[0].bookmakers[0].markets.toQualify, {
    home: 1.72,
    away: 2.04,
  });
  assert.deepEqual(events[0].bookmakers[0].markets.bothTeamsToScore, {
    yes: 1.48,
    no: 2.43,
  });
  assert.deepEqual(events[0].bookmakers[0].markets.firstHalfBothTeamsToScore, {
    yes: 3.35,
    no: 1.28,
  });
  assert.deepEqual(events[0].bookmakers[0].markets.market_urmatorul_gol, {
    home: 2.9,
    away: 3.1,
    none: 5.5,
  });
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
