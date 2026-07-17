'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  FIDELITY_STATUSES,
  buildExpectedOddRecord,
  parseMarketDescriptor,
  parseMarketList,
  verifyOddAgainstText,
} = require('../scripts/odds-fidelity-core');

function expected(check) {
  return buildExpectedOddRecord({
    event: {
      id: 'event-1',
      homeTeam: 'Brommapojkarna',
      awayTeam: 'GAIS',
      competition: 'Allsvenskan',
      startsAt: '2026-07-10T17:00:00Z',
    },
    bookmaker: {
      name: 'GetsBet',
      url: 'https://example.test/event',
    },
    check,
  });
}

test('verifies a total goals price only with event, market, line, outcome, and price context', () => {
  const record = expected({
    marketKey: 'totalGoals_2_5',
    outcome: 'over',
    price: 1.58,
  });
  const text = `
    Brommapojkarna vs GAIS
    Allsvenskan
    Total Goluri
    Peste
    Sub
    2.5
    1.58
    2.30
  `;

  const result = verifyOddAgainstText(record, text);

  assert.equal(result.status, FIDELITY_STATUSES.verified);
  assert.equal(result.websitePrice, 1.58);
  assert.equal(result.evidence.marketFound, true);
  assert.equal(result.evidence.lineFound, true);
  assert.equal(result.evidence.outcomeFound, true);
});

test('does not verify by price alone', () => {
  const record = expected({
    marketKey: 'totalGoals_2_5',
    outcome: 'over',
    price: 1.58,
  });
  const text = `
    Brommapojkarna vs GAIS
    Allsvenskan
    Random highlighted offer 1.58
  `;

  const result = verifyOddAgainstText(record, text);

  assert.equal(result.status, FIDELITY_STATUSES.ambiguous);
  assert.equal(result.evidence.reason, 'price_visible_without_proven_context');
});

test('rejects endpoint Over 0 when the website shows Over 2.5', () => {
  const record = expected({
    marketKey: 'totalGoals_0',
    outcome: 'over',
    price: 1.58,
  });
  const text = `
    Brommapojkarna vs GAIS
    Total Goluri
    Peste
    Sub
    2.5
    1.58
    2.30
  `;

  const result = verifyOddAgainstText(record, text);

  assert.notEqual(result.status, FIDELITY_STATUSES.verified);
  assert.equal(result.evidence.lineFound, false);
});

test('marks same context with a different website price as mismatch', () => {
  const record = expected({
    marketKey: 'totalGoals_2_5',
    outcome: 'over',
    price: 1.58,
  });
  const text = `
    Brommapojkarna vs GAIS
    Total Goluri
    Peste
    Sub
    2.5
    1.64
    2.30
  `;

  const result = verifyOddAgainstText(record, text);

  assert.equal(result.status, FIDELITY_STATUSES.mismatch);
  assert.equal(result.websitePrice, 1.64);
});

test('does not use one flattened SPA text line as global price context', () => {
  const record = expected({
    marketKey: 'totalGoals_2_5',
    outcome: 'over',
    price: 1.58,
  });
  const filler = ' menu '.repeat(350);
  const text = `Brommapojkarna vs GAIS Total Goluri Peste Sub 2.5 1.64 2.30 ${filler} unrelated promo 1.58`;

  const result = verifyOddAgainstText(record, text);

  assert.equal(result.status, FIDELITY_STATUSES.mismatch);
  assert.equal(result.websitePrice, 1.64);
});

test('verifies from a structured DOM row when full context is proven', () => {
  const record = expected({
    marketKey: 'totalGoals_2_5',
    outcome: 'over',
    price: 1.58,
  });
  const text = 'Brommapojkarna vs GAIS Allsvenskan unrelated promo 1.58';

  const result = verifyOddAgainstText(record, text, {
    contextRows: [{
      source: 'table-row',
      selector: 'tr.market-row',
      text: 'Total Goluri Timp regulamentar Peste Sub 2.5 1.58 2.30',
    }],
  });

  assert.equal(result.status, FIDELITY_STATUSES.verified);
  assert.equal(result.websitePrice, 1.58);
  assert.equal(result.evidence.source, 'table-row');
  assert.equal(result.evidence.selector, 'tr.market-row');
});

test('marks structured row context with a different price as mismatch', () => {
  const record = expected({
    marketKey: 'totalGoals_2_5',
    outcome: 'over',
    price: 1.58,
  });
  const text = 'Brommapojkarna vs GAIS Allsvenskan unrelated promo 1.58';

  const result = verifyOddAgainstText(record, text, {
    contextRows: [{
      source: 'dom-row',
      text: 'Total Goluri Timp regulamentar Peste Sub 2.5 1.64 2.30',
    }],
  });

  assert.equal(result.status, FIDELITY_STATUSES.mismatch);
  assert.equal(result.websitePrice, 1.64);
});

