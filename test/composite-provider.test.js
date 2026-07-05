const test = require('node:test');
const assert = require('node:assert/strict');

const { CompositeProvider } = require('../src/providers/composite-provider');

const baseEvent = {
  id: 'first:1',
  externalIds: { sportradar: '123' },
  sport: 'Football',
  competition: 'World Cup',
  startsAt: '2026-06-22T10:00:00.000Z',
  homeTeam: 'Romania',
  awayTeam: 'Brazil',
  bookmakers: [{ name: 'First', markets: { h2h: { home: 2, draw: 3, away: 4 } } }],
};

function stripDuration(provider) {
  const { durationMs, ...rest } = provider;
  return rest;
}

function stripDurations(providers) {
  return providers.map(stripDuration);
}

function assertProviderDurations(providers) {
  for (const provider of providers) {
    assert.equal(Number.isInteger(provider.durationMs), true);
    assert.ok(provider.durationMs >= 0);
  }
}

test('merges bookmaker quotes for the same Sportradar fixture', async () => {
  const second = structuredClone(baseEvent);
  second.id = 'second:9';
  second.bookmakers[0].name = 'Second';

  const provider = new CompositeProvider([
    { name: 'First', getOdds: async () => [baseEvent] },
    { name: 'Second', getOdds: async () => [second] },
  ]);

  const result = await provider.getOdds();

  assert.equal(result.events.length, 1);
  assert.deepEqual(
    result.events[0].bookmakers.map((bookmaker) => bookmaker.name),
    ['First', 'Second'],
  );
  assert.equal(result.events[0].matchConfidence, 'shared sportradar');
  assert.deepEqual(stripDurations(result.providers), [
    { name: 'First', ok: true, events: 1 },
    { name: 'Second', ok: true, events: 1 },
  ]);
  assertProviderDurations(result.providers);
});

test('streams composite provider snapshots as each provider finishes', async () => {
  let resolveSecond;
  const secondReady = new Promise((resolve) => {
    resolveSecond = resolve;
  });
  const second = structuredClone(baseEvent);
  second.id = 'second:9';
  second.bookmakers[0].name = 'Second';

  const provider = new CompositeProvider([
    { name: 'First', getOdds: async () => [baseEvent] },
    { name: 'Second', getOdds: async () => secondReady.then(() => [second]) },
  ]);

  const iterator = provider.getOddsProgress();
  const firstSnapshot = await iterator.next();
  assert.equal(firstSnapshot.done, false);
  assert.deepEqual(firstSnapshot.value.progress, { done: 1, total: 2, complete: false });
  assert.deepEqual(stripDurations(firstSnapshot.value.providers), [{ name: 'First', ok: true, events: 1 }]);
  assertProviderDurations(firstSnapshot.value.providers);

  resolveSecond();
  const finalSnapshot = await iterator.next();
  assert.equal(finalSnapshot.done, false);
  assert.deepEqual(finalSnapshot.value.progress, { done: 2, total: 2, complete: true });
  assert.deepEqual(
    finalSnapshot.value.events[0].bookmakers.map((bookmaker) => bookmaker.name),
    ['First', 'Second'],
  );
});

test('merges fixtures with a shared provider event id before fuzzy matching', async () => {
  const first = structuredClone(baseEvent);
  first.externalIds = { digitainMatch: '38638787' };
  first.homeTeam = 'Team A';
  first.awayTeam = 'Team B';

  const second = structuredClone(baseEvent);
  second.id = 'second:shared-id';
  second.externalIds = { digitainMatch: '38638787' };
  second.homeTeam = 'Completely Different Home';
  second.awayTeam = 'Completely Different Away';
  second.bookmakers[0].name = 'Second';

  const provider = new CompositeProvider([
    { name: 'First', getOdds: async () => [first] },
    { name: 'Second', getOdds: async () => [second] },
  ]);

  const result = await provider.getOdds();

  assert.equal(result.events.length, 1);
  assert.deepEqual(
    result.events[0].bookmakers.map((bookmaker) => bookmaker.name),
    ['First', 'Second'],
  );
});

