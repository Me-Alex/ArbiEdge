const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { BetTracker } = require('../src/bet-tracker');

function createTempTracker() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bet-tracker-test-'));
  const logPath = path.join(tmpDir, 'bets.jsonl');
  return new BetTracker({ logPath });
}

test('creates and retrieves bets', () => {
  const tracker = createTempTracker();
  const bet = tracker.create({
    event: 'Team A vs Team B',
    market: '1X2',
    selection: 'Home @ Fortuna',
    odds: 2.5,
    stake: 100,
    closingOdds: '2.4',
    sport: 'Football',
  });

  assert.ok(bet.id);
  assert.equal(bet.status, 'pending');

  const all = tracker.readAll();
  assert.equal(all.length, 1);
  assert.equal(all[0].event, 'Team A vs Team B');
  assert.equal(all[0].closingOdds, 2.4);
});

test('settles a bet as won', () => {
  const tracker = createTempTracker();
  const bet = tracker.create({
    event: 'Team A vs Team B',
    odds: 2.5,
    stake: 100,
    market: 'h2h',
  });

  const settled = tracker.settle(bet.id, 'won', { closingOdds: 2.3 });
  assert.equal(settled.status, 'won');
  assert.equal(settled.closingOdds, 2.3);
  assert.ok(settled.settledAt);
});

test('settles a bet as lost', () => {
  const tracker = createTempTracker();
  const bet = tracker.create({
    event: 'Team A vs Team B',
    odds: 2.5,
    stake: 100,
  });

  const settled = tracker.settle(bet.id, 'lost');
  assert.equal(settled.status, 'lost');
});

test('rejects invalid settlement result', () => {
  const tracker = createTempTracker();
  const bet = tracker.create({ event: 'Test', odds: 2, stake: 50 });

  assert.throws(() => tracker.settle(bet.id, 'invalid'), /Invalid result/);
});

test('deletes a bet', () => {
  const tracker = createTempTracker();
  const bet = tracker.create({ event: 'Test', odds: 2, stake: 50 });
  assert.equal(tracker.readAll().length, 1);

  const removed = tracker.remove(bet.id);
  assert.equal(removed, true);
  assert.equal(tracker.readAll().length, 0);
});

test('computes analytics with correct ROI and hit rate', () => {
  const tracker = createTempTracker();

  // 2 wins, 1 loss
  tracker.create({ event: 'A vs B', odds: 2.0, stake: 100, market: 'h2h', bookmaker: 'Fortuna' });
  tracker.create({ event: 'C vs D', odds: 3.0, stake: 50, market: 'h2h', bookmaker: 'Fortuna' });
  tracker.create({ event: 'E vs F', odds: 2.5, stake: 80, market: 'h2h', bookmaker: 'Superbet' });

  const bets = tracker.readAll();
  tracker.settle(bets[0].id, 'won');
  tracker.settle(bets[1].id, 'won');
  tracker.settle(bets[2].id, 'lost');

  const analytics = tracker.analytics();

  assert.equal(analytics.summary.settledBets, 3);
  assert.equal(analytics.summary.wonBets, 2);
  assert.equal(analytics.summary.lostBets, 1);
  assert.ok(analytics.summary.hitRate > 0.66 && analytics.summary.hitRate < 0.67);

  // Total stake: 100 + 50 + 80 = 230
  // Total return: (100*2.0) + (50*3.0) + 0 = 350
  // Net profit: 350 - 230 = 120
  assert.equal(analytics.summary.totalStake, 230);
  assert.equal(analytics.summary.totalReturn, 350);
  assert.equal(analytics.summary.netProfit, 120);
  assert.ok(analytics.summary.roi > 0.52 && analytics.summary.roi < 0.53);
});

test('annotates Romanian tax when annual winnings exceed threshold', () => {
  const tracker = createTempTracker();

  const first = tracker.create({ event: 'A vs B', odds: 2.0, stake: 9900, market: 'h2h' });
  const second = tracker.create({ event: 'C vs D', odds: 2.0, stake: 200, market: 'h2h' });

  const firstSettled = tracker.settle(first.id, 'won');
  const secondSettled = tracker.settle(second.id, 'won');

  assert.equal(firstSettled.taxOwed, 0);
  assert.equal(secondSettled.taxableWinnings, 100);
  assert.equal(secondSettled.taxOwed, 3);
  assert.equal(secondSettled.netProfitAfterTax, 197);

  const analytics = tracker.analytics();
  assert.equal(analytics.summary.taxableWinnings, 100);
  assert.equal(analytics.summary.taxOwed, 3);
  assert.equal(analytics.summary.netProfit, 10100);
  assert.equal(analytics.summary.netProfitAfterTax, 10097);
});

test('computes CLV from closing odds', () => {
  const tracker = createTempTracker();

  const bet = tracker.create({ event: 'A vs B', odds: 2.5, stake: 100, market: 'h2h' });
  tracker.settle(bet.id, 'won', { closingOdds: 2.2 });

  const analytics = tracker.analytics();
  // CLV = (2.5 - 2.2) / 2.2 = 0.1363...
  assert.ok(analytics.summary.clvSamples === 1);
  assert.ok(analytics.summary.avgClv > 0.13);
  assert.ok(analytics.summary.avgClv < 0.14);
});

test('filters bets by sport', () => {
  const tracker = createTempTracker();

  tracker.create({ event: 'A vs B', odds: 2, stake: 100, sport: 'Football' });
  tracker.create({ event: 'C vs D', odds: 2, stake: 50, sport: 'Basketball' });

  const football = tracker.query({ sport: 'Football' });
  const basketball = tracker.query({ sport: 'Basketball' });

  assert.equal(football.length, 1);
  assert.equal(basketball.length, 1);
});

test('updates a bet with closing odds', () => {
  const tracker = createTempTracker();
  const bet = tracker.create({ event: 'A vs B', odds: 2.5, stake: 100 });
  const updated = tracker.update(bet.id, { closingOdds: 2.3, notes: 'Line moved' });

  assert.equal(updated.closingOdds, 2.3);
  assert.equal(updated.notes, 'Line moved');
});

test('aggregates by bookmaker and market', () => {
  const tracker = createTempTracker();

  const b1 = tracker.create({ event: 'A vs B', odds: 2.0, stake: 100, market: 'h2h', bookmaker: 'Fortuna' });
  const b2 = tracker.create({ event: 'C vs D', odds: 3.0, stake: 50, market: 'btts', bookmaker: 'Superbet' });

  tracker.settle(b1.id, 'won');
  tracker.settle(b2.id, 'lost');

  const analytics = tracker.analytics();

  assert.ok(analytics.byBookmaker['Fortuna']);
  assert.ok(analytics.byBookmaker['Superbet']);
  assert.equal(analytics.byBookmaker['Fortuna'].bets, 1);
  assert.equal(analytics.byBookmaker['Superbet'].bets, 1);

  assert.ok(analytics.byMarket['h2h']);
  assert.ok(analytics.byMarket['btts']);
});
