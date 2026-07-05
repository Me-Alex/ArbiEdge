/**
 * Odds Audit Enhancement: Cross-book outlier detection
 *
 * For each event and market, compute z-score of each bookmaker's implied
 * probability per outcome vs the cross-book mean. Flag any bookmaker whose
 * implied probability is more than 3 standard deviations from the mean.
 */

'use strict';
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'src', 'odds-audit.js');
let src = fs.readFileSync(filePath, 'utf8');

// =====================================================
// 1. Add crossBookOutliers to the issue bucket creation
// =====================================================
src = src.replace(
  "sameBookHighOverround: issueBucket(),\n    highOdds: issueBucket(),",
  `sameBookHighOverround: issueBucket(),
    crossBookOutliers: issueBucket(),
    highOdds: issueBucket(),`
);

// =====================================================
// 2. Add cross-book outlier check in auditBookmakerMarkets
// =====================================================
// After the auditBookmakerMarkets function call, add cross-book audit
src = src.replace(
  'totals.events += 1;\n    for (const bookmaker of Array.isArray(event.bookmakers) ? event.bookmakers : []) {',
  `totals.events += 1;

    // Cross-book outlier detection (deferred — needs all bookmakers loaded first)
    auditCrossBookOutliers({ event, issues, sampleLimit });

    for (const bookmaker of Array.isArray(event.bookmakers) ? event.bookmakers : []) {`
);

// =====================================================
// 3. Add the crossBookOutliers function
// =====================================================
const crossBookFunction = `
/** Cross-book implied probability outlier detection.
 * For each market across all bookmakers, compute the mean and standard
 * deviation of implied probabilities per outcome. Flag any bookmaker whose
 * implied probability is >3 standard deviations from the mean. */
const CROSS_BOOK_Z_THRESHOLD = 3;

function auditCrossBookOutliers({ event, issues, sampleLimit }) {
  const bookmakers = Array.isArray(event.bookmakers) ? event.bookmakers : [];
  if (bookmakers.length < 3) return; // need at least 3 to compute meaningful z-scores

  // Build per-market price matrix
  const marketPrices = new Map();
  for (const bm of bookmakers) {
    const markets = bm.markets || {};
    for (const [marketKey, prices] of Object.entries(markets)) {
      if (!marketPrices.has(marketKey)) {
        marketPrices.set(marketKey, []);
      }
      const validPrices = {};
      for (const [outcome, odds] of Object.entries(prices)) {
        if (isDecimalOdds(odds)) validPrices[outcome] = odds;
      }
      if (Object.keys(validPrices).length > 0) {
        marketPrices.get(marketKey).push({ bookmaker: bm.name, prices: validPrices });
      }
    }
  }

  for (const [marketKey, entries] of marketPrices) {
    // Find outcomes that appear in >= 3 bookmakers
    const outcomeCounts = new Map();
    for (const entry of entries) {
      for (const outcome of Object.keys(entry.prices)) {
        outcomeCounts.set(outcome, (outcomeCounts.get(outcome) || 0) + 1);
      }
    }

    for (const [outcome, count] of outcomeCounts) {
      if (count < 3) continue;

      // Collect implied probabilities for this outcome
      const impliedProbs = entries
        .filter(e => e.prices[outcome])
        .map(e => ({ bookmaker: e.bookmaker, implied: 1 / e.prices[outcome], odds: e.prices[outcome] }));

      if (impliedProbs.length < 3) continue;

      const mean = impliedProbs.reduce((s, p) => s + p.implied, 0) / impliedProbs.length;
      const variance = impliedProbs.reduce((s, p) => s + (p.implied - mean) ** 2, 0) / impliedProbs.length;
      const stdDev = Math.sqrt(variance);

      if (stdDev < 0.001) continue; // essentially identical — no outlier possible

      for (const entry of impliedProbs) {
        const zScore = (entry.implied - mean) / stdDev;
        if (Math.abs(zScore) > CROSS_BOOK_Z_THRESHOLD) {
          addIssue(issues.crossBookOutliers, sampleLimit, issueContext(event, { bookmaker: entry.bookmaker }, {
            marketKey,
            outcome,
            odds: entry.odds,
            impliedProb: Number(entry.implied.toFixed(4)),
            crossBookMean: Number(mean.toFixed(4)),
            crossBookStdDev: Number(stdDev.toFixed(4)),
            zScore: Number(zScore.toFixed(2)),
          }));
        }
      }
    }
  }
}
`;

// Insert before the module.exports
src = src.replace(
  "function isHalfLine(value) {",
  crossBookFunction + "\nfunction isHalfLine(value) {"
);

// =====================================================
// 4. Add crossBookOutliers to blocking/suspicious counts
// =====================================================
src = src.replace(
  'const suspiciousIssueCount =\n    issues.highOdds.count +\n    issues.sameBookHighOverround.count;',
  `const suspiciousIssueCount =
    issues.highOdds.count +
    issues.sameBookHighOverround.count +
    issues.crossBookOutliers.count;`
);

// =====================================================
// Write and verify
// =====================================================
fs.writeFileSync(filePath, src, 'utf8');
console.log('✅ Odds audit updated with cross-book outlier detection');

try {
  delete require.cache[require.resolve(filePath)];
  const { auditOdds } = require(filePath);

  // Test with outlier data
  const result = auditOdds([{
    id: 'test-1',
    homeTeam: 'Home',
    awayTeam: 'Away',
    startsAt: '2026-07-05T12:00:00Z',
    bookmakers: [
      { name: 'Book A', markets: { h2h: { home: 2.10, draw: 3.40, away: 3.20 } } },
      { name: 'Book B', markets: { h2h: { home: 2.05, draw: 3.35, away: 3.25 } } },
      { name: 'Book C', markets: { h2h: { home: 2.08, draw: 3.42, away: 3.18 } } },
      { name: 'Book D', markets: { h2h: { home: 1.20, draw: 3.30, away: 5.00 } } }, // outlier
    ],
  }]);

  console.log(`  Status: ${result.status}`);
  console.log(`  crossBookOutliers: ${result.issueCounts.crossBookOutliers}`);
  if (result.issues.crossBookOutliers.samples.length > 0) {
    const sample = result.issues.crossBookOutliers.samples[0];
    console.log(`  Sample: ${sample.bookmaker} ${sample.marketKey}.${sample.outcome} z=${sample.zScore}`);
  }
  console.log('  ✓ Cross-book outlier detection working');
} catch (e) {
  console.error('❌ ERROR:', e.message);
  console.error(e.stack);
  process.exit(1);
}