test('does not merge XSport fixtures only because they share a palinsesto id', async () => {
  const first = structuredClone(baseEvent);
  first.externalIds = { xsportPalinsesto: '26270', xsportFixture: '26270:100' };
  first.homeTeam = 'Team One';
  first.awayTeam = 'Team Two';

  const second = structuredClone(baseEvent);
  second.id = 'second:xsport';
  second.externalIds = { xsportPalinsesto: '26270', xsportFixture: '26270:200' };
  second.homeTeam = 'Different Home';
  second.awayTeam = 'Different Away';
  second.bookmakers[0].name = 'Second';

  const provider = new CompositeProvider([
    { name: 'First', getOdds: async () => [first] },
    { name: 'Second', getOdds: async () => [second] },
  ]);

  const result = await provider.getOdds();

  assert.equal(result.events.length, 2);
});

test('does not fuzzy-merge fixtures with conflicting trusted external ids', async () => {
  const first = structuredClone(baseEvent);
  first.externalIds = { sportradar: '111' };
  first.homeTeam = 'AC Milan';
  first.awayTeam = 'Manchester Utd';

  const second = structuredClone(baseEvent);
  second.id = 'second:conflicting-id';
  second.externalIds = { sportradar: '222' };
  second.homeTeam = 'Milan';
  second.awayTeam = 'Manchester United';
  second.bookmakers[0].name = 'Second';

  const provider = new CompositeProvider([
    { name: 'First', getOdds: async () => [first] },
    { name: 'Second', getOdds: async () => [second] },
  ]);

  const result = await provider.getOdds();

  assert.equal(result.events.length, 2);
});

test('does not fuzzy-merge Prowin fixtures without a shared event id', async () => {
  const first = structuredClone(baseEvent);
  first.externalIds = {};
  first.homeTeam = 'Elvetia';
  first.awayTeam = 'Algeria';
  first.startsAt = '2026-06-22T10:00:00.000Z';
  first.bookmakers[0].name = 'Winbet';

  const second = structuredClone(baseEvent);
  second.id = 'prowin:fuzzy';
  second.externalIds = {};
  second.homeTeam = 'Elvetia';
  second.awayTeam = 'Algeria';
  second.startsAt = '2026-06-22T10:00:00.000Z';
  second.bookmakers[0].name = 'Prowin';

  const provider = new CompositeProvider([
    { name: 'Winbet', getOdds: async () => [first] },
    { name: 'Prowin', getOdds: async () => [second] },
  ]);

  const result = await provider.getOdds();

  assert.equal(result.events.length, 2);
});

test('merges Prowin fixtures when they share a trusted event id', async () => {
  const first = structuredClone(baseEvent);
  first.externalIds = { sportradar: 'sr:match:100' };
  first.homeTeam = 'Elvetia';
  first.awayTeam = 'Algeria';
  first.startsAt = '2026-06-22T10:00:00.000Z';
  first.bookmakers[0].name = 'Winbet';

  const second = structuredClone(baseEvent);
  second.id = 'prowin:shared';
  second.externalIds = { sportradar: 'sr:match:100' };
  second.homeTeam = 'Switzerland';
  second.awayTeam = 'Algeria';
  second.startsAt = '2026-06-22T10:00:00.000Z';
  second.bookmakers[0].name = 'Prowin';

  const provider = new CompositeProvider([
    { name: 'Winbet', getOdds: async () => [first] },
    { name: 'Prowin', getOdds: async () => [second] },
  ]);

  const result = await provider.getOdds();

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].matchConfidence, 'shared sportradar');
  assert.deepEqual(
    result.events[0].bookmakers.map((bookmaker) => bookmaker.name),
    ['Winbet', 'Prowin'],
  );
});

test('keeps successful providers when another provider fails', async () => {
  const provider = new CompositeProvider([
    { name: 'First', getOdds: async () => [baseEvent] },
    { name: 'Broken', getOdds: async () => { throw new Error('blocked'); } },
  ]);

  const result = await provider.getOdds();

  assert.equal(result.events.length, 1);
  assert.deepEqual(stripDuration(result.providers[1]), {
    name: 'Broken',
    ok: false,
    events: 0,
    error: 'blocked',
  });
  assertProviderDurations(result.providers);
});

