const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  COVERAGE_STATUSES,
  ROMANIAN_BOOKMAKER_COVERAGE,
  coverageByStatus,
  coverageRemaining,
  coverageSummary,
} = require('../src/bookmaker-coverage');

test('tracks Romanian bookmaker coverage with valid statuses and unique domains', () => {
  const statuses = new Set(Object.values(COVERAGE_STATUSES));
  const domains = new Set();

  for (const entry of ROMANIAN_BOOKMAKER_COVERAGE) {
    assert.ok(entry.name, 'entry requires a name');
    assert.ok(entry.domain, `${entry.name} requires a domain`);
    assert.ok(statuses.has(entry.status), `${entry.name} has an unknown status`);
    assert.equal(domains.has(entry.domain), false, `${entry.domain} is duplicated`);
    domains.add(entry.domain);
  }
});

test('requires active coverage entries to name their adapter', () => {
  const active = ROMANIAN_BOOKMAKER_COVERAGE.filter((entry) =>
    [COVERAGE_STATUSES.direct, COVERAGE_STATUSES.browserOptional].includes(entry.status),
  );

  assert.ok(active.length >= 20);
  assert.equal(active.every((entry) => entry.adapter), true);
});

test('keeps remaining licensed sportsbook targets visible', () => {
  const remainingDomains = new Set(coverageRemaining().map((entry) => entry.domain));

  for (const domain of [
    'betfair.ro',
    'favbet.ro',
    'mozzartbet.ro',
    '777.ro',
    'victorybet.ro',
    'xbet.ro',
    'pokerstarssports.ro',
    'winboss.ro',
    'powerbet.ro',
    'magnumbet.ro',
    'excelbet.ro',
    'spin.ro',
    'royalslots.ro',
  ]) {
    assert.equal(remainingDomains.has(domain), true, `${domain} should remain tracked`);
  }
});

test('tracks a discovery URL for every remaining provider target', () => {
  const providerTargets = ROMANIAN_BOOKMAKER_COVERAGE.filter(
    (entry) => entry.status === COVERAGE_STATUSES.remainingProvider,
  );

  assert.equal(providerTargets.length, 14);
  for (const entry of providerTargets) {
    assert.ok(entry.discoveryUrl, `${entry.name} requires a discovery URL`);
    assert.doesNotThrow(() => new URL(entry.discoveryUrl));
  }
});

test('tracks evidence for licensed domains without visible sportsbook markets', () => {
  const nonSportsbookTargets = ROMANIAN_BOOKMAKER_COVERAGE.filter(
    (entry) => entry.status === COVERAGE_STATUSES.notSportsbook,
  );

  assert.equal(nonSportsbookTargets.length, 7);
  for (const entry of nonSportsbookTargets) {
    assert.ok(entry.note, `${entry.name} requires a note`);
    assert.ok(entry.evidenceUrl, `${entry.name} requires an evidence URL`);
    assert.doesNotThrow(() => new URL(entry.evidenceUrl));
  }
});

test('tracks evidence for inactive licensed sportsbook domains', () => {
  const inactiveTargets = ROMANIAN_BOOKMAKER_COVERAGE.filter(
    (entry) => entry.status === COVERAGE_STATUSES.inactive,
  );

  assert.equal(inactiveTargets.length, 1);
  for (const entry of inactiveTargets) {
    assert.ok(entry.note, `${entry.name} requires a note`);
    assert.ok(entry.evidenceUrl, `${entry.name} requires an evidence URL`);
    assert.doesNotThrow(() => new URL(entry.evidenceUrl));
  }
});

test('tracks evidence for temporarily unavailable licensed domains', () => {
  const unavailableTargets = ROMANIAN_BOOKMAKER_COVERAGE.filter(
    (entry) => entry.status === COVERAGE_STATUSES.temporarilyUnavailable,
  );

  assert.equal(unavailableTargets.length, 2);
  for (const entry of unavailableTargets) {
    assert.ok(entry.note, `${entry.name} requires a note`);
    assert.ok(entry.evidenceUrl, `${entry.name} requires an evidence URL`);
    assert.doesNotThrow(() => new URL(entry.evidenceUrl));
  }
});

test('summarizes current coverage status counts', () => {
  assert.deepEqual(coverageByStatus(), {
    direct: 28,
    browserOptional: 1,
    remainingProvider: 14,
    needsTriage: 9,
    notSportsbook: 7,
    inactive: 1,
    temporarilyUnavailable: 2,
  });
});

test('builds a public coverage summary for the application API', () => {
  const summary = coverageSummary();

  assert.equal(summary.total, 62);
  assert.equal(summary.active, 29);
  assert.equal(summary.remaining, 23);
  assert.deepEqual(summary.counts, {
    direct: 28,
    browserOptional: 1,
    remainingProvider: 14,
    needsTriage: 9,
    notSportsbook: 7,
    inactive: 1,
    temporarilyUnavailable: 2,
  });
  assert.equal(summary.entries.length, summary.total);
});

test('README runtime bookmaker list mirrors direct coverage entries', () => {
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  const section = readme.match(
    /The default runtime concurrently loads direct Romanian bookmaker adapters for:\n\n(?<list>(?:- .+\n)+)/,
  );
  assert.ok(section, 'README should include the direct runtime bookmaker list');

  const readmeNames = section.groups.list
    .trim()
    .split(/\r?\n/)
    .map((line) => line.replace(/^- /, ''))
    .sort((left, right) => left.localeCompare(right));
  const directNames = ROMANIAN_BOOKMAKER_COVERAGE
    .filter((entry) => entry.status === COVERAGE_STATUSES.direct)
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  assert.deepEqual(readmeNames, directNames);
});
