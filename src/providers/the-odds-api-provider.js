const {
  handicapMarketKey,
  isDecimalOdds,
} = require('./market-utils');

const DEFAULT_MAX_EVENT_DETAIL_REQUESTS = 20;
const DEFAULT_EVENT_DETAIL_CONCURRENCY = 2;
const DEFAULT_SPORT_CONCURRENCY = 3;
const DEFAULT_MAX_SPORTS = 8;

class ProviderError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'ProviderError';
    this.status = options.status;
  }
}

class TheOddsApiProvider {
  constructor({
    apiKey,
    sportKeys,
    regions = ['eu', 'uk'],
    bookmakers = [],
    // btts + draw_no_bet unlock more cross formulas (BTTS soft, DNB/AH0 mirrors).
    marketKeys = ['h2h', 'spreads', 'totals', 'btts', 'draw_no_bet'],
    eventMarketKeys = [],
    maxEventDetailRequests = DEFAULT_MAX_EVENT_DETAIL_REQUESTS,
    eventDetailConcurrency = DEFAULT_EVENT_DETAIL_CONCURRENCY,
    discoverSports = false,
    sportGroups = [],
    maxSports = DEFAULT_MAX_SPORTS,
    sportConcurrency = DEFAULT_SPORT_CONCURRENCY,
    fetchImpl = globalThis.fetch,
    timeoutMs = 8000,
  }) {
    if (!apiKey) {
      throw new TypeError('The Odds API key is required');
    }

    this.apiKey = apiKey;
    this.name = 'The Odds API';
    this.sportKeys = normalizeList(sportKeys);
    this.regions = normalizeList(regions);
    this.bookmakers = normalizeList(bookmakers);
    this.marketKeys = normalizeList(marketKeys);
    this.eventMarketKeys = normalizeList(eventMarketKeys);
    this.maxEventDetailRequests = normalizeNonNegativeInteger(
      maxEventDetailRequests,
      DEFAULT_MAX_EVENT_DETAIL_REQUESTS,
    );
    this.eventDetailConcurrency = normalizePositiveInteger(
      eventDetailConcurrency,
      DEFAULT_EVENT_DETAIL_CONCURRENCY,
    );
    this.discoverSports = Boolean(discoverSports);
    this.sportGroups = normalizeList(sportGroups);
    this.maxSports = normalizePositiveInteger(maxSports, DEFAULT_MAX_SPORTS);
    this.sportConcurrency = normalizePositiveInteger(sportConcurrency, DEFAULT_SPORT_CONCURRENCY);
    this.lastSportFailures = [];
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async getOdds() {
    const sportKeys = await this.#resolveSportKeys();
    const results = await mapWithConcurrency(
      sportKeys,
      this.sportConcurrency,
      async (sportKey) => {
        try {
          return { ok: true, sportKey, events: await this.#fetchSport(sportKey) };
        } catch (error) {
          return { ok: false, sportKey, error };
        }
      },
    );
    const successful = results.filter((result) => result.ok);
    this.lastSportFailures = results
      .filter((result) => !result.ok)
      .map((result) => ({ sportKey: result.sportKey, error: result.error.message }));
    if (successful.length === 0 && results.length > 0) throw results[0].error;

    const uniqueEvents = new Map();
    for (const event of successful.flatMap((result) => result.events).map(normalizeEvent).filter(Boolean)) {
      uniqueEvents.set(event.id, event);
    }

    return [...uniqueEvents.values()].sort(
      (left, right) => new Date(left.startsAt) - new Date(right.startsAt),
    );
  }

  async #resolveSportKeys() {
    if (!this.discoverSports) return this.sportKeys.slice(0, this.maxSports);
    const discovered = await this.#fetchActiveSports().catch(() => []);
    const groups = new Set(this.sportGroups.map(normalizeSportGroup));
    const matches = discovered
      .filter((sport) => sport?.active !== false && typeof sport?.key === 'string')
      .filter((sport) => groups.size === 0
        || groups.has(normalizeSportGroup(sport.group))
        || [...groups].some((group) => normalizeSportGroup(sport.key).startsWith(group)))
      .map((sport) => sport.key);
    return [...new Set([...this.sportKeys, ...matches])].slice(0, this.maxSports);
  }

  async #fetchActiveSports() {
    const url = new URL('https://api.the-odds-api.com/v4/sports/');
    url.search = new URLSearchParams({ apiKey: this.apiKey, all: 'false' });
    const response = await this.fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  }

