'use strict';

const { ProviderError } = require('./the-odds-api-provider');
const {
  formatLine,
  handicapMarketKey,
  hasAnyCompleteMarket,
  isDecimalOdds,
  splitFixtureName,
} = require('./market-utils');
const { bookmakerLinkFields, favbetEventUrl } = require('./event-links');

const FAVBET_RPC_URL = 'https://www.favbet.ro/service/lineout/frontend_api2/';
const FAVBET_FOOTBALL_URL = 'https://www.favbet.ro/ro/sports/sport/soccer';
const FOOTBALL_SPORT_ID = 1;
const PRE_MATCH_SERVICE_ID = 0;

const RESULT_TYPES = Object.freeze({
  fulltime: 1,
  firstHalf: 7,
  secondHalf: 8,
});

const MARKET_TEMPLATES = Object.freeze({
  h2h: 1,
  doubleChance: 40,
  total: 50,
  oddEven: 74,
  handicap: 190,
  teamTotal: 740,
  bothTeamsToScore: 779,
  asianTotal: 1226,
  asianHandicap: 1227,
  halfTimeOrFullTime: 1385,
  // Common additional templates (ignored harmlessly when absent from feed).
  drawNoBet: 46,
  totalCorners: 51,
  totalCards: 52,
  toQualify: 247,
});

class FavbetProvider {
  constructor({
    fetchImpl = globalThis.fetch,
    timeoutMs = 12_000,
    maxEvents = 1500,
    now = () => new Date(),
  } = {}) {
    this.name = 'Favbet';
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.maxEvents = positiveInteger(maxEvents, 1500);
    this.now = now;
  }

  async getOdds() {
    const payload = await this.fetchFootballEvents();
    return normalizeFavbetPayload(payload, this.now().toISOString());
  }

  async fetchFootballEvents() {
    const body = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'frontend/event/get',
      params: {
        by: {
          lang: 'ro',
          sport_id: FOOTBALL_SPORT_ID,
          head_markets: true,
          service_id: PRE_MATCH_SERVICE_ID,
          tz_diff: -new Date().getTimezoneOffset(),
          limit: this.maxEvents,
          offset: 0,
        },
      },
    };

    const response = await this.fetchImpl(FAVBET_RPC_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Origin: 'https://www.favbet.ro',
        Referer: FAVBET_FOOTBALL_URL,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    }).catch((error) => {
      throw new ProviderError(`Unable to reach Favbet: ${error.message}`, { cause: error });
    });

    if (!response.ok) {
      throw new ProviderError(`Favbet returned HTTP ${response.status}`, {
        status: response.status,
      });
    }

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new ProviderError('Favbet returned invalid JSON', { cause: error });
    }

    if (payload?.error) {
      const message = payload.error.message || payload.error.data || 'unknown JSON-RPC error';
      throw new ProviderError(`Favbet JSON-RPC error: ${message}`);
    }
    if (!Array.isArray(payload?.result)) {
      throw new ProviderError('Favbet response did not include an event result array');
    }
    return payload;
  }
}

function normalizeFavbetPayload(payload, fetchedAt = new Date().toISOString()) {
  const events = Array.isArray(payload) ? payload : payload?.result;
  return (Array.isArray(events) ? events : [])
    .map((event) => normalizeFavbetEvent(event, fetchedAt))
    .filter(Boolean);
}

function normalizeFavbetEvent(event, fetchedAt) {
  if (
    Number(event?.sport_id) !== FOOTBALL_SPORT_ID ||
    Number(event?.service_id) !== PRE_MATCH_SERVICE_ID ||
    (event.event_status_type && event.event_status_type !== 'notstarted')
  ) {
    return null;
  }

  const teams = favbetTeams(event);
  const startsAt = favbetStartTime(event?.event_dt);
  if (!teams || !startsAt || !event?.event_id) {
    return null;
  }

  const markets = normalizeFavbetMarkets(event.head_markets, teams);
  if (!hasAnyCompleteMarket(markets)) {
    return null;
  }

  const competition = [event.category_name, event.tournament_name]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' - ') || 'Favbet Football';

  return {
    id: `favbet:${event.event_id}`,
    externalIds: { favbetEvent: String(event.event_id) },
    sport: 'Football',
    competition,
    startsAt,
    homeTeam: teams.homeTeam,
    awayTeam: teams.awayTeam,
    bookmakers: [{
      name: 'Favbet',
      lastUpdate: fetchedAt,
      ...bookmakerLinkFields('Favbet', favbetEventUrl(event)),
      markets,
    }],
  };
}