test('includes provider event target metadata when configured', async () => {
  const provider = new CompositeProvider([
    { name: 'Targeted', eventTarget: 1000, getOdds: async () => [baseEvent] },
  ]);

  const result = await provider.getOdds();

  assert.deepEqual(stripDuration(result.providers[0]), {
    name: 'Targeted',
    ok: true,
    events: 1,
    targetEvents: 1000,
  });
  assertProviderDurations(result.providers);
});

test('merges fixtures with close start times and equivalent team names', async () => {
  const first = structuredClone(baseEvent);
  first.externalIds = {};
  first.homeTeam = 'AC Milan';
  first.awayTeam = 'Manchester Utd';
  first.startsAt = '2026-06-22T10:00:00.000Z';

  const second = structuredClone(baseEvent);
  second.id = 'second:fuzzy';
  second.externalIds = {};
  second.homeTeam = 'Milan';
  second.awayTeam = 'Manchester United';
  second.startsAt = '2026-06-22T10:02:00.000Z';
  second.bookmakers[0].name = 'Second';

  const provider = new CompositeProvider([
    { name: 'First', getOdds: async () => [first] },
    { name: 'Second', getOdds: async () => [second] },
  ]);

  const result = await provider.getOdds();

  assert.equal(result.events.length, 1);
  assert.deepEqual(
    result.events[0].bookmakers.map((bookmaker) => bookmaker.name),
    ['First', 'Second'],
  );
});

test('does not fuzzy-merge fixtures from incompatible competitions', async () => {
  const first = structuredClone(baseEvent);
  first.externalIds = {};
  first.homeTeam = 'Elvetia';
  first.awayTeam = 'Algeria';
  first.competition = 'International Friendly';
  first.startsAt = '2026-06-22T10:00:00.000Z';

  const second = structuredClone(baseEvent);
  second.id = 'second:different-competition';
  second.externalIds = {};
  second.homeTeam = 'Elvetia';
  second.awayTeam = 'Algeria';
  second.competition = 'African Nations Championship';
  second.startsAt = '2026-06-22T10:00:00.000Z';
  second.bookmakers[0].name = 'Second';

  const provider = new CompositeProvider([
    { name: 'First', getOdds: async () => [first] },
    { name: 'Second', getOdds: async () => [second] },
  ]);

  const result = await provider.getOdds();

  assert.equal(result.events.length, 2);
});

test('fuzzy-merges fixtures with equivalent competition wording', async () => {
  const first = structuredClone(baseEvent);
  first.externalIds = {};
  first.homeTeam = 'AC Milan';
  first.awayTeam = 'Manchester Utd';
  first.competition = 'International Clubs Friendly';
  first.startsAt = '2026-06-22T10:00:00.000Z';

  const second = structuredClone(baseEvent);
  second.id = 'second:same-competition';
  second.externalIds = {};
  second.homeTeam = 'Milan';
  second.awayTeam = 'Manchester United';
  second.competition = 'Club Friendlies';
  second.startsAt = '2026-06-22T10:02:00.000Z';
  second.bookmakers[0].name = 'Second';

  const provider = new CompositeProvider([
    { name: 'First', getOdds: async () => [first] },
    { name: 'Second', getOdds: async () => [second] },
  ]);

  const result = await provider.getOdds();

  assert.equal(result.events.length, 1);
});

