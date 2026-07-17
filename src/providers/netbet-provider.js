const { ProviderError } = require('./the-odds-api-provider');
const {
  formatLine,
  genericMarketKey,
  handicapMarketKey,
  hasAnyCompleteMarket,
  hasCompleteOutcomes,
  isDecimalOdds,
  normalizeOutcomeKey,
} = require('./market-utils');
const { bookmakerLinkFields, netbetEventUrl } = require('./event-links');

const NETBET_BOOKMAKER = 'netbetro';
const NETBET_EVENTS_URL = 'https://api.sportify.bet/api/content/inventory-events';
const NETBET_MARKETS_URL = 'https://api.sportify.bet/echo/v1/markets';
const DEFAULT_NETBET_MAX_DETAIL_EVENTS = 220;
const DEFAULT_NETBET_DETAILS_CONCURRENCY = 10;
const NETBET_MARKET_TYPES = Object.freeze({
  h2h: 5498,
  doubleChance: 5499,
  totalGoals: 5500,
  btts: 5508,
  firstHalfH2h: 5518,
  firstHalfDoubleChance: 5519,
  firstHalfTotalGoals: 5520,
  handicap3Way: 5504,
  asianTotalGoals: 10047,
  firstHalfAsianTotalGoals: 11011,
});

class NetBetProvider {
  constructor({
    eventsUrl = NETBET_EVENTS_URL,
    marketsUrl = NETBET_MARKETS_URL,
    fetchImpl = globalThis.fetch,
    timeoutMs = 8000,
    maxDetailEvents = DEFAULT_NETBET_MAX_DETAIL_EVENTS,
    detailsConcurrency = DEFAULT_NETBET_DETAILS_CONCURRENCY,
    now = () => new Date(),
  } = {}) {
    this.name = 'NetBet';
    this.eventsUrl = eventsUrl;
    this.marketsUrl = marketsUrl;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.maxDetailEvents = maxDetailEvents;
    this.detailsConcurrency = detailsConcurrency;
    this.now = now;
  }

  async getOdds() {
    const fetchedAt = this.now().toISOString();
    const listPayload = await this.fetchJson(this.eventsRequestUrl(), 'events');
    const events = extractNetBetEvents(listPayload).slice(0, this.maxDetailEvents);
    const detailedEvents = await mapWithConcurrency(
      events,
      this.detailsConcurrency,
      async (event) => {
        try {
          return await this.fetchJson(this.marketsRequestUrl(event.id), 'markets');
        } catch {
          return event;
        }
      },
    );

    return normalizeNetBetPayload(detailedEvents, fetchedAt);
  }

  eventsRequestUrl() {
    const url = new URL(this.eventsUrl);
    url.search = new URLSearchParams({
      bookmaker: NETBET_BOOKMAKER,
      sport: 'football',
      lang: 'ro',
    });
    return url;
  }

  marketsRequestUrl(eventId) {
    const url = new URL(this.marketsUrl);
    url.search = new URLSearchParams({
      bookmaker: NETBET_BOOKMAKER,
      event_id: eventId,
      lang: 'ro',
    });
    return url;
  }