function normalizeFavbetMarkets(rows, teams = {}) {
  const markets = {};
  for (const market of Array.isArray(rows) ? rows : []) {
    if (market?.market_suspend === true) {
      continue;
    }
    const normalized = normalizeFavbetMarket(market, teams);
    if (normalized && !markets[normalized.key]) {
      markets[normalized.key] = normalized.prices;
    }
  }
  return markets;
}

function normalizeFavbetMarket(market, teams) {
  const templateId = Number(market?.market_template_id);
  const resultTypeId = Number(market?.result_type_id);
  const outcomes = activeFavbetOutcomes(market?.outcomes);
  if (outcomes.length < 2) {
    return null;
  }

  if (templateId === MARKET_TEMPLATES.h2h) {
    return mappedMarket(periodMarketKey(resultTypeId, {
      fulltime: 'h2h',
      firstHalf: 'firstHalfH2h',
      secondHalf: 'secondHalfH2h',
    }), outcomes, { 1: 'home', 2: 'draw', 3: 'away' }, ['home', 'draw', 'away']);
  }

  if (templateId === MARKET_TEMPLATES.doubleChance) {
    return mappedMarket(periodMarketKey(resultTypeId, {
      fulltime: 'doubleChance',
      firstHalf: 'firstHalfDoubleChance',
      secondHalf: 'secondHalfDoubleChance',
    }), outcomes, { 4: 'homeDraw', 5: 'homeAway', 6: 'drawAway' }, ['homeDraw', 'homeAway', 'drawAway']);
  }

  if (templateId === MARKET_TEMPLATES.total || templateId === MARKET_TEMPLATES.asianTotal) {
    const line = favbetLine(outcomes);
    const key = periodTotalKey(resultTypeId, templateId === MARKET_TEMPLATES.asianTotal, line);
    return mappedMarket(key, outcomes, { 10: 'over', 11: 'under' }, ['over', 'under']);
  }

  if ([MARKET_TEMPLATES.handicap, MARKET_TEMPLATES.asianHandicap].includes(templateId)) {
    if (resultTypeId !== RESULT_TYPES.fulltime) {
      return null;
    }
    const home = outcomes.find((outcome) => Number(outcome.outcome_type_id) === 1);
    const homeLine = parseLine(home?.outcome_param);
    if (homeLine === null) {
      return null;
    }
    const base = templateId === MARKET_TEMPLATES.asianHandicap ? 'asianHandicap' : 'handicap';
    return mappedMarket(
      handicapMarketKey(base, homeLine),
      outcomes,
      { 1: 'home', 3: 'away' },
      ['home', 'away'],
    );
  }

  if (templateId === MARKET_TEMPLATES.teamTotal) {
    const line = favbetLine(outcomes);
    const side = favbetTeamTotalSide(market, outcomes, teams);
    // Full-time team totals are the main cross-book schema; period team totals
    // stay on the same keys when the feed tags half periods (rare but useful).
    const key = side && line !== null
      ? `market_total_goluri_${side}_${lineToken(line)}`
      : null;
    return mappedMarket(key, outcomes, { 10: 'over', 11: 'under' }, ['over', 'under']);
  }

  if (templateId === MARKET_TEMPLATES.bothTeamsToScore) {
    return mappedMarket(periodMarketKey(resultTypeId, {
      fulltime: 'bothTeamsToScore',
      firstHalf: 'firstHalfBothTeamsToScore',
      secondHalf: 'secondHalfBothTeamsToScore',
    }), outcomes, { 20: 'yes', 21: 'no' }, ['yes', 'no']);
  }

  if (templateId === MARKET_TEMPLATES.oddEven) {
    // Odd/even is usually full-time; still accept period mapping when feed tags it.
    const oddEvenKey = periodMarketKey(resultTypeId, {
      fulltime: 'market_total_goluri_impar_par',
      firstHalf: 'market_total_goluri_impar_par',
      secondHalf: 'market_total_goluri_impar_par',
    });
    return mappedMarket(oddEvenKey, outcomes, { 30: 'odd', 31: 'even' }, ['odd', 'even']);
  }

  if (templateId === MARKET_TEMPLATES.halfTimeOrFullTime && resultTypeId === RESULT_TYPES.fulltime) {
    return mappedMarket('halfTimeOrFullTime', outcomes, { 802: 'home', 803: 'draw', 804: 'away' }, ['home', 'draw', 'away']);
  }

  if (templateId === MARKET_TEMPLATES.drawNoBet) {
    return mappedMarket(periodMarketKey(resultTypeId, {
      fulltime: 'drawNoBet',
      firstHalf: 'firstHalfDrawNoBet',
      secondHalf: 'secondHalfDrawNoBet',
    }), outcomes, { 1: 'home', 3: 'away' }, ['home', 'away']);
  }

  if (templateId === MARKET_TEMPLATES.totalCorners || templateId === MARKET_TEMPLATES.totalCards) {
    const line = favbetLine(outcomes);
    if (line === null) return null;
    const base = templateId === MARKET_TEMPLATES.totalCorners ? 'totalCorners' : 'totalCards';
    const periodBase = periodMarketKey(resultTypeId, {
      fulltime: base,
      firstHalf: templateId === MARKET_TEMPLATES.totalCorners ? 'firstHalfTotalCorners' : 'firstHalfTotalCards',
      secondHalf: templateId === MARKET_TEMPLATES.totalCorners ? 'secondHalfTotalCorners' : 'secondHalfTotalCards',
    });
    const key = periodBase ? `${periodBase}_${lineToken(line)}` : null;
    return mappedMarket(key, outcomes, { 10: 'over', 11: 'under' }, ['over', 'under']);
  }

  if (templateId === MARKET_TEMPLATES.toQualify) {
    return mappedMarket('toQualify', outcomes, { 1: 'home', 3: 'away' }, ['home', 'away']);
  }

  // Name-based fallback when template ids differ by region/feed version.
  return normalizeFavbetMarketByName(market, outcomes, teams, resultTypeId);
}

