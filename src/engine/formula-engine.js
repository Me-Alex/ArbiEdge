/**
 * Server-side formula engine — extracted from public/app.js.
 *
 * Computes arbitrage opportunities and value bets from normalized odds events.
 * Exposed via GET /api/opportunities and GET /api/value-bets.
 */

'use strict';

const { marketOutcomes: sportMarketOutcomes } = require('../core/sports');
const {
  DEFAULT_MAX_KICKOFF_SKEW_MS,
  DEFAULT_MAX_QUOTE_AGE_MS,
  DEFAULT_MAX_QUOTE_SKEW_MS,
  bookmakerQuoteObservedAt,
  evaluateKickoffTiming,
  evaluateQuoteTiming,
  firstValidIsoDate,
} = require('../core/quote-metadata');
const {
  MAX_ACTIONABLE_EDGE,
  attachOpportunityEligibility,
  evaluateOpportunityEligibility,
  isScannableClassicMarket,
  isScannableHandicapMarket,
  isSupportedClassicMarket,
  isSupportedHandicapMarket,
} = require('./opportunity-eligibility');
const {
  detectSettlementFormulaArbitrage,
} = require('./arbitrage/settlement-formula-scanner');


const MIN_VALUE_EDGE = 0.02;
const FIDELITY_RISKY_STATUSES = new Set(['mismatch', 'not_found', 'unverifiable']);
const FIDELITY_REVIEW_STATUSES = new Set(['ambiguous', 'unverified', 'stale', 'partial']);
const FIDELITY_VERIFIED_STATUS = 'verified';
const FIDELITY_UNVERIFIED_STATUS = 'unverified';

/** Bookmakers considered sharp reference lines. Used as the "fair" price
 * for value bet calculations, falling back to trimmed-mean consensus. */
const SHARP_BOOKMAKER_NAMES = new Set([
  'pinnacle', 'Pinnacle',
  'betfair', 'Betfair', 'Betfair Exchange',
]);

/** Maximum edge for classic arbitrage — anything above is almost certainly a data error. */
const MAX_ARB_EDGE = 0.25;

/** Expected outcomes for known market types. Used to reject incomplete markets. */
const MARKET_OUTCOMES = {
  // 3-way markets
  h2h: ['home', 'draw', 'away'],
  firstHalfH2h: ['home', 'draw', 'away'],
  secondHalfH2h: ['home', 'draw', 'away'],
  halfTimeOrFullTime: ['home', 'draw', 'away'],
  // 2-way markets
  bothTeamsToScore: ['yes', 'no'],
  firstHalfBothTeamsToScore: ['yes', 'no'],
  secondHalfBothTeamsToScore: ['yes', 'no'],
  drawNoBet: ['home', 'away'],
  firstHalfDrawNoBet: ['home', 'away'],
  secondHalfDrawNoBet: ['home', 'away'],
  toQualify: ['home', 'away'],
  market_marcheaza_home: ['yes', 'no'],
  market_marcheaza_away: ['yes', 'no'],
  market_clean_sheet_home: ['yes', 'no'],
  market_clean_sheet_away: ['yes', 'no'],
  market_total_goluri_impar_par: ['odd', 'even'],
  // Double chance — overlapping outcomes (not classic-scanned)
  doubleChance: ['homeDraw', 'homeAway', 'drawAway'],
  firstHalfDoubleChance: ['homeDraw', 'homeAway', 'drawAway'],
  secondHalfDoubleChance: ['homeDraw', 'homeAway', 'drawAway'],
};

const MARKET_LABELS = {
  h2h: '1X2',
  firstHalfH2h: '1st Half 1X2',
  secondHalfH2h: '2nd Half 1X2',
  doubleChance: 'Double Chance',
  firstHalfDoubleChance: '1st Half Double Chance',
  secondHalfDoubleChance: '2nd Half Double Chance',
  bothTeamsToScore: 'BTTS',
  firstHalfBothTeamsToScore: '1st Half BTTS',
  secondHalfBothTeamsToScore: '2nd Half BTTS',
  drawNoBet: 'Draw No Bet',
  firstHalfDrawNoBet: '1st Half DNB',
  secondHalfDrawNoBet: '2nd Half DNB',
  toQualify: 'To Qualify',
  halfTimeOrFullTime: 'HT/FT',
  market_marcheaza_home: 'Home to Score',
  market_marcheaza_away: 'Away to Score',
  market_clean_sheet_home: 'Home Clean Sheet',
  market_clean_sheet_away: 'Away Clean Sheet',
  market_total_goluri_impar_par: 'Goals Odd/Even',
};

const MARKET_DESCRIPTIONS = {
  h2h: 'Match result — Home / Draw / Away',
  firstHalfH2h: 'Result at half-time — Home / Draw / Away',
  secondHalfH2h: 'Result in second half — Home / Draw / Away',
  doubleChance: 'Two of three outcomes — 1X / 12 / X2',
  firstHalfDoubleChance: 'First-half double chance — 1X / 12 / X2',
  secondHalfDoubleChance: 'Second-half double chance — 1X / 12 / X2',
  bothTeamsToScore: 'Will both teams score at least one goal?',
  firstHalfBothTeamsToScore: 'Will both teams score in the first half?',
  secondHalfBothTeamsToScore: 'Will both teams score in the second half?',
  drawNoBet: 'Home or Away wins; stake refunded on a draw',
  firstHalfDrawNoBet: 'Half-time DNB — stake refunded if level at HT',
  secondHalfDrawNoBet: 'Second-half DNB — stake refunded if level at 2nd half',
  toQualify: 'Which team advances to the next round',
  halfTimeOrFullTime: 'Predict result at half-time AND full-time',
  market_marcheaza_home: 'Will the home team score at least one goal?',
  market_marcheaza_away: 'Will the away team score at least one goal?',
  market_clean_sheet_home: 'Will the home team concede zero goals?',
  market_clean_sheet_away: 'Will the away team concede zero goals?',
  market_total_goluri_impar_par: 'Will total goals be odd or even?',
};

const LINE_MARKET_FAMILIES = [
  { prefix: 'firstHalfAsianTotalGoals', label: '1st Half Asian Goals', description: 'Asian Over/Under goals in first half' },
  { prefix: 'secondHalfAsianTotalGoals', label: '2nd Half Asian Goals', description: 'Asian Over/Under goals in second half' },
  { prefix: 'asianTotalGoals', label: 'Asian Goals', description: 'Asian Over/Under total match goals' },
  { prefix: 'firstHalfAsianTotalCorners', label: '1st Half Asian Corners', description: 'Asian Over/Under corners in first half' },
  { prefix: 'secondHalfAsianTotalCorners', label: '2nd Half Asian Corners', description: 'Asian Over/Under corners in second half' },
  { prefix: 'asianTotalCorners', label: 'Asian Corners', description: 'Asian Over/Under total match corners' },
  { prefix: 'firstHalfAsianTotalCards', label: '1st Half Asian Cards', description: 'Asian Over/Under cards in first half' },
  { prefix: 'secondHalfAsianTotalCards', label: '2nd Half Asian Cards', description: 'Asian Over/Under cards in second half' },
  { prefix: 'asianTotalCards', label: 'Asian Cards', description: 'Asian Over/Under total match cards' },
  { prefix: 'firstHalfTotalGoals', label: '1st Half Goals', description: 'Over/Under goals in first half' },
  { prefix: 'secondHalfTotalGoals', label: '2nd Half Goals', description: 'Over/Under goals in second half' },
  { prefix: 'totalGoals', label: 'Goals', description: 'Over/Under total match goals' },
  { prefix: 'firstHalfTotalCorners', label: '1st Half Corners', description: 'Over/Under corners in first half' },
  { prefix: 'secondHalfTotalCorners', label: '2nd Half Corners', description: 'Over/Under corners in second half' },
  { prefix: 'totalCorners', label: 'Corners', description: 'Over/Under total match corners' },
  { prefix: 'firstHalfTotalCards', label: '1st Half Cards', description: 'Over/Under cards in first half' },
  { prefix: 'secondHalfTotalCards', label: '2nd Half Cards', description: 'Over/Under cards in second half' },
  { prefix: 'totalCards', label: 'Cards', description: 'Over/Under total match cards' },
  { prefix: 'totalPoints', label: 'Points', description: 'Over/Under total match points' },
  { prefix: 'totalGames', label: 'Games', description: 'Over/Under total match games' },
  { prefix: 'totalSets', label: 'Sets', description: 'Over/Under total match sets' },
];

const OUTCOME_LABELS = {
  home: '1',
  draw: 'X',
  away: '2',
  homeAway: '12',
  homeDraw: '1X',
  drawAway: 'X2',
  yes: 'Yes',
  no: 'No',
  over: 'Over',
  under: 'Under',
  odd: 'Odd',
  even: 'Even',
};

const RESULT_MARKET_KEY_RE = /(?:^|_)(?:result|rezultat|1x2)(?:_|$)/;
const NON_THREE_WAY_RESULT_KEY_RE = /(?:doublechance|double_chance|drawnobet|draw_no_bet|dnb|halftimeorfulltime|half_time_or_full_time|ht_ft)/;
const BUCKET_OUTCOME_KEY_RE = /^(?:\d+(?:minus|plus)\d+|\d+(?:plus|_plus)|\d+_?\d*min(?:us)?\d*|\d+_to_\d+|\d+_or_more)$/;

function formatLineFromKey(key) {
  const m = String(key).match(/_(\d+)_(\d+)?$/);
  if (!m) {
    const m2 = String(key).match(/_(\d+)$/);
    if (m2) return m2[1];
    return null;
  }
  return m[2] ? `${m[1]}.${m[2]}` : m[1];
}

function parseLineNumberFromKey(key) {
  const line = formatLineFromKey(key);
  if (!line) return null;
  const number = Number(line);
  return Number.isFinite(number) ? number : null;
}

function isScannableMiddleLine(line) {
  return Number.isFinite(line) && line > 0;
}

function isInvalidFormulaLineMarket(marketKey) {
  const family = lineMarketFamilyForKey(marketKey);
  if (!family) return false;
  const line = parseLineNumberFromKey(marketKey);
  return line !== null && line <= 0;
}

function lineMarketFamilyForKey(key) {
  const normalized = String(key || '').replace(/_\d+(?:_\d+)?$/, '');
  return LINE_MARKET_FAMILIES.find((family) => normalized === family.prefix) || null;
}

function getLineMarketFamilyLabel(key) {
  return lineMarketFamilyForKey(key)?.label || null;
}

function getLineMarketFamilyDescription(key) {
  return lineMarketFamilyForKey(key)?.description || null;
}

function formatMiddleLegLabel(outcome, line, familyLabel) {
  const outcomeLabel = getOutcomeLabel(outcome);
  return familyLabel ? `${outcomeLabel} ${line} ${familyLabel}` : `${outcomeLabel} ${line}`;
}

function formatHandicapLine(key) {
  const zero = String(key).match(/(?:asian)?[Hh]andicap_0$/);
  if (zero) return '0';
  const m = String(key).match(/(?:asian)?[Hh]andicap_(plus|minus)_(\d+)(?:_(\d+))?$/);
  if (!m) return null;
  const sign = m[1] === 'plus' ? '+' : '-';
  const line = m[3] ? `${m[2]}.${m[3]}` : m[2];
  return `${sign}${line}`;
}