  async fetchJson(url, label) {
    let response;
    try {
      response = await this.fetchImpl(url, {
        headers: netbetHeaders(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new ProviderError(`Unable to reach NetBet ${label}: ${error.message}`, {
        cause: error,
      });
    }

    if (!response.ok) {
      throw new ProviderError(`NetBet ${label} returned HTTP ${response.status}`, {
        status: response.status,
      });
    }

    try {
      return await response.json();
    } catch (error) {
      throw new ProviderError(`NetBet ${label} returned invalid JSON`, {
        cause: error,
      });
    }
  }
}

function extractNetBetEvents(payload) {
  return collectNetBetCompetitions(payload?.tree)
    .flatMap((competition) =>
      (Array.isArray(competition?.events) ? competition.events : []).map((event) => ({
        ...event,
        competition_name: event.competition_name || competition.name,
        competition_slug: event.competition_slug || competition.slug,
      })),
    );
}

function collectNetBetCompetitions(nodes) {
  const competitions = [];
  const visit = (items) => {
    for (const node of Array.isArray(items) ? items : []) {
      if (!node || typeof node !== 'object') {
        continue;
      }
      if (Array.isArray(node.competitions)) {
        competitions.push(...node.competitions);
      }
      for (const key of ['children', 'regions', 'categories', 'items']) {
        visit(node[key]);
      }
    }
  };
  visit(nodes);
  return competitions;
}

function normalizeNetBetPayload(payload, fetchedAt) {
  const events = Array.isArray(payload) ? payload : extractNetBetEvents(payload);
  return events
    .map((event) => normalizeNetBetEvent(event, fetchedAt))
    .filter(Boolean)
    .sort((left, right) => new Date(left.startsAt) - new Date(right.startsAt));
}

function normalizeNetBetEvent(event, fetchedAt) {
  if (!event || event.sport_slug !== 'football' || event.is_live || event.is_suspended) {
    return null;
  }

  const homeTeam = netbetTeamName(event, true);
  const awayTeam = netbetTeamName(event, false);
  const startsAt = new Date(event.starts_at);
  const markets = normalizeNetBetMarkets(event.markets, { homeTeam, awayTeam });
  const eventId = netbetEventId(event);

  if (
    !eventId ||
    !homeTeam ||
    !awayTeam ||
    Number.isNaN(startsAt.getTime()) ||
    !hasAnyCompleteMarket(markets)
  ) {
    return null;
  }

  const sportradar = netbetSportradarId(event);
  return {
    id: `netbet:${eventId}`,
    externalIds: {
      netbetEvent: eventId,
      ...(sportradar ? { sportradar } : {}),
    },
    sport: 'Football',
    competition: event.competition_name || event.region_name || 'NetBet Football',
    startsAt: startsAt.toISOString(),
    homeTeam,
    awayTeam,
    bookmakers: [
      {
        name: 'NetBet',
        lastUpdate: fetchedAt,
        ...bookmakerLinkFields('NetBet', netbetEventUrl(event)),
        markets,
      },
    ],
  };
}

function normalizeNetBetMarkets(markets, { homeTeam, awayTeam }) {
  const normalized = {};
  for (const market of Array.isArray(markets) ? markets : []) {
    if (!market || market.is_suspended) {
      continue;
    }

    const marketType = Number(market.market_type);
    if (market.market_code === 'default' || marketType === NETBET_MARKET_TYPES.h2h) {
      addOutcomeMarket(normalized, 'h2h', market, {
        W1: 'home',
        Home: 'home',
        '1': 'home',
        X: 'draw',
        Draw: 'draw',
        W2: 'away',
        Away: 'away',
        '2': 'away',
      }, ['home', 'draw', 'away']);
      continue;
    }

    if (marketType === NETBET_MARKET_TYPES.doubleChance) {
      addOutcomeMarket(normalized, 'doubleChance', market, {
        '1X': 'homeDraw',
        '12': 'homeAway',
        X2: 'drawAway',
      }, ['homeDraw', 'homeAway', 'drawAway']);
      continue;
    }

    if (market.market_code === 'btts' || marketType === NETBET_MARKET_TYPES.btts) {
      addOutcomeMarket(normalized, 'bothTeamsToScore', market, {
        Yes: 'yes',
        Da: 'yes',
        No: 'no',
        Nu: 'no',
      }, ['yes', 'no']);
      continue;
    }

    if (market.market_code === 'total_goals' || marketType === NETBET_MARKET_TYPES.totalGoals) {
      addLineMarkets(normalized, market, 'totalGoals');
      continue;
    }

    if (marketType === NETBET_MARKET_TYPES.asianTotalGoals) {
      addLineMarkets(normalized, market, 'asianTotalGoals');
      continue;
    }

    if (marketType === NETBET_MARKET_TYPES.firstHalfH2h) {
      addOutcomeMarket(normalized, 'firstHalfH2h', market, {
        W1: 'home',
        Home: 'home',
        '1': 'home',
        X: 'draw',
        Draw: 'draw',
        W2: 'away',
        Away: 'away',
        '2': 'away',
      }, ['home', 'draw', 'away']);
      continue;
    }

    if (marketType === NETBET_MARKET_TYPES.firstHalfDoubleChance) {
      addOutcomeMarket(normalized, 'firstHalfDoubleChance', market, {
        '1X': 'homeDraw',
        '12': 'homeAway',
        X2: 'drawAway',
      }, ['homeDraw', 'homeAway', 'drawAway']);
      continue;
    }

    if (marketType === NETBET_MARKET_TYPES.firstHalfTotalGoals) {
      addLineMarkets(normalized, market, 'firstHalfTotalGoals');
      continue;
    }

    if (marketType === NETBET_MARKET_TYPES.firstHalfAsianTotalGoals) {
      addLineMarkets(normalized, market, 'firstHalfAsianTotalGoals');
      continue;
    }

    if (marketType === NETBET_MARKET_TYPES.handicap3Way) {
      addNetBetHandicap3Way(normalized, market);
      continue;
    }

    // market_code / name based expansions when type ids differ by feed version.
    const code = String(market.market_code || '').toLowerCase();
    const name = String(market.name || market.market_name || '').toLowerCase();

    if (code === 'draw_no_bet' || code === 'dnb' || name.includes('draw no bet') || name.includes('fara egal')) {
      addOutcomeMarket(normalized, 'drawNoBet', market, {
        W1: 'home', Home: 'home', '1': 'home',
        W2: 'away', Away: 'away', '2': 'away',
      }, ['home', 'away']);
      continue;
    }

    if (code === 'odd_even' || code === 'goals_odd_even' || (name.includes('par') && name.includes('impar'))) {
      addOutcomeMarket(normalized, 'market_total_goluri_impar_par', market, {
        Odd: 'odd', Even: 'even', Par: 'even', Impar: 'odd',
        odd: 'odd', even: 'even',
      }, ['odd', 'even']);
      continue;
    }

    if (code === 'total_corners' || name.includes('total cornere') || name.includes('total corners')) {
      addLineMarkets(normalized, market, 'totalCorners');
      continue;
    }

    if (code === 'total_cards' || name.includes('total cartonase') || name.includes('total cards')) {
      addLineMarkets(normalized, market, 'totalCards');
      continue;
    }

    if (
      code === '2nd_half_result'
      || code === 'second_half_1x2'
      || name.includes('a doua repriza') && (name.includes('1x2') || name.includes('rezultat') || name === 'a doua repriza')
    ) {
      addOutcomeMarket(normalized, 'secondHalfH2h', market, {
        W1: 'home', Home: 'home', '1': 'home',
        X: 'draw', Draw: 'draw',
        W2: 'away', Away: 'away', '2': 'away',
      }, ['home', 'draw', 'away']);
      continue;
    }

    if (code === '2nd_half_total' || code === 'second_half_total_goals') {
      addLineMarkets(normalized, market, 'secondHalfTotalGoals');
      continue;
    }

    if (
      code === '2nd_half_double_chance'
      || code === 'second_half_double_chance'
      || (name.includes('sansa dubla') && (name.includes('a doua') || name.includes('2nd')))
    ) {
      addOutcomeMarket(normalized, 'secondHalfDoubleChance', market, {
        '1X': 'homeDraw', '12': 'homeAway', X2: 'drawAway',
      }, ['homeDraw', 'homeAway', 'drawAway']);
      continue;
    }

    if (
      code === 'btts_1st'
      || code === '1st_half_btts'
      || (name.includes('ambele') && (name.includes('pauza') || name.includes('prima')))
    ) {
      addOutcomeMarket(normalized, 'firstHalfBothTeamsToScore', market, {
        Yes: 'yes', Da: 'yes', No: 'no', Nu: 'no',
      }, ['yes', 'no']);
      continue;
    }

    if (
      code === 'btts_2nd'
      || code === '2nd_half_btts'
      || (name.includes('ambele') && (name.includes('a doua') || name.includes('2nd')))
    ) {
      addOutcomeMarket(normalized, 'secondHalfBothTeamsToScore', market, {
        Yes: 'yes', Da: 'yes', No: 'no', Nu: 'no',
      }, ['yes', 'no']);
      continue;
    }

    if (code === 'asian_corners' || name.includes('cornere asiatice') || name.includes('asian corner')) {
      addLineMarkets(normalized, market, 'asianTotalCorners');
      continue;
    }

    if (
      code === 'team_total_home'
      || ((name.includes('total goluri') || name.includes('team total'))
        && (name.includes('home') || name.includes('gazde') || name.includes('1')))
    ) {
      addLineMarkets(normalized, market, 'market_total_goluri_home');
      continue;
    }

    if (
      code === 'team_total_away'
      || ((name.includes('total goluri') || name.includes('team total'))
        && (name.includes('away') || name.includes('oaspeti') || name.includes('2')))
    ) {
      addLineMarkets(normalized, market, 'market_total_goluri_away');
      continue;
    }

    if (code === 'to_qualify' || name.includes('to qualify') || name.includes('califica')) {
      addOutcomeMarket(normalized, 'toQualify', market, {
        W1: 'home', Home: 'home', '1': 'home',
        W2: 'away', Away: 'away', '2': 'away',
      }, ['home', 'away']);
      continue;
    }

    addGenericNetBetMarket(normalized, market, { homeTeam, awayTeam });
  }
  return normalized;
}

function addOutcomeMarket(markets, key, market, outcomeMap, required) {
  const prices = {};
  for (const outcome of activeOutcomes(market)) {
    const mapped = outcomeMap[outcome.kind] ||
      outcomeMap[outcome.name] ||
      outcomeMap[outcome.fullname];
    if (mapped && isDecimalOdds(outcome.odds)) {
      prices[mapped] = outcome.odds;
    }
  }

  if (required.every((outcome) => isDecimalOdds(prices[outcome]))) {
    markets[key] = prices;
  }
}

function addLineMarkets(markets, market, baseKey) {
  const grouped = new Map();
  for (const outcome of activeOutcomes(market)) {
    const parsed = parseNetBetLineOutcome(outcome);
    if (!parsed || !isDecimalOdds(outcome.odds)) {
      continue;
    }

    if (!grouped.has(parsed.lineKey)) {
      grouped.set(parsed.lineKey, {});
    }
    grouped.get(parsed.lineKey)[parsed.side] = outcome.odds;
  }

  for (const [lineKey, prices] of grouped) {
    if (['over', 'under'].every((outcome) => isDecimalOdds(prices[outcome]))) {
      markets[`${baseKey}_${lineKey.replace('.', '_')}`] = prices;
    }
  }
}

function addNetBetHandicap3Way(markets, market) {
  const grouped = new Map();
  for (const outcome of activeOutcomes(market)) {
    const parsed = parseNetBetHandicapOutcome(outcome);
    if (!parsed || !isDecimalOdds(outcome.odds)) {
      continue;
    }
    if (!grouped.has(parsed.homeLine)) {
      grouped.set(parsed.homeLine, {});
    }
    grouped.get(parsed.homeLine)[parsed.side] = outcome.odds;
  }

  for (const [homeLine, prices] of grouped) {
    if (['home', 'draw', 'away'].every((outcome) => isDecimalOdds(prices[outcome]))) {
      markets[handicapMarketKey('handicap3Way', homeLine)] = prices;
    }
  }
}

function addGenericNetBetMarket(markets, market, { homeTeam, awayTeam } = {}) {
  const label = abstractTeamNames(
    market.name || market.fullname || market.market_name || market.market_code || market.market_type,
    { homeTeam, awayTeam },
  );
  const grouped = new Map();
  const unlinedPrices = {};

  for (const outcome of activeOutcomes(market)) {
    const outcomeKey = normalizeOutcomeKey(outcome.kind || outcome.name || outcome.fullname);
    if (!outcomeKey || !isDecimalOdds(outcome.odds)) {
      continue;
    }

    const line = parseLine(outcome.name) ?? parseLine(outcome.fullname);
    if (line !== null) {
      const lineKey = formatLine(line);
      if (!grouped.has(lineKey)) {
        grouped.set(lineKey, {});
      }
      grouped.get(lineKey)[outcomeKey] = outcome.odds;
    } else {
      unlinedPrices[outcomeKey] = outcome.odds;
    }
  }

  for (const [lineKey, prices] of grouped) {
    const key = genericMarketKey(label, { line: lineKey });
    if (key && !markets[key] && hasCompleteOutcomes(prices)) {
      markets[key] = prices;
    }
  }

  if (grouped.size > 0) {
    return;
  }

  const key = genericMarketKey(label);
  if (key && !markets[key] && hasCompleteOutcomes(unlinedPrices)) {
    markets[key] = unlinedPrices;
  }
}

function activeOutcomes(market) {
  return (Array.isArray(market?.outcomes) ? market.outcomes : [])
    .filter((outcome) =>
      outcome &&
      outcome.status !== false &&
      outcome.visible !== false &&
      outcome.suspended !== true &&
      outcome.non_runner == null &&
      isDecimalOdds(outcome.odds),
    );
}

function parseNetBetLineOutcome(outcome) {
  const side = normalizeOutcomeKey(outcome.kind || outcome.name);
  const line = parseLine(outcome.name) ?? parseLine(outcome.fullname);
  if (!['over', 'under'].includes(side) || line === null) {
    return null;
  }
  return {
    side,
    lineKey: formatLine(line),
  };
}

function parseNetBetHandicapOutcome(outcome) {
  const side = normalizeOutcomeKey(outcome.kind || outcome.name);
  const line = parseLine(outcome.name) ?? parseLine(outcome.fullname);
  if (!['home', 'draw', 'away'].includes(side) || line === null) {
    return null;
  }
  return {
    side,
    homeLine: side === 'away' ? -line : line,
  };
}

function netbetTeamName(event, isHome) {
  const team = (Array.isArray(event?.competitors) ? event.competitors : [])
    .find((competitor) => competitor?.is_home === isHome);
  if (team?.name) {
    return team.name.trim();
  }

  const index = isHome ? 0 : 1;
  return String(event?.teams?.[index] || parseNetBetNameTeams(event?.name)?.[index] || '').trim();
}

function parseNetBetNameTeams(name) {
  const label = String(name || '');
  for (const separator of [/\s+vs\.?\s+/i, /\s+v\.?\s+/i, /\s+[-–—]\s+/]) {
    const parts = label.split(separator).map((part) => part.trim()).filter(Boolean);
    if (parts.length === 2) {
      return parts;
    }
  }
  return [];
}

function abstractTeamNames(value, { homeTeam, awayTeam }) {
  let label = String(value || '');
  if (homeTeam) {
    label = label.replaceAll(homeTeam, 'Home');
  }
  if (awayTeam) {
    label = label.replaceAll(awayTeam, 'Away');
  }
  return label;
}

function netbetEventId(event) {
  const value = String(event?.id || '').split('-').pop();
  return /^\d+$/.test(value) ? value : null;
}

function netbetSportradarId(event) {
  const value = String(event?.sportradar?.match_id || '').trim();
  const match = value.match(/(\d+)$/);
  return match?.[1] || null;
}

function parseLine(value) {
  const match = String(value || '').match(/[+-]?\d+(?:[.,]\d+)?/);
  return match ? Number(match[0].replace(',', '.')) : null;
}

function netbetHeaders() {
  return {
    accept: 'application/json, text/plain, */*',
    origin: 'https://sport.netbet.ro',
    referer: 'https://sport.netbet.ro/fotbal/',
    'user-agent': 'Mozilla/5.0',
  };
}

async function mapWithConcurrency(items, concurrency, iteratee) {
  const limit = Math.max(1, Number(concurrency) || 1);
  const results = new Array(items.length);
  let index = 0;

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (index < items.length) {
        const currentIndex = index;
        index += 1;
        results[currentIndex] = await iteratee(items[currentIndex], currentIndex);
      }
    }),
  );

  return results;
}

module.exports = {
  DEFAULT_NETBET_DETAILS_CONCURRENCY,
  DEFAULT_NETBET_MAX_DETAIL_EVENTS,
  NETBET_BOOKMAKER,
  NETBET_EVENTS_URL,
  NETBET_MARKETS_URL,
  NETBET_MARKET_TYPES,
  NetBetProvider,
  extractNetBetEvents,
  normalizeNetBetPayload,
  normalizeNetBetEvent,
  normalizeNetBetMarkets,
};
