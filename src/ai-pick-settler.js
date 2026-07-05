/**
 * AI Pick Auto-Settler
 *
 * Automatically determines whether AI picks have won, lost, or need
 * manual review based on odds feed changes.
 *
 * Settlement triggers:
 * - Event no longer appears in the live odds feed (finished match)
 * - Closing odds inference: last known odds for each outcome indicate result
 * - Cross-reference: selection vs. outcome with lowest closing odds = likely winner
 *
 * For 1X2 markets: the outcome with odds closest to 1.0 won.
 * For Over/Under: if "over" odds → 1.0 and total goals are above the line, over won.
 * For BTTS: yes/no odds pattern indicates which outcome hit.
 * For others: mark as "review" for manual settlement.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_AI_PICK_LOG_PATH = path.join(__dirname, '..', 'data', 'ai-picks.jsonl');
const SETTLE_BUFFER_MS = 3 * 60 * 60 * 1000; // 3 hours after event start
const MAX_ODDS_DROP_RATIO = 0.65; // if closing odds dropped below 65% of opening, likely a result signal

/**
 * Read all AI pick log entries.
 */
function readAiPicks(logPath) {
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

/**
 * Get only the "created" picks that haven't been settled yet.
 */
function getPendingPicks(logPath) {
  const picks = readAiPicks(logPath);
  const settled = new Set(
    picks
      .filter(p => p.action === 'settled')
      .map(p => p.entry?.id || p.entry?.event)
  );
  return picks.filter(p => p.action === 'created' && !settled.has(p.entry?.id) && p.entry?.status !== 'settled');
}

/**
 * Parse selection text to extract outcome and bookmaker.
 * Examples:
 *   "Over @ Market average"  → { outcome: 'over', label: 'Over' }
 *   "Home @ Fortuna"         → { outcome: 'home', label: 'Home' }
 *   "1 @ Superbet"           → { outcome: 'home', label: '1' }
 *   "X2 @ Betano"            → { outcome: 'drawAway', label: 'X2' }
 *   "Yes @ Book A"           → { outcome: 'yes', label: 'Yes' }
 */
function parseSelection(selection) {
  if (!selection) return { outcome: null, label: null };
  const s = String(selection).trim();
  const parts = s.split(/\s*@\s*/);
  const label = parts[0].trim();
  const outcome = normalizeOutcome(label);
  return { outcome, label };
}

function normalizeOutcome(label) {
  const s = String(label || '').trim().toLowerCase();
  if (/^home$|^1$/.test(s)) return 'home';
  if (/^draw$|^x$/.test(s)) return 'draw';
  if (/^away$|^2$/.test(s)) return 'away';
  if (/^over$/.test(s)) return 'over';
  if (/^under$/.test(s)) return 'under';
  if (/^yes$/.test(s)) return 'yes';
  if (/^no$/.test(s)) return 'no';
  if (/^1x$/.test(s)) return 'homeDraw';
  if (/^12$/.test(s)) return 'homeAway';
  if (/^x2$/.test(s)) return 'drawAway';
  return s || null;
}

/**
 * Map market keys to outcome set for settlement inference.
 */
function marketOutcomeSet(marketKey) {
  const k = String(marketKey || '').toLowerCase();
  if (/^(h2h|result|rezultat|firsthalfh2h|secondhalfh2h|halftimeorfulltime)/.test(k)) {
    return ['home', 'draw', 'away'];
  }
  if (/^(doublechance|double_chance)$/.test(k)) {
    return ['homeDraw', 'homeAway', 'drawAway'];
  }
  if (/^(drawnobet|draw_no_bet|dnb|firsthalfdrawnobet|secondhalfdrawnobet)$/.test(k)) {
    return ['home', 'away'];
  }
  if (/^(bothteamstoscore|btts)$/.test(k)) {
    return ['yes', 'no'];
  }
  if (/^total(goals|corners|cards)_/.test(k) || /^firsthalftotal|^secondhalftotal/.test(k) || k === 'totalline') {
    return ['over', 'under'];
  }
  if (/^toqualify$/.test(k)) {
    return ['home', 'away'];
  }
  return null;
}

/**
 * Given a market type, determine which outcome won based on closing odds.
 * The winner is the outcome whose closing odds dropped closest to 1.0.
 *
 * Returns { likelyWinner, confidence } or null if inconclusive.
 */
function inferResultFromOdds(marketKey, closingPrices, openingPrices) {
  const outcomeSet = marketOutcomeSet(marketKey);
  if (!outcomeSet) return null;

  const outcomes = outcomeSet.filter(o => closingPrices[o] && closingPrices[o] > 1);
  if (outcomes.length === 0) return null;

  // Sort by closing odds ascending (lowest = most likely winner)
  outcomes.sort((a, b) => closingPrices[a] - closingPrices[b]);

  const winner = outcomes[0];
  const winnerClosing = closingPrices[winner];
  const winnerOpening = openingPrices?.[winner];

  // Confidence: how much did the winning odds drop?
  let confidence = 'review';
  if (winnerClosing <= 1.10) {
    confidence = 'trusted';
  } else if (winnerClosing <= 1.30) {
    confidence = 'high';
  } else if (winnerClosing <= 1.60) {
    confidence = 'review';
  } else {
    // No clear signal — all odds are still high
    return null;
  }

  // Verify: the winner's odds should have dropped significantly from opening
  if (winnerOpening && winnerOpening > 1) {
    const dropRatio = winnerClosing / winnerOpening;
    if (dropRatio > MAX_ODDS_DROP_RATIO && winnerClosing > 1.15) {
      return null; // odds didn't drop enough to be a clear result
    }
  }

  return { likelyWinner: winner, confidence };
}

/**
 * Classify a market key for the settlement engine.
 * Returns the canonical market family for matching.
 */
function classifyMarket(marketKey) {
  const k = String(marketKey || '');
  if (/^(h2h|result|rezultat|1x2)/.test(k.toLowerCase())) return 'h2h';
  if (/^doublechance/.test(k.toLowerCase())) return 'doubleChance';
  if (/^drawnobet/.test(k.toLowerCase())) return 'drawNoBet';
  if (/^bothteamstoscore/.test(k.toLowerCase())) return 'bothTeamsToScore';
  if (/^total(goals|corners|cards)/.test(k.toLowerCase())) return 'totalLine';
  if (/^firsthalftotal|^secondhalftotal/.test(k.toLowerCase())) return 'totalLine';
  if (/^toqualify/.test(k.toLowerCase())) return 'toQualify';
  return k;
}

/**
 * Find a matching event in the odds feed by team name fuzzy match.
 */
function findMatchingEvent(eventKey, liveEvents) {
  if (!eventKey || !liveEvents) return null;

  // Parse "Home vs Away" or "Home vs Away" format
  const parts = String(eventKey).split(/\s+vs\.?\s*/i);
  if (parts.length !== 2) return null;

  const [homeName, awayName] = parts;
  const homeNorm = normalizeTeamName(homeName);
  const awayNorm = normalizeTeamName(awayName);

  for (const event of liveEvents) {
    const eHome = normalizeTeamName(event.homeTeam);
    const eAway = normalizeTeamName(event.awayTeam);
    if (eHome === homeNorm && eAway === awayNorm) return event;
  }

  // Fuzzy: containment match
  for (const event of liveEvents) {
    const eHome = normalizeTeamName(event.homeTeam);
    const eAway = normalizeTeamName(event.awayTeam);
    if ((eHome.includes(homeNorm) || homeNorm.includes(eHome)) &&
        (eAway.includes(awayNorm) || awayNorm.includes(eAway))) {
      return event;
    }
  }

  return null;
}

function normalizeTeamName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Get best current prices for all outcomes of a market from a matching event.
 */
function getMarketPrices(event, marketFamily) {
  if (!event || !event.bookmakers) return null;

  // Find the first market key matching this family
  let targetMarketKey = null;
  for (const bm of event.bookmakers) {
    if (!bm.markets) continue;
    for (const mk of Object.keys(bm.markets)) {
      if (classifyMarket(mk) === marketFamily) {
        targetMarketKey = mk;
        break;
      }
    }
    if (targetMarketKey) break;
  }

  if (!targetMarketKey) return null;

  // Collect best prices per outcome
  const prices = {};
  for (const bm of event.bookmakers) {
    const marketData = bm.markets?.[targetMarketKey];
    if (!marketData) continue;
    for (const [outcome, price] of Object.entries(marketData)) {
      if (typeof price === 'number' && price > 1) {
        if (!prices[outcome] || price > prices[outcome].price) {
          prices[outcome] = { price, bookmaker: bm.name };
        }
      }
    }
  }

  return Object.keys(prices).length > 0
    ? Object.fromEntries(Object.entries(prices).map(([k, v]) => [k, v.price]))
    : null;
}

/**
 * Main settlement check for a single AI pick.
 *
 * @param {Object} pick - AI pick entry
 * @param {Array} liveEvents - Current live events from odds feed
 * @param {Object|null} previousEvents - Previous snapshot events for closing odds
 * @returns {Object|null} - Settlement result or null if not ready
 */
function settlePick(pick, liveEvents, previousEvents) {
  const entry = pick.entry || {};
  const event = entry.event || '';
  const market = entry.market || '';
  const selection = entry.selection || '';
  const odds = Number(entry.odds) || 0;
  const loggedAt = new Date(entry.loggedAt || pick.loggedAt).getTime();
  const eventStartsAt = entry.eventStartsAt ? new Date(entry.eventStartsAt).getTime() : null;

  // Must have been created at least 3 hours ago
  const now = Date.now();
  if (now - loggedAt < SETTLE_BUFFER_MS) return null;

  const parsed = parseSelection(selection);
  if (!parsed.outcome) {
    return { status: 'review', reason: 'Cannot parse selection', pickId: entry.id, event, market, selection };
  }

  // Check if the event is still in the live feed
  const liveMatch = findMatchingEvent(event, liveEvents);
  const previousMatch = findMatchingEvent(event, previousEvents || []);

  // If event is still live and hasn't started or just started, don't settle
  if (liveMatch) {
    const startTime = liveMatch.startsAt ? new Date(liveMatch.startsAt).getTime() : null;
    if (startTime && now - startTime < SETTLE_BUFFER_MS) {
      return null; // Event still active
    }
    // Event is still in feed but old — might be live/in-play, don't auto-settle
    return null;
  }

  // Event is no longer in the live feed — it's finished

  // Try to infer result from the previous snapshot's closing odds
  const marketFamily = classifyMarket(market);
  const closingPrices = getMarketPrices(previousMatch, marketFamily);

  if (closingPrices) {
    const inference = inferResultFromOdds(marketFamily, closingPrices, null);
    if (inference) {
      const won = parsed.outcome === inference.likelyWinner;
      return {
        status: 'settled',
        result: won ? 'won' : 'lost',
        confidence: inference.confidence,
        likelyWinner: inference.likelyWinner,
        pickOutcome: parsed.outcome,
        pickLabel: parsed.label,
        pickId: entry.id,
        event,
        market,
        selection,
        odds,
        closingPrices,
      };
    }
  }

  // Cannot infer — mark for review
  return {
    status: 'review',
    reason: 'Event finished but result cannot be inferred from odds',
    pickId: entry.id,
    event,
    market,
    selection,
    odds,
  };
}

/**
 * Run auto-settlement on all pending AI picks.
 *
 * @param {Object} options
 * @param {string} options.logPath - Path to ai-picks.jsonl
 * @param {Array} options.liveEvents - Current live events
 * @param {Array|null} options.previousEvents - Previous snapshot events
 * @returns {Object} - { settled, reviewed, unchanged, total }
 */
function runAutoSettle({ logPath, liveEvents, previousEvents }) {
  const pending = getPendingPicks(logPath);
  const results = { settled: [], reviewed: [], unchanged: [], total: pending.length };

  for (const pick of pending) {
    const result = settlePick(pick, liveEvents, previousEvents);
    if (!result) {
      results.unchanged.push({ pickId: pick.entry?.id, event: pick.entry?.event });
      continue;
    }

    if (result.status === 'settled') {
      results.settled.push(result);
      logSettlement(logPath, pick, result);
    } else {
      results.reviewed.push(result);
    }
  }

  return results;
}

/**
 * Append a settlement record to the AI pick log.
 */
function logSettlement(logPath, pick, result) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const record = {
    loggedAt: new Date().toISOString(),
    action: 'settled',
    originalPick: pick,
    settlement: result,
  };
  fs.appendFileSync(logPath, `${JSON.stringify(record)}\n`, 'utf8');
}

module.exports = {
  runAutoSettle,
  settlePick,
  getPendingPicks,
  readAiPicks,
  parseSelection,
  inferResultFromOdds,
  findMatchingEvent,
  getMarketPrices,
  classifyMarket,
  normalizeOutcome,
  SETTLE_BUFFER_MS,
};