test('normalizes reversed home and away bookmaker markets when merging fixtures', async () => {
  const first = structuredClone(baseEvent);
  first.externalIds = {};
  first.homeTeam = 'Franta';
  first.awayTeam = 'Romania';
  first.bookmakers[0].name = 'First';
  first.bookmakers[0].markets = {
    h2h: { home: 1.6, draw: 3.5, away: 9 },
    doubleChance: { homeDraw: 1.08, homeAway: 1.22, drawAway: 2.4 },
    drawNoBet: { home: 1.2, away: 4.5 },
    asianHandicap_plus_0_5: { home: 1.3, away: 3.2 },
    handicap_minus_1_5: { home: 2.6, draw: 3.7, away: 2.1 },
    market_total_goluri_home_1_5: { over: 2.4, under: 1.5 },
    market_marcheaza_home: { yes: 1.3, no: 3.1 },
    market_clean_sheet_away: { yes: 4.8, no: 1.12 },
    totalGoals_2_5: { over: 2.05, under: 1.78 },
  };

  const second = structuredClone(baseEvent);
  second.id = 'second:reversed';
  second.externalIds = {};
  second.homeTeam = 'Romania';
  second.awayTeam = 'Franta';
  second.bookmakers[0].name = 'Second';
  second.bookmakers[0].markets = {
    h2h: { home: 9.2, draw: 3.4, away: 1.61 },
    doubleChance: { homeDraw: 2.5, homeAway: 1.24, drawAway: 1.09 },
    drawNoBet: { home: 4.7, away: 1.22 },
    asianHandicap_plus_0_5: { home: 3.25, away: 1.31 },
    handicap_minus_1_5: { home: 8, draw: 4.2, away: 1.44 },
    market_total_goluri_home_1_5: { over: 3.4, under: 1.22 },
    market_marcheaza_home: { yes: 2.9, no: 1.35 },
    market_clean_sheet_away: { yes: 2.2, no: 1.64 },
    totalGoals_2_5: { over: 2.08, under: 1.74 },
  };

  const provider = new CompositeProvider([
    { name: 'First', getOdds: async () => [first] },
    { name: 'Second', getOdds: async () => [second] },
  ]);

  const result = await provider.getOdds();

  assert.equal(result.events.length, 1);
  const event = result.events[0];
  assert.equal(event.homeTeam, 'Franta');
  assert.equal(event.awayTeam, 'Romania');
  assert.deepEqual(event.matchEvidence, [
    'fuzzy team/time',
    'home/away order normalized',
  ]);

  const secondMarkets = event.bookmakers.find((bookmaker) => bookmaker.name === 'Second').markets;
  assert.deepEqual(secondMarkets.h2h, { home: 1.61, draw: 3.4, away: 9.2 });
  assert.deepEqual(secondMarkets.doubleChance, {
    homeDraw: 1.09,
    homeAway: 1.24,
    drawAway: 2.5,
  });
  assert.deepEqual(secondMarkets.drawNoBet, { home: 1.22, away: 4.7 });
  assert.deepEqual(secondMarkets.asianHandicap_minus_0_5, { home: 1.31, away: 3.25 });
  assert.deepEqual(secondMarkets.handicap_plus_1_5, { home: 1.44, draw: 4.2, away: 8 });
  assert.deepEqual(secondMarkets.market_total_goluri_away_1_5, { over: 3.4, under: 1.22 });
  assert.deepEqual(secondMarkets.market_marcheaza_away, { yes: 2.9, no: 1.35 });
  assert.deepEqual(secondMarkets.market_clean_sheet_home, { yes: 2.2, no: 1.64 });
  assert.deepEqual(secondMarkets.totalGoals_2_5, { over: 2.08, under: 1.74 });
});

test('prevents false 1X2 underrounds from reversed bookmaker team order', async () => {
  const first = structuredClone(baseEvent);
  first.externalIds = {};
  first.homeTeam = 'Franta';
  first.awayTeam = 'Romania';
  first.bookmakers[0].name = 'First';
  first.bookmakers[0].markets = {
    h2h: { home: 1.6, draw: 3.5, away: 9 },
  };

  const second = structuredClone(baseEvent);
  second.id = 'second:false-positive';
  second.externalIds = {};
  second.homeTeam = 'Romania';
  second.awayTeam = 'Franta';
  second.bookmakers[0].name = 'Second';
  second.bookmakers[0].markets = {
    h2h: { home: 9.2, draw: 3.4, away: 1.61 },
  };

  const result = await new CompositeProvider([
    { name: 'First', getOdds: async () => [first] },
    { name: 'Second', getOdds: async () => [second] },
  ]).getOdds();

  const [event] = result.events;
  const best = Object.fromEntries(
    ['home', 'draw', 'away'].map((outcome) => [
      outcome,
      Math.max(...event.bookmakers.map((bookmaker) => bookmaker.markets.h2h[outcome])),
    ]),
  );
  const implied = 1 / best.home + 1 / best.draw + 1 / best.away;

  assert.deepEqual(best, { home: 1.61, draw: 3.5, away: 9.2 });
  assert.ok(implied > 1, `expected aligned odds not to produce arbitrage, got ${implied}`);
});

