'use strict';

const MAX_ACTIONABLE_EDGE = 0.08;

const VERIFIED_STATUS = 'verified';
const REVIEW_STATUSES = new Set(['ambiguous', 'partial', 'stale', 'unverified']);
const FAILED_STATUSES = new Set(['mismatch', 'not_found', 'unverifiable']);
const TRANSIENT_REASON_CODES = new Set([
  'verification_missing',
  'quote_timestamp_missing',
  'quote_stale',
  'quote_time_skew',
  'kickoff_missing',
]);

/**
 * Structural codes that keep a mathematical edge visible as a review candidate
 * (not actionable without a complete settlement model / verification).
 * Hard blocks (same-book, failed fidelity, edge outliers, etc.) still reject.
 */
const CANDIDATE_STRUCTURE_CODES = new Set([
  'push_settlement',
  'unknown_market_schema',
  'unsupported_formula',
  // High math edges stay visible for operator review; never auto-actionable.
  'edge_outlier',
]);

const SAFE_CLASSIC_MARKETS = new Set([
  'h2h',
  'firstHalfH2h',
  'secondHalfH2h',
  'bothTeamsToScore',
  'firstHalfBothTeamsToScore',
  'secondHalfBothTeamsToScore',
  'toQualify',
  // True 2-way exhaustive markets (no push).
  'market_total_goluri_impar_par',
]);

/** Yes/No exhaustive team markets commonly normalized by RO providers. */
const YES_NO_TEAM_MARKET_RE = /^(?:market_marcheaza_(?:home|away)|market_clean_sheet_(?:home|away))$/;

const SAFE_CROSS_MARKETS = new Set([
  'cross_1X_2',
  'cross_1_X2',
  'cross_12_X',
  'cross_1H_1X_2',
  'cross_1H_1_X2',
  'cross_1H_12_X',
  'cross_2H_1X_2',
  'cross_2H_1_X2',
  'cross_2H_12_X',
  'cross_btts_no_over_0_5',
  'cross_btts_no_over_1_5',
  'cross_1H_btts_no_over_0_5',
  'cross_1H_btts_no_over_1_5',
  'cross_2H_btts_no_over_0_5',
  'cross_2H_btts_no_over_1_5',
  // Exhaustive partitions (overlap states only improve worst-case).
  'cross_btts_team_score',
  'cross_btts_no_both_score',
  'cross_1H_btts_team_score',
  'cross_1H_btts_no_both_score',
  'cross_home_score_vs_no',
  'cross_away_score_vs_no',
]);

const TOTAL_LINE_MARKET_RE = /^(?:total|asianTotal|firstHalfTotal|secondHalfTotal|firstHalfAsianTotal|secondHalfAsianTotal)(?:Goals|Corners|Cards|Points|Games|Sets)_\d+(?:_\d+)?$/;
const HANDICAP_LINE_MARKET_RE = /^(?:asianH|h)andicap_(?:plus|minus)_\d+(?:_\d+)?$/;
const TEAM_TOTAL_MARKET_RE = /^market_total_goluri_(?:home|away)_\d+(?:_\d+)?$/;

function lineFromMarketKey(marketKey) {
  const match = String(marketKey || '').match(/_(\d+)(?:_(\d+))?$/);
  if (!match) return null;
  const line = Number(match[2] ? `${match[1]}.${match[2]}` : match[1]);
  return Number.isFinite(line) ? line : null;
}

function isHalfLineMarket(marketKey) {
  const line = lineFromMarketKey(marketKey);
  return line !== null && line > 0 && Math.abs((line % 1) - 0.5) < 1e-9;
}

function isPositiveLineMarket(marketKey) {
  const line = lineFromMarketKey(marketKey);
  return line !== null && line > 0;
}

