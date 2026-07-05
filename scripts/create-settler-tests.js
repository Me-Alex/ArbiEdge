// Test scaffold generator — writes ai-pick-settler.test.js
const fs = require('fs');
const path = require('path');
const os = require('os');

const content = `'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  settlePick,
  parseSelection,
  inferResultFromOdds,
  findMatchingEvent,
  getMarketPrices,
  classifyMarket,
  normalizeOutcome,
  getPendingPicks,
} = require('../src/ai-pick-settler');

function makePick(overrides = {}) {
  return {
    loggedAt: '2026-01-01T00:00:00Z',
    action: 'created',
    entry: {
      id: 'pick_test1',
      event: 'Team A vs Team B',
      market: 'h2h',
      selection: 'Home @ Book A',
      bookmaker: 'Book A',
      odds: 2.50,
      eventStartsAt: '2025-12-31T18:00:00Z',
      ...overrides,
    },
  };
}

function makeEvent(overrides = {}) {
  return {
    homeTeam: 'Team A',
    awayTeam: 'Team B',
    startsAt: '2025-12-31T18:00:00Z',
    competition: 'Test League',
    bookmakers: [{
      name: 'Book A',
      markets: {
        h2h: { home: 1.05, draw: 12.0, away: 20.0 },
      },
    }],
    ...overrides,
  };
}

// ===== parseSelection =====
test('parseSelection extracts outcome from "Home @ Book A"', () => {
  const r = parseSelection('Home @ Book A');
  assert.equal(r.outcome, 'home');
  assert.equal(r.label, 'Home');
});

test('parseSelection normalizes "1" to home', () => {
  assert.equal(parseSelection('1 @ Superbet').outcome, 'home');
});

test('parseSelection normalizes "X" to draw', () => {
  assert.equal(parseSelection('X @ Fortuna').outcome, 'draw');
});

test('parseSelection normalizes "2" to away', () => {
  assert.equal(parseSelection('2 @ Betano').outcome, 'away');
});

test('parseSelection normalizes Over/Under', () => {
  assert.equal(parseSelection('Over @ Avg').outcome, 'over');
  assert.equal(parseSelection('Under @ Avg').outcome, 'under');
});

test('parseSelection normalizes Yes/No', () => {
  assert.equal(parseSelection('Yes @ Book').outcome, 'yes');
  assert.equal(parseSelection('No @ Book').outcome, 'no');
});

test('parseSelection normalizes X2', () => {
  assert.equal(parseSelection('X2 @ Book A').outcome, 'drawAway');
});

test('parseSelection returns null for empty string', () => {
  assert.equal(parseSelection('').outcome, null);
});

// ===== normalizeOutcome =====
test('normalizeOutcome maps all standard labels', () => {
  assert.equal(normalizeOutcome('Home'), 'home');
  assert.equal(normalizeOutcome('1'), 'home');
  assert.equal(normalizeOutcome('Draw'), 'draw');
  assert.equal(normalizeOutcome('X'), 'draw');
  assert.equal(normalizeOutcome('Away'), 'away');
  assert.equal(normalizeOutcome('2'), 'away');
  assert.equal(normalizeOutcome('Over'), 'over');
  assert.equal(normalizeOutcome('Under'), 'under');
  assert.equal(normalizeOutcome('Yes'), 'yes');
  assert.equal(normalizeOutcome('No'), 'no');
  assert.equal(normalizeOutcome('1X'), 'homeDraw');
  assert.equal(normalizeOutcome('12'), 'homeAway');
  assert.equal(normalizeOutcome('X2'), 'drawAway');
});

// ===== classifyMarket =====
test('classifyMarket returns canonical families', () => {
  assert.equal(classifyMarket('h2h'), 'h2h');
  assert.equal(classifyMarket('totalGoals_2_5'), 'totalLine');
  assert.equal(classifyMarket('bothTeamsToScore'), 'bothTeamsToScore');
  assert.equal(classifyMarket('doubleChance'), 'doubleChance');
  assert.equal(classifyMarket('drawNoBet'), 'drawNoBet');
  assert.equal(classifyMarket('toQualify'), 'toQualify');
});

// ===== findMatchingEvent =====
test('findMatchingEvent matches exact team names', () => {
  const result = findMatchingEvent('Team A vs Team B', [makeEvent()]);
  assert.ok(result);
  assert.equal(result.homeTeam, 'Team A');
});

test('findMatchingEvent returns null for no match', () => {
  const result = findMatchingEvent('Team A vs Team B', [
    makeEvent({ homeTeam: 'Other', awayTeam: 'Sides' }),
  ]);
  assert.equal(result, null);
});

test('findMatchingEvent handles null inputs', () => {
  assert.equal(findMatchingEvent('', [makeEvent()]), null);
  assert.equal(findMatchingEvent('A vs B', null), null);
});

test('findMatchingEvent does fuzzy containment matching', () => {
  const event = makeEvent({ homeTeam: 'Manchester United', awayTeam: 'Liverpool' });
  const result = findMatchingEvent('Man United vs Liverpool', [event]);
  assert.ok(result);
});

// ===== getMarketPrices =====
test('getMarketPrices extracts best prices from multiple bookmakers', () => {
  const event = makeEvent({
    bookmakers: [
      { name: 'Book A', markets: { h2h: { home: 2.0, draw: 3.5, away: 3.0 } } },
      { name: 'Book B', markets: { h2h: { home: 2.1, draw: 3.3, away: 2.9 } } },
    ],
  });
  const prices = getMarketPrices(event, 'h2h');
  assert.equal(prices.home, 2.1);
  assert.equal(prices.away, 3.0);
  assert.equal(prices.draw, 3.5);
});

test('getMarketPrices returns null when market not found', () => {
  const event = makeEvent({ bookmakers: [{ name: 'A', markets: {} }] });
  assert.equal(getMarketPrices(event, 'h2h'), null);
});

// ===== inferResultFromOdds =====
test('inferResultFromOdds detects clear winner at 1.05', () => {
  const result = inferResultFromOdds('h2h', { home: 1.05, draw: 12.0, away: 20.0 });
  assert.ok(result);
  assert.equal(result.likelyWinner, 'home');
  assert.equal(result.confidence, 'trusted');
});

test('inferResultFromOdds returns null when odds are ambiguous', () => {
  const result = inferResultFromOdds('h2h', { home: 2.0, draw: 3.5, away: 3.0 });
  assert.equal(result, null);
});

test('inferResultFromOdds returns null for unknown market family', () => {
  const result = inferResultFromOdds('exotic_market', { a: 1.01, b: 50.0 });
  assert.equal(result, null);
});

test('inferResultFromOdds handles 2-way Over/Under', () => {
  const result = inferResultFromOdds('totalGoals_2_5', { over: 1.08, under: 8.0 });
  assert.ok(result);
  assert.equal(result.likelyWinner, 'over');
});

test('inferResultFromOdds handles BTTS yes/no', () => {
  const result = inferResultFromOdds('bothTeamsToScore', { yes: 1.03, no: 25.0 });
  assert.ok(result);
  assert.equal(result.likelyWinner, 'yes');
});

test('inferResultFromOdds high confidence for odds at 1.20', () => {
  const result = inferResultFromOdds('h2h', { home: 1.20, draw: 7.0, away: 10.0 });
  assert.ok(result);
  assert.equal(result.confidence, 'high');
});

// ===== settlePick =====
test('settlePick returns null for recently created picks (3h buffer)', () => {
  const pick = makePick({ loggedAt: new Date().toISOString() });
  assert.equal(settlePick(pick, [], []), null);
});

test('settlePick returns null if event is still in live feed', () => {
  const pick = makePick();
  assert.equal(settlePick(pick, [makeEvent()], []), null);
});

test('settlePick infers won when selection matches closing odds winner', () => {
  const pick = makePick({ selection: 'Home @ Book A', market: 'h2h' });
  const prev = [makeEvent()];
  const result = settlePick(pick, [], prev);
  assert.ok(result);
  assert.equal(result.status, 'settled');
  assert.equal(result.result, 'won');
});

test('settlePick infers lost when selection does not match winner', () => {
  const pick = makePick({ selection: 'Away @ Book A', market: 'h2h' });
  const prev = [makeEvent()]; // home won at 1.05
  const result = settlePick(pick, [], prev);
  assert.ok(result);
  assert.equal(result.status, 'settled');
  assert.equal(result.result, 'lost');
});

test('settlePick returns review when event finished but no closing odds', () => {
  const pick = makePick({ selection: 'Home @ Book A', market: 'h2h' });
  const result = settlePick(pick, [], []);
  assert.ok(result);
  assert.equal(result.status, 'review');
  assert.ok(result.reason.includes('cannot be inferred'));
});

test('settlePick returns review for unparsable selection', () => {
  const pick = makePick({ selection: '', market: 'h2h' });
  const result = settlePick(pick, [], []);
  assert.ok(result);
  assert.equal(result.status, 'review');
  assert.ok(result.reason.includes('parse'));
});

test('settlePick handles Over/Under markets correctly', () => {
  const pick = makePick({ selection: 'Over @ Avg', market: 'totalGoals_2_5' });
  const prev = [makeEvent({
    bookmakers: [{ name: 'A', markets: { totalGoals_2_5: { over: 1.02, under: 30.0 } } }],
  })];
  const result = settlePick(pick, [], prev);
  assert.ok(result);
  assert.equal(result.status, 'settled');
  assert.equal(result.result, 'won');
});

test('settlePick handles Under lost case', () => {
  const pick = makePick({ selection: 'Under @ Avg', market: 'totalGoals_2_5' });
  const prev = [makeEvent({
    bookmakers: [{ name: 'A', markets: { totalGoals_2_5: { over: 1.02, under: 30.0 } } }],
  })];
  const result = settlePick(pick, [], prev);
  assert.ok(result);
  assert.equal(result.result, 'lost');
});

// ===== getPendingPicks =====
test('getPendingPicks filters out settled picks from JSONL', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-pick-'));
  const logPath = path.join(tmpDir, 'ai-picks.jsonl');
  fs.writeFileSync(logPath, [
    JSON.stringify({ loggedAt: '2026-01-01T00:00:00Z', action: 'created', entry: { id: 'p1', status: 'pending', event: 'A vs B', market: 'h2h', selection: 'Home @ Book', odds: 2.5 } }),
    JSON.stringify({ loggedAt: '2026-01-02T00:00:00Z', action: 'settled', entry: { id: 'p2', event: 'C vs D' }, settlement: { result: 'won' } }),
    JSON.stringify({ loggedAt: '2026-01-03T00:00:00Z', action: 'created', entry: { id: 'p3', status: 'pending', event: 'E vs F', market: 'h2h', selection: 'Away @ Book', odds: 3.0 } }),
  ].join('\\n') + '\\n', 'utf8');

  const pending = getPendingPicks(logPath);
  assert.equal(pending.length, 2);
  assert.equal(pending[0].entry.id, 'p1');
  assert.equal(pending[1].entry.id, 'p3');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('getPendingPicks returns empty for non-existent file', () => {
  assert.deepEqual(getPendingPicks('/nonexistent/path.jsonl'), []);
});
`;

const outPath = path.join(__dirname, '..', 'test', 'ai-pick-settler.test.js');
fs.writeFileSync(outPath, content, 'utf8');
console.log('Written: ' + outPath);