function getMarketLabel(key) {
  if (MARKET_LABELS[key]) return MARKET_LABELS[key];

  const k = String(key);

  // Asian handicap: asianHandicap_plus_0_5 → AH +0.5 ; asianHandicap_0 → AH 0
  const ah = formatHandicapLine(k);
  if (ah && k.startsWith('asianHandicap')) return ah === '0' ? 'AH 0 (DNB)' : `AH ${ah}`;
  if (ah && k.startsWith('handicap')) return ah === '0' ? 'Handicap 0' : `Handicap ${ah}`;

  // Total goals with line: totalGoals_2_5 → O/U 2.5 Goals
  if (/^totalGoals_/.test(k)) {
    const line = formatLineFromKey(k);
    return line ? `O/U ${line} Goals` : 'Total Goals';
  }
  if (/^firstHalfTotalGoals_/.test(k)) {
    const line = formatLineFromKey(k);
    return line ? `1H O/U ${line} Goals` : '1st Half Total Goals';
  }
  if (/^secondHalfTotalGoals_/.test(k)) {
    const line = formatLineFromKey(k);
    return line ? `2H O/U ${line} Goals` : '2nd Half Total Goals';
  }
  if (/^totalCorners_/.test(k)) {
    const line = formatLineFromKey(k);
    return line ? `O/U ${line} Corners` : 'Total Corners';
  }
  if (/^firstHalfTotalCorners_/.test(k)) {
    const line = formatLineFromKey(k);
    return line ? `1H O/U ${line} Corners` : '1st Half Corners';
  }
  if (/^secondHalfTotalCorners_/.test(k)) {
    const line = formatLineFromKey(k);
    return line ? `2H O/U ${line} Corners` : '2nd Half Corners';
  }
  if (/^totalCards_/.test(k)) {
    const line = formatLineFromKey(k);
    return line ? `O/U ${line} Cards` : 'Total Cards';
  }
  const multiSportTotal = k.match(/^total(Points|Games|Sets)_/);
  if (multiSportTotal) {
    const line = formatLineFromKey(k);
    return line ? `O/U ${line} ${multiSportTotal[1]}` : `Total ${multiSportTotal[1]}`;
  }
  if (/^firstHalfTotalCards_/.test(k)) {
    const line = formatLineFromKey(k);
    return line ? `1H O/U ${line} Cards` : '1st Half Cards';
  }
  if (/^secondHalfTotalCards_/.test(k)) {
    const line = formatLineFromKey(k);
    return line ? `2H O/U ${line} Cards` : '2nd Half Cards';
  }
  if (/^asianTotalGoals_/.test(k)) {
    const line = formatLineFromKey(k);
    return line ? `Asian O/U ${line} Goals` : 'Asian Total Goals';
  }
  if (/^firstHalfAsianTotalGoals_/.test(k)) {
    const line = formatLineFromKey(k);
    return line ? `1H Asian O/U ${line} Goals` : '1st Half Asian Total Goals';
  }
  if (/^secondHalfAsianTotalGoals_/.test(k)) {
    const line = formatLineFromKey(k);
    return line ? `2H Asian O/U ${line} Goals` : '2nd Half Asian Total Goals';
  }
  if (/^asianTotalCorners_/.test(k)) {
    const line = formatLineFromKey(k);
    return line ? `Asian O/U ${line} Corners` : 'Asian Total Corners';
  }
  if (/^firstHalfAsianTotalCorners_/.test(k)) {
    const line = formatLineFromKey(k);
    return line ? `1H Asian O/U ${line} Corners` : '1st Half Asian Total Corners';
  }
  if (/^secondHalfAsianTotalCorners_/.test(k)) {
    const line = formatLineFromKey(k);
    return line ? `2H Asian O/U ${line} Corners` : '2nd Half Asian Total Corners';
  }
  if (/^asianTotalCards_/.test(k)) {
    const line = formatLineFromKey(k);
    return line ? `Asian O/U ${line} Cards` : 'Asian Total Cards';
  }
  if (/^firstHalfAsianTotalCards_/.test(k)) {
    const line = formatLineFromKey(k);
    return line ? `1H Asian O/U ${line} Cards` : '1st Half Asian Total Cards';
  }
  if (/^secondHalfAsianTotalCards_/.test(k)) {
    const line = formatLineFromKey(k);
    return line ? `2H Asian O/U ${line} Cards` : '2nd Half Asian Total Cards';
  }
  if (/^total_goluri_home/.test(k)) return 'Home Team Total Goals';
  if (/^total_goluri_away/.test(k)) return 'Away Team Total Goals';
  if (/market_marcheaza_home/.test(k)) return 'Home to Score';
  if (/market_marcheaza_away/.test(k)) return 'Away to Score';
  if (/market_clean_sheet_home/.test(k)) return 'Home Clean Sheet';
  if (/market_clean_sheet_away/.test(k)) return 'Away Clean Sheet';
  if (/total_goluri_impar_par/.test(k)) return 'Total Goals Odd/Even';
  if (/castiga_oricare_repriza_home/.test(k)) return 'Home to Win a Half';
  if (/castiga_oricare_repriza_away/.test(k)) return 'Away to Win a Half';

  return k
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/_/g, ' ');
}

function describeMarket(key) {
  if (MARKET_DESCRIPTIONS[key]) return MARKET_DESCRIPTIONS[key];
  const k = String(key);
  if (/^asianHandicap/.test(k)) {
    const line = formatHandicapLine(k);
    return `Asian handicap ${line} — split stake on two adjacent lines`;
  }
  if (/^handicap_/.test(k)) {
    const line = formatHandicapLine(k);
    return `European handicap ${line} — full stake on one line`;
  }
  if (/^totalGoals_/.test(k)) return 'Over/Under total match goals';
  if (/^firstHalfTotalGoals_/.test(k)) return 'Over/Under goals in first half';
  if (/^secondHalfTotalGoals_/.test(k)) return 'Over/Under goals in second half';
  if (/^totalCorners_/.test(k)) return 'Over/Under total match corners';
  if (/^firstHalfTotalCorners_/.test(k)) return 'Over/Under corners in first half';
  if (/^secondHalfTotalCorners_/.test(k)) return 'Over/Under corners in second half';
  if (/^totalCards_/.test(k)) return 'Over/Under total match cards';
  if (/^totalPoints_/.test(k)) return 'Over/Under total match points';
  if (/^totalGames_/.test(k)) return 'Over/Under total match games';
  if (/^totalSets_/.test(k)) return 'Over/Under total match sets';
  if (/^firstHalfTotalCards_/.test(k)) return 'Over/Under cards in first half';
  if (/^secondHalfTotalCards_/.test(k)) return 'Over/Under cards in second half';
  if (/^asianTotal/.test(k) || /^firstHalfAsianTotal/.test(k) || /^secondHalfAsianTotal/.test(k)) {
    return getLineMarketFamilyDescription(k);
  }
  if (/market_marcheaza_home/.test(k)) return 'Will the home team score at least one goal?';
  if (/market_marcheaza_away/.test(k)) return 'Will the away team score at least one goal?';
  if (/market_clean_sheet_home/.test(k)) return 'Will the home team concede zero goals?';
  if (/market_clean_sheet_away/.test(k)) return 'Will the away team concede zero goals?';
  return null;
}

function getOutcomeLabel(key) {
  return OUTCOME_LABELS[key] || key;
}

function isResultLikeMarketKey(marketKey) {
  const key = String(marketKey || '').toLowerCase();
  return RESULT_MARKET_KEY_RE.test(key) && !NON_THREE_WAY_RESULT_KEY_RE.test(key);
}

function normalizeResultOutcomeKey(outcomeKey) {
  const key = String(outcomeKey || '').toLowerCase();
  if (key === 'home' || /(?:^|_)(?:1|home)(?:_|$)/.test(key)) return 'home';
  if (key === 'draw' || /(?:^|_)(?:x|draw|egal)(?:_|$)/.test(key)) return 'draw';
  if (key === 'away' || /(?:^|_)(?:2|away)(?:_|$)/.test(key)) return 'away';
  return null;
}

function expectedOutcomesForMarket(marketKey, outcomeKeys, sportKey) {
  const key = String(marketKey);

  // Sport-aware override: e.g. basketball h2h has no draw.
  if (sportKey) {
    const sportOutcomes = sportMarketOutcomes(sportKey, key);
    if (sportOutcomes) return sportOutcomes;
  }

  const expected = MARKET_OUTCOMES[key];
  if (expected) return expected;

  if (isResultLikeMarketKey(key)) {
    return ['home', 'draw', 'away'];
  }

  if (key.startsWith('handicap3Way_')) {
    return ['home', 'draw', 'away'];
  }

  if (key.startsWith('handicap_') && outcomeKeys.includes('draw')) {
    return ['home', 'draw', 'away'];
  }

  return null;
}

function isBucketLikeOutcomeKey(outcomeKey) {
  const key = String(outcomeKey || '').toLowerCase();
  return BUCKET_OUTCOME_KEY_RE.test(key)
    || /^\d+$/.test(key)
    || /^\d+_?\d*$/.test(key)
    || /^\d+(?:plus|minus)\d+$/.test(key);
}

function hasCompleteBucketCoverage(marketKey, outcomeKeys) {
  const key = String(marketKey || '').toLowerCase();
  if (!key.startsWith('market_')) return true;
  const bucketKeys = outcomeKeys.filter(isBucketLikeOutcomeKey);
  if (bucketKeys.length === 0) return true;
  return bucketKeys.length >= 3;
}

function hasExpectedOutcomes(best, expected) {
  if (!expected) return true;
  return expected.every((outcomeKey) => {
    if (best[outcomeKey]) return true;
    return Object.keys(best).some((key) => normalizeResultOutcomeKey(key) === outcomeKey);
  });
}

function impliedProb(price) {
  return 1 / price;
}

function calculateNoVigMarket(pricesByOutcome) {
  const entries = Object.entries(pricesByOutcome || {})
    .filter(([, price]) => typeof price === 'number' && Number.isFinite(price) && price > 1);
  if (entries.length < 2) return null;

  const outcomes = entries.map(([outcome, price]) => ({
    outcome,
    price,
    impliedProb: impliedProb(price),
  }));
  const overround = outcomes.reduce((sum, outcome) => sum + outcome.impliedProb, 0);
  if (!(overround > 0)) return null;

  return {
    overround,
    hold: overround - 1,
    outcomes: outcomes.map((outcome) => {
      const fairProb = outcome.impliedProb / overround;
      return {
        ...outcome,
        fairProb,
        fairOdds: fairProb > 0 ? 1 / fairProb : outcome.price,
      };
    }),
  };
}

/** Collect all unique market keys across all bookmakers for an event */
function getEventMarkets(event) {
  const marketKeys = new Set();
  for (const bm of event.bookmakers || []) {
    if (bm.markets && typeof bm.markets === 'object') {
      for (const key of Object.keys(bm.markets)) {
        marketKeys.add(key);
      }
    }
  }
  return [...marketKeys];
}

/** For a given event + market key, find the best price for each outcome across all bookmakers */
function findBestPrices(event, marketKey) {
  const outcomes = {};
  for (const bm of event.bookmakers || []) {
    if (!bm.markets || !bm.markets[marketKey]) continue;
    const marketData = bm.markets[marketKey];
    for (const [outcomeKey, price] of Object.entries(marketData)) {
      if (typeof price !== 'number' || price <= 1) continue;
      if (!outcomes[outcomeKey] || price > outcomes[outcomeKey].price) {
        outcomes[outcomeKey] = {
          price,
          bookmaker: bm.name,
          url: bm.eventUrl || bm.bookmakerUrl || '',
          label: getOutcomeLabel(outcomeKey),
          marketKey,
          outcome: outcomeKey,
          verificationStatus: marketVerificationStatus(bm, marketKey, outcomeKey),
        };
      }
    }
  }
  return outcomes;
}

/** Collect all prices per outcome across bookmakers for a market */
function collectAllPrices(event, marketKey) {
  const all = {};
  for (const bm of event.bookmakers || []) {
    if (!bm.markets || !bm.markets[marketKey]) continue;
    const md = bm.markets[marketKey];
    for (const [ok, price] of Object.entries(md)) {
      if (typeof price !== 'number' || price <= 1) continue;
      if (!all[ok]) all[ok] = [];
      all[ok].push({
        price,
        bookmaker: bm.name,
        url: bm.eventUrl || bm.bookmakerUrl || '',
        marketKey,
        outcome: ok,
        verificationStatus: marketVerificationStatus(bm, marketKey, ok),
      });
    }
  }
  return all;
}

function marketVerificationStatus(bookmaker, marketKey, outcome) {
  const roots = [
    bookmaker?.verification,
    bookmaker?.fidelity,
    bookmaker?.oddsVerification,
    bookmaker?.oddsFidelity,
  ].filter(Boolean);

  for (const root of roots) {
    const status = statusFromVerificationRoot(root, marketKey, outcome);
    if (status) return status;
  }

  for (const list of [
    bookmaker?.verificationRecords,
    bookmaker?.fidelityRecords,
    bookmaker?.oddsVerificationRecords,
  ]) {
    if (!Array.isArray(list)) continue;
    const record = list.find((item) =>
      item?.marketKey === marketKey && String(item?.outcome) === String(outcome));
    const status = statusFromNode(record);
    if (status) return status;
  }

  return null;
}

function statusFromVerificationRoot(root, marketKey, outcome) {
  const marketNode = root?.markets?.[marketKey] || root?.[marketKey];
  return statusFromNode(marketNode?.[outcome])
    || statusFromNode(marketNode?.outcomes?.[outcome])
    || statusFromNode(marketNode)
    || statusFromNode(root?.records?.find?.((item) =>
      item?.marketKey === marketKey && String(item?.outcome) === String(outcome)))
    || statusFromNode(root);
}

function statusFromNode(node) {
  if (!node) return null;
  if (typeof node === 'string') return node;
  return node.status || node.verificationStatus || node.fidelityStatus || null;
}

/* ===== Formula 1: Classic cross-book arbitrage ===== */
function detectArbitrage(event, marketKey, sportKey) {
  // Scannable includes push/integer lines and yes/no team markets so more
  // mathematical candidates surface; eligibility still gates actionable.
  if (!isScannableClassicMarket(marketKey)) return null;
  if (isInvalidFormulaLineMarket(marketKey)) return null;

  const best = findBestPrices(event, marketKey);
  const outcomeKeys = Object.keys(best);
  if (outcomeKeys.length < 2) return null;

  // Reject known markets with incomplete outcomes — e.g. a 1X2 market
  // where only Home and Away prices were parsed (missing Draw makes
  // the implied-probability sum artificially low, producing fake edges).
  const expected = expectedOutcomesForMarket(marketKey, outcomeKeys, sportKey || event.sport);
  if (!hasExpectedOutcomes(best, expected)) return null;
  if (!hasCompleteBucketCoverage(marketKey, outcomeKeys)) return null;

  let totalProb = 0;
  const legs = [];
  for (const key of outcomeKeys) {
    const p = best[key];
    totalProb += impliedProb(p.price);
    legs.push({
      outcome: key,
      label: p.label,
      bookmaker: p.bookmaker,
      price: p.price,
      url: p.url || '',
      marketKey: p.marketKey || marketKey,
      verificationStatus: p.verificationStatus || null,
    });
  }

  const edge = 1 - totalProb;
  if (edge <= 0) return null;

  // Sanity cap: real arbitrage edges are typically 0.5–5%. Anything
  // above 25% is virtually always a data-quality issue (missing outcome,
  // misparsed exotic market, stale price, different settlement rules).
  if (edge > MAX_ARB_EDGE) return null;

  const stake = 100;
  for (const leg of legs) {
    leg.stake = (stake * impliedProb(leg.price)) / totalProb;
  }
  const returnAmount = stake / totalProb;
  const profit = returnAmount - stake;

  return {
    marketKey,
    marketLabel: getMarketLabel(marketKey),
    legs,
    edge,
    profit,
    returnAmount,
    totalProb,
    stake,
    type: 'classic',
    confidence: classifyConfidence(edge, outcomeKeys.length, legs.length),
  };
}