function isSupportedClassicMarket(marketKey) {
  const key = String(marketKey || '');
  if (SAFE_CLASSIC_MARKETS.has(key)) return true;
  if (YES_NO_TEAM_MARKET_RE.test(key)) return true;
  // Team O/U half-lines are exhaustive 2-way (no push) — same as match totals.
  if (TEAM_TOTAL_MARKET_RE.test(key) && isHalfLineMarket(key)) return true;
  return TOTAL_LINE_MARKET_RE.test(key) && isHalfLineMarket(key);
}

/**
 * Broader gate for classic math scanning: includes push/integer lines and
 * known 2-way team schemas so candidates appear even when not actionable.
 */
function isScannableClassicMarket(marketKey) {
  const key = String(marketKey || '');
  if (isSupportedClassicMarket(key)) return true;
  // Integer / quarter totals — candidate only (push / half-win settlement).
  if (TOTAL_LINE_MARKET_RE.test(key) && isPositiveLineMarket(key)) return true;
  if (TEAM_TOTAL_MARKET_RE.test(key) && isPositiveLineMarket(key)) return true;
  return false;
}

function isSupportedHandicapMarket(marketKey) {
  const key = String(marketKey || '');
  return HANDICAP_LINE_MARKET_RE.test(key) && isHalfLineMarket(key);
}

/** Scan every two-way Asian/European handicap line; half-lines stay actionable. */
function isScannableHandicapMarket(marketKey) {
  const key = String(marketKey || '');
  if (!HANDICAP_LINE_MARKET_RE.test(key)) return false;
  const line = lineFromMarketKey(key);
  return line !== null && line >= 0;
}

function normalizeVerificationStatus(status) {
  const normalized = String(status || 'unverified').toLowerCase().trim().replace(/[\s-]+/g, '_');
  return normalized || 'unverified';
}

function marketStructure(opportunity) {
  const type = opportunity?.type || 'classic';
  const marketKey = String(opportunity?.marketKey || '');

  if (type === 'middle') {
    return {
      safe: false,
      analysis: true,
      code: 'middle_not_guaranteed',
      reason: 'A middle has an upside window but is not a guaranteed arbitrage.',
    };
  }

  if (type === 'settlement-formula') {
    const stake = Number(opportunity?.stake);
    const minimumReturn = Number(opportunity?.minimumReturn);
    const scenarioReturns = Array.isArray(opportunity?.scenarioReturns)
      ? opportunity.scenarioReturns.map((scenario) => Number(scenario?.returnAmount))
      : [];
    const matrixIsComplete = opportunity?.settlementModel === 'score-state-matrix-v1'
      && opportunity?.coverageVerified === true
      && Number.isFinite(stake)
      && stake > 0
      && Number.isFinite(minimumReturn)
      && scenarioReturns.length >= 3
      && scenarioReturns.every(Number.isFinite)
      && Math.abs(Math.min(...scenarioReturns) - minimumReturn) <= 0.01
      && minimumReturn > stake;

    if (matrixIsComplete) return { safe: true, analysis: false };
    return {
      safe: false,
      analysis: false,
      code: 'incomplete_settlement_matrix',
      reason: 'The formula does not include a complete, internally consistent settlement matrix.',
    };
  }

  if (type === 'classic' && isSupportedClassicMarket(marketKey)) {
    return { safe: true, analysis: false };
  }

  if (type === 'handicap' && isSupportedHandicapMarket(marketKey)) {
    return { safe: true, analysis: false };
  }

  if (type === 'cross-market' && SAFE_CROSS_MARKETS.has(marketKey)) {
    return { safe: true, analysis: false };
  }

  if (marketKey === 'doubleChance' || /DoubleChance$/i.test(marketKey)) {
    return {
      safe: false,
      analysis: false,
      code: 'overlapping_outcomes',
      reason: 'Double-chance selections overlap and cannot use a classic dutching formula.',
    };
  }

  if (/drawNoBet/i.test(marketKey)) {
    return {
      safe: false,
      analysis: false,
      code: 'push_settlement',
      reason: 'Draw-no-bet includes a push outcome that the classic formula does not model.',
    };
  }

  if (
    TOTAL_LINE_MARKET_RE.test(marketKey)
    || HANDICAP_LINE_MARKET_RE.test(marketKey)
    || TEAM_TOTAL_MARKET_RE.test(marketKey)
  ) {
    return {
      safe: false,
      analysis: false,
      code: 'push_settlement',
      reason: 'Integer and quarter lines require push or half-win settlement modelling.',
    };
  }

  if (marketKey.startsWith('market_')) {
    return {
      safe: false,
      analysis: false,
      code: 'unknown_market_schema',
      reason: 'The market has no explicit exhaustive outcome schema.',
    };
  }

  return {
    safe: false,
    analysis: false,
    code: 'unsupported_formula',
    reason: 'This formula is not approved for actionable arbitrage.',
  };
}

