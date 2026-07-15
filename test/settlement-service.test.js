'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { BetTracker } = require('../src/finance/bet-tracker');
const { SettlementService, findResultEvent, settleBetFromScore } = require('../src/results/settlement-service');
const { MemoryAutonomyStore } = require('../src/storage/autonomy-store');

test('SettlementService settles supported markets from authoritative scores', async () => {
  const tracker = new BetTracker({ logPath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'settle-')), 'bets.jsonl') });
  const bet = tracker.create({
    event: 'Home vs Away', market: 'h2h', selection: '1', odds: 2, stake: 10,
    eventStartsAt: '2026-07-14T10:00:00Z', status: 'pending',
  });
  const store = await new MemoryAutonomyStore().init();
  const service = new SettlementService({
    betTracker: tracker,
    store,
    resultsProvider: {
      name: 'Official scores',
      getCompletedEvents: async () => [{
        id: 'e1', homeTeam: 'Home', awayTeam: 'Away', startsAt: '2026-07-14T10:00:00Z',
        completed: true, homeScore: 2, awayScore: 1,
      }],
    },
  });
  const result = await service.settlePending({ force: true });
  assert.equal(result.settled, 1);
  assert.equal(tracker.readAll().find((item) => item.id === bet.id).status, 'won');
  assert.equal(store.settlements.length, 1);
});

test('settlement helpers match teams and support totals and BTTS', () => {
  const event = { homeTeam: 'FC Home', awayTeam: 'Away United', startsAt: '2026-07-14T10:00:00Z', homeScore: 2, awayScore: 1 };
  assert.equal(findResultEvent({ event: 'FC Home vs Away United' }, [event]), event);
  assert.equal(settleBetFromScore({ market: 'Total goals', selection: 'Over 2.5' }, event), 'won');
  assert.equal(settleBetFromScore({ market: 'BTTS', selection: 'Yes' }, event), 'won');
});