  async #fetchSport(sportKey) {
    const url = new URL(
      `https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sportKey)}/odds/`,
    );
    url.search = new URLSearchParams(this.#oddsQueryParams(this.marketKeys));

    let response;
    try {
      response = await this.fetchImpl(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new ProviderError(`Unable to reach The Odds API: ${error.message}`, {
        cause: error,
      });
    }

    if (!response.ok) {
      throw new ProviderError(
        `The Odds API returned HTTP ${response.status}`,
        { status: response.status },
      );
    }

    try {
      const data = await response.json();
      const events = Array.isArray(data) ? data : [];
      return this.#withEventDetails(sportKey, events);
    } catch (error) {
      throw new ProviderError('The Odds API returned invalid JSON', {
        cause: error,
      });
    }
  }

  async #withEventDetails(sportKey, events) {
    if (
      this.eventMarketKeys.length === 0 ||
      this.maxEventDetailRequests <= 0 ||
      events.length === 0
    ) {
      return events;
    }

    const detailTargets = eventDetailTargets(events)
      .slice(0, this.maxEventDetailRequests);
    if (detailTargets.length === 0) {
      return events;
    }

    const details = await mapWithConcurrency(
      detailTargets,
      this.eventDetailConcurrency,
      (event) => this.#fetchEventOdds(sportKey, event.id),
    );

    return mergeEventDetails(events, details.filter(Boolean));
  }

