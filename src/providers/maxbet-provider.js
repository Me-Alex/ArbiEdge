const { ProviderError } = require('./the-odds-api-provider');
const {
  formatLine,
  genericMarketKey,
  hasAnyCompleteMarket,
  isDecimalOdds,
  normalizeOutcomeKey,
} = require('./market-utils');
const { absoluteEventUrl, bookmakerLinkFields } = require('./event-links');
const { findTransferStateEntries } = require('./angular-transfer-state');

const MAXBET_PAGE_URL = 'https://www.maxbet.ro/ro/pariuri-sportive';
const MAXBET_EVENTS_URL = 'https://sports-sm-distribution-api.de-2.nsoftcdn.com/api/v1/events';
const MAXBET_FOOTBALL_SPORT_ID = 2;
const NSOFT_MARKETS = Object.freeze({
  final: 2,
  totalGoals: 1547,
  bothTeamsToScore: 1709,
  oddEvenGoals: 2160,
});

class MaxBetProvider {
  constructor({
    eventsUrl = MAXBET_EVENTS_URL,
    pageUrl = MAXBET_PAGE_URL,
    fetchImpl = globalThis.fetch,
    timeoutMs = 8000,
    now = () => new Date(),
  } = {}) {
    this.name = 'MaxBet';
    this.eventsUrl = eventsUrl;
    this.pageUrl = pageUrl;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.now = now;
  }

  async getOdds() {
    const fetchedAt = this.now().toISOString();
    const payload = await this.fetchPagePayload().catch((pageError) =>
      this.fetchDirectEventsPayload().catch((directError) => {
        throw new ProviderError(
          `Unable to load MaxBet events: ${pageError.message}; direct feed failed: ${directError.message}`,
          { cause: directError },
        );
      }),
    );
    return normalizeMaxBetPayload(payload, fetchedAt);
  }

  async fetchPagePayload() {
    const html = await this.fetchPage();
    return extractMaxBetEventsPayload(html);
  }