/* ===== Formula 2: Cross-market arbitrage (1X2 vs doubleChance, all periods) ===== */
function pushCrossMarketPair(results, {
  marketKey,
  marketLabel,
  legA,
  legB,
}) {
  if (!legA || !legB) return;
  const priceA = Number(legA.price);
  const priceB = Number(legB.price);
  if (!(priceA > 1) || !(priceB > 1)) return;
  const total = impliedProb(priceA) + impliedProb(priceB);
  if (!(total < 1)) return;
  const edge = 1 - total;
  if (edge > MAX_ARB_EDGE) return;
  const stake = 100;
  const s1 = (stake * impliedProb(priceA)) / total;
  const s2 = (stake * impliedProb(priceB)) / total;
  results.push({
    marketKey,
    marketLabel,
    type: 'cross-market',
    legs: [
      {
        outcome: legA.outcome,
        label: legA.label,
        bookmaker: legA.bookmaker,
        price: priceA,
        stake: s1,
        url: legA.url || '',
        marketKey: legA.marketKey,
        verificationStatus: legA.verificationStatus || null,
      },
      {
        outcome: legB.outcome,
        label: legB.label,
        bookmaker: legB.bookmaker,
        price: priceB,
        stake: s2,
        url: legB.url || '',
        marketKey: legB.marketKey,
        verificationStatus: legB.verificationStatus || null,
      },
    ],
    edge,
    profit: stake / total - stake,
    totalProb: total,
    stake,
    confidence: classifyConfidence(edge, 2, 2),
  });
}

function detectPeriodCrossMarket(event, h2hKey, dcKey, keyPrefix, labelPrefix) {
  const results = [];
  const h2hBest = findBestPrices(event, h2hKey);
  const dcBest = findBestPrices(event, dcKey);
  if (!h2hBest.away || !h2hBest.home) return results;

  const prefix = keyPrefix || '';
  const label = labelPrefix ? `${labelPrefix} ` : '';

  // DC 1X + h2h 2
  if (dcBest.homeDraw) {
    pushCrossMarketPair(results, {
      marketKey: `cross_${prefix}1X_2`,
      marketLabel: `${label}1X (DC) + 2 (1X2)`.trim(),
      legA: {
        outcome: '1X',
        label: '1X',
        bookmaker: dcBest.homeDraw.bookmaker,
        price: dcBest.homeDraw.price,
        url: dcBest.homeDraw.url,
        marketKey: dcBest.homeDraw.marketKey || dcKey,
        verificationStatus: dcBest.homeDraw.verificationStatus,
      },
      legB: {
        outcome: 'away',
        label: '2',
        bookmaker: h2hBest.away.bookmaker,
        price: h2hBest.away.price,
        url: h2hBest.away.url,
        marketKey: h2hBest.away.marketKey || h2hKey,
        verificationStatus: h2hBest.away.verificationStatus,
      },
    });
  }

  // DC X2 + h2h 1
  if (dcBest.drawAway) {
    pushCrossMarketPair(results, {
      marketKey: `cross_${prefix}1_X2`,
      marketLabel: `${label}1 (1X2) + X2 (DC)`.trim(),
      legA: {
        outcome: 'home',
        label: '1',
        bookmaker: h2hBest.home.bookmaker,
        price: h2hBest.home.price,
        url: h2hBest.home.url,
        marketKey: h2hBest.home.marketKey || h2hKey,
        verificationStatus: h2hBest.home.verificationStatus,
      },
      legB: {
        outcome: 'X2',
        label: 'X2',
        bookmaker: dcBest.drawAway.bookmaker,
        price: dcBest.drawAway.price,
        url: dcBest.drawAway.url,
        marketKey: dcBest.drawAway.marketKey || dcKey,
        verificationStatus: dcBest.drawAway.verificationStatus,
      },
    });
  }

  // DC 12 + h2h X
  if (dcBest.homeAway && h2hBest.draw) {
    pushCrossMarketPair(results, {
      marketKey: `cross_${prefix}12_X`,
      marketLabel: `${label}12 (DC) + X (1X2)`.trim(),
      legA: {
        outcome: '12',
        label: '12',
        bookmaker: dcBest.homeAway.bookmaker,
        price: dcBest.homeAway.price,
        url: dcBest.homeAway.url,
        marketKey: dcBest.homeAway.marketKey || dcKey,
        verificationStatus: dcBest.homeAway.verificationStatus,
      },
      legB: {
        outcome: 'draw',
        label: 'X',
        bookmaker: h2hBest.draw.bookmaker,
        price: h2hBest.draw.price,
        url: h2hBest.draw.url,
        marketKey: h2hBest.draw.marketKey || h2hKey,
        verificationStatus: h2hBest.draw.verificationStatus,
      },
    });
  }

  return results;
}

function detectCrossMarketArbitrage(event) {
  return [
    ...detectPeriodCrossMarket(event, 'h2h', 'doubleChance', '', ''),
    ...detectPeriodCrossMarket(event, 'firstHalfH2h', 'firstHalfDoubleChance', '1H_', '1H'),
    ...detectPeriodCrossMarket(event, 'secondHalfH2h', 'secondHalfDoubleChance', '2H_', '2H'),
    ...detectBttsTotalsSoftCross(event),
    ...detectQualifyVsH2hCross(event),
    ...detectTeamScoreVsCleanSheetCross(event),
    ...detectScoreVsTeamTotalIdentityCross(event),
    ...detectDnbVsDoubleChanceCross(event),
    ...detectH2hVsDnbMirrorCross(event),
    ...detectQualifyVsDnbCross(event),
    ...detectCsNoVsOpponentScoreCross(event),
    ...detectEuroAsianSameLineArbitrage(event),
    ...detectAhZeroVsDnbCross(event),
    ...detectDcVsAhZeroCross(event),
  ];
}

/**
 * Double-chance vs AH0 complementary soft covers (push on draw for AH0):
 * - 1X + AH0 Away  (home/draw vs away)
 * - X2 + AH0 Home  (away/draw vs home)
 * Kept as review candidates (AH0 push settlement).
 */
function detectDcVsAhZeroCross(event) {
  const results = [];
  const dc = findBestPrices(event, 'doubleChance');
  const ah = findBestPrices(event, 'asianHandicap_0');
  if (!dc.homeDraw && !dc.drawAway) return results;

  if (dc.homeDraw && ah.away) {
    pushCrossMarketPair(results, {
      marketKey: 'cross_dc_1x_ah0_away',
      marketLabel: '1X (DC) + AH0 Away',
      legA: {
        outcome: 'homeDraw',
        label: '1X',
        bookmaker: dc.homeDraw.bookmaker,
        price: dc.homeDraw.price,
        url: dc.homeDraw.url,
        marketKey: dc.homeDraw.marketKey || 'doubleChance',
        verificationStatus: dc.homeDraw.verificationStatus,
      },
      legB: {
        outcome: 'away',
        label: 'AH0 Away',
        bookmaker: ah.away.bookmaker,
        price: ah.away.price,
        url: ah.away.url,
        marketKey: ah.away.marketKey || 'asianHandicap_0',
        verificationStatus: ah.away.verificationStatus,
      },
    });
  }
  if (dc.drawAway && ah.home) {
    pushCrossMarketPair(results, {
      marketKey: 'cross_dc_x2_ah0_home',
      marketLabel: 'X2 (DC) + AH0 Home',
      legA: {
        outcome: 'drawAway',
        label: 'X2',
        bookmaker: dc.drawAway.bookmaker,
        price: dc.drawAway.price,
        url: dc.drawAway.url,
        marketKey: dc.drawAway.marketKey || 'doubleChance',
        verificationStatus: dc.drawAway.verificationStatus,
      },
      legB: {
        outcome: 'home',
        label: 'AH0 Home',
        bookmaker: ah.home.bookmaker,
        price: ah.home.price,
        url: ah.home.url,
        marketKey: ah.home.marketKey || 'asianHandicap_0',
        verificationStatus: ah.home.verificationStatus,
      },
    });
  }
  return results;
}

/**
 * Asian Handicap 0 and Draw No Bet share the same win/lose/push matrix on FT
 * result. Merge best home/away across both markets for a soft two-way, and
 * emit complementary AH0 Home × DNB Away (and inverse) when books disagree.
 * Push on draw → review/candidate only (not SAFE_CROSS).
 */
function detectAhZeroVsDnbCross(event) {
  const results = [];

  // Full-time AH0 × DNB only (AH keys are FT-scoped in providers).
  const dnb = findBestPrices(event, 'drawNoBet');
  const ah = findBestPrices(event, 'asianHandicap_0');

  const bestHome = pickBestPriceEntry(dnb.home, ah.home);
  const bestAway = pickBestPriceEntry(dnb.away, ah.away);
  if (bestHome && bestAway) {
    pushCrossMarketPair(results, {
      marketKey: 'cross_dnb_ah0_merged',
      marketLabel: 'DNB/AH0 Home + Away (merged)',
      legA: {
        outcome: 'home',
        label: 'Home (DNB/AH0)',
        bookmaker: bestHome.bookmaker,
        price: bestHome.price,
        url: bestHome.url,
        marketKey: bestHome.marketKey || 'drawNoBet',
        verificationStatus: bestHome.verificationStatus,
      },
      legB: {
        outcome: 'away',
        label: 'Away (DNB/AH0)',
        bookmaker: bestAway.bookmaker,
        price: bestAway.price,
        url: bestAway.url,
        marketKey: bestAway.marketKey || 'drawNoBet',
        verificationStatus: bestAway.verificationStatus,
      },
    });
  }

  // Complementary soft: AH0 Home vs DNB Away (and inverse)
  if (ah.home && dnb.away) {
    pushCrossMarketPair(results, {
      marketKey: 'cross_ah0_home_dnb_away',
      marketLabel: 'AH0 Home + DNB Away',
      legA: {
        outcome: 'home',
        label: 'AH0 Home',
        bookmaker: ah.home.bookmaker,
        price: ah.home.price,
        url: ah.home.url,
        marketKey: ah.home.marketKey || 'asianHandicap_0',
        verificationStatus: ah.home.verificationStatus,
      },
      legB: {
        outcome: 'away',
        label: 'DNB Away',
        bookmaker: dnb.away.bookmaker,
        price: dnb.away.price,
        url: dnb.away.url,
        marketKey: dnb.away.marketKey || 'drawNoBet',
        verificationStatus: dnb.away.verificationStatus,
      },
    });
  }
  if (ah.away && dnb.home) {
    pushCrossMarketPair(results, {
      marketKey: 'cross_ah0_away_dnb_home',
      marketLabel: 'AH0 Away + DNB Home',
      legA: {
        outcome: 'away',
        label: 'AH0 Away',
        bookmaker: ah.away.bookmaker,
        price: ah.away.price,
        url: ah.away.url,
        marketKey: ah.away.marketKey || 'asianHandicap_0',
        verificationStatus: ah.away.verificationStatus,
      },
      legB: {
        outcome: 'home',
        label: 'DNB Home',
        bookmaker: dnb.home.bookmaker,
        price: dnb.home.price,
        url: dnb.home.url,
        marketKey: dnb.home.marketKey || 'drawNoBet',
        verificationStatus: dnb.home.verificationStatus,
      },
    });
  }

  return results;
}

/**
 * Exhaustive identities on half-line 0.5 team totals:
 * - Team scores Yes ≡ team Over 0.5
 * - Team scores No  ≡ team Under 0.5
 * - Clean sheet Yes ≡ opponent Under 0.5
 * - Clean sheet No  ≡ opponent Over 0.5
 * Best-of-book pairing surfaces edges classic per-market scanning misses.
 */