  async #fetchEventOdds(sportKey, eventId) {
    const url = new URL(
      `https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sportKey)}/events/${encodeURIComponent(eventId)}/odds`,
    );
    url.search = new URLSearchParams(this.#oddsQueryParams(this.eventMarketKeys));

    let response;
    try {
      response = await this.fetchImpl(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      return null;
    }

    if (!response.ok) {
      return null;
    }

    try {
      const data = await response.json();
      return data && typeof data === 'object' && !Array.isArray(data)
        ? data
        : null;
    } catch {
      return null;
    }
  }

  #oddsQueryParams(marketKeys) {
    const params = {
      apiKey: this.apiKey,
      markets: marketKeys.join(',') || 'h2h',
      oddsFormat: 'decimal',
      dateFormat: 'iso',
    };
    if (this.bookmakers.length > 0) {
      params.bookmakers = this.bookmakers.join(',');
    } else {
      params.regions = this.regions.join(',');
    }
    return params;
  }
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeSportGroup(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeNonNegativeInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function eventDetailTargets(events) {
  const seen = new Set();
  const targets = [];
  for (const event of events) {
    if (!event || typeof event.id !== 'string' || seen.has(event.id)) {
      continue;
    }
    seen.add(event.id);
    targets.push(event);
  }
  return targets;
}

function mergeEventDetails(events, details) {
  const detailsById = new Map();
  for (const detail of details) {
    if (detail && typeof detail.id === 'string') {
      detailsById.set(detail.id, detail);
    }
  }

  return events.map((event) => {
    const detail = detailsById.get(event?.id);
    return detail ? mergeEventDetail(event, detail) : event;
  });
}

function mergeEventDetail(event, detail) {
  const detailBookmakers = Array.isArray(detail?.bookmakers)
    ? detail.bookmakers
    : [];
  if (detailBookmakers.length === 0) {
    return event;
  }

  const bookmakers = Array.isArray(event?.bookmakers)
    ? [...event.bookmakers]
    : [];
  const bookmakerIndexes = new Map();
  bookmakers.forEach((bookmaker, index) => {
    const key = bookmakerIdentity(bookmaker);
    if (key) {
      bookmakerIndexes.set(key, index);
    }
  });

  for (const detailBookmaker of detailBookmakers) {
    const key = bookmakerIdentity(detailBookmaker);
    const existingIndex = key ? bookmakerIndexes.get(key) : undefined;
    if (existingIndex === undefined) {
      bookmakers.push(detailBookmaker);
      if (key) {
        bookmakerIndexes.set(key, bookmakers.length - 1);
      }
      continue;
    }

    bookmakers[existingIndex] = mergeBookmakerMarkets(
      bookmakers[existingIndex],
      detailBookmaker,
    );
  }

  return {
    ...event,
    bookmakers,
  };
}

function mergeBookmakerMarkets(baseBookmaker, detailBookmaker) {
  const markets = Array.isArray(baseBookmaker?.markets)
    ? [...baseBookmaker.markets]
    : [];
  const seenMarketKeys = new Set(
    markets
      .map((market) => market?.key)
      .filter((key) => typeof key === 'string' && key),
  );

  for (const market of Array.isArray(detailBookmaker?.markets)
    ? detailBookmaker.markets
    : []) {
    if (typeof market?.key !== 'string' || !seenMarketKeys.has(market.key)) {
      markets.push(market);
      if (typeof market?.key === 'string' && market.key) {
        seenMarketKeys.add(market.key);
      }
    }
  }

  return {
    ...detailBookmaker,
    ...baseBookmaker,
    markets,
  };
}

function bookmakerIdentity(bookmaker) {
  const value = bookmaker?.key || bookmaker?.title;
  return typeof value === 'string' && value.trim()
    ? value.trim().toLowerCase()
    : null;
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

function normalizeEvent(event) {
  if (
    !event ||
    typeof event.id !== 'string' ||
    typeof event.home_team !== 'string' ||
    typeof event.away_team !== 'string'
  ) {
    return null;
  }

  const startsAt = toIsoDate(event.commence_time);
  if (!startsAt) {
    return null;
  }

  const sport = sportFromOddsApiKey(event.sport_key);
  const bookmakers = Array.isArray(event.bookmakers)
    ? event.bookmakers
        .map((bookmaker) =>
          normalizeBookmaker(bookmaker, event.home_team, event.away_team, sport),
        )
        .filter(Boolean)
    : [];

  if (bookmakers.length === 0) {
    return null;
  }

  return {
    id: event.id,
    sport,
    competition: event.sport_title || event.sport_key || sport,
    startsAt,
    homeTeam: event.home_team,
    awayTeam: event.away_team,
    bookmakers,
  };
}

function normalizeBookmaker(bookmaker, homeTeam, awayTeam, sport = 'Football') {
  if (!bookmaker || typeof bookmaker.title !== 'string') {
    return null;
  }

  const upstreamMarkets = Array.isArray(bookmaker.markets) ? bookmaker.markets : [];
  const markets = {};

  const h2h = upstreamMarkets.find((market) =>
    ['h2h', 'h2h_3_way'].includes(market?.key),
  );
  const h2hPrices = Object.fromEntries(
    (Array.isArray(h2h?.outcomes) ? h2h.outcomes : [])
      .filter(
        (outcome) =>
          outcome &&
          typeof outcome.name === 'string' &&
          isDecimalOdds(outcome.price),
      )
      .map((outcome) => [outcome.name, outcome.price]),
  );

  const home = h2hPrices[homeTeam];
  const away = h2hPrices[awayTeam];
  const draw = h2hPrices.Draw;
  if ([home, draw, away].every(isDecimalOdds)) {
    markets.h2h = { home, draw, away };
  } else if ([home, away].every(isDecimalOdds)) {
    markets.h2h = { home, away };
  }

  for (const market of upstreamMarkets.filter((item) =>
    ['spreads', 'alternate_spreads'].includes(item?.key),
  )) {
    const spread = normalizeSpreadMarket(market, homeTeam, awayTeam);
    if (spread) {
      for (const item of Array.isArray(spread) ? spread : [spread]) {
        markets[item.key] = item.prices;
      }
    }
  }

  for (const market of upstreamMarkets.filter((item) =>
    ['totals', 'alternate_totals'].includes(item?.key),
  )) {
    const total = normalizeTotalsMarket(market, totalMarketPrefixForSport(sport));
    if (total) {
      for (const item of Array.isArray(total) ? total : [total]) {
        markets[item.key] = item.prices;
      }
    }
  }

  for (const market of upstreamMarkets.filter((item) => item?.key === 'draw_no_bet')) {
    const drawNoBet = normalizeDrawNoBetMarket(market, homeTeam, awayTeam);
    if (drawNoBet) {
      markets[drawNoBet.key] = drawNoBet.prices;
    }
  }

  for (const market of upstreamMarkets.filter((item) => item?.key === 'btts')) {
    const btts = normalizeBttsMarket(market);
    if (btts) {
      markets[btts.key] = btts.prices;
    }
  }

  if (Object.keys(markets).length === 0) {
    return null;
  }

  return {
    name: bookmaker.title,
    lastUpdate: toIsoDate(bookmaker.last_update),
    markets,
  };
}

function normalizeSpreadMarket(market, homeTeam, awayTeam) {
  const grouped = new Map();
  for (const outcome of Array.isArray(market.outcomes) ? market.outcomes : []) {
    if (!isDecimalOdds(outcome?.price) || !Number.isFinite(outcome?.point)) {
      continue;
    }
    let side = null;
    let homeLine = null;
    if (outcome.name === homeTeam) {
      side = 'home';
      homeLine = outcome.point;
    }
    if (outcome.name === awayTeam) {
      side = 'away';
      homeLine = -outcome.point;
    }
    if (!side || !Number.isFinite(homeLine)) {
      continue;
    }

    const key = formatLine(homeLine);
    if (!grouped.has(key)) {
      grouped.set(key, { homeLine, prices: {} });
    }
    grouped.get(key).prices[side] = outcome.price;
  }

  const markets = [...grouped.values()]
    .filter(({ prices }) =>
      isDecimalOdds(prices.home) && isDecimalOdds(prices.away),
    )
    // Spreads are 2-way Asian-style — use asianHandicap_* for formula alignment.
    .map(({ homeLine, prices }) => ({
      key: handicapMarketKey('asianHandicap', homeLine),
      prices,
    }));
  return markets.length === 1 ? markets[0] : markets.length ? markets : null;
}

function normalizeTotalsMarket(market, marketPrefix = 'totalGoals') {
  const grouped = new Map();
  for (const outcome of Array.isArray(market.outcomes) ? market.outcomes : []) {
    if (!isDecimalOdds(outcome?.price) || !Number.isFinite(outcome?.point)) {
      continue;
    }
    const side = outcome.name === 'Over'
      ? 'over'
      : outcome.name === 'Under'
        ? 'under'
        : null;
    if (!side) {
      continue;
    }

    const line = formatLine(outcome.point);
    if (!grouped.has(line)) {
      grouped.set(line, { line, prices: {} });
    }
    grouped.get(line).prices[side] = outcome.price;
  }

  const markets = [...grouped.values()]
    .filter(({ prices }) =>
      isDecimalOdds(prices.over) && isDecimalOdds(prices.under),
    )
    .map(({ line, prices }) => ({
      key: `${marketPrefix}_${line.replace('.', '_')}`,
      prices,
    }));
  return markets.length === 1 ? markets[0] : markets.length ? markets : null;
}

function normalizeDrawNoBetMarket(market, homeTeam, awayTeam) {
  const prices = {};
  for (const outcome of Array.isArray(market.outcomes) ? market.outcomes : []) {
    if (!isDecimalOdds(outcome?.price)) {
      continue;
    }
    if (outcome.name === homeTeam) {
      prices.home = outcome.price;
    }
    if (outcome.name === awayTeam) {
      prices.away = outcome.price;
    }
  }
  return isDecimalOdds(prices.home) && isDecimalOdds(prices.away)
    ? { key: 'drawNoBet', prices }
    : null;
}

function normalizeBttsMarket(market) {
  const prices = {};
  for (const outcome of Array.isArray(market.outcomes) ? market.outcomes : []) {
    if (!isDecimalOdds(outcome?.price)) {
      continue;
    }
    if (outcome.name === 'Yes') {
      prices.yes = outcome.price;
    }
    if (outcome.name === 'No') {
      prices.no = outcome.price;
    }
  }
  return isDecimalOdds(prices.yes) && isDecimalOdds(prices.no)
    ? { key: 'bothTeamsToScore', prices }
    : null;
}

function formatLine(value) {
  const number = Number(value);
  if (Number.isInteger(number)) return number.toFixed(0);
  return Number.isInteger(number * 2) ? number.toFixed(1) : number.toFixed(2);
}

function toIsoDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function sportFromOddsApiKey(value) {
  const key = String(value || '').toLowerCase();
  if (key.startsWith('basketball_')) return 'Basketball';
  if (key.startsWith('tennis_')) return 'Tennis';
  if (key.startsWith('icehockey_')) return 'Ice Hockey';
  if (key.startsWith('handball_')) return 'Handball';
  if (key.startsWith('volleyball_')) return 'Volleyball';
  if (key.startsWith('americanfootball_')) return 'American Football';
  if (/^(?:esports_|csgo_|dota2_|leagueoflegends_)/.test(key)) return 'eSports';
  return 'Football';
}

function totalMarketPrefixForSport(sport) {
  if (sport === 'Basketball' || sport === 'American Football' || sport === 'Volleyball') {
    return 'totalPoints';
  }
  if (sport === 'Tennis') return 'totalGames';
  return 'totalGoals';
}

module.exports = {
  ProviderError,
  TheOddsApiProvider,
  normalizeEvent,
  sportFromOddsApiKey,
  totalMarketPrefixForSport,
};
