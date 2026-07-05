const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SPORTS,
  DEFAULT_SPORT,
  resolveSportKey,
  sportLabel,
  sportCanonical,
  parseSportList,
  providerSportId,
  marketOutcomes,
  allSportKeys,
  allSportOptions,
} = require('../src/sport-config');

test('exports sport definitions', () => {
  assert.ok(SPORTS.football);
  assert.ok(SPORTS.basketball);
  assert.ok(SPORTS.tennis);
  assert.ok(SPORTS.icehockey);
});

test('resolveSportKey handles various inputs', () => {
  assert.equal(resolveSportKey('football'), 'football');
  assert.equal(resolveSportKey('Football'), 'football');
  assert.equal(resolveSportKey('basketball'), 'basketball');
  assert.equal(resolveSportKey('ICE HOCKEY'), 'icehockey');
  assert.equal(resolveSportKey(''), DEFAULT_SPORT);
  assert.equal(resolveSportKey('unknown'), DEFAULT_SPORT);
});

test('sportLabel returns human-readable label', () => {
  assert.equal(sportLabel('football'), 'Football');
  assert.equal(sportLabel('basketball'), 'Basketball');
  assert.equal(sportLabel('icehockey'), 'Ice Hockey');
});

test('sportCanonical returns canonical sport name', () => {
  assert.equal(sportCanonical('football'), 'Football');
  assert.equal(sportCanonical('basketball'), 'Basketball');
});

test('parseSportList parses comma-separated list', () => {
  const list = parseSportList('football,basketball,tennis');
  assert.equal(list.length, 3);
  assert.ok(list.includes('Football'));
  assert.ok(list.includes('Basketball'));
  assert.ok(list.includes('Tennis'));
});

test('parseSportList returns default when empty', () => {
  const list = parseSportList('');
  assert.equal(list.length, 1);
  assert.equal(list[0], 'Football');
});

test('providerSportId returns correct ID per provider', () => {
  assert.equal(providerSportId('football', 'fortuna'), 'ufo:sprt:00');
  assert.equal(providerSportId('football', 'superbet'), '5');
  assert.equal(providerSportId('basketball', 'superbet'), '2');
  assert.equal(providerSportId('tennis', 'superbet'), '7');
  assert.equal(providerSportId('unknown', 'fortuna'), null);
});

test('marketOutcomes returns expected outcomes per sport', () => {
  // Football h2h has 3 outcomes
  const fbH2h = marketOutcomes('football', 'h2h');
  assert.deepEqual(fbH2h, ['home', 'draw', 'away']);

  // Basketball h2h has 2 outcomes (no draw)
  const bkH2h = marketOutcomes('basketball', 'h2h');
  assert.deepEqual(bkH2h, ['home', 'away']);

  // Tennis h2h has 2 outcomes
  const tnH2h = marketOutcomes('tennis', 'h2h');
  assert.deepEqual(tnH2h, ['home', 'away']);
});

test('allSportKeys returns all sport keys', () => {
  const keys = allSportKeys();
  assert.ok(keys.includes('football'));
  assert.ok(keys.includes('basketball'));
  assert.ok(keys.includes('tennis'));
  assert.ok(keys.includes('icehockey'));
});

test('allSportOptions returns label+key pairs', () => {
  const options = allSportOptions();
  assert.ok(options.length >= 4);
  assert.ok(options.some((o) => o.key === 'football' && o.label === 'Football'));
  assert.ok(options.some((o) => o.key === 'icehockey' && o.label === 'Ice Hockey'));
});