function normalizeFavbetMarketByName(market, outcomes, teams, resultTypeId) {
  const name = normalizeText(market?.market_name || market?.market_name_en || '');
  if (!name) return null;

  if (name.includes('draw_no_bet') || name.includes('fara_egal') || name.includes('egal_pariu')) {
    return mappedMarket(periodMarketKey(resultTypeId, {
      fulltime: 'drawNoBet',
      firstHalf: 'firstHalfDrawNoBet',
      secondHalf: 'secondHalfDrawNoBet',
    }), outcomes, { 1: 'home', 3: 'away', 2: 'away' }, ['home', 'away']);
  }

  if (name.includes('corner') || name.includes('cornere')) {
    const line = favbetLine(outcomes);
    if (line === null) return null;
    const base = periodMarketKey(resultTypeId, {
      fulltime: 'totalCorners',
      firstHalf: 'firstHalfTotalCorners',
      secondHalf: 'secondHalfTotalCorners',
    });
    return mappedMarket(base ? `${base}_${lineToken(line)}` : null, outcomes, { 10: 'over', 11: 'under' }, ['over', 'under']);
  }

  if (name.includes('card') || name.includes('cartonas') || name.includes('booking')) {
    const line = favbetLine(outcomes);
    if (line === null) return null;
    const base = periodMarketKey(resultTypeId, {
      fulltime: 'totalCards',
      firstHalf: 'firstHalfTotalCards',
      secondHalf: 'secondHalfTotalCards',
    });
    return mappedMarket(base ? `${base}_${lineToken(line)}` : null, outcomes, { 10: 'over', 11: 'under' }, ['over', 'under']);
  }

  if (name.includes('to_qualify') || name.includes('califica') || name.includes('merge_mai_departe')) {
    return mappedMarket('toQualify', outcomes, { 1: 'home', 3: 'away', 2: 'away' }, ['home', 'away']);
  }

  if (name.includes('team_total') || name.includes('total_goluri_echipa')) {
    const line = favbetLine(outcomes);
    const side = favbetTeamTotalSide(market, outcomes, teams);
    const key = side && line !== null
      ? `market_total_goluri_${side}_${lineToken(line)}`
      : null;
    return mappedMarket(key, outcomes, { 10: 'over', 11: 'under' }, ['over', 'under']);
  }

  return null;
}