function detectScoreVsTeamTotalIdentityCross(event) {
  const results = [];
  const homeScore = findBestPrices(event, 'market_marcheaza_home');
  const awayScore = findBestPrices(event, 'market_marcheaza_away');
  const homeCs = findBestPrices(event, 'market_clean_sheet_home');
  const awayCs = findBestPrices(event, 'market_clean_sheet_away');
  const homeOu = findBestPrices(event, 'market_total_goluri_home_0_5');
  const awayOu = findBestPrices(event, 'market_total_goluri_away_0_5');

  // Complementary partitions only (Yes ≡ Over 0.5 / No ≡ Under 0.5).
  const exhaustive = [
    {
      marketKey: 'cross_home_score_yes_vs_home_under_0_5',
      marketLabel: 'Home Scores Yes + Home Under 0.5',
      legA: homeScore.yes && {
        outcome: 'yes',
        label: 'Home Scores',
        bookmaker: homeScore.yes.bookmaker,
        price: homeScore.yes.price,
        url: homeScore.yes.url,
        marketKey: homeScore.yes.marketKey || 'market_marcheaza_home',
        verificationStatus: homeScore.yes.verificationStatus,
      },
      legB: homeOu.under && {
        outcome: 'under',
        label: 'Home Under 0.5',
        bookmaker: homeOu.under.bookmaker,
        price: homeOu.under.price,
        url: homeOu.under.url,
        marketKey: homeOu.under.marketKey || 'market_total_goluri_home_0_5',
        verificationStatus: homeOu.under.verificationStatus,
      },
    },
    {
      marketKey: 'cross_home_score_no_vs_home_over_0_5',
      marketLabel: 'Home Scores No + Home Over 0.5',
      legA: homeScore.no && {
        outcome: 'no',
        label: 'Home No Score',
        bookmaker: homeScore.no.bookmaker,
        price: homeScore.no.price,
        url: homeScore.no.url,
        marketKey: homeScore.no.marketKey || 'market_marcheaza_home',
        verificationStatus: homeScore.no.verificationStatus,
      },
      legB: homeOu.over && {
        outcome: 'over',
        label: 'Home Over 0.5',
        bookmaker: homeOu.over.bookmaker,
        price: homeOu.over.price,
        url: homeOu.over.url,
        marketKey: homeOu.over.marketKey || 'market_total_goluri_home_0_5',
        verificationStatus: homeOu.over.verificationStatus,
      },
    },
    {
      marketKey: 'cross_away_score_yes_vs_away_under_0_5',
      marketLabel: 'Away Scores Yes + Away Under 0.5',
      legA: awayScore.yes && {
        outcome: 'yes',
        label: 'Away Scores',
        bookmaker: awayScore.yes.bookmaker,
        price: awayScore.yes.price,
        url: awayScore.yes.url,
        marketKey: awayScore.yes.marketKey || 'market_marcheaza_away',
        verificationStatus: awayScore.yes.verificationStatus,
      },
      legB: awayOu.under && {
        outcome: 'under',
        label: 'Away Under 0.5',
        bookmaker: awayOu.under.bookmaker,
        price: awayOu.under.price,
        url: awayOu.under.url,
        marketKey: awayOu.under.marketKey || 'market_total_goluri_away_0_5',
        verificationStatus: awayOu.under.verificationStatus,
      },
    },
    {
      marketKey: 'cross_away_score_no_vs_away_over_0_5',
      marketLabel: 'Away Scores No + Away Over 0.5',
      legA: awayScore.no && {
        outcome: 'no',
        label: 'Away No Score',
        bookmaker: awayScore.no.bookmaker,
        price: awayScore.no.price,
        url: awayScore.no.url,
        marketKey: awayScore.no.marketKey || 'market_marcheaza_away',
        verificationStatus: awayScore.no.verificationStatus,
      },
      legB: awayOu.over && {
        outcome: 'over',
        label: 'Away Over 0.5',
        bookmaker: awayOu.over.bookmaker,
        price: awayOu.over.price,
        url: awayOu.over.url,
        marketKey: awayOu.over.marketKey || 'market_total_goluri_away_0_5',
        verificationStatus: awayOu.over.verificationStatus,
      },
    },
    {
      marketKey: 'cross_home_cs_yes_vs_away_over_0_5',
      marketLabel: 'Home Clean Sheet Yes + Away Over 0.5',
      legA: homeCs.yes && {
        outcome: 'yes',
        label: 'Home Clean Sheet',
        bookmaker: homeCs.yes.bookmaker,
        price: homeCs.yes.price,
        url: homeCs.yes.url,
        marketKey: homeCs.yes.marketKey || 'market_clean_sheet_home',
        verificationStatus: homeCs.yes.verificationStatus,
      },
      legB: awayOu.over && {
        outcome: 'over',
        label: 'Away Over 0.5',
        bookmaker: awayOu.over.bookmaker,
        price: awayOu.over.price,
        url: awayOu.over.url,
        marketKey: awayOu.over.marketKey || 'market_total_goluri_away_0_5',
        verificationStatus: awayOu.over.verificationStatus,
      },
    },
    {
      marketKey: 'cross_home_cs_no_vs_away_under_0_5',
      marketLabel: 'Home Clean Sheet No + Away Under 0.5',
      legA: homeCs.no && {
        outcome: 'no',
        label: 'Home CS No',
        bookmaker: homeCs.no.bookmaker,
        price: homeCs.no.price,
        url: homeCs.no.url,
        marketKey: homeCs.no.marketKey || 'market_clean_sheet_home',
        verificationStatus: homeCs.no.verificationStatus,
      },
      legB: awayOu.under && {
        outcome: 'under',
        label: 'Away Under 0.5',
        bookmaker: awayOu.under.bookmaker,
        price: awayOu.under.price,
        url: awayOu.under.url,
        marketKey: awayOu.under.marketKey || 'market_total_goluri_away_0_5',
        verificationStatus: awayOu.under.verificationStatus,
      },
    },
    {
      marketKey: 'cross_away_cs_yes_vs_home_over_0_5',
      marketLabel: 'Away Clean Sheet Yes + Home Over 0.5',
      legA: awayCs.yes && {
        outcome: 'yes',
        label: 'Away Clean Sheet',
        bookmaker: awayCs.yes.bookmaker,
        price: awayCs.yes.price,
        url: awayCs.yes.url,
        marketKey: awayCs.yes.marketKey || 'market_clean_sheet_away',
        verificationStatus: awayCs.yes.verificationStatus,
      },
      legB: homeOu.over && {
        outcome: 'over',
        label: 'Home Over 0.5',
        bookmaker: homeOu.over.bookmaker,
        price: homeOu.over.price,
        url: homeOu.over.url,
        marketKey: homeOu.over.marketKey || 'market_total_goluri_home_0_5',
        verificationStatus: homeOu.over.verificationStatus,
      },
    },
    {
      marketKey: 'cross_away_cs_no_vs_home_under_0_5',
      marketLabel: 'Away Clean Sheet No + Home Under 0.5',
      legA: awayCs.no && {
        outcome: 'no',
        label: 'Away CS No',
        bookmaker: awayCs.no.bookmaker,
        price: awayCs.no.price,
        url: awayCs.no.url,
        marketKey: awayCs.no.marketKey || 'market_clean_sheet_away',
        verificationStatus: awayCs.no.verificationStatus,
      },
      legB: homeOu.under && {
        outcome: 'under',
        label: 'Home Under 0.5',
        bookmaker: homeOu.under.bookmaker,
        price: homeOu.under.price,
        url: homeOu.under.url,
        marketKey: homeOu.under.marketKey || 'market_total_goluri_home_0_5',
        verificationStatus: homeOu.under.verificationStatus,
      },
    },
  ];

  for (const pair of exhaustive) {
    if (!pair.legA || !pair.legB) continue;
    pushCrossMarketPair(results, {
      marketKey: pair.marketKey,
      marketLabel: pair.marketLabel,
      legA: pair.legA,
      legB: pair.legB,
    });
  }

  return results;
}

/**
 * Half-line European and Asian totals settle identically on integer outcomes.
 * Combining best Over from one family with best Under from the other unlocks
 * edges that per-market classic scanning misses.
 */
function detectEuroAsianSameLineArbitrage(event) {
  const results = [];
  const families = [
    {
      euroPrefix: 'totalGoals_',
      asianPrefix: 'asianTotalGoals_',
      id: 'goals',
      label: 'Goals',
    },
    {
      euroPrefix: 'firstHalfTotalGoals_',
      asianPrefix: 'firstHalfAsianTotalGoals_',
      id: '1h_goals',
      label: '1H Goals',
    },
    {
      euroPrefix: 'secondHalfTotalGoals_',
      asianPrefix: 'secondHalfAsianTotalGoals_',
      id: '2h_goals',
      label: '2H Goals',
    },
    {
      euroPrefix: 'totalCorners_',
      asianPrefix: 'asianTotalCorners_',
      id: 'corners',
      label: 'Corners',
    },
    {
      euroPrefix: 'totalCards_',
      asianPrefix: 'asianTotalCards_',
      id: 'cards',
      label: 'Cards',
    },
    {
      euroPrefix: 'firstHalfTotalCorners_',
      asianPrefix: 'firstHalfAsianTotalCorners_',
      id: '1h_corners',
      label: '1H Corners',
    },
    {
      euroPrefix: 'secondHalfTotalCorners_',
      asianPrefix: 'secondHalfAsianTotalCorners_',
      id: '2h_corners',
      label: '2H Corners',
    },
    {
      euroPrefix: 'firstHalfTotalCards_',
      asianPrefix: 'firstHalfAsianTotalCards_',
      id: '1h_cards',
      label: '1H Cards',
    },
    {
      euroPrefix: 'secondHalfTotalCards_',
      asianPrefix: 'secondHalfAsianTotalCards_',
      id: '2h_cards',
      label: '2H Cards',
    },
  ];

  const marketKeys = getEventMarkets(event);
  for (const family of families) {
    const euroByLine = new Map();
    const asianByLine = new Map();
    for (const mk of marketKeys) {
      if (mk.startsWith(family.euroPrefix)) {
        const line = parseLineNumberFromKey(mk);
        if (line !== null && Math.abs((line % 1) - 0.5) < 1e-9) euroByLine.set(line, mk);
      } else if (mk.startsWith(family.asianPrefix)) {
        const line = parseLineNumberFromKey(mk);
        if (line !== null && Math.abs((line % 1) - 0.5) < 1e-9) asianByLine.set(line, mk);
      }
    }

    for (const [line, euroKey] of euroByLine) {
      const asianKey = asianByLine.get(line);
      if (!asianKey) continue;

      const euroBest = findBestPrices(event, euroKey);
      const asianBest = findBestPrices(event, asianKey);
      const candidates = [
        [euroBest.over, asianBest.under],
        [asianBest.over, euroBest.under],
        [euroBest.over, euroBest.under],
        [asianBest.over, asianBest.under],
      ];

      let bestPair = null;
      for (const [over, under] of candidates) {
        if (!over || !under || !(Number(over.price) > 1) || !(Number(under.price) > 1)) continue;
        if (over.bookmaker && under.bookmaker && over.bookmaker === under.bookmaker) continue;
        const total = impliedProb(over.price) + impliedProb(under.price);
        if (!(total < 1)) continue;
        const edge = 1 - total;
        if (edge > MAX_ARB_EDGE) continue;
        if (!bestPair || edge > bestPair.edge) {
          bestPair = { over, under, edge, total };
        }
      }
      if (!bestPair) continue;

      const stake = 100;
      const s1 = (stake * impliedProb(bestPair.over.price)) / bestPair.total;
      const s2 = (stake * impliedProb(bestPair.under.price)) / bestPair.total;
      const lineToken = String(line).replace('.', '_');
      results.push({
        marketKey: `cross_eu_as_ou_${family.id}_${lineToken}`,
        marketLabel: `${family.label} O/U ${line} (EU↔Asian)`,
        type: 'cross-market',
        legs: [
          {
            outcome: 'over',
            label: `Over ${line}`,
            bookmaker: bestPair.over.bookmaker,
            price: bestPair.over.price,
            stake: s1,
            url: bestPair.over.url || '',
            marketKey: bestPair.over.marketKey || euroKey,
            verificationStatus: bestPair.over.verificationStatus || null,
          },
          {
            outcome: 'under',
            label: `Under ${line}`,
            bookmaker: bestPair.under.bookmaker,
            price: bestPair.under.price,
            stake: s2,
            url: bestPair.under.url || '',
            marketKey: bestPair.under.marketKey || asianKey,
            verificationStatus: bestPair.under.verificationStatus || null,
          },
        ],
        edge: bestPair.edge,
        profit: stake / bestPair.total - stake,
        totalProb: bestPair.total,
        stake,
        confidence: classifyConfidence(bestPair.edge, 2, 2),
      });
    }
  }

  return results;
}

/**
 * Clean-sheet No ≡ opponent scored. Pair Home CS No with Away scores No (and
 * inverse) for exhaustive yes/no coverage when books split the two markets.
 */
function detectCsNoVsOpponentScoreCross(event) {
  const results = [];
  const homeScore = findBestPrices(event, 'market_marcheaza_home');
  const awayScore = findBestPrices(event, 'market_marcheaza_away');
  const homeCs = findBestPrices(event, 'market_clean_sheet_home');
  const awayCs = findBestPrices(event, 'market_clean_sheet_away');

  // Home CS No (away scored) vs Away scores No
  if (homeCs.no && awayScore.no) {
    pushCrossMarketPair(results, {
      marketKey: 'cross_home_cs_no_vs_away_ns',
      marketLabel: 'Home CS No + Away No Score',
      legA: {
        outcome: 'no',
        label: 'Home CS No',
        bookmaker: homeCs.no.bookmaker,
        price: homeCs.no.price,
        url: homeCs.no.url,
        marketKey: homeCs.no.marketKey || 'market_clean_sheet_home',
        verificationStatus: homeCs.no.verificationStatus,
      },
      legB: {
        outcome: 'no',
        label: 'Away No Score',
        bookmaker: awayScore.no.bookmaker,
        price: awayScore.no.price,
        url: awayScore.no.url,
        marketKey: awayScore.no.marketKey || 'market_marcheaza_away',
        verificationStatus: awayScore.no.verificationStatus,
      },
    });
  }

  // Away CS No (home scored) vs Home scores No
  if (awayCs.no && homeScore.no) {
    pushCrossMarketPair(results, {
      marketKey: 'cross_away_cs_no_vs_home_ns',
      marketLabel: 'Away CS No + Home No Score',
      legA: {
        outcome: 'no',
        label: 'Away CS No',
        bookmaker: awayCs.no.bookmaker,
        price: awayCs.no.price,
        url: awayCs.no.url,
        marketKey: awayCs.no.marketKey || 'market_clean_sheet_away',
        verificationStatus: awayCs.no.verificationStatus,
      },
      legB: {
        outcome: 'no',
        label: 'Home No Score',
        bookmaker: homeScore.no.bookmaker,
        price: homeScore.no.price,
        url: homeScore.no.url,
        marketKey: homeScore.no.marketKey || 'market_marcheaza_home',
        verificationStatus: homeScore.no.verificationStatus,
      },
    });
  }

  return results;
}

/**
 * Soft: To-qualify Home vs Away DNB (and inverse). Extra-time qualification and
 * DNB push on draw mean this is review-only (unsupported_formula / push).
 */