test('can verify from proven network-payload context tied to visible event page', () => {
  const record = expected({
    marketKey: 'totalGoals_2_5',
    outcome: 'under',
    price: 2.3,
  });
  const text = 'Brommapojkarna vs GAIS Allsvenskan';

  const result = verifyOddAgainstText(record, text, {
    contextRows: [{
      source: 'network-payload',
      adapterId: 'network-payload',
      networkUrl: 'https://example.test/api/event/1',
      text: '{"marketName":"Total Goluri","period":"Timp regulamentar","line":"2.5","outcomes":[{"name":"Peste","price":1.58},{"name":"Sub","price":2.30}]}',
    }],
  });

  assert.equal(result.status, FIDELITY_STATUSES.verified);
  assert.equal(result.websitePrice, 2.3);
  assert.equal(result.evidence.source, 'network-payload');
  assert.equal(result.evidence.networkUrl, 'https://example.test/api/event/1');
});

test('rejects Superbet-style BTTS combo carousel as pure bothTeamsToScore evidence', () => {
  const record = expected({
    marketKey: 'bothTeamsToScore',
    outcome: 'yes',
    price: 1.4,
  });
  const text = `
    Brommapojkarna vs GAIS
    Allsvenskan football event page
    Final 1 1.53 X 4.45 2 4.60
  `;

  const result = verifyOddAgainstText(record, text, {
    contextRows: [{
      source: 'dom-row',
      selector: 'li.sds-base-carousel-item',
      text: '129+ au pariat pe asta GG & Peste 2.5 goluri - Da 1.57',
    }],
  });

  assert.notEqual(result.status, FIDELITY_STATUSES.verified);
  assert.notEqual(result.status, FIDELITY_STATUSES.mismatch);
  assert.ok(
    result.status === FIDELITY_STATUSES.notFound
    || result.status === FIDELITY_STATUSES.ambiguous
    || result.websitePrice == null,
  );
});

test('verifies pure Ambele echipe marcheaza market for bothTeamsToScore', () => {
  const record = expected({
    marketKey: 'bothTeamsToScore',
    outcome: 'yes',
    price: 1.4,
  });
  const text = `
    Brommapojkarna vs GAIS
    Allsvenskan football event page
  `;

  const result = verifyOddAgainstText(record, text, {
    contextRows: [{
      source: 'dom-row',
      selector: 'div.single-market-card',
      text: 'Ambele echipe marcheaza Da 1.40 Nu 2.75',
    }],
  });

  assert.equal(result.status, FIDELITY_STATUSES.verified);
  assert.equal(result.websitePrice, 1.4);
  assert.equal(result.evidence.contaminated, false);
});

test('rejects first-half website context for a full-time corners endpoint odd', () => {
  const record = expected({
    marketKey: 'totalCorners_6_5',
    outcome: 'over',
    price: 4.25,
  });
  const text = `
    Brommapojkarna vs GAIS
    Cornere Peste/Sub - Repriza 1
    Peste
    Corner
    Sub
    6.5
    4.25
    1.15
  `;

  const result = verifyOddAgainstText(record, text);

  assert.notEqual(result.status, FIDELITY_STATUSES.verified);
  assert.equal(result.evidence.periodFound, false);
});

test('handles comma decimal line and price formats', () => {
  const record = expected({
    marketKey: 'totalGoals_2_5',
    outcome: 'under',
    price: 2.3,
  });
  const text = `
    Brommapojkarna vs GAIS
    Total Goluri
    Peste
    Sub
    2,5
    1,58
    2,30
  `;

  const result = verifyOddAgainstText(record, text);

  assert.equal(result.status, FIDELITY_STATUSES.verified);
  assert.equal(result.websitePrice, 2.3);
});

test('parses market descriptors for family, period, and line', () => {
  assert.deepEqual(parseMarketDescriptor('firstHalfTotalCorners_6_5'), {
    marketKey: 'firstHalfTotalCorners_6_5',
    marketFamily: 'totalCorners',
    period: 'firstHalf',
    line: '6.5',
    asian: false,
    teamScope: null,
  });
  assert.equal(parseMarketDescriptor('totalGoals_2_5').period, 'fulltime');
  assert.equal(parseMarketDescriptor('totalPoints_224_5').marketFamily, 'totalPoints');
  assert.deepEqual(parseMarketList('h2h,totalGoals,totalCorners'), ['h2h', 'totalGoals', 'totalCorners']);
});