  async fetchDirectEventsPayload() {
    let response;
    try {
      response = await this.fetchImpl(this.eventsUrl, {
        headers: {
          accept: 'application/json',
          origin: 'https://www.maxbet.ro',
          referer: this.pageUrl,
          'user-agent': 'Mozilla/5.0',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new ProviderError(`Unable to reach MaxBet events feed: ${error.message}`, {
        cause: error,
      });
    }

    if (!response.ok) {
      throw new ProviderError(`MaxBet events feed returned HTTP ${response.status}`, {
        status: response.status,
      });
    }

    const body = await response.json();
    const payload = body?.data || body;
    if (!Array.isArray(payload?.events)) {
      throw new ProviderError('MaxBet events feed did not include events data');
    }
    return payload;
  }

  async fetchPage() {
    let response;
    try {
      response = await this.fetchImpl(this.pageUrl, {
        headers: {
          accept: 'text/html',
          'user-agent': 'Mozilla/5.0',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new ProviderError(`Unable to reach MaxBet: ${error.message}`, {
        cause: error,
      });
    }

    if (!response.ok) {
      throw new ProviderError(`MaxBet returned HTTP ${response.status}`, {
        status: response.status,
      });
    }

    return response.text();
  }
}

function extractMaxBetEventsPayload(html) {
  if (!String(html || '').includes('id="ng-state"')) {
    throw new ProviderError('MaxBet page did not include Angular state');
  }

  const payloads = findTransferStateEntries(
    html,
    (item) => item.url === MAXBET_EVENTS_URL || item.url.startsWith(`${MAXBET_EVENTS_URL}?`),
  )
    .map((entry) => entry?.body?.data)
    .filter((payload) => Array.isArray(payload?.events));
  const payload = selectMaxBetEventsPayload(payloads);
  if (!Array.isArray(payload?.events)) {
    throw new ProviderError('MaxBet page did not include events data');
  }
  return payload;
}

function selectMaxBetEventsPayload(payloads) {
  return [...payloads].sort((left, right) =>
    maxBetPayloadScore(right) - maxBetPayloadScore(left)
    || right.events.length - left.events.length,
  )[0];
}

function maxBetPayloadScore(payload) {
  return (Array.isArray(payload?.events) ? payload.events : []).filter(isLegacyMaxBetEvent).length;
}

function isLegacyMaxBetEvent(event) {
  return Number(event?.b) === MAXBET_FOOTBALL_SPORT_ID
    && event?.l === 1
    && Array.isArray(event?.o)
    && Array.isArray(event?.p);
}

function normalizeMaxBetPayload(payload, fetchedAt) {
  return (Array.isArray(payload?.events) ? payload.events : [])
    .map((event) => normalizeMaxBetEvent(event, fetchedAt))
    .filter(Boolean)
    .sort((left, right) => new Date(left.startsAt) - new Date(right.startsAt));
}

function normalizeMaxBetEvent(event, fetchedAt) {
  if (
    !event ||
    Number(event.b) !== MAXBET_FOOTBALL_SPORT_ID ||
    event.l !== 1 ||
    !Array.isArray(event.o)
  ) {
    return null;
  }

  const homeTeam = competitorName(event, 1);
  const awayTeam = competitorName(event, 2);
  const startsAt = new Date(event.n);
  const markets = normalizeMaxBetMarkets(event.o);

  if (
    !event.a ||
    !homeTeam ||
    !awayTeam ||
    Number.isNaN(startsAt.getTime()) ||
    !hasAnyCompleteMarket(markets)
  ) {
    return null;
  }

  return {
    id: `maxbet:${event.a}`,
    externalIds: {
      maxbetEvent: String(event.a),
      ...(event.q ? { nsoftRootEvent: String(event.q) } : {}),
    },
    sport: 'Football',
    competition: event.g || event.d || 'MaxBet Football',
    startsAt: startsAt.toISOString(),
    homeTeam,
    awayTeam,
    bookmakers: [
      {
        name: 'MaxBet',
        lastUpdate: fetchedAt,
        ...bookmakerLinkFields('MaxBet', maxBetEventUrl(event)),
        markets,
      },
    ],
  };
}

function normalizeMaxBetMarkets(markets) {
  const normalized = {};
  for (const market of Array.isArray(markets) ? markets : []) {
    if (market?.d !== 1) {
      continue;
    }

    if (Number(market.b) === NSOFT_MARKETS.final) {
      const prices = nsoftPrices(market, {
        '1': 'home',
        X: 'draw',
        '2': 'away',
      });
      if (hasOutcomes(prices, ['home', 'draw', 'away'])) {
        normalized.h2h = prices;
      }

      const doubleChance = nsoftPrices(market, {
        '1X': 'homeDraw',
        '12': 'homeAway',
        X2: 'drawAway',
      });
      if (hasOutcomes(doubleChance, ['homeDraw', 'homeAway', 'drawAway'])) {
        normalized.doubleChance = doubleChance;
      }
      continue;
    }

    if (Number(market.b) === NSOFT_MARKETS.totalGoals) {
      addMaxBetTotalGoals(normalized, market);
      continue;
    }

    if (Number(market.b) === NSOFT_MARKETS.bothTeamsToScore) {
      const prices = nsoftPrices(market, {
        Da: 'yes',
        Nu: 'no',
        Yes: 'yes',
        No: 'no',
      });
      if (hasOutcomes(prices, ['yes', 'no'])) {
        normalized.bothTeamsToScore = prices;
      }
      continue;
    }

    if (Number(market.b) === NSOFT_MARKETS.oddEvenGoals) {
      const prices = nsoftPrices(market, {
        Par: 'even',
        Impar: 'odd',
        Even: 'even',
        Odd: 'odd',
      });
      const key = genericMarketKey('Total goluri par impar');
      if (key && hasOutcomes(prices, ['odd', 'even'])) {
        normalized[key] = prices;
      }
    }
  }
  return normalized;
}

function addMaxBetTotalGoals(markets, market) {
  const line = market.g?.[0] || market.h?.[0]?.f || market.h?.[0]?.e;
  const parsedLine = parseLine(line);
  if (parsedLine === null) {
    return;
  }

  const prices = {};
  for (const outcome of activeOutcomes(market)) {
    const key = normalizeOutcomeKey(outcome.e);
    if (['over', 'under'].includes(key) && isDecimalOdds(outcome.g)) {
      prices[key] = outcome.g;
    }
  }

  if (hasOutcomes(prices, ['over', 'under'])) {
    markets[`totalGoals_${formatLine(parsedLine).replace('.', '_')}`] = prices;
  }
}

function nsoftPrices(market, outcomeMap) {
  const prices = {};
  for (const outcome of activeOutcomes(market)) {
    const key = outcomeMap[String(outcome.e || '').trim()];
    if (key && isDecimalOdds(outcome.g)) {
      prices[key] = outcome.g;
    }
  }
  return prices;
}

function activeOutcomes(market) {
  return (Array.isArray(market?.h) ? market.h : []).filter((outcome) => outcome?.c === 1);
}

function competitorName(event, type) {
  const competitor = (event.p || []).find((item) => Number(item.c) === type);
  return cleanTeamName(competitor?.d || competitor?.e);
}

function cleanTeamName(value) {
  return String(value || '')
    .replace(/^[FR]\//, '')
    .trim();
}

function maxBetEventUrl(event) {
  if (!event?.a) {
    return null;
  }
  return absoluteEventUrl(`/ro/pariuri-sportive/eveniment/${event.a}`, 'https://www.maxbet.ro');
}

function parseLine(value) {
  const match = String(value || '').match(/[+-]?\d+(?:[.,]\d+)?/);
  return match ? Number(match[0].replace(',', '.')) : null;
}

function hasOutcomes(prices, outcomes) {
  return outcomes.every((outcome) => isDecimalOdds(prices[outcome]));
}

module.exports = {
  MAXBET_EVENTS_URL,
  MAXBET_FOOTBALL_SPORT_ID,
  MAXBET_PAGE_URL,
  MaxBetProvider,
  extractMaxBetEventsPayload,
  normalizeMaxBetPayload,
};