function detectQualifyVsDnbCross(event) {
  const results = [];
  const qualify = findBestPrices(event, 'toQualify');
  const dnb = findBestPrices(event, 'drawNoBet');
  if (qualify.home && dnb.away) {
    pushCrossMarketPair(results, {
      marketKey: 'cross_qualify_home_dnb_away',
      marketLabel: 'To Qualify Home + DNB Away',
      legA: {
        outcome: 'home',
        label: 'Qualify 1',
        bookmaker: qualify.home.bookmaker,
        price: qualify.home.price,
        url: qualify.home.url,
        marketKey: qualify.home.marketKey || 'toQualify',
        verificationStatus: qualify.home.verificationStatus,
      },
      legB: {
        outcome: 'away',
        label: 'DNB 2',
        bookmaker: dnb.away.bookmaker,
        price: dnb.away.price,
        url: dnb.away.url,
        marketKey: dnb.away.marketKey || 'drawNoBet',
        verificationStatus: dnb.away.verificationStatus,
      },
    });
  }
  if (qualify.away && dnb.home) {
    pushCrossMarketPair(results, {
      marketKey: 'cross_qualify_away_dnb_home',
      marketLabel: 'To Qualify Away + DNB Home',
      legA: {
        outcome: 'away',
        label: 'Qualify 2',
        bookmaker: qualify.away.bookmaker,
        price: qualify.away.price,
        url: qualify.away.url,
        marketKey: qualify.away.marketKey || 'toQualify',
        verificationStatus: qualify.away.verificationStatus,
      },
      legB: {
        outcome: 'home',
        label: 'DNB 1',
        bookmaker: dnb.home.bookmaker,
        price: dnb.home.price,
        url: dnb.home.url,
        marketKey: dnb.home.marketKey || 'drawNoBet',
        verificationStatus: dnb.home.verificationStatus,
      },
    });
  }
  return results;
}

/**
 * Soft 2-way: match Home vs Away DNB (and Away vs Home DNB).
 * Draw pushes the DNB leg and loses the straight 1/2 — worst case is break-even
 * on the DNB stake return, so classic dutch underestimates floor → review only.
 */
function detectH2hVsDnbMirrorCross(event) {
  return [
    ...detectH2hVsDnbForScope(event, {
      h2hKey: 'h2h',
      dnbKey: 'drawNoBet',
      prefix: '',
      labelPrefix: '',
    }),
    ...detectH2hVsDnbForScope(event, {
      h2hKey: 'firstHalfH2h',
      dnbKey: 'firstHalfDrawNoBet',
      prefix: '1H_',
      labelPrefix: '1H ',
    }),
    ...detectH2hVsDnbForScope(event, {
      h2hKey: 'secondHalfH2h',
      dnbKey: 'secondHalfDrawNoBet',
      prefix: '2H_',
      labelPrefix: '2H ',
    }),
  ];
}

function detectH2hVsDnbForScope(event, { h2hKey, dnbKey, prefix, labelPrefix }) {
  const results = [];
  const h2h = findBestPrices(event, h2hKey);
  const dnb = findBestPrices(event, dnbKey);
  if (h2h.home && dnb.away) {
    pushCrossMarketPair(results, {
      marketKey: `cross_${prefix}h2h_home_dnb_away`,
      marketLabel: `${labelPrefix}1 (1X2) + DNB Away`.trim(),
      legA: {
        outcome: 'home',
        label: '1',
        bookmaker: h2h.home.bookmaker,
        price: h2h.home.price,
        url: h2h.home.url,
        marketKey: h2h.home.marketKey || h2hKey,
        verificationStatus: h2h.home.verificationStatus,
      },
      legB: {
        outcome: 'away',
        label: 'DNB 2',
        bookmaker: dnb.away.bookmaker,
        price: dnb.away.price,
        url: dnb.away.url,
        marketKey: dnb.away.marketKey || dnbKey,
        verificationStatus: dnb.away.verificationStatus,
      },
    });
  }
  if (h2h.away && dnb.home) {
    pushCrossMarketPair(results, {
      marketKey: `cross_${prefix}h2h_away_dnb_home`,
      marketLabel: `${labelPrefix}2 (1X2) + DNB Home`.trim(),
      legA: {
        outcome: 'away',
        label: '2',
        bookmaker: h2h.away.bookmaker,
        price: h2h.away.price,
        url: h2h.away.url,
        marketKey: h2h.away.marketKey || h2hKey,
        verificationStatus: h2h.away.verificationStatus,
      },
      legB: {
        outcome: 'home',
        label: 'DNB 1',
        bookmaker: dnb.home.bookmaker,
        price: dnb.home.price,
        url: dnb.home.url,
        marketKey: dnb.home.marketKey || dnbKey,
        verificationStatus: dnb.home.verificationStatus,
      },
    });
  }
  return results;
}

/**
 * Soft covers with push on DNB draw:
 * - Home DNB + X2 covers every FT result (draw → DNB push + X2 wins).
 * - Away DNB + 1X is the mirror.
 * Not promoted to SAFE_CROSS (push settlement) → stays review/candidate.
 */
function detectDnbVsDoubleChanceCross(event) {
  return [
    ...detectDnbVsDcForScope(event, {
      dnbKey: 'drawNoBet',
      dcKey: 'doubleChance',
      prefix: '',
      labelPrefix: '',
    }),
    ...detectDnbVsDcForScope(event, {
      dnbKey: 'firstHalfDrawNoBet',
      dcKey: 'firstHalfDoubleChance',
      prefix: '1H_',
      labelPrefix: '1H ',
    }),
    ...detectDnbVsDcForScope(event, {
      dnbKey: 'secondHalfDrawNoBet',
      dcKey: 'secondHalfDoubleChance',
      prefix: '2H_',
      labelPrefix: '2H ',
    }),
  ];
}

function detectDnbVsDcForScope(event, { dnbKey, dcKey, prefix, labelPrefix }) {
  const results = [];
  const dnb = findBestPrices(event, dnbKey);
  const dc = findBestPrices(event, dcKey);
  if (dnb.home && dc.drawAway) {
    pushCrossMarketPair(results, {
      marketKey: `cross_${prefix}dnb_home_x2`,
      marketLabel: `${labelPrefix}DNB Home + X2 (DC)`.trim(),
      legA: {
        outcome: 'home',
        label: `${labelPrefix}DNB 1`.trim(),
        bookmaker: dnb.home.bookmaker,
        price: dnb.home.price,
        url: dnb.home.url,
        marketKey: dnb.home.marketKey || dnbKey,
        verificationStatus: dnb.home.verificationStatus,
      },
      legB: {
        outcome: 'X2',
        label: 'X2',
        bookmaker: dc.drawAway.bookmaker,
        price: dc.drawAway.price,
        url: dc.drawAway.url,
        marketKey: dc.drawAway.marketKey || dcKey,
        verificationStatus: dc.drawAway.verificationStatus,
      },
    });
  }
  if (dnb.away && dc.homeDraw) {
    pushCrossMarketPair(results, {
      marketKey: `cross_${prefix}dnb_away_1x`,
      marketLabel: `${labelPrefix}DNB Away + 1X (DC)`.trim(),
      legA: {
        outcome: 'away',
        label: `${labelPrefix}DNB 2`.trim(),
        bookmaker: dnb.away.bookmaker,
        price: dnb.away.price,
        url: dnb.away.url,
        marketKey: dnb.away.marketKey || dnbKey,
        verificationStatus: dnb.away.verificationStatus,
      },
      legB: {
        outcome: '1X',
        label: '1X',
        bookmaker: dc.homeDraw.bookmaker,
        price: dc.homeDraw.price,
        url: dc.homeDraw.url,
        marketKey: dc.homeDraw.marketKey || dcKey,
        verificationStatus: dc.homeDraw.verificationStatus,
      },
    });
  }
  return results;
}

/**
 * Home scores Yes ≈ Away clean sheet No (and inverse). Exhaustive 2-way when both
 * markets refer to whether the home attack / away defence produced a goal.
 */
function detectTeamScoreVsCleanSheetCross(event) {
  const results = [];
  const homeScore = findBestPrices(event, 'market_marcheaza_home');
  const awayScore = findBestPrices(event, 'market_marcheaza_away');
  const homeCs = findBestPrices(event, 'market_clean_sheet_home');
  const awayCs = findBestPrices(event, 'market_clean_sheet_away');

  // Home scores Yes vs Away CS Yes (away CS yes ⇒ home did not score)
  if (homeScore.yes && awayCs.yes) {
    pushCrossMarketPair(results, {
      marketKey: 'cross_home_score_vs_away_cs',
      marketLabel: 'Home Scores vs Away Clean Sheet',
      legA: {
        outcome: 'yes',
        label: 'Home Scores',
        bookmaker: homeScore.yes.bookmaker,
        price: homeScore.yes.price,
        url: homeScore.yes.url,
        marketKey: homeScore.yes.marketKey || 'market_marcheaza_home',
        verificationStatus: homeScore.yes.verificationStatus,
      },
      legB: {
        outcome: 'yes',
        label: 'Away Clean Sheet',
        bookmaker: awayCs.yes.bookmaker,
        price: awayCs.yes.price,
        url: awayCs.yes.url,
        marketKey: awayCs.yes.marketKey || 'market_clean_sheet_away',
        verificationStatus: awayCs.yes.verificationStatus,
      },
    });
  }

  // Away scores Yes vs Home CS Yes
  if (awayScore.yes && homeCs.yes) {
    pushCrossMarketPair(results, {
      marketKey: 'cross_away_score_vs_home_cs',
      marketLabel: 'Away Scores vs Home Clean Sheet',
      legA: {
        outcome: 'yes',
        label: 'Away Scores',
        bookmaker: awayScore.yes.bookmaker,
        price: awayScore.yes.price,
        url: awayScore.yes.url,
        marketKey: awayScore.yes.marketKey || 'market_marcheaza_away',
        verificationStatus: awayScore.yes.verificationStatus,
      },
      legB: {
        outcome: 'yes',
        label: 'Home Clean Sheet',
        bookmaker: homeCs.yes.bookmaker,
        price: homeCs.yes.price,
        url: homeCs.yes.url,
        marketKey: homeCs.yes.marketKey || 'market_clean_sheet_home',
        verificationStatus: homeCs.yes.verificationStatus,
      },
    });
  }

  return results;
}

/**
 * To-qualify (2-way) vs match 1X2 away/home is not exhaustive (draw / ET rules),
 * but Home qualify + Away match-win is a common soft candidate when books price
 * "to lift the cup" independently of 90-minute settlement. Kept as review-only
 * unless later approved in SAFE_CROSS (currently unsupported_formula → review).
 */
function detectQualifyVsH2hCross(event) {
  const results = [];
  const qualify = findBestPrices(event, 'toQualify');
  const h2h = findBestPrices(event, 'h2h');
  if (!qualify.home || !qualify.away || !h2h.home || !h2h.away) return results;

  // Soft pairs: qualify home vs match away (and inverse). Not guaranteed under
  // extra-time qualification rules — eligibility keeps them non-actionable.
  pushCrossMarketPair(results, {
    marketKey: 'cross_qualify_home_match_away',
    marketLabel: 'To Qualify Home + Match Away',
    legA: {
      outcome: 'home',
      label: 'Qualify 1',
      bookmaker: qualify.home.bookmaker,
      price: qualify.home.price,
      url: qualify.home.url,
      marketKey: qualify.home.marketKey || 'toQualify',
      verificationStatus: qualify.home.verificationStatus,
    },
    legB: {
      outcome: 'away',
      label: '2',
      bookmaker: h2h.away.bookmaker,
      price: h2h.away.price,
      url: h2h.away.url,
      marketKey: h2h.away.marketKey || 'h2h',
      verificationStatus: h2h.away.verificationStatus,
    },
  });
  pushCrossMarketPair(results, {
    marketKey: 'cross_qualify_away_match_home',
    marketLabel: 'To Qualify Away + Match Home',
    legA: {
      outcome: 'away',
      label: 'Qualify 2',
      bookmaker: qualify.away.bookmaker,
      price: qualify.away.price,
      url: qualify.away.url,
      marketKey: qualify.away.marketKey || 'toQualify',
      verificationStatus: qualify.away.verificationStatus,
    },
    legB: {
      outcome: 'home',
      label: '1',
      bookmaker: h2h.home.bookmaker,
      price: h2h.home.price,
      url: h2h.home.url,
      marketKey: h2h.home.marketKey || 'h2h',
      verificationStatus: h2h.home.verificationStatus,
    },
  });
  return results;
}

/**
 * Exhaustive soft covers pairing BTTS No with low Over lines.
 * - Over 0.5 covers any goal; BTTS No covers blanks / one-team blanks.
 * - Over 1.5 covers 2+ goals; BTTS No covers 0-0 and 1-0 / 0-1.
 * Period variants use matching half BTTS + half totals when present.
 */
