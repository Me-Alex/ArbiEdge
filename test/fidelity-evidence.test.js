'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { applyFidelityEvidence, fidelityRecordMatches } = require('../src/autonomy/fidelity-evidence');

test('applyFidelityEvidence attaches current evidence and stales changed prices', () => {
  const event = {
    id: 'e1', homeTeam: 'FCSB', awayTeam: 'CFR Cluj', startsAt: '2026-07-15T18:00:00Z',
    bookmakers: [{ name: 'BookA', markets: { h2h: { home: 2.1, away: 3.2 } } }],
  };
  const records = [
    { bookmaker: 'BookA', eventId: 'e1', marketKey: 'h2h', outcome: 'home', endpointPrice: 2.1, status: 'verified', checkedAt: '2026-07-14T12:00:00Z' },
    { bookmaker: 'BookA', eventId: 'e1', marketKey: 'h2h', outcome: 'away', endpointPrice: 3.1, status: 'verified', checkedAt: '2026-07-14T12:00:00Z' },
  ];
  assert.equal(applyFidelityEvidence([event], records, { now: new Date('2026-07-14T13:00:00Z') }), 2);
  assert.equal(event.bookmakers[0].fidelityRecords[0].status, 'verified');
  assert.equal(event.bookmakers[0].fidelityRecords[1].status, 'stale');
  assert.equal(fidelityRecordMatches(records[0], event, event.bookmakers[0]), true);
});
