/**
 * AI Pick Auto-Settler Domain Component.
 */

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_AI_PICK_LOG_PATH = path.join(__dirname, '..', '..', 'data', 'ai-picks.jsonl');
const SETTLE_BUFFER_MS = 3 * 60 * 60 * 1000;
const MAX_ODDS_DROP_RATIO = 0.65;

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

function getPendingPicks(logPath) {
  const picks = readAiPicks(logPath);
  const settled = new Set(
    picks
      .filter(p => p.action === 'settled')
      .map(p => p.entry?.id || p.entry?.event)
  );
  return picks.filter(p => p.action === 'created' && !settled.has(p.entry?.id) && p.entry?.status !== 'settled');
}

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

function inferResultFromOdds(marketKey, closingPrices, openingPrices) {
  const outcomeSet = marketOutcomeSet(marketKey);
  if (!outcomeSet) return null;

  const outcomes = outcomeSet.filter(o => closingPrices[o] && closingPrices[o] > 1);
  if (outcomes.length === 0) return null;

  outcomes.sort((a, b) => closingPrices[a] - closingPrices[b]);

  const winner = outcomes[0];
  const winnerClosing = closingPrices[winner];
  const winnerOpening = openingPrices?.[winner];

  let confidence = 'review';
  if (winnerClosing <= 1.10) {
    confidence = 'trusted';
  } else if (winnerClosing <= 1.30) {
    confidence = 'high';
  } else if (winnerClosing <= 1.60) {
    confidence = 'review';
  } else {
    return null;
  }

  if (winnerOpening && winnerOpening > 1) {
    const dropRatio = winnerClosing / winnerOpening;
    if (dropRatio > MAX_ODDS_DROP_RATIO && winnerClosing > 1.15) {
      return null;
    }
  }

  return { likelyWinner: winner, confidence };
}

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

function findMatchingEvent(eventKey, liveEvents) {
  if (!eventKey || !liveEvents) return null;

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

function getMarketPrices(event, marketFamily) {
  if (!event || !event.bookmakers) return null;

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

function settlePick(pick, liveEvents, previousEvents) {
  const entry = pick.entry || {};
  const event = entry.event || '';
  const market = entry.market || '';
  const selection = entry.selection || '';
  const odds = Number(entry.odds) || 0;
  const loggedAt = new Date(entry.loggedAt || pick.loggedAt).getTime();

  const now = Date.now();
  if (now - loggedAt < SETTLE_BUFFER_MS) return null;

  const parsed = parseSelection(selection);
  if (!parsed.outcome) {
    return { status: 'review', reason: 'Cannot parse selection', pickId: entry.id, event, market, selection };
  }

  const liveMatch = findMatchingEvent(event, liveEvents);
  const previousMatch = findMatchingEvent(event, previousEvents || []);

  if (liveMatch) {
    const startTime = liveMatch.startsAt ? new Date(liveMatch.startsAt).getTime() : null;
    if (startTime && now - startTime < SETTLE_BUFFER_MS) {
      return null;
    }
    return null;
  }

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