function detectBttsTotalsSoftCross(event) {
  const results = [];
  const pairs = [
    {
      bttsKey: 'bothTeamsToScore',
      totalKey: 'totalGoals_0_5',
      marketKey: 'cross_btts_no_over_0_5',
      marketLabel: 'BTTS No + Over 0.5 Goals',
      overLabel: 'Over 0.5',
    },
    {
      bttsKey: 'bothTeamsToScore',
      totalKey: 'totalGoals_1_5',
      marketKey: 'cross_btts_no_over_1_5',
      marketLabel: 'BTTS No + Over 1.5 Goals',
      overLabel: 'Over 1.5',
    },
    {
      bttsKey: 'bothTeamsToScore',
      totalKey: 'asianTotalGoals_0_5',
      marketKey: 'cross_btts_no_asian_over_0_5',
      marketLabel: 'BTTS No + Asian Over 0.5',
      overLabel: 'Asian Over 0.5',
    },
    {
      bttsKey: 'bothTeamsToScore',
      totalKey: 'asianTotalGoals_1_5',
      marketKey: 'cross_btts_no_asian_over_1_5',
      marketLabel: 'BTTS No + Asian Over 1.5',
      overLabel: 'Asian Over 1.5',
    },
    // Soft review covers (1-1 loses both on 2.5 lines) — still surface math edges.
    {
      bttsKey: 'bothTeamsToScore',
      totalKey: 'totalGoals_2_5',
      marketKey: 'cross_btts_no_over_2_5',
      marketLabel: 'BTTS No + Over 2.5 Goals',
      overLabel: 'Over 2.5',
    },
    {
      bttsKey: 'bothTeamsToScore',
      totalKey: 'asianTotalGoals_2_5',
      marketKey: 'cross_btts_no_asian_over_2_5',
      marketLabel: 'BTTS No + Asian Over 2.5',
      overLabel: 'Asian Over 2.5',
    },
    {
      bttsKey: 'firstHalfBothTeamsToScore',
      totalKey: 'firstHalfTotalGoals_0_5',
      marketKey: 'cross_1H_btts_no_over_0_5',
      marketLabel: '1H BTTS No + Over 0.5',
      overLabel: '1H Over 0.5',
    },
    {
      bttsKey: 'firstHalfBothTeamsToScore',
      totalKey: 'firstHalfTotalGoals_1_5',
      marketKey: 'cross_1H_btts_no_over_1_5',
      marketLabel: '1H BTTS No + Over 1.5',
      overLabel: '1H Over 1.5',
    },
    {
      bttsKey: 'firstHalfBothTeamsToScore',
      totalKey: 'firstHalfAsianTotalGoals_0_5',
      marketKey: 'cross_1H_btts_no_asian_over_0_5',
      marketLabel: '1H BTTS No + Asian Over 0.5',
      overLabel: '1H Asian Over 0.5',
    },
    {
      bttsKey: 'firstHalfBothTeamsToScore',
      totalKey: 'firstHalfAsianTotalGoals_1_5',
      marketKey: 'cross_1H_btts_no_asian_over_1_5',
      marketLabel: '1H BTTS No + Asian Over 1.5',
      overLabel: '1H Asian Over 1.5',
    },
    {
      bttsKey: 'secondHalfBothTeamsToScore',
      totalKey: 'secondHalfTotalGoals_0_5',
      marketKey: 'cross_2H_btts_no_over_0_5',
      marketLabel: '2H BTTS No + Over 0.5',
      overLabel: '2H Over 0.5',
    },
    {
      bttsKey: 'secondHalfBothTeamsToScore',
      totalKey: 'secondHalfTotalGoals_1_5',
      marketKey: 'cross_2H_btts_no_over_1_5',
      marketLabel: '2H BTTS No + Over 1.5',
      overLabel: '2H Over 1.5',
    },
    {
      bttsKey: 'secondHalfBothTeamsToScore',
      totalKey: 'secondHalfAsianTotalGoals_0_5',
      marketKey: 'cross_2H_btts_no_asian_over_0_5',
      marketLabel: '2H BTTS No + Asian Over 0.5',
      overLabel: '2H Asian Over 0.5',
    },
    {
      bttsKey: 'secondHalfBothTeamsToScore',
      totalKey: 'secondHalfAsianTotalGoals_1_5',
      marketKey: 'cross_2H_btts_no_asian_over_1_5',
      marketLabel: '2H BTTS No + Asian Over 1.5',
      overLabel: '2H Asian Over 1.5',
    },
  ];

  for (const pair of pairs) {
    const btts = findBestPrices(event, pair.bttsKey);
    const totals = findBestPrices(event, pair.totalKey);
    if (!btts.no || !totals.over) continue;
    pushCrossMarketPair(results, {
      marketKey: pair.marketKey,
      marketLabel: pair.marketLabel,
      legA: {
        outcome: 'no',
        label: 'BTTS No',
        bookmaker: btts.no.bookmaker,
        price: btts.no.price,
        url: btts.no.url,
        marketKey: btts.no.marketKey || pair.bttsKey,
        verificationStatus: btts.no.verificationStatus,
      },
      legB: {
        outcome: 'over',
        label: pair.overLabel,
        bookmaker: totals.over.bookmaker,
        price: totals.over.price,
        url: totals.over.url,
        marketKey: totals.over.marketKey || pair.totalKey,
        verificationStatus: totals.over.verificationStatus,
      },
    });
  }
  return results;
}

/* ===== Formula 3: Middle bets (over/under line gap) ===== */
function detectMiddleBets(event) {
  const results = [];
  const marketKeys = getEventMarkets(event);

  const lineMarkets = [];
  for (const mk of marketKeys) {
    if (/^(?:total|asianTotal)(Goals|Corners|Cards|Points|Games|Sets)_/.test(mk)
      || /^firstHalf(?:Asian)?Total/.test(mk)
      || /^secondHalf(?:Asian)?Total/.test(mk)
      || /^market_total_goluri_(?:home|away)_/.test(mk)) {
      const best = findBestPrices(event, mk);
      if (best.over && best.under) {
        const line = parseLineNumberFromKey(mk);
        if (line !== null && isScannableMiddleLine(line)) {
          const familyLabel = getLineMarketFamilyLabel(mk)
            || (/market_total_goluri_home_/.test(mk) ? 'Home Team Goals' : null)
            || (/market_total_goluri_away_/.test(mk) ? 'Away Team Goals' : null);
          lineMarkets.push({
            marketKey: mk,
            groupKey: String(mk).replace(/_\d+(?:_\d+)?$/, ''),
            line,
            over: best.over,
            under: best.under,
            marketLabel: getMarketLabel(mk),
            marketFamilyLabel: familyLabel,
            marketDescription: describeMarket(mk),
          });
        }
      }
    }
  }

  lineMarkets.sort((a, b) => a.groupKey.localeCompare(b.groupKey) || a.line - b.line);

  // Pair any lower Over with higher Under in the same family (not only adjacent
  // lines) so e.g. Over 2.5 / Under 3.5 is found when 3.0 sits between them.
  const MAX_MIDDLE_GAP = 3.0;
  const pushMiddle = (lower, higher, { crossFamily = false } = {}) => {
    if (higher.line <= lower.line) return;
    const gap = higher.line - lower.line;
    if (gap > MAX_MIDDLE_GAP + 1e-9) return;

    const probOver = impliedProb(lower.over.price);
    const probUnder = impliedProb(higher.under.price);
    const total = probOver + probUnder;

    const hasMiddle = gap >= 0.25 - 1e-9;
    const edge = 1 - total;

    // Cross-family (EU vs Asian goals) needs a real gap; same-family keeps soft window.
    if (crossFamily) {
      if (!(edge > -0.03 && hasMiddle && gap >= 0.25 - 1e-9)) return;
    } else if (!(edge > -0.05 || (hasMiddle && edge > -0.1))) {
      return;
    }

    const stake = 100;
    const s1 = (stake * probOver) / total;
    const s2 = (stake * probUnder) / total;
    const profit = stake / total - stake;
    const familyLabel = crossFamily
      ? `${lower.marketFamilyLabel || 'Goals'}→${higher.marketFamilyLabel || 'Goals'}`
      : (lower.marketFamilyLabel || 'Line');

    results.push({
      marketKey: `middle_${lower.marketKey}_${higher.marketKey}`,
      marketLabel: `${familyLabel} Middle: Over ${lower.line} / Under ${higher.line}`,
      marketFamilyLabel: lower.marketFamilyLabel || null,
      marketDescription: lower.marketDescription || higher.marketDescription || null,
      type: 'middle',
      legs: [
        { outcome: 'over', label: formatMiddleLegLabel('over', lower.line, lower.marketFamilyLabel), bookmaker: lower.over.bookmaker, price: lower.over.price, stake: s1, url: lower.over.url || '', marketKey: lower.marketKey, verificationStatus: lower.over.verificationStatus || null },
        { outcome: 'under', label: formatMiddleLegLabel('under', higher.line, higher.marketFamilyLabel), bookmaker: higher.under.bookmaker, price: higher.under.price, stake: s2, url: higher.under.url || '', marketKey: higher.marketKey, verificationStatus: higher.under.verificationStatus || null },
      ],
      edge,
      profit,
      totalProb: total,
      stake,
      hasMiddle,
      middleWindow: `${lower.line} - ${higher.line}`,
      middleGap: gap,
      crossFamily,
      confidence: hasMiddle && edge > 0 ? 'high' : edge > 0 ? 'trusted' : 'review',
    });
  };

  for (let i = 0; i < lineMarkets.length; i++) {
    const lower = lineMarkets[i];
    for (let j = i + 1; j < lineMarkets.length; j++) {
      const higher = lineMarkets[j];
      if (lower.groupKey !== higher.groupKey) break;
      pushMiddle(lower, higher);
    }
  }

  // Extra candidates: European vs Asian lines for goals and corners.
  const crossFamilyPairs = [
    ['totalGoals', 'asianTotalGoals'],
    ['totalCorners', 'asianTotalCorners'],
    ['totalCards', 'asianTotalCards'],
    ['firstHalfTotalGoals', 'firstHalfAsianTotalGoals'],
    ['secondHalfTotalGoals', 'secondHalfAsianTotalGoals'],
    ['firstHalfTotalCorners', 'firstHalfAsianTotalCorners'],
  ];
  for (const [groupA, groupB] of crossFamilyPairs) {
    const sideA = lineMarkets.filter((item) => item.groupKey === groupA);
    const sideB = lineMarkets.filter((item) => item.groupKey === groupB);
    for (const lower of sideA) {
      for (const higher of sideB) {
        if (higher.line > lower.line) pushMiddle(lower, higher, { crossFamily: true });
      }
    }
    for (const lower of sideB) {
      for (const higher of sideA) {
        if (higher.line > lower.line) pushMiddle(lower, higher, { crossFamily: true });
      }
    }
  }

  return results;
}

/* ===== Formula 4: Asian handicap arbitrage ===== */
function detectHandicapArbitrage(event) {
  const results = [];
  const marketKeys = getEventMarkets(event);

  for (const mk of marketKeys) {
    if (!/^handicap_|^asianHandicap_/.test(mk)) continue;
    // Scan all AH lines; half-lines remain actionable via eligibility.
    if (!isScannableHandicapMarket(mk) && !isSupportedHandicapMarket(mk)) continue;

    const allPrices = collectAllPrices(event, mk);
    const outcomes = Object.keys(allPrices);
    if (outcomes.length < 2) continue;

    // Skip 3-way European Handicap markets
    if (allPrices.draw && allPrices.draw.length > 0) {
      continue;
    }

    const bestHome = allPrices.home?.sort((a, b) => b.price - a.price)[0];
    const bestAway = allPrices.away?.sort((a, b) => b.price - a.price)[0];

    if (!bestHome || !bestAway) continue;

    const total = impliedProb(bestHome.price) + impliedProb(bestAway.price);
    if (total < 1) {
      const edge = 1 - total;
      if (edge > MAX_ARB_EDGE) continue;
      const stake = 100;
      const s1 = (stake * impliedProb(bestHome.price)) / total;
      const s2 = (stake * impliedProb(bestAway.price)) / total;

      results.push({
        marketKey: mk,
        marketLabel: getMarketLabel(mk),
        type: 'handicap',
        legs: [
          { outcome: 'home', label: 'Home', bookmaker: bestHome.bookmaker, price: bestHome.price, stake: s1, url: bestHome.url || '', marketKey: bestHome.marketKey || mk, verificationStatus: bestHome.verificationStatus || null },
          { outcome: 'away', label: 'Away', bookmaker: bestAway.bookmaker, price: bestAway.price, stake: s2, url: bestAway.url || '', marketKey: bestAway.marketKey || mk, verificationStatus: bestAway.verificationStatus || null },
        ],
        edge,
        profit: stake / total - stake,
        totalProb: total,
        stake,
        confidence: classifyConfidence(edge, 2, 2),
      });
    }
  }

  return results;
}

/* ===== Confidence classifier ===== */
function classifyConfidence(edge, outcomeCount, legCount) {
  if (edge >= 0.05 && outcomeCount >= 3) return 'high';
  if (edge >= 0.02) return 'trusted';
  if (edge >= 0.005) return 'review';
  return 'risky';
}

