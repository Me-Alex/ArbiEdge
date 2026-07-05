const test = require('node:test');
const assert = require('node:assert/strict');

const { auditOdds } = require('../src/odds-audit');

function eventWithMarkets(markets) {
  return [{
    id: 'event-1',
    homeTeam: 'Home',
    awayTeam: 'Away',
    startsAt: '2026-06-29T12:00:00.000Z',
    bookmakers: [{
      name: 'Book',
      markets,
    }],
  }];
}

test('passes clean normalized odds without warnings', () => {
  const audit = auditOdds(eventWithMarkets({
    h2h: { home: 2.2, draw: 3.4, away: 3.1 },
    doubleChance: { homeDraw: 1.3, homeAway: 1.25, drawAway: 1.5 },
    drawNoBet: { home: 1.65, away: 2.25 },
    totalGoals_1_5: { over: 1.4, under: 2.8 },
    totalGoals_2_5: { over: 1.9, under: 1.9 },
    totalGoals_3_5: { over: 2.6, under: 1.45 },
  }));

  assert.equal(audit.status, 'ok');
  assert.equal(audit.warning, null);
  assert.equal(audit.issueCounts.invalidOdds, 0);
  assert.equal(audit.issueCounts.doubleChanceViolations, 0);
  assert.equal(audit.issueCounts.totalLineMonotonicity, 0);
  assert.equal(audit.issueCounts.sameBookHighOverround, 0);
});

test('flags invalid odds and impossible double chance prices', () => {
  const audit = auditOdds(eventWithMarkets({
    h2h: { home: 1.4, draw: 4.5, away: 8 },
    doubleChance: { homeDraw: 1.2, homeAway: 1.8, drawAway: 1.1 },
    totalGoals_2_5: { over: 0, under: 1.95 },
  }));

  assert.equal(audit.status, 'warning');
  assert.equal(audit.issueCounts.invalidOdds, 1);
  assert.equal(audit.issueCounts.doubleChanceViolations, 1);
  assert.match(audit.warning, /validation issue/);
  assert.equal(audit.issues.invalidOdds.samples[0].marketKey, 'totalGoals_2_5');
  assert.equal(audit.issues.doubleChanceViolations.samples[0].selection, '12');
});

test('flags draw no bet prices above equivalent h2h prices', () => {
  const audit = auditOdds(eventWithMarkets({
    h2h: { home: 1.8, draw: 3.2, away: 4.8 },
    drawNoBet: { home: 2.1, away: 2.5 },
  }));

  assert.equal(audit.issueCounts.drawNoBetViolations, 1);
  assert.equal(audit.issues.drawNoBetViolations.samples[0].side, 'home');
});

test('flags non-monotonic total goal lines', () => {
  const audit = auditOdds(eventWithMarkets({
    totalGoals_1_5: { over: 1.8, under: 2.1 },
    totalGoals_2_5: { over: 1.6, under: 2.4 },
  }));

  assert.equal(audit.issueCounts.totalLineMonotonicity, 1);
  assert.equal(audit.issues.totalLineMonotonicity.samples[0].marketName, 'totalGoals');
});

test('flags same-book strict underrounds', () => {
  const audit = auditOdds(eventWithMarkets({
    bothTeamsToScore: { yes: 2.5, no: 2.5 },
  }));

  assert.equal(audit.issueCounts.sameBookUnderround, 1);
  assert.equal(audit.issues.sameBookUnderround.samples[0].marketKey, 'bothTeamsToScore');
});

test('marks extreme same-book overround as review', () => {
  const audit = auditOdds(eventWithMarkets({
    h2h: { home: 1.35, draw: 2.1, away: 2.2 },
  }));

  assert.equal(audit.status, 'review');
  assert.equal(audit.issueCounts.sameBookHighOverround, 1);
  assert.equal(audit.issues.sameBookHighOverround.samples[0].marketKey, 'h2h');
  assert.equal(audit.issues.sameBookHighOverround.samples[0].implied, 1.671477);
  assert.match(audit.warning, /suspicious price issue/);
});

test('marks extreme odds as review without blocking validation', () => {
  const audit = auditOdds(eventWithMarkets({
    market_player_total_goals: { '1plus': 101, '2plus': 150 },
  }));

  assert.equal(audit.status, 'review');
  assert.equal(audit.issueCounts.highOdds, 2);
  assert.match(audit.warning, /suspicious price issues/);
});