function evaluateOpportunityEligibility(opportunity) {
  const legs = Array.isArray(opportunity?.legs) ? opportunity.legs : [];
  const structure = marketStructure(opportunity);
  const statuses = legs.map((leg) => normalizeVerificationStatus(leg?.verificationStatus));
  const bookmakers = new Set(legs.map((leg) => String(leg?.bookmaker || '').trim()).filter(Boolean));
  const feedGroups = new Set(legs.map((leg) => String(leg?.feedGroup || leg?.bookmaker || '').trim()).filter(Boolean));
  const reasons = [];
  const reasonCodes = [];

  const addReason = (code, reason) => {
    if (!reasonCodes.includes(code)) reasonCodes.push(code);
    if (!reasons.includes(reason)) reasons.push(reason);
  };

  if (structure.analysis) {
    addReason(structure.code, structure.reason);
    return {
      eligibility: 'analysis',
      eligibilityReasons: reasons,
      eligibilityReasonCodes: reasonCodes,
      structuralStatus: 'analysis',
      verificationStatuses: [...new Set(statuses)],
      verifiedLegCount: statuses.filter((status) => status === VERIFIED_STATUS).length,
      legCount: legs.length,
      allLegsVerified: statuses.length > 0 && statuses.every((status) => status === VERIFIED_STATUS),
      sameBook: bookmakers.size <= 1,
    };
  }

  if (!structure.safe) addReason(structure.code, structure.reason);
  if (legs.length < 2) addReason('incomplete_legs', 'At least two complete outcome legs are required.');
  if (legs.some((leg) => !leg?.bookmaker)) addReason('missing_bookmaker', 'A selected leg has no bookmaker identity.');
  if (legs.length >= 2 && bookmakers.size <= 1) {
    addReason('same_book', 'All best prices come from one bookmaker; the scanner requires cross-book execution.');
  }
  if (legs.length >= 2 && feedGroups.size <= 1) {
    addReason('same_feed', 'The selected prices originate from one correlated feed; independent price evidence is required.');
  }

  const edge = Number(opportunity?.edge);
  if (!Number.isFinite(edge) || edge <= 0) addReason('invalid_edge', 'The calculated edge is not positive.');
  if (Number.isFinite(edge) && edge > MAX_ACTIONABLE_EDGE) {
    addReason('edge_outlier', `The edge exceeds the ${(MAX_ACTIONABLE_EDGE * 100).toFixed(0)}% actionability ceiling.`);
  }

  const failedStatuses = [...new Set(statuses.filter((status) => FAILED_STATUSES.has(status)))];
  const reviewStatuses = [...new Set(statuses.filter((status) => REVIEW_STATUSES.has(status) || status !== VERIFIED_STATUS))];
  if (failedStatuses.length > 0) {
    addReason('verification_failed', `Evidence failed for ${failedStatuses.join(', ')} leg status${failedStatuses.length === 1 ? '' : 'es'}.`);
  }

  const quoteTiming = opportunity?.quoteTiming;
  if (quoteTiming?.status === 'missing') {
    addReason('quote_timestamp_missing', 'Every selected quote needs a collection timestamp from the current scan.');
  } else if (quoteTiming?.status === 'stale') {
    addReason('quote_stale', 'At least one selected quote is older than the actionable freshness limit.');
  } else if (quoteTiming?.status === 'skewed') {
    addReason('quote_time_skew', 'The selected quotes were collected too far apart to be treated as synchronized.');
  }

  const kickoffTiming = opportunity?.kickoffTiming;
  if (kickoffTiming?.status === 'missing') {
    addReason('kickoff_missing', 'Every selected leg needs a bookmaker kickoff time.');
  } else if (kickoffTiming?.status === 'mismatched') {
    addReason('kickoff_mismatch', 'The selected prices refer to fixtures with different kickoff times.');
  }

  const hardBlockCodes = reasonCodes.filter(
    (code) => !TRANSIENT_REASON_CODES.has(code) && !CANDIDATE_STRUCTURE_CODES.has(code),
  );
  const candidateOnlyCodes = reasonCodes.filter((code) => CANDIDATE_STRUCTURE_CODES.has(code));
  const allLegsVerified = statuses.length > 0 && statuses.every((status) => status === VERIFIED_STATUS);
  const quotesActionable = !quoteTiming || quoteTiming.actionable === true;
  const kickoffsActionable = !kickoffTiming || kickoffTiming.actionable === true;
  let eligibility;

  if (hardBlockCodes.length > 0 || failedStatuses.length > 0) {
    eligibility = 'rejected';
  } else if (
    !structure.safe
    || candidateOnlyCodes.length > 0
    || !allLegsVerified
    || !quotesActionable
    || !kickoffsActionable
  ) {
    // Candidate structure codes (push settlement, edge outlier, etc.) never promote
    // to actionable even when every leg is fidelity-verified.
    eligibility = 'review';
    if (!allLegsVerified) {
      addReason('verification_missing', `Every leg must be verified; current evidence: ${reviewStatuses.join(', ') || 'unverified'}.`);
    }
  } else {
    eligibility = 'actionable';
  }

  return {
    eligibility,
    eligibilityReasons: reasons,
    eligibilityReasonCodes: reasonCodes,
    structuralStatus: structure.safe ? 'approved' : 'blocked',
    verificationStatuses: [...new Set(statuses)],
    verifiedLegCount: statuses.filter((status) => status === VERIFIED_STATUS).length,
    legCount: legs.length,
    allLegsVerified,
    sameBook: legs.length >= 2 && bookmakers.size <= 1,
    independentFeedCount: feedGroups.size,
    sameFeed: legs.length >= 2 && feedGroups.size <= 1,
    quoteTiming: quoteTiming || null,
    quotesSynchronized: quotesActionable,
    kickoffTiming: kickoffTiming || null,
    kickoffsMatched: kickoffsActionable,
  };
}

function attachOpportunityEligibility(opportunity) {
  if (!opportunity || typeof opportunity !== 'object') return opportunity;
  Object.assign(opportunity, evaluateOpportunityEligibility(opportunity));
  if (opportunity.eligibility === 'actionable') opportunity.confidence = 'trusted';
  else if (opportunity.eligibility === 'rejected') opportunity.confidence = 'risky';
  else opportunity.confidence = 'review';
  return opportunity;
}

module.exports = {
  CANDIDATE_STRUCTURE_CODES,
  FAILED_STATUSES,
  MAX_ACTIONABLE_EDGE,
  REVIEW_STATUSES,
  TRANSIENT_REASON_CODES,
  SAFE_CLASSIC_MARKETS,
  SAFE_CROSS_MARKETS,
  VERIFIED_STATUS,
  attachOpportunityEligibility,
  evaluateOpportunityEligibility,
  isHalfLineMarket,
  isScannableClassicMarket,
  isScannableHandicapMarket,
  isSupportedClassicMarket,
  isSupportedHandicapMarket,
  normalizeVerificationStatus,
};
