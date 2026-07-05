const DEFAULT_SAMPLE_LIMIT = 10;
const HIGH_ODDS_THRESHOLD = 100;
const HIGH_OVERROUND_THRESHOLD = 1.35;

function auditOdds(events, { sampleLimit = DEFAULT_SAMPLE_LIMIT } = {}) {
  const issues = {
    invalidOdds: issueBucket(),
    doubleChanceViolations: issueBucket(),
    drawNoBetViolations: issueBucket(),
    totalLineMonotonicity: issueBucket(),
    sameBookUnderround: issueBucket(),
    sameBookHighOverround: issueBucket(),
    crossBookOutliers: issueBucket(),
    highOdds: issueBucket(),
  };
  const totals = {
    events: 0,
    bookmakers: 0,
    markets: 0,
    prices: 0,
  };

  for (const event of Array.isArray(events) ? events : []) {
    totals.events += 1;

    // Cross-book outlier detection (deferred — needs all bookmakers loaded first)
    auditCrossBookOutliers({ event, issues, sampleLimit });

    for (const bookmaker of Array.isArray(event.bookmakers) ? event.bookmakers : []) {
      totals.bookmakers += 1;
      const markets = bookmaker.markets || {};
      auditBookmakerMarkets({ event, bookmaker, markets, issues, totals, sampleLimit });
      auditDoubleChance({ event, bookmaker, markets, issues, sampleLimit });
      auditDrawNoBet({ event, bookmaker, markets, issues, sampleLimit });
      auditLineMonotonicity({ event, bookmaker, markets, issues, sampleLimit });
    }
  }

  const blockingIssueCount =
    issues.invalidOdds.count +
    issues.doubleChanceViolations.count +
    issues.drawNoBetViolations.count +
    issues.totalLineMonotonicity.count +
    issues.sameBookUnderround.count;
  const suspiciousIssueCount =
    issues.highOdds.count +
    issues.sameBookHighOverround.count +
    issues.crossBookOutliers.count;

  return {
    status: blockingIssueCount > 0 ? 'warning' : suspiciousIssueCount > 0 ? 'review' : 'ok',
    totals,
    issueCounts: Object.fromEntries(
      Object.entries(issues).map(([key, bucket]) => [key, bucket.count]),
    ),
    issues,
    warning:
      blockingIssueCount > 0
        ? `Odds audit flagged ${blockingIssueCount} validation issue${blockingIssueCount === 1 ? '' : 's'}.`
        : suspiciousIssueCount > 0
          ? `Odds audit found ${suspiciousIssueCount} suspicious price issue${suspiciousIssueCount === 1 ? '' : 's'} for review.`
          : null,
  };
}

function auditBookmakerMarkets({ event, bookmaker, markets, issues, totals, sampleLimit }) {
  for (const [marketKey, prices] of Object.entries(markets)) {
    totals.markets += 1;
    const validPrices = [];
    for (const [outcome, odds] of Object.entries(prices || {})) {
      if (!isDecimalOdds(odds)) {
        addIssue(issues.invalidOdds, sampleLimit, issueContext(event, bookmaker, {
          marketKey,
          outcome,
          odds,
        }));
        continue;
      }

      totals.prices += 1;
      validPrices.push(odds);
      if (odds >= HIGH_ODDS_THRESHOLD) {
        addIssue(issues.highOdds, sampleLimit, issueContext(event, bookmaker, {
          marketKey,
          outcome,
          odds,
        }));
      }
    }

    if (isStrictSameBookMarket(marketKey, prices)) {
      const implied = validPrices.reduce((total, odds) => total + 1 / odds, 0);
      if (implied < 0.995) {
        addIssue(issues.sameBookUnderround, sampleLimit, issueContext(event, bookmaker, {
          marketKey,
          implied: Number(implied.toFixed(6)),
          prices,
        }));
      }
      if (implied > HIGH_OVERROUND_THRESHOLD) {
        addIssue(issues.sameBookHighOverround, sampleLimit, issueContext(event, bookmaker, {
          marketKey,
          implied: Number(implied.toFixed(6)),
          prices,
        }));
      }
    }
  }
}

function auditDoubleChance({ event, bookmaker, markets, issues, sampleLimit }) {
  const h2h = markets.h2h;
  const doubleChance = markets.doubleChance;
  if (!h2h || !doubleChance) {
    return;
  }

  for (const [selection, key, coveredOutcomes] of [
    ['1X', 'homeDraw', ['home', 'draw']],
    ['12', 'homeAway', ['home', 'away']],
    ['X2', 'drawAway', ['draw', 'away']],
  ]) {
    const value = doubleChance[key];
    const ceiling = minValidOdds(coveredOutcomes.map((outcome) => h2h[outcome]));
    if (isDecimalOdds(value) && isDecimalOdds(ceiling) && value > ceiling + 0.001) {
      addIssue(issues.doubleChanceViolations, sampleLimit, issueContext(event, bookmaker, {
        selection,
        value,
        ceiling,
        h2h,
      }));
    }
  }
}