function activeFavbetOutcomes(outcomes) {
  return (Array.isArray(outcomes) ? outcomes : []).filter((outcome) =>
    outcome?.outcome_visible !== false && isDecimalOdds(Number(outcome?.outcome_coef)));
}

function mappedMarket(key, outcomes, outcomeTypes, required) {
  if (!key) {
    return null;
  }
  const prices = {};
  for (const outcome of outcomes) {
    const mapped = outcomeTypes[Number(outcome.outcome_type_id)];
    const price = Number(outcome.outcome_coef);
    if (mapped && isDecimalOdds(price)) {
      prices[mapped] = price;
    }
  }
  return required.every((outcome) => isDecimalOdds(prices[outcome]))
    ? { key, prices }
    : null;
}

function periodMarketKey(resultTypeId, keys) {
  if (resultTypeId === RESULT_TYPES.fulltime) return keys.fulltime;
  if (resultTypeId === RESULT_TYPES.firstHalf) return keys.firstHalf;
  if (resultTypeId === RESULT_TYPES.secondHalf) return keys.secondHalf;
  return null;
}

function periodTotalKey(resultTypeId, asian, line) {
  if (line === null) {
    return null;
  }
  const keys = asian
    ? {
        fulltime: 'asianTotalGoals',
        firstHalf: 'firstHalfAsianTotalGoals',
        secondHalf: 'secondHalfAsianTotalGoals',
      }
    : {
        fulltime: 'totalGoals',
        firstHalf: 'firstHalfTotalGoals',
        secondHalf: 'secondHalfTotalGoals',
      };
  const base = periodMarketKey(resultTypeId, keys);
  return base ? `${base}_${lineToken(line)}` : null;
}

function favbetLine(outcomes) {
  for (const outcome of outcomes) {
    const line = parseLine(outcome?.outcome_param);
    if (line !== null) {
      return Math.abs(line);
    }
  }
  return null;
}

function parseLine(value) {
  const parsed = Number.parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function lineToken(value) {
  return formatLine(value).replace('.', '_');
}

function favbetTeamTotalSide(market, outcomes, teams) {
  const outcomeLabel = String(outcomes[0]?.outcome_short_name || outcomes[0]?.outcome_name || '').trim();
  if (/^1(?:\s|$)/.test(outcomeLabel)) return 'home';
  if (/^2(?:\s|$)/.test(outcomeLabel)) return 'away';

  const marketName = normalizeText(market?.market_name);
  if (teams.homeTeam && marketName.includes(normalizeText(teams.homeTeam))) return 'home';
  if (teams.awayTeam && marketName.includes(normalizeText(teams.awayTeam))) return 'away';
  return null;
}

function favbetTeams(event) {
  const participants = Array.isArray(event?.participants) ? event.participants : [];
  const home = participants.find((participant) => Number(participant?.participant_number) === 1);
  const away = participants.find((participant) => Number(participant?.participant_number) === 2);
  if (home?.participant_name && away?.participant_name) {
    return {
      homeTeam: String(home.participant_name).trim(),
      awayTeam: String(away.participant_name).trim(),
    };
  }

  const [homeTeam, awayTeam] = splitFixtureName(event?.event_name);
  return homeTeam && awayTeam ? { homeTeam, awayTeam } : null;
}

function favbetStartTime(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return null;
  }
  const date = new Date(timestamp > 1e12 ? timestamp : timestamp * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

module.exports = {
  FAVBET_FOOTBALL_URL,
  FAVBET_RPC_URL,
  FavbetProvider,
  normalizeFavbetEvent,
  normalizeFavbetMarket,
  normalizeFavbetMarkets,
  normalizeFavbetPayload,
};