/* ===== Value Bet Detection with Z-score and Kelly ===== */
function detectValueBet(event, marketKey, sportKey) {
  if (isInvalidFormulaLineMarket(marketKey)) return null;

  const best = findBestPrices(event, marketKey);
  const outcomeKeys = Object.keys(best);
  if (outcomeKeys.length < 2) return null;

  const expected = expectedOutcomesForMarket(marketKey, outcomeKeys, sportKey || event.sport);
  if (!hasExpectedOutcomes(best, expected)) return null;
  if (!hasCompleteBucketCoverage(marketKey, outcomeKeys)) return null;

  const allPrices = collectAllPrices(event, marketKey);

  // 1a. Look for a sharp bookmaker reference line (Pinnacle, Betfair)
  const sharpPrice = findSharpPrice(allPrices);

  // 1. Calculate consensus price for all outcomes first to compute total market overround
  const consensusPrices = {};
  const bookCounts = {};
  const zScores = {};

  for (const key of outcomeKeys) {
    const entries = allPrices[key] || [];
    const prices = entries.map((e) => e.price).filter((p) => p > 1);
    if (prices.length < 2) continue;

    prices.sort((a, b) => a - b);
    const trimmed = prices.length > 2 ? prices.slice(1, -1) : prices;
    const consensus = trimmed.reduce((s, p) => s + p, 0) / trimmed.length;
    consensusPrices[key] = consensus;
    bookCounts[key] = prices.length;

    // Calculate z-score
    const mean = consensus;
    const variance = trimmed.reduce((s, p) => s + (p - mean) ** 2, 0) / trimmed.length;
    const stdDev = Math.sqrt(variance);
    zScores[key] = stdDev > 0 ? (best[key].price - mean) / stdDev : 0;
  }

  let consensusOverround = 0;
  let hasAllConsensus = true;
  for (const key of outcomeKeys) {
    if (consensusPrices[key]) {
      consensusOverround += impliedProb(consensusPrices[key]);
    } else {
      hasAllConsensus = false;
    }
  }

  const valueCandidates = [];
  for (const key of outcomeKeys) {
    if (!consensusPrices[key]) continue;

    const consensus = consensusPrices[key];
    const zScore = zScores[key];

    // Remove margin using proportional consensus overround
    let fairProb;
    if (sharpPrice && sharpPrice.price && hasAllConsensus && consensusOverround > 0) {
      // Build a synthetic market using the sharp book's price for the current outcome
      const sharpPricesMap = {};
      for (const ok of outcomeKeys) {
        sharpPricesMap[ok] = (ok === key) ? sharpPrice.price : (consensusPrices[ok] || best[ok]?.price);
      }
      const sharpFairMarket = calculateNoVigMarket(sharpPricesMap);
      const sharpOutcome = sharpFairMarket?.outcomes?.find(o => o.outcome === key);
      if (sharpOutcome) {
        fairProb = sharpOutcome.fairProb;
      } else {
        fairProb = impliedProb(consensus) / consensusOverround;
      }
    } else if (hasAllConsensus && consensusOverround > 0) {
      fairProb = impliedProb(consensus) / consensusOverround;
    } else {
      // Fallback to 5% vig if we don't have consensus for all legs
      fairProb = impliedProb(consensus) / 1.05;
    }

    const fairOdds = fairProb > 0 ? 1 / fairProb : consensus;
    const gap = (best[key].price - consensus) / consensus;
    const fairGap = (best[key].price - fairOdds) / fairOdds;

    const b = best[key].price - 1;
    const p = fairProb > 0 && fairProb < 1 ? fairProb : impliedProb(consensus);
    const q = 1 - p;
    const kelly = b > 0 ? (b * p - q) / b : 0;
    const kellyFraction = Math.max(0, Math.min(0.25, kelly));

    const isValue = gap >= MIN_VALUE_EDGE || zScore > 2 || (kelly > 0 && fairGap > 0.01);

    if (isValue) {
      valueCandidates.push({
        outcome: key,
        label: best[key].label,
        bookmaker: best[key].bookmaker,
        price: best[key].price,
        marketKey: best[key].marketKey || marketKey,
        verificationStatus: best[key].verificationStatus || null,
        consensus,
        fairOdds,
        gap,
        fairGap,
        zScore,
        kelly: kellyFraction,
        url: best[key].url || '',
        bookCount: bookCounts[key],
      });
    }
  }

  if (valueCandidates.length === 0) return null;
  const top = valueCandidates.sort((a, b) => b.kelly - a.kelly || b.gap - a.gap)[0];
  return {
    marketKey,
    marketLabel: getMarketLabel(marketKey),
    ...top,
  };
}

/* ===== Formula 5: BTTS + Team-to-Score / Clean Sheet arbitrage ===== */
function pickBestPriceEntry(...candidates) {
  return candidates
    .filter((entry) => entry && Number(entry.price) > 1)
    .sort((a, b) => b.price - a.price)[0] || null;
}

function pushThreeWayCross(results, {
  marketKey,
  marketLabel,
  legs,
}) {
  if (!legs || legs.length !== 3 || legs.some((leg) => !leg || !(Number(leg.price) > 1))) return;
  const total = legs.reduce((sum, leg) => sum + impliedProb(leg.price), 0);
  if (!(total < 1)) return;
  const edge = 1 - total;
  if (edge > MAX_ARB_EDGE) return;
  const stake = 100;
  results.push({
    marketKey,
    marketLabel,
    type: 'cross-market',
    legs: legs.map((leg) => ({
      outcome: leg.outcome,
      label: leg.label,
      bookmaker: leg.bookmaker,
      price: leg.price,
      stake: (stake * impliedProb(leg.price)) / total,
      url: leg.url || '',
      marketKey: leg.marketKey,
      verificationStatus: leg.verificationStatus || null,
    })),
    edge,
    profit: stake / total - stake,
    totalProb: total,
    stake,
    confidence: classifyConfidence(edge, 3, 3),
  });
}

function detectBttsTeamScoreArbitrage(event) {
  return [
    ...detectBttsTeamScoreForScope(event, {
      bttsKey: 'bothTeamsToScore',
      prefix: '',
      labelPrefix: '',
    }),
    ...detectBttsTeamScoreForScope(event, {
      bttsKey: 'firstHalfBothTeamsToScore',
      prefix: '1H_',
      labelPrefix: '1H ',
    }),
    ...detectBttsTeamScoreForScope(event, {
      bttsKey: 'secondHalfBothTeamsToScore',
      prefix: '2H_',
      labelPrefix: '2H ',
    }),
  ];
}

function detectBttsTeamScoreForScope(event, { bttsKey, prefix, labelPrefix }) {
  const results = [];

  const bttsBest = findBestPrices(event, bttsKey);
  const homeScoreBest = findBestPrices(event, 'market_marcheaza_home');
  const awayScoreBest = findBestPrices(event, 'market_marcheaza_away');
  const homeTotal05Best = findBestPrices(event, 'market_total_goluri_home_0_5');
  const awayTotal05Best = findBestPrices(event, 'market_total_goluri_away_0_5');
  const homeCsBest = findBestPrices(event, 'market_clean_sheet_home');
  const awayCsBest = findBestPrices(event, 'market_clean_sheet_away');

  // Home fails to score ≈ home under 0.5 ≈ away clean sheet yes
  const bestHomeNo = pickBestPriceEntry(
    homeScoreBest.no,
    homeTotal05Best.under,
    awayCsBest.yes,
  );
  // Away fails to score ≈ away under 0.5 ≈ home clean sheet yes
  const bestAwayNo = pickBestPriceEntry(
    awayScoreBest.no,
    awayTotal05Best.under,
    homeCsBest.yes,
  );

  // BTTS Yes + Home no score + Away no score (exhaustive partition)
  if (bttsBest.yes && bestHomeNo && bestAwayNo) {
    pushThreeWayCross(results, {
      marketKey: `cross_${prefix}btts_team_score`,
      marketLabel: `${labelPrefix}BTTS Yes + Home NS + Away NS`.trim(),
      legs: [
        {
          outcome: 'yes',
          label: `${labelPrefix}BTTS Yes`.trim(),
          bookmaker: bttsBest.yes.bookmaker,
          price: bttsBest.yes.price,
          url: bttsBest.yes.url,
          marketKey: bttsBest.yes.marketKey || bttsKey,
          verificationStatus: bttsBest.yes.verificationStatus,
        },
        {
          outcome: 'homeNo',
          label: 'Home No Score',
          bookmaker: bestHomeNo.bookmaker,
          price: bestHomeNo.price,
          url: bestHomeNo.url,
          marketKey: bestHomeNo.marketKey || 'market_marcheaza_home',
          verificationStatus: bestHomeNo.verificationStatus,
        },
        {
          outcome: 'awayNo',
          label: 'Away No Score',
          bookmaker: bestAwayNo.bookmaker,
          price: bestAwayNo.price,
          url: bestAwayNo.url,
          marketKey: bestAwayNo.marketKey || 'market_marcheaza_away',
          verificationStatus: bestAwayNo.verificationStatus,
        },
      ],
    });
  }

  // BTTS No + Home scores + Away scores
  const bestHomeYes = pickBestPriceEntry(homeScoreBest.yes, homeTotal05Best.over);
  const bestAwayYes = pickBestPriceEntry(awayScoreBest.yes, awayTotal05Best.over);
  if (bttsBest.no && bestHomeYes && bestAwayYes) {
    pushThreeWayCross(results, {
      marketKey: `cross_${prefix}btts_no_both_score`,
      marketLabel: `${labelPrefix}BTTS No + Home Scores + Away Scores`.trim(),
      legs: [
        {
          outcome: 'no',
          label: `${labelPrefix}BTTS No`.trim(),
          bookmaker: bttsBest.no.bookmaker,
          price: bttsBest.no.price,
          url: bttsBest.no.url,
          marketKey: bttsBest.no.marketKey || bttsKey,
          verificationStatus: bttsBest.no.verificationStatus,
        },
        {
          outcome: 'homeYes',
          label: 'Home Scores',
          bookmaker: bestHomeYes.bookmaker,
          price: bestHomeYes.price,
          url: bestHomeYes.url,
          marketKey: bestHomeYes.marketKey || 'market_marcheaza_home',
          verificationStatus: bestHomeYes.verificationStatus,
        },
        {
          outcome: 'awayYes',
          label: 'Away Scores',
          bookmaker: bestAwayYes.bookmaker,
          price: bestAwayYes.price,
          url: bestAwayYes.url,
          marketKey: bestAwayYes.marketKey || 'market_marcheaza_away',
          verificationStatus: bestAwayYes.verificationStatus,
        },
      ],
    });
  }

  // Pairwise yes/no only for full-time scope (same team markets).
  if (!prefix) {
    if (bestHomeYes && bestHomeNo) {
      pushCrossMarketPair(results, {
        marketKey: 'cross_home_score_vs_no',
        marketLabel: 'Home Scores Yes/No',
        legA: {
          outcome: 'yes',
          label: 'Home Scores',
          bookmaker: bestHomeYes.bookmaker,
          price: bestHomeYes.price,
          url: bestHomeYes.url,
          marketKey: bestHomeYes.marketKey || 'market_marcheaza_home',
          verificationStatus: bestHomeYes.verificationStatus,
        },
        legB: {
          outcome: 'no',
          label: 'Home No Score',
          bookmaker: bestHomeNo.bookmaker,
          price: bestHomeNo.price,
          url: bestHomeNo.url,
          marketKey: bestHomeNo.marketKey || 'market_marcheaza_home',
          verificationStatus: bestHomeNo.verificationStatus,
        },
      });
    }

    if (bestAwayYes && bestAwayNo) {
      pushCrossMarketPair(results, {
        marketKey: 'cross_away_score_vs_no',
        marketLabel: 'Away Scores Yes/No',
        legA: {
          outcome: 'yes',
          label: 'Away Scores',
          bookmaker: bestAwayYes.bookmaker,
          price: bestAwayYes.price,
          url: bestAwayYes.url,
          marketKey: bestAwayYes.marketKey || 'market_marcheaza_away',
          verificationStatus: bestAwayYes.verificationStatus,
        },
        legB: {
          outcome: 'no',
          label: 'Away No Score',
          bookmaker: bestAwayNo.bookmaker,
          price: bestAwayNo.price,
          url: bestAwayNo.url,
          marketKey: bestAwayNo.marketKey || 'market_marcheaza_away',
          verificationStatus: bestAwayNo.verificationStatus,
        },
      });
    }
  }

  return results;
}

/* ===== Formula 6: Team Totals vs Match Totals arbitrage ===== */
function detectTeamMatchTotalArbitrage(event) {
  const results = [];
  const marketKeys = getEventMarkets(event);

  const matchLines = [];
  const homeLines = [];
  const awayLines = [];

  for (const mk of marketKeys) {
    const line = parseLineNumberFromKey(mk);
    if (line === null) continue;
    // Half-lines only: integer/quarter push rules break the simple H+A identity.
    const isHalf = Math.abs((line % 1) - 0.5) < 1e-9;
    if (!isHalf) continue;

    if (mk.startsWith('totalGoals_') || mk.startsWith('asianTotalGoals_')) {
      matchLines.push({ key: mk, line });
    } else if (mk.startsWith('market_total_goluri_home_')) {
      homeLines.push({ key: mk, line });
    } else if (mk.startsWith('market_total_goluri_away_')) {
      awayLines.push({ key: mk, line });
    }
  }

  if (matchLines.length === 0 || homeLines.length === 0 || awayLines.length === 0) {
    return results;
  }

  for (const m of matchLines) {
    for (const h of homeLines) {
      // Match Over M + Home Under H + Away Under A when H + A = M + slack
      // (if both teams stay under their lines, match cannot exceed M on half-lines).
      // slack 0.5 is the classic lattice; 1.0 covers e.g. 1.5+1.5 vs 2.5.
      for (const slack of [0.5, 1.0]) {
        const neededA = m.line + slack - h.line;
        if (neededA > 0) {
          const a = awayLines.find((item) => Math.abs(item.line - neededA) < 0.01);
          if (a) {
            const matchBest = findBestPrices(event, m.key);
            const homeBest = findBestPrices(event, h.key);
            const awayBest = findBestPrices(event, a.key);
            if (matchBest.over && homeBest.under && awayBest.under) {
              pushThreeWayCross(results, {
                marketKey: `cross_totals_${m.key}_${h.key}_${a.key}`,
                marketLabel: `Totals: Over ${m.line} (Match) + Under ${h.line} (Home) + Under ${a.line} (Away)`,
                legs: [
                  {
                    outcome: 'over',
                    label: `Over ${m.line} Goals`,
                    bookmaker: matchBest.over.bookmaker,
                    price: matchBest.over.price,
                    url: matchBest.over.url,
                    marketKey: matchBest.over.marketKey || m.key,
                    verificationStatus: matchBest.over.verificationStatus,
                  },
                  {
                    outcome: 'under',
                    label: `Home Under ${h.line}`,
                    bookmaker: homeBest.under.bookmaker,
                    price: homeBest.under.price,
                    url: homeBest.under.url,
                    marketKey: homeBest.under.marketKey || h.key,
                    verificationStatus: homeBest.under.verificationStatus,
                  },
                  {
                    outcome: 'under',
                    label: `Away Under ${a.line}`,
                    bookmaker: awayBest.under.bookmaker,
                    price: awayBest.under.price,
                    url: awayBest.under.url,
                    marketKey: awayBest.under.marketKey || a.key,
                    verificationStatus: awayBest.under.verificationStatus,
                  },
                ],
              });
            }
          }
        }

        // Inverse: Match Under M + Home Over H + Away Over A when H + A = M - slack
        const neededAInverse = m.line - slack - h.line;
        if (neededAInverse > 0) {
          const aInv = awayLines.find((item) => Math.abs(item.line - neededAInverse) < 0.01);
          if (aInv) {
            const matchBest = findBestPrices(event, m.key);
            const homeBest = findBestPrices(event, h.key);
            const awayBest = findBestPrices(event, aInv.key);
            if (matchBest.under && homeBest.over && awayBest.over) {
              pushThreeWayCross(results, {
                marketKey: `cross_totals_inv_${m.key}_${h.key}_${aInv.key}`,
                marketLabel: `Totals: Under ${m.line} (Match) + Over ${h.line} (Home) + Over ${aInv.line} (Away)`,
                legs: [
                  {
                    outcome: 'under',
                    label: `Under ${m.line} Goals`,
                    bookmaker: matchBest.under.bookmaker,
                    price: matchBest.under.price,
                    url: matchBest.under.url,
                    marketKey: matchBest.under.marketKey || m.key,
                    verificationStatus: matchBest.under.verificationStatus,
                  },
                  {
                    outcome: 'over',
                    label: `Home Over ${h.line}`,
                    bookmaker: homeBest.over.bookmaker,
                    price: homeBest.over.price,
                    url: homeBest.over.url,
                    marketKey: homeBest.over.marketKey || h.key,
                    verificationStatus: homeBest.over.verificationStatus,
                  },
                  {
                    outcome: 'over',
                    label: `Away Over ${aInv.line}`,
                    bookmaker: awayBest.over.bookmaker,
                    price: awayBest.over.price,
                    url: awayBest.over.url,
                    marketKey: awayBest.over.marketKey || aInv.key,
                    verificationStatus: awayBest.over.verificationStatus,
                  },
                ],
              });
            }
          }
        }
      }
    }
  }

  return results;
}



