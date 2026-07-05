/**
 * Server-side formula engine — extracted from public/app.js.
 *
 * Computes arbitrage opportunities and value bets from normalized odds events.
 * Exposed via GET /api/opportunities and GET /api/value-bets.
 */

'use strict';

const { marketOutcomes: sportMarketOutcomes } = require('./sport-config');


const MIN_VALUE_EDGE = 0.025;

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
  drawNoBet: ['home', 'away'],
  firstHalfDrawNoBet: ['home', 'away'],
  secondHalfDrawNoBet: ['home', 'away'],
  // Double chance — 3 mutually exhaustive outcomes
  doubleChance: ['homeDraw', 'homeAway', 'drawAway'],
};

const MARKET_LABELS = {
  h2h: '1X2',
  firstHalfH2h: '1st Half 1X2',
  secondHalfH2h: '2nd Half 1X2',
  doubleChance: 'Double Chance',
  bothTeamsToScore: 'BTTS',
  drawNoBet: 'Draw No Bet',
  firstHalfDrawNoBet: '1st Half DNB',
  secondHalfDrawNoBet: '2nd Half DNB',
  toQualify: 'To Qualify',
  halfTimeOrFullTime: 'HT/FT',
};

const MARKET_DESCRIPTIONS = {
  h2h: 'Match result — Home / Draw / Away',
  firstHalfH2h: 'Result at half-time — Home / Draw / Away',
  secondHalfH2h: 'Result in second half — Home / Draw / Away',
  doubleChance: 'Two of three outcomes — 1X / 12 / X2',
  bothTeamsToScore: 'Will both teams score at least one goal?',
  drawNoBet: 'Home or Away wins; stake refunded on a draw',
  firstHalfDrawNoBet: 'Half-time DNB — stake refunded if level at HT',
  secondHalfDrawNoBet: 'Second-half DNB — stake refunded if level at 2nd half',
  toQualify: 'Which team advances to the next round',
  halfTimeOrFullTime: 'Predict result at half-time AND full-time',
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
  const m = String(key).match(/(?:asian)?[Hh]andicap_(plus|minus)_(\d+)(?:_(\d+))?$/);
  if (!m) return null;
  const sign = m[1] === 'plus' ? '+' : '-';
  const line = m[3] ? `${m[2]}.${m[3]}` : m[2];
  return `${sign}${line}`;
}

function getMarketLabel(key) {
  if (MARKET_LABELS[key]) return MARKET_LABELS[key];

  const k = String(key);

  // Asian handicap: asianHandicap_plus_0_5 → AH +0.5
  const ah = formatHandicapLine(k);
  if (ah && k.startsWith('asianHandicap')) return `AH ${ah}`;
  if (ah && k.startsWith('handicap')) return `Handicap ${ah}`;

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
  const expected = MARKET_OUTCOMES[key];
  if (expected) return expected;

  // Sport-aware override: e.g. basketball h2h has no draw
  if (sportKey) {
    const sportOutcomes = sportMarketOutcomes(sportKey, key);
    if (sportOutcomes) return sportOutcomes;
  }

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
      all[ok].push({ price, bookmaker: bm.name, url: bm.eventUrl || bm.bookmakerUrl || '' });
    }
  }
  return all;
}