test('does not fuzzy-merge women fixtures with unmarked senior fixtures', async () => {
  const first = structuredClone(baseEvent);
  first.externalIds = {};
  first.homeTeam = 'Arsenal Women';
  first.awayTeam = 'Chelsea Women';
  first.competition = 'England Women';
  first.startsAt = '2026-06-22T10:00:00.000Z';

  const second = structuredClone(baseEvent);
  second.id = 'second:senior';
  second.externalIds = {};
  second.homeTeam = 'Arsenal';
  second.awayTeam = 'Chelsea';
  second.competition = 'England';
  second.startsAt = '2026-06-22T10:00:00.000Z';
  second.bookmakers[0].name = 'Second';

  const provider = new CompositeProvider([
    { name: 'First', getOdds: async () => [first] },
    { name: 'Second', getOdds: async () => [second] },
  ]);

  const result = await provider.getOdds();

  assert.equal(result.events.length, 2);
});

test('merges women fixtures when both feeds mark the variant differently', async () => {
  const first = structuredClone(baseEvent);
  first.externalIds = {};
  first.homeTeam = 'F/Guangdong Meizhou H.';
  first.awayTeam = 'F/Wuhan Jianghan Univ.';
  first.startsAt = '2026-06-22T10:00:00.000Z';

  const second = structuredClone(baseEvent);
  second.id = 'second:women';
  second.externalIds = {};
  second.homeTeam = 'Guangdong Meizhou Hakka Women';
  second.awayTeam = 'Wuhan Jianghan Univ Women';
  second.startsAt = '2026-06-22T10:00:00.000Z';
  second.bookmakers[0].name = 'Second';

  const provider = new CompositeProvider([
    { name: 'First', getOdds: async () => [first] },
    { name: 'Second', getOdds: async () => [second] },
  ]);

  const result = await provider.getOdds();

  assert.equal(result.events.length, 1);
  assert.deepEqual(
    result.events[0].bookmakers.map((bookmaker) => bookmaker.name),
    ['First', 'Second'],
  );
});

test('does not fuzzy-merge youth fixtures with senior fixtures', async () => {
  const first = structuredClone(baseEvent);
  first.externalIds = {};
  first.homeTeam = 'Spania U19';
  first.awayTeam = 'Austria U19';
  first.startsAt = '2026-06-22T10:00:00.000Z';

  const second = structuredClone(baseEvent);
  second.id = 'second:senior-youth';
  second.externalIds = {};
  second.homeTeam = 'Spania';
  second.awayTeam = 'Austria';
  second.startsAt = '2026-06-22T10:00:00.000Z';
  second.bookmakers[0].name = 'Second';

  const provider = new CompositeProvider([
    { name: 'First', getOdds: async () => [first] },
    { name: 'Second', getOdds: async () => [second] },
  ]);

  const result = await provider.getOdds();

  assert.equal(result.events.length, 2);
});

test('merges exact-time fixtures with roman numerals and abbreviation variants', async () => {
  const first = structuredClone(baseEvent);
  first.externalIds = {};
  first.homeTeam = 'Vindbjart';
  first.awayTeam = 'Stabaek 2';
  first.startsAt = '2026-06-28T14:00:00.000Z';

  const second = structuredClone(baseEvent);
  second.id = 'second:roman';
  second.externalIds = {};
  second.homeTeam = 'Vindbjart';
  second.awayTeam = 'Stabaek II';
  second.startsAt = '2026-06-28T14:00:00.000Z';
  second.bookmakers[0].name = 'Second';

  const provider = new CompositeProvider([
    { name: 'First', getOdds: async () => [first] },
    { name: 'Second', getOdds: async () => [second] },
  ]);

  const result = await provider.getOdds();

  assert.equal(result.events.length, 1);
  assert.deepEqual(
    result.events[0].bookmakers.map((bookmaker) => bookmaker.name),
    ['First', 'Second'],
  );
});