/** Categorize a market key into its settlement time scope. */
const SETTLEMENT_SCOPES = {
  // Full-time 90 min
  h2h: 'fulltime',
  doubleChance: 'fulltime',
  drawNoBet: 'fulltime',
  bothTeamsToScore: 'fulltime',
  firstHalfBothTeamsToScore: 'firstHalf',
  secondHalfBothTeamsToScore: 'secondHalf',
  toQualify: 'overtime',
  halfTimeOrFullTime: 'htft',
  market_total_goluri_impar_par: 'fulltime',
  // First half
  firstHalfH2h: 'firstHalf',
  firstHalfDrawNoBet: 'firstHalf',
  firstHalfDoubleChance: 'firstHalf',
  // Second half
  secondHalfH2h: 'secondHalf',
  secondHalfDrawNoBet: 'secondHalf',
  secondHalfDoubleChance: 'secondHalf',
};

/** Prefix-based scope detection. totalGoals_, totalCorners_, totalCards_ → fulltime,
 *  firstHalfTotalGoals_ → firstHalf, etc. */
function getSettlementScope(marketKey) {
  const key = String(marketKey || '');
  // Direct match
  if (SETTLEMENT_SCOPES[key]) return SETTLEMENT_SCOPES[key];
  // Prefix match (longest first)
  for (const [prefix, scope] of Object.entries(SETTLEMENT_SCOPES).sort((a, b) => b[0].length - a[0].length)) {
    if (key.startsWith(prefix)) return scope;
  }
  // totalGoals_, totalCorners_, totalCards_ → fulltime
  if (/^total(Goals|Corners|Cards|Points|Games|Sets)_/.test(key)) return 'fulltime';
  if (/^firstHalfTotal/.test(key)) return 'firstHalf';
  if (/^secondHalfTotal/.test(key)) return 'secondHalf';
  // Market-specific: handicap defaults to fulltime
  if (/^(asian)?[Hh]andicap/.test(key)) return 'fulltime';
  return 'unknown';
}

/** Downgrade confidence if legs span different settlement scopes. */
function applySettlementRisk(baseConfidence, marketKeys) {
  const scopes = marketKeys.map(mk => getSettlementScope(mk)).filter(s => s !== 'unknown');
  const unique = new Set(scopes);
  if (unique.size > 1) return 'risky';
  return baseConfidence;
}

function applyVerificationRisk(baseConfidence, legs = []) {
  const statuses = collectLegVerificationStatuses(legs, { includeMissing: true });
  if (statuses.some((status) => FIDELITY_RISKY_STATUSES.has(status))) {
    return 'risky';
  }
  if (statuses.some((status) => status !== FIDELITY_VERIFIED_STATUS || FIDELITY_REVIEW_STATUSES.has(status))) {
    return capConfidence(baseConfidence, 'review');
  }
  return baseConfidence;
}

function attachVerificationRisk(opportunity) {
  const statuses = collectLegVerificationStatuses(opportunity?.legs, { includeMissing: true });
  if (statuses.length > 0) {
    opportunity.verificationStatuses = [...new Set(statuses)];
  }
  if (opportunity?.confidence) {
    opportunity.confidence = applyVerificationRisk(opportunity.confidence, opportunity.legs);
  }
  return opportunity;
}

function collectLegVerificationStatuses(legs = [], { includeMissing = false } = {}) {
  return legs
    .map((leg) => leg?.verificationStatus || (includeMissing ? FIDELITY_UNVERIFIED_STATUS : null))
    .filter(Boolean);
}

function capConfidence(confidence, cap) {
  const rank = { risky: 0, review: 1, trusted: 2, high: 3 };
  if (!(confidence in rank) || !(cap in rank)) {
    return confidence;
  }
  return rank[confidence] > rank[cap] ? cap : confidence;
}

/** Build a lookup index for an event to avoid repeated iteration.
 * Returns { bookmakersByMarket: Map, allMarketKeys: string[] } */
function buildEventIndex(event) {
  const bookmakersByMarket = new Map();
  const allMarketKeys = new Set();
  for (const bm of event.bookmakers || []) {
    if (!bm.markets || typeof bm.markets !== 'object') continue;
    for (const [marketKey, prices] of Object.entries(bm.markets)) {
      allMarketKeys.add(marketKey);
      if (!bookmakersByMarket.has(marketKey)) {
        bookmakersByMarket.set(marketKey, []);
      }
      bookmakersByMarket.get(marketKey).push({ bookmaker: bm, prices });
    }
  }
  return { bookmakersByMarket, allMarketKeys: [...allMarketKeys] };
}

function finalizeOpportunity(opportunity, event, eventName, {
  now = new Date(),
  maxKickoffSkewMs = DEFAULT_MAX_KICKOFF_SKEW_MS,
  maxQuoteAgeMs = DEFAULT_MAX_QUOTE_AGE_MS,
  maxQuoteSkewMs = DEFAULT_MAX_QUOTE_SKEW_MS,
} = {}) {
  opportunity.eventName = eventName;
  const bookmakers = new Map((event.bookmakers || []).map((bookmaker) => [bookmaker.name, bookmaker]));
  let hasQuoteTimestamp = false;
  for (const leg of opportunity.legs || []) {
    const bookmaker = bookmakers.get(leg.bookmaker);
    if (bookmaker) {
      leg.feedGroup = bookmaker.feedGroup || null;
      leg.platformGroup = bookmaker.platformGroup || null;
      const observedAt = bookmakerQuoteObservedAt(bookmaker, leg.marketKey || opportunity.marketKey);
      if (observedAt) {
        leg.observedAt = observedAt;
        hasQuoteTimestamp = true;
      }
      const bookmakerKickoff = firstValidIsoDate([
        bookmaker.sourceStartsAt,
        bookmaker.startsAt,
        event.startsAt,
      ]);
      if (bookmakerKickoff) {
        leg.kickoff = bookmakerKickoff;
        leg.kickoffSource = bookmaker.sourceStartsAt || bookmaker.startsAt
          ? 'bookmaker'
          : 'event';
      }
    }
    // Always fall back to event kickoff so review candidates are not over-rejected
    // when a bookmaker row is missing or lacks its own startsAt.
    if (!leg.kickoff && event.startsAt) {
      leg.kickoff = event.startsAt;
      leg.kickoffSource = leg.kickoffSource || 'event';
    }
  }
  if (hasQuoteTimestamp) {
    opportunity.quoteTiming = evaluateQuoteTiming(opportunity.legs, {
      now,
      maxAgeMs: maxQuoteAgeMs,
      maxSkewMs: maxQuoteSkewMs,
    });
  }
  const settlementKeys = (opportunity.legs || [])
    .map((leg) => leg.marketKey)
    .filter(Boolean);
  opportunity.confidence = applySettlementRisk(
    opportunity.confidence,
    settlementKeys.length > 0 ? settlementKeys : [opportunity.marketKey],
  );
  attachVerificationRisk(opportunity);
  opportunity.settlementScope = opportunity.type === 'settlement-formula'
    ? 'fulltime-score-matrix'
    : getSettlementScope(opportunity.marketKey);
  opportunity.competition = event.competition;
  opportunity.kickoff = event.startsAt;
  opportunity.kickoffTiming = evaluateKickoffTiming(opportunity.legs, {
    expectedKickoff: event.startsAt,
    maxSkewMs: maxKickoffSkewMs,
  });
  opportunity.sport = event.sport || null;
  opportunity.eventId = event.id || null;
  attachOpportunityEligibility(opportunity);
  return opportunity;
}

/* ===== Aggregate all opportunities for an event ===== */
function getAllOpportunities(events, options = {}) {
  const opps = [];
  const finalizationOptions = {
    ...options,
    now: options.now || new Date(),
  };
  for (const event of events) {
    const eventName = `${event.homeTeam} vs ${event.awayTeam}`;
    const { allMarketKeys: marketKeys } = buildEventIndex(event);

    for (const mk of marketKeys) {
      const arb = detectArbitrage(event, mk, event.sport);
      if (arb) {
        opps.push(finalizeOpportunity(arb, event, eventName, finalizationOptions));
      }
    }

    const crossMarket = detectCrossMarketArbitrage(event);
    for (const cm of crossMarket) {
      opps.push(finalizeOpportunity(cm, event, eventName, finalizationOptions));
    }

    const middles = detectMiddleBets(event);
    for (const m of middles) {
      opps.push(finalizeOpportunity(m, event, eventName, finalizationOptions));
    }

    const handicaps = detectHandicapArbitrage(event);
    for (const h of handicaps) {
      opps.push(finalizeOpportunity(h, event, eventName, finalizationOptions));
    }

    const settlementFormulas = detectSettlementFormulaArbitrage(event, {
      findBestPrices,
      getEventMarkets,
      maxEdge: MAX_ARB_EDGE,
    });
    for (const formula of settlementFormulas) {
      opps.push(finalizeOpportunity(formula, event, eventName, finalizationOptions));
    }

    const bttsTeamScore = detectBttsTeamScoreArbitrage(event);
    for (const bts of bttsTeamScore) {
      opps.push(finalizeOpportunity(bts, event, eventName, finalizationOptions));
    }

    const teamMatchTotals = detectTeamMatchTotalArbitrage(event);
    for (const tmt of teamMatchTotals) {
      opps.push(finalizeOpportunity(tmt, event, eventName, finalizationOptions));
    }
  }
  return dedupeOpportunities(opps).sort((a, b) => Number(b.edge || 0) - Number(a.edge || 0));
}

/** Keep the best edge when two detectors emit the same event/market/legs fingerprint. */
function dedupeOpportunities(opportunities) {
  const bestByKey = new Map();
  for (const opportunity of opportunities || []) {
    const key = opportunityFingerprint(opportunity);
    const existing = bestByKey.get(key);
    if (!existing || Number(opportunity.edge || 0) > Number(existing.edge || 0)) {
      bestByKey.set(key, opportunity);
    }
  }
  return [...bestByKey.values()];
}

function opportunityFingerprint(opportunity) {
  const legs = (opportunity?.legs || [])
    .map((leg) => `${leg.bookmaker || ''}:${leg.marketKey || ''}:${leg.outcome || leg.label || ''}:${Number(leg.price || 0).toFixed(3)}`)
    .sort()
    .join('|');
  return [
    opportunity?.eventId || opportunity?.eventName || '',
    opportunity?.type || '',
    opportunity?.marketKey || '',
    legs,
  ].join('::');
}

function getValueBets(events, maxBets = 40) {
  const bets = [];
  for (const event of events) {
    const eventName = `${event.homeTeam} vs ${event.awayTeam}`;
    const { allMarketKeys: marketKeys } = buildEventIndex(event);
      for (const mk of marketKeys) {
        const vb = detectValueBet(event, mk, event.sport);
      if (vb) {
        vb.eventName = eventName;
        bets.push(vb);
      }
    }
  }
  return bets.sort((a, b) => b.kelly - a.kelly || b.gap - a.gap).slice(0, maxBets);
}

/** Find a sharp bookmaker price entry in collected prices.
 * Returns the first entry from Pinnacle/Betfair, or null. */
function findSharpPrice(allPrices) {
  for (const entries of Object.values(allPrices)) {
    const sharp = entries.find(e => SHARP_BOOKMAKER_NAMES.has(e.bookmaker));
    if (sharp) return sharp;
  }
  return null;
}

module.exports = {
  MIN_VALUE_EDGE,
  MAX_ARB_EDGE,
  MAX_ACTIONABLE_EDGE,
  MARKET_OUTCOMES,
  MARKET_LABELS,
  MARKET_DESCRIPTIONS,
  OUTCOME_LABELS,
  getMarketLabel,
  describeMarket,
  getOutcomeLabel,
  impliedProb,
  calculateNoVigMarket,
  getEventMarkets,
  findBestPrices,
  collectAllPrices,
  detectArbitrage,
  detectCrossMarketArbitrage,
  detectMiddleBets,
  detectHandicapArbitrage,
  detectSettlementFormulaArbitrage,
  detectBttsTeamScoreArbitrage,
  detectTeamMatchTotalArbitrage,
  classifyConfidence,
  applyVerificationRisk,
  attachOpportunityEligibility,
  evaluateOpportunityEligibility,
  detectValueBet,
  getAllOpportunities,
  getValueBets,
  buildEventIndex,
  getSettlementScope,
  marketVerificationStatus,
  SHARP_BOOKMAKER_NAMES,
};