/* ===== Formula 1: Classic cross-book arbitrage ===== */
function detectArbitrage(event, marketKey, sportKey) {
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

/* ===== Formula 2: Cross-market arbitrage (h2h vs doubleChance) ===== */
function detectCrossMarketArbitrage(event) {
  const results = [];
  const h2hBest = findBestPrices(event, 'h2h');
  const dcBest = findBestPrices(event, 'doubleChance');

  if (!h2hBest.away || !h2hBest.home) return results;

  // DC 1X + h2h 2
  if (dcBest.homeDraw) {
    const prob1X = impliedProb(dcBest.homeDraw.price);
    const prob2 = impliedProb(h2hBest.away.price);
    const total = prob1X + prob2;
    if (total < 1) {
      const edge = 1 - total;
      const stake = 100;
      const s1 = (stake * prob1X) / total;
      const s2 = (stake * prob2) / total;
      results.push({
        marketKey: 'cross_1X_2',
        marketLabel: '1X (DC) + 2 (1X2)',
        type: 'cross-market',
        legs: [
          { outcome: '1X', label: '1X', bookmaker: dcBest.homeDraw.bookmaker, price: dcBest.homeDraw.price, stake: s1, url: dcBest.homeDraw.url || '' },
          { outcome: 'away', label: '2', bookmaker: h2hBest.away.bookmaker, price: h2hBest.away.price, stake: s2, url: h2hBest.away.url || '' },
        ],
        edge,
        profit: stake / total - stake,
        totalProb: total,
        stake,
        confidence: classifyConfidence(edge, 2, 2),
      });
    }
  }

  // DC X2 + h2h 1
  if (dcBest.drawAway) {
    const probX2 = impliedProb(dcBest.drawAway.price);
    const prob1 = impliedProb(h2hBest.home.price);
    const total = probX2 + prob1;
    if (total < 1) {
      const edge = 1 - total;
      const stake = 100;
      const s1 = (stake * prob1) / total;
      const s2 = (stake * probX2) / total;
      results.push({
        marketKey: 'cross_1_X2',
        marketLabel: '1 (1X2) + X2 (DC)',
        type: 'cross-market',
        legs: [
          { outcome: 'home', label: '1', bookmaker: h2hBest.home.bookmaker, price: h2hBest.home.price, stake: s1, url: h2hBest.home.url || '' },
          { outcome: 'X2', label: 'X2', bookmaker: dcBest.drawAway.bookmaker, price: dcBest.drawAway.price, stake: s2, url: dcBest.drawAway.url || '' },
        ],
        edge,
        profit: stake / total - stake,
        totalProb: total,
        stake,
        confidence: classifyConfidence(edge, 2, 2),
      });
    }
  }

  // DC 12 + h2h X
  if (dcBest.homeAway && h2hBest.draw) {
    const prob12 = impliedProb(dcBest.homeAway.price);
    const probX = impliedProb(h2hBest.draw.price);
    const total = prob12 + probX;
    if (total < 1) {
      const edge = 1 - total;
      const stake = 100;
      const s1 = (stake * prob12) / total;
      const s2 = (stake * probX) / total;
      results.push({
        marketKey: 'cross_12_X',
        marketLabel: '12 (DC) + X (1X2)',
        type: 'cross-market',
        legs: [
          { outcome: '12', label: '12', bookmaker: dcBest.homeAway.bookmaker, price: dcBest.homeAway.price, stake: s1, url: dcBest.homeAway.url || '' },
          { outcome: 'draw', label: 'X', bookmaker: h2hBest.draw.bookmaker, price: h2hBest.draw.price, stake: s2, url: h2hBest.draw.url || '' },
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

/* ===== Formula 3: Middle bets (over/under line gap) ===== */
function detectMiddleBets(event) {
  const results = [];
  const marketKeys = getEventMarkets(event);

  const lineMarkets = [];
  for (const mk of marketKeys) {
    if (/^(?:total|asianTotal)(Goals|Corners|Cards)_/.test(mk)
      || /^firstHalf(?:Asian)?Total/.test(mk)
      || /^secondHalf(?:Asian)?Total/.test(mk)) {
      const best = findBestPrices(event, mk);
      if (best.over && best.under) {
        const line = parseLineNumberFromKey(mk);
        if (line !== null) {
          const familyLabel = getLineMarketFamilyLabel(mk);
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

  for (let i = 0; i < lineMarkets.length - 1; i++) {
    const lower = lineMarkets[i];
    const higher = lineMarkets[i + 1];

    if (lower.groupKey !== higher.groupKey || higher.line <= lower.line) continue;

    const probOver = impliedProb(lower.over.price);
    const probUnder = impliedProb(higher.under.price);
    const total = probOver + probUnder;

    const hasMiddle = higher.line - lower.line >= 0.5;
    const edge = 1 - total;

    if (edge > -0.05 || (hasMiddle && edge > -0.1)) {
      const stake = 100;
      const s1 = (stake * probOver) / total;
      const s2 = (stake * probUnder) / total;
      const profit = stake / total - stake;

      results.push({
        marketKey: `middle_${lower.marketKey}_${higher.marketKey}`,
        marketLabel: `${lower.marketFamilyLabel || 'Line'} Middle: Over ${lower.line} / Under ${higher.line}`,
        marketFamilyLabel: lower.marketFamilyLabel || null,
        marketDescription: lower.marketDescription || higher.marketDescription || null,
        type: 'middle',
        legs: [
          { outcome: 'over', label: formatMiddleLegLabel('over', lower.line, lower.marketFamilyLabel), bookmaker: lower.over.bookmaker, price: lower.over.price, stake: s1, url: lower.over.url || '' },
          { outcome: 'under', label: formatMiddleLegLabel('under', higher.line, higher.marketFamilyLabel), bookmaker: higher.under.bookmaker, price: higher.under.price, stake: s2, url: higher.under.url || '' },
        ],
        edge,
        profit,
        totalProb: total,
        stake,
        hasMiddle,
        middleWindow: `${lower.line} - ${higher.line}`,
        confidence: hasMiddle && edge > 0 ? 'high' : edge > 0 ? 'trusted' : 'review',
      });
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
      const stake = 100;
      const s1 = (stake * impliedProb(bestHome.price)) / total;
      const s2 = (stake * impliedProb(bestAway.price)) / total;

      results.push({
        marketKey: mk,
        marketLabel: getMarketLabel(mk),
        type: 'handicap',
        legs: [
          { outcome: 'home', label: 'Home', bookmaker: bestHome.bookmaker, price: bestHome.price, stake: s1, url: bestHome.url || '' },
          { outcome: 'away', label: 'Away', bookmaker: bestAway.bookmaker, price: bestAway.price, stake: s2, url: bestAway.url || '' },
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

/* ===== Formula 5: BTTS + Team-to-Score arbitrage ===== */
function detectBttsTeamScoreArbitrage(event) {
  const results = [];

  const bttsBest = findBestPrices(event, 'bothTeamsToScore');
  if (!bttsBest.yes) return results;

  const homeScoreBest = findBestPrices(event, 'market_marcheaza_home');
  const homeTotal05Best = findBestPrices(event, 'market_total_goluri_home_0_5');

  let bestHomeNo = null;
  if (homeScoreBest.no && homeTotal05Best.under) {
    bestHomeNo = homeScoreBest.no.price > homeTotal05Best.under.price ? homeScoreBest.no : homeTotal05Best.under;
  } else {
    bestHomeNo = homeScoreBest.no || homeTotal05Best.under || null;
  }

  const awayScoreBest = findBestPrices(event, 'market_marcheaza_away');
  const awayTotal05Best = findBestPrices(event, 'market_total_goluri_away_0_5');

  let bestAwayNo = null;
  if (awayScoreBest.no && awayTotal05Best.under) {
    bestAwayNo = awayScoreBest.no.price > awayTotal05Best.under.price ? awayScoreBest.no : awayTotal05Best.under;
  } else {
    bestAwayNo = awayScoreBest.no || awayTotal05Best.under || null;
  }

  if (!bestHomeNo || !bestAwayNo) return results;

  const total = impliedProb(bttsBest.yes.price) + impliedProb(bestHomeNo.price) + impliedProb(bestAwayNo.price);
  if (total < 1) {
    const edge = 1 - total;
    const stake = 100;
    const s1 = (stake * impliedProb(bttsBest.yes.price)) / total;
    const s2 = (stake * impliedProb(bestHomeNo.price)) / total;
    const s3 = (stake * impliedProb(bestAwayNo.price)) / total;

    results.push({
      marketKey: 'cross_btts_team_score',
      marketLabel: 'BTTS Yes + Team Clean Sheets',
      type: 'cross-market',
      legs: [
        { outcome: 'yes', label: 'BTTS Yes', bookmaker: bttsBest.yes.bookmaker, price: bttsBest.yes.price, stake: s1, url: bttsBest.yes.url || '' },
        { outcome: 'homeNo', label: 'Home to Score: No', bookmaker: bestHomeNo.bookmaker, price: bestHomeNo.price, stake: s2, url: bestHomeNo.url || '' },
        { outcome: 'awayNo', label: 'Away to Score: No', bookmaker: bestAwayNo.bookmaker, price: bestAwayNo.price, stake: s3, url: bestAwayNo.url || '' },
      ],
      edge,
      profit: stake / total - stake,
      totalProb: total,
      stake,
      confidence: classifyConfidence(edge, 3, 3),
    });
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

    if (mk.startsWith('totalGoals_')) {
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
      const neededA = m.line + 0.5 - h.line;
      if (neededA <= 0) continue;

      const a = awayLines.find((item) => Math.abs(item.line - neededA) < 0.01);
      if (!a) continue;

      const matchBest = findBestPrices(event, m.key);
      const homeBest = findBestPrices(event, h.key);
      const awayBest = findBestPrices(event, a.key);

      if (!matchBest.over || !homeBest.under || !awayBest.under) continue;

      const priceOver = matchBest.over.price;
      const priceHomeUnder = homeBest.under.price;
      const priceAwayUnder = awayBest.under.price;

      const total = impliedProb(priceOver) + impliedProb(priceHomeUnder) + impliedProb(priceAwayUnder);
      if (total < 1) {
        const edge = 1 - total;
        const stake = 100;
        const s1 = (stake * impliedProb(priceOver)) / total;
        const s2 = (stake * impliedProb(priceHomeUnder)) / total;
        const s3 = (stake * impliedProb(priceAwayUnder)) / total;

        results.push({
          marketKey: `cross_totals_${m.key}_${h.key}_${a.key}`,
          marketLabel: `Totals: Over ${m.line} (Match) + Under ${h.line} (Home) + Under ${a.line} (Away)`,
          type: 'cross-market',
          legs: [
            { outcome: 'over', label: `Over ${m.line} Goals`, bookmaker: matchBest.over.bookmaker, price: priceOver, stake: s1, url: matchBest.over.url || '' },
            { outcome: 'under', label: `Home Under ${h.line}`, bookmaker: homeBest.under.bookmaker, price: priceHomeUnder, stake: s2, url: homeBest.under.url || '' },
            { outcome: 'under', label: `Away Under ${a.line}`, bookmaker: awayBest.under.bookmaker, price: priceAwayUnder, stake: s3, url: awayBest.under.url || '' },
          ],
          edge,
          profit: stake / total - stake,
          totalProb: total,
          stake,
          confidence: classifyConfidence(edge, 3, 3),
        });
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
  toQualify: 'overtime',
  halfTimeOrFullTime: 'htft',
  // First half
  firstHalfH2h: 'firstHalf',
  firstHalfDrawNoBet: 'firstHalf',
  // Second half
  secondHalfH2h: 'secondHalf',
  secondHalfDrawNoBet: 'secondHalf',
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
  if (/^total(Goals|Corners|Cards)_/.test(key)) return 'fulltime';
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

/* ===== Aggregate all opportunities for an event ===== */
function getAllOpportunities(events) {
  const opps = [];
  for (const event of events) {
    const eventName = `${event.homeTeam} vs ${event.awayTeam}`;
    const { allMarketKeys: marketKeys } = buildEventIndex(event);

      for (const mk of marketKeys) {
        const arb = detectArbitrage(event, mk, event.sport);
      if (arb) {
        arb.eventName = eventName;
        arb.confidence = applySettlementRisk(arb.confidence, [mk]);
        arb.settlementScope = getSettlementScope(mk);
        arb.competition = event.competition;
        arb.kickoff = event.startsAt;
        opps.push(arb);
      }
    }

    const crossMarket = detectCrossMarketArbitrage(event);
    for (const cm of crossMarket) {
      cm.eventName = eventName;
      cm.confidence = applySettlementRisk(cm.confidence, [cm.marketKey]);
      cm.competition = event.competition;
      cm.kickoff = event.startsAt;
      opps.push(cm);
    }

    const middles = detectMiddleBets(event);
    for (const m of middles) {
      m.eventName = eventName;
      m.confidence = applySettlementRisk(m.confidence, [m.marketKey]);
      m.competition = event.competition;
      m.kickoff = event.startsAt;
      opps.push(m);
    }

    const handicaps = detectHandicapArbitrage(event);
    for (const h of handicaps) {
      h.eventName = eventName;
      h.confidence = applySettlementRisk(h.confidence, [h.marketKey]);
      h.competition = event.competition;
      h.kickoff = event.startsAt;
      opps.push(h);
    }

    const bttsTeamScore = detectBttsTeamScoreArbitrage(event);
    for (const bts of bttsTeamScore) {
      bts.eventName = eventName;
      bts.competition = event.competition;
      bts.kickoff = event.startsAt;
      opps.push(bts);
    }

    const teamMatchTotals = detectTeamMatchTotalArbitrage(event);
    for (const tmt of teamMatchTotals) {
      tmt.eventName = eventName;
      tmt.competition = event.competition;
      tmt.kickoff = event.startsAt;
      opps.push(tmt);
    }
  }
  return opps;
}

function getValueBets(events, maxBets = 30) {
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
  detectBttsTeamScoreArbitrage,
  detectTeamMatchTotalArbitrage,
  classifyConfidence,
  detectValueBet,
  getAllOpportunities,
  getValueBets,
  buildEventIndex,
  getSettlementScope,
  SHARP_BOOKMAKER_NAMES,
};