test('merges exact-time fixtures with partial team names from different feeds', async () => {
  const first = structuredClone(baseEvent);
  first.externalIds = { sportradar: '69614778' };
  first.homeTeam = 'Juventud Antoniana';
  first.awayTeam = 'Defensores de Vilelas';
  first.startsAt = '2026-06-28T18:30:00.000Z';

  const second = structuredClone(baseEvent);
  second.id = 'second:partial';
  second.externalIds = {};
  second.homeTeam = 'Juventud Antoniana';
  second.awayTeam = 'Defensores Puerto Vilelas';
  second.startsAt = '2026-06-28T18:30:00.000Z';
  second.bookmakers[0].name = 'Second';

  const provider = new CompositeProvider([
    { name: 'First', getOdds: async () => [first] },
    { name: 'Second', getOdds: async () => [second] },
  ]);

  const result = await provider.getOdds();

  assert.equal(result.events.length, 1);
  assert.deepEqual(
    result.events[0].bookmakers.map((bookmaker) => bookmaker.name),
    ['First', 'Second'],
  );
});

test('merges exact-time fixtures with common short bookmaker abbreviations', async () => {
  const first = structuredClone(baseEvent);
  first.externalIds = {};
  first.homeTeam = 'New York Red Bulls II';
  first.awayTeam = 'Philadelphia Union II';
  first.startsAt = '2026-06-28T23:00:00.000Z';

  const second = structuredClone(baseEvent);
  second.id = 'second:abbreviation';
  second.externalIds = {};
  second.homeTeam = 'New York RB II';
  second.awayTeam = 'Philadelphia Union II';
  second.startsAt = '2026-06-28T23:00:00.000Z';
  second.bookmakers[0].name = 'Second';

  const provider = new CompositeProvider([
    { name: 'First', getOdds: async () => [first] },
    { name: 'Second', getOdds: async () => [second] },
  ]);

  const result = await provider.getOdds();

  assert.equal(result.events.length, 1);
  assert.deepEqual(
    result.events[0].bookmakers.map((bookmaker) => bookmaker.name),
    ['First', 'Second'],
  );
});

test('merges exact-time fixtures with noisy single-letter location abbreviations', async () => {
  const first = structuredClone(baseEvent);
  first.externalIds = { sportradar: '70250794' };
  first.homeTeam = 'Spartak M. II';
  first.awayTeam = 'Luki Energiya';
  first.startsAt = '2026-06-28T15:00:00.000Z';

  const second = structuredClone(baseEvent);
  second.id = 'second:location-abbreviation';
  second.externalIds = {};
  second.homeTeam = 'Spartak Moscova II';
  second.awayTeam = 'Luki Energiya V.Luki';
  second.startsAt = '2026-06-28T15:00:00.000Z';
  second.bookmakers[0].name = 'Second';

  const provider = new CompositeProvider([
    { name: 'First', getOdds: async () => [first] },
    { name: 'Second', getOdds: async () => [second] },
  ]);

  const result = await provider.getOdds();

  assert.equal(result.events.length, 1);
  assert.deepEqual(
    result.events[0].bookmakers.map((bookmaker) => bookmaker.name),
    ['First', 'Second'],
  );
});

test('does not fuzzy-merge two events from the same bookmaker without a shared id', async () => {
  const first = structuredClone(baseEvent);
  first.externalIds = {};
  first.homeTeam = 'River Plate';
  first.awayTeam = 'La Luz FC';
  first.startsAt = '2026-06-28T15:00:00.000Z';

  const second = structuredClone(baseEvent);
  second.id = 'first:near-duplicate';
  second.externalIds = {};
  second.homeTeam = 'River Plate Montevideo';
  second.awayTeam = 'La Luz FC';
  second.startsAt = '2026-06-28T15:00:00.000Z';

  const provider = new CompositeProvider([
    { name: 'First', getOdds: async () => [first, second] },
  ]);

  const result = await provider.getOdds();

  assert.equal(result.events.length, 2);
});