function auditDrawNoBet({ event, bookmaker, markets, issues, sampleLimit }) {
  const h2h = markets.h2h;
  const drawNoBet = markets.drawNoBet;
  if (!h2h || !drawNoBet) {
    return;
  }

  for (const side of ['home', 'away']) {
    const value = drawNoBet[side];
    const ceiling = h2h[side];
    if (isDecimalOdds(value) && isDecimalOdds(ceiling) && value > ceiling + 0.001) {
      addIssue(issues.drawNoBetViolations, sampleLimit, issueContext(event, bookmaker, {
        side,
        value,
        ceiling,
        h2h,
      }));
    }
  }
}

function auditLineMonotonicity({ event, bookmaker, markets, issues, sampleLimit }) {
  for (const [prefix, marketName] of [
    ['totalGoals_', 'totalGoals'],
    ['firstHalfTotalGoals_', 'firstHalfTotalGoals'],
    ['totalCorners_', 'totalCorners'],
    ['market_total_goluri_home_', 'homeTeamTotalGoals'],
    ['market_total_goluri_away_', 'awayTeamTotalGoals'],
  ]) {
    const rows = Object.entries(markets)
      .filter(([marketKey, prices]) =>
        marketKey.startsWith(prefix) &&
        isDecimalOdds(prices?.over) &&
        isDecimalOdds(prices?.under),
      )
      .map(([marketKey, prices]) => ({
        marketKey,
        line: extractLineFromMarketKey(marketKey),
        over: prices.over,
        under: prices.under,
      }))
      .filter((row) => Number.isFinite(row.line))
      .sort((left, right) => left.line - right.line);

    for (let index = 1; index < rows.length; index += 1) {
      const previous = rows[index - 1];
      const next = rows[index];
      if (next.over + 0.001 < previous.over || next.under > previous.under + 0.001) {
        addIssue(issues.totalLineMonotonicity, sampleLimit, issueContext(event, bookmaker, {
          marketName,
          previous,
          next,
        }));
      }
    }
  }
}

function isStrictSameBookMarket(marketKey, prices) {
  const outcomes = validOutcomeSet(prices);
  if (marketKey === 'h2h') {
    return outcomes === 'away|draw|home';
  }
  if (marketKey === 'bothTeamsToScore') {
    return outcomes === 'no|yes';
  }
  if (marketKey === 'toQualify') {
    return outcomes === 'away|home';
  }
  if (
    marketKey.startsWith('totalGoals_') ||
    marketKey.startsWith('firstHalfTotalGoals_') ||
    marketKey.startsWith('totalCorners_')
  ) {
    return outcomes === 'over|under' && isHalfLine(extractLineFromMarketKey(marketKey));
  }
  return false;
}

function validOutcomeSet(prices) {
  return Object.keys(prices || {})
    .filter((outcome) => isDecimalOdds(prices[outcome]))
    .sort()
    .join('|');
}

function issueBucket() {
  return {
    count: 0,
    samples: [],
  };
}

function addIssue(bucket, sampleLimit, issue) {
  bucket.count += 1;
  if (bucket.samples.length < sampleLimit) {
    bucket.samples.push(issue);
  }
}

function issueContext(event, bookmaker, extra = {}) {
  return {
    eventId: event.id,
    match: [event.homeTeam, event.awayTeam].filter(Boolean).join(' vs '),
    startsAt: event.startsAt,
    bookmaker: bookmaker.name,
    ...extra,
  };
}

function minValidOdds(values) {
  const valid = values.filter(isDecimalOdds);
  return valid.length ? Math.min(...valid) : Number.NaN;
}

function isDecimalOdds(value) {
  return Number.isFinite(value) && value > 1;
}

function extractLineFromMarketKey(marketKey) {
  const match = String(marketKey).match(/(?:^|_)(minus_)?([0-9]+)(?:_([0-9]+))?$/);
  if (!match) {
    return Number.NaN;
  }
  const value = Number(`${match[2]}.${match[3] || '0'}`);
  return match[1] ? -value : value;
}


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

function isHalfLine(value) {
  return Math.abs(Math.abs(value % 1) - 0.5) < 0.000001;
}

module.exports = {
  auditOdds,
};
