'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CandidateVerificationBroker,
  prioritizeVerificationOpportunities,
} = require('../src/autonomy/candidate-verification-broker');
const { MemoryAutonomyStore } = require('../src/storage/autonomy-store');

function fixture() {
  return {
    id: 'e1',
    homeTeam: 'Home',
    awayTeam: 'Away',
    competition: 'League',
    startsAt: '2026-07-15T18:00:00Z',
    bookmakers: [
      { name: 'BookA', eventUrl: 'https://a.test/e1', markets: { h2h: { home: 2.2 } } },
      { name: 'BookB', eventUrl: 'https://b.test/e1', markets: { h2h: { away: 2.2 } } },
    ],
  };
}

function candidateOpportunity() {
  return {
    eventId: 'e1',
    eventName: 'Home vs Away',
    kickoff: '2026-07-15T18:00:00Z',
    type: 'classic',
    marketKey: 'h2h',
    edge: 0.03,
    eligibility: 'review',
    structuralStatus: 'approved',
    eligibilityReasonCodes: ['verification_missing'],
    quoteTiming: { actionable: true, status: 'fresh' },
    legs: [
      { bookmaker: 'BookA', marketKey: 'h2h', outcome: 'home', price: 2.2, verificationStatus: 'unverified' },
      { bookmaker: 'BookB', marketKey: 'h2h', outcome: 'away', price: 2.2, verificationStatus: 'unverified' },
    ],
  };
}

test('CandidateVerificationBroker verifies and persists legs from the best candidate', async () => {
  const store = await new MemoryAutonomyStore().init();
  const event = fixture();
  let received = [];
  const broker = new CandidateVerificationBroker({
    store,
    detector: () => [candidateOpportunity()],
    now: () => new Date('2026-07-14T12:00:00Z'),
    verifier: async (candidates) => {
      received = candidates;
      return {
        ok: true,
        checkedAt: '2026-07-14T12:00:00Z',
        verificationRecords: candidates.flatMap((candidate) => candidate.prices.map((price) => ({
          bookmaker: candidate.bookmaker.name,
          eventId: candidate.event.id,
          marketKey: price.marketKey,
          outcome: price.outcome,
          endpointPrice: price.price,
          websitePrice: price.price,
          status: 'verified',
          checkedAt: '2026-07-14T12:00:00Z',
        }))),
      };
    },
  });

  const result = await broker.verifySnapshot({ mode: 'live', events: [event] });
  assert.equal(result.ok, true);
  assert.equal(result.candidates, 2);
  assert.equal(result.records, 2);
  assert.equal(received.length, 2);
  assert.equal(store.fidelityRecords.length, 2);
  assert.equal(event.bookmakers[0].fidelityRecords[0].status, 'verified');
});

test('candidate priority excludes structurally rejected and unsynchronized quotes', () => {
  const good = candidateOpportunity();
  const rejected = { ...candidateOpportunity(), eligibility: 'rejected' };
  const skewed = { ...candidateOpportunity(), quoteTiming: { actionable: false, status: 'skewed' } };
  assert.deepEqual(prioritizeVerificationOpportunities([rejected, skewed, good]), [good]);
});
