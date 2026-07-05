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
const { betOneEventUrl, bookmakerLinkFields } = require('./event-links');

const BETONE_CONTENT_URL = 'https://cms-api.betone.ro/api/v1/sports/offer/content';
const BETONE_EVENT_URL = 'https://cms-api.betone.ro/api/v1/sports/offer/event';
const BETONE_FOOTBALL_STRUCTURE_ID = '001001';
const DEFAULT_BETONE_MAX_DETAIL_EVENTS = 160;
const DEFAULT_BETONE_DETAILS_CONCURRENCY = 8;
const BETONE_MARKETS = Object.freeze({
  final: 6,
  btts: 4607,
  totalGoals: 3960,
  firstHalfTotalGoals: 2439,
  asianTotalGoals: 2550,
  firstHalfAsianTotalGoals: 2607,
  firstHalf: 371,
  drawNoBet: 389,
  handicap: 722,
  totalCorners: 572,
});

class BetOneProvider {
  constructor({
    contentUrl = BETONE_CONTENT_URL,
    eventUrl = BETONE_EVENT_URL,
    fetchImpl = globalThis.fetch,
    timeoutMs = 8000,
    maxDetailEvents = DEFAULT_BETONE_MAX_DETAIL_EVENTS,
    detailsConcurrency = DEFAULT_BETONE_DETAILS_CONCURRENCY,
    now = () => new Date(),
  } = {}) {
    this.name = 'BetOne';
    this.contentUrl = contentUrl;
    this.eventUrl = eventUrl;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.maxDetailEvents = maxDetailEvents;
    this.detailsConcurrency = detailsConcurrency;
    this.now = now;
  }

  async getOdds() {
    const fetchedAt = this.now().toISOString();
    const contentPayload = await this.fetchJson(this.contentRequestUrl(), 'content');
    const fixtures = extractBetOneFixtures(contentPayload).slice(0, this.maxDetailEvents);
    const details = await mapWithConcurrency(
      fixtures,
      this.detailsConcurrency,
      async (fixture) => {
        try {
          const detailPayload = await this.fetchJson(this.eventRequestUrl(fixture.fixtureId), 'event');
          return mergeBetOneDetail(fixture, detailPayload);
        } catch {
          return { content: fixture };
        }
      },
    );

    return normalizeBetOnePayload(details, fetchedAt);
  }

  contentRequestUrl() {
    const url = new URL(this.contentUrl);
    url.search = new URLSearchParams({
      structureId: BETONE_FOOTBALL_STRUCTURE_ID,
      timeSlotId: '0',
    });
    return url;
  }

  eventRequestUrl(fixtureId) {
    const url = new URL(this.eventUrl);
    url.search = new URLSearchParams({
      fixtureId: String(fixtureId),
      includeOutcomes: 'true',
    });
    return url;
  }

  async fetchJson(url, label) {
    let response;
    try {
      response = await this.fetchImpl(url, {
        headers: betOneHeaders(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new ProviderError(`Unable to reach BetOne ${label}: ${error.message}`, {
        cause: error,
      });
    }

    if (!response.ok) {
      throw new ProviderError(`BetOne ${label} returned HTTP ${response.status}`, {
        status: response.status,
      });
    }

    try {
      return await response.json();
    } catch (error) {
      throw new ProviderError(`BetOne ${label} returned invalid JSON`, {
        cause: error,
      });
    }
  }
}

function extractBetOneFixtures(payload) {
  return (payload?.content?.offerContent || [])
    .filter((group) => group?.imgKey === 'soccer' || group?.name === 'FOTBAL')
    .flatMap((group) => (Array.isArray(group.competitions) ? group.competitions : []))
    .flatMap((competition) =>
      (Array.isArray(competition.events) ? competition.events : [])
        .map((event) => normalizeBetOneListFixture(event, competition))
        .filter(Boolean),
    )
    .filter((event) => event.fixtureId && event.homeTeam && event.awayTeam);
}

function normalizeBetOneListFixture(event, competition) {
  if (!event) {
    return null;
  }
  const teams = betOneTeams(event);
  return {
    ...event,
    homeTeam: teams?.homeTeam || event.homeTeam,
    awayTeam: teams?.awayTeam || event.awayTeam,
    competitionName: event.competitionName || competition.fullName || competition.name,
    categoryName: event.categoryName || competition.categoryName,
    sportName: event.sportName || 'FOTBAL',
  };
}

function normalizeBetOnePayload(payload, fetchedAt) {
  const items = Array.isArray(payload) ? payload : [payload];
  return items
    .map((item) => normalizeBetOneEvent(item?.content || item, fetchedAt))
    .filter(Boolean)
    .sort((left, right) => new Date(left.startsAt) - new Date(right.startsAt));
}

function mergeBetOneDetail(fixture, payload) {
  const content = payload?.content || {};
  const teams = betOneTeams(content) || betOneTeams(fixture);
  return {
    ...payload,
    content: {
      ...fixture,
      ...content,
      fixtureId: content.fixtureId || fixture.fixtureId || payload?.qryParams?.fixtureId,
      fixtureDate: content.fixtureDate || content.eventDate || fixture.fixtureDate,
      eventId: content.eventId || fixture.eventId,
      homeTeam: teams?.homeTeam || content.homeTeam || fixture.homeTeam,
      awayTeam: teams?.awayTeam || content.awayTeam || fixture.awayTeam,
      categoryName: content.categoryName || fixture.categoryName,
      competitionName: content.competitionName || fixture.competitionName,
      sportName: content.sportName || fixture.sportName || 'FOTBAL',
    },
  };
}

function normalizeBetOneEvent(event, fetchedAt) {
  if (!event || !isBetOneFootball(event)) {
    return null;
  }

  const startsAt = new Date(event.eventDate || event.fixtureDate);
  const teams = betOneTeams(event);
  const homeTeam = teams?.homeTeam;
  const awayTeam = teams?.awayTeam;
  const markets = normalizeBetOneMarkets(event.markets || marketsFromListEvent(event), {
    homeTeam,
    awayTeam,
  });
  if (
    !event.fixtureId ||
    !homeTeam ||
    !awayTeam ||
    Number.isNaN(startsAt.getTime()) ||
    !hasAnyCompleteMarket(markets)
  ) {
    return null;
  }

  return {
    id: `betone:${event.fixtureId}`,
    externalIds: {
      betoneFixture: String(event.fixtureId),
      ...(event.eventId ? { betoneEvent: String(event.eventId) } : {}),
    },
    sport: 'Football',
    competition: event.competitionName || event.eventTitle || 'BetOne Football',
    startsAt: startsAt.toISOString(),
    homeTeam,
    awayTeam,
    bookmakers: [
      {
        name: 'BetOne',
        lastUpdate: fetchedAt,
        ...bookmakerLinkFields('BetOne', betOneEventUrl(event)),
        markets,
      },
    ],
  };
}

function normalizeBetOneMarkets(markets, { homeTeam, awayTeam } = {}) {
  const normalized = {};
  for (const market of Array.isArray(markets) ? markets : []) {
    const marketId = Number(market.marketId);
    if (marketId === BETONE_MARKETS.final) {
      addOutcomeMarket(normalized, 'h2h', market, {
        '1': 'home',
        X: 'draw',
        '2': 'away',
      }, ['home', 'draw', 'away']);
      addOutcomeMarket(normalized, 'doubleChance', market, {
        '1X': 'homeDraw',
        '12': 'homeAway',
        X2: 'drawAway',
      }, ['homeDraw', 'homeAway', 'drawAway']);
      continue;
    }

    if (marketId === BETONE_MARKETS.firstHalf) {
      addOutcomeMarket(normalized, 'firstHalfH2h', market, {
        '1': 'home',
        X: 'draw',
        '2': 'away',
      }, ['home', 'draw', 'away']);
      addOutcomeMarket(normalized, 'firstHalfDoubleChance', market, {
        '1X': 'homeDraw',
        '12': 'homeAway',
        X2: 'drawAway',
      }, ['homeDraw', 'homeAway', 'drawAway']);
      continue;
    }

    if (marketId === BETONE_MARKETS.btts) {
      addOutcomeMarket(normalized, 'bothTeamsToScore', market, {
        GG: 'yes',
        Da: 'yes',
        Yes: 'yes',
        NG: 'no',
        Nu: 'no',
        No: 'no',
      }, ['yes', 'no']);
      continue;
    }

    if (marketId === BETONE_MARKETS.totalGoals) {
      addPlusRangeTotals(normalized, market, 'totalGoals');
      continue;
    }

    if (marketId === BETONE_MARKETS.firstHalfTotalGoals) {
      addPlusRangeTotals(normalized, market, 'firstHalfTotalGoals');
      continue;
    }

    if (marketId === BETONE_MARKETS.asianTotalGoals) {
      addLineMarkets(normalized, market, 'asianTotalGoals');
      continue;
    }

    if (marketId === BETONE_MARKETS.firstHalfAsianTotalGoals) {
      addLineMarkets(normalized, market, 'firstHalfAsianTotalGoals');
      continue;
    }

    if (marketId === BETONE_MARKETS.drawNoBet) {
      addOutcomeMarket(normalized, 'drawNoBet', market, {
        '1': 'home',
        '2': 'away',
      }, ['home', 'away']);
      continue;
    }

    if (marketId === BETONE_MARKETS.handicap) {
      addHandicapMarkets(normalized, market, 'handicap');
      continue;
    }

    if (marketId === BETONE_MARKETS.totalCorners) {
      addLineMarkets(normalized, market, 'totalCorners');
      continue;
    }

    addGenericBetOneMarket(normalized, market, { homeTeam, awayTeam });
  }
  return normalized;
}

function marketsFromListEvent(event) {
  return event.outcomes
    ? [{ marketId: BETONE_MARKETS.final, marketName: 'Final', outcomes: event.outcomes }]
    : [];
}

function betOneTeams(event) {
  const homeTeam = String(event?.homeTeamName || event?.homeTeam || '').trim();
  const awayTeam = String(event?.awayTeamName || event?.awayTeam || '').trim();
  if (homeTeam && awayTeam) {
    return { homeTeam, awayTeam };
  }

  const label = String(
    event?.name ||
      event?.eventName ||
      event?.matchName ||
      event?.fixtureName ||
      event?.eventTitle ||
      '',
  );
  for (const separator of [/\s+vs\.?\s+/i, /\s+v\.?\s+/i, /\s+[-–—]\s+/]) {
    const parts = label.split(separator).map((part) => part.trim()).filter(Boolean);
    if (parts.length === 2) {
      return { homeTeam: parts[0], awayTeam: parts[1] };
    }
  }
  return null;
}

function addOutcomeMarket(markets, key, market, outcomeMap, required) {
  const prices = {};
  for (const outcome of activeOutcomes(market)) {
    const mapped = outcomeMap[String(outcome.name || '').trim()];
    if (mapped && isDecimalOdds(outcome.value)) {
      prices[mapped] = outcome.value;
    }
  }

  if (required.every((outcome) => isDecimalOdds(prices[outcome]))) {
    markets[key] = prices;
  }
}

function addPlusRangeTotals(markets, market, baseKey) {
  const grouped = new Map();
  for (const outcome of activeOutcomes(market)) {
    const parsed = parsePlusRangeTotal(outcome.name);
    if (!parsed || !isDecimalOdds(outcome.value)) {
      continue;
    }
    if (!grouped.has(parsed.lineKey)) {
      grouped.set(parsed.lineKey, {});
    }
    grouped.get(parsed.lineKey)[parsed.side] = outcome.value;
  }

  for (const [lineKey, prices] of grouped) {
    if (['over', 'under'].every((outcome) => isDecimalOdds(prices[outcome]))) {
      markets[`${baseKey}_${lineKey.replace('.', '_')}`] = prices;
    }
  }
}

function addLineMarkets(markets, market, baseKey) {
  const grouped = new Map();
  for (const outcome of activeOutcomes(market)) {
    const parsed = parseLineOutcome(outcome.name);
    if (!parsed || !isDecimalOdds(outcome.value)) {
      continue;
    }
    if (!grouped.has(parsed.lineKey)) {
      grouped.set(parsed.lineKey, {});
    }
    grouped.get(parsed.lineKey)[parsed.side] = outcome.value;
  }

  for (const [lineKey, prices] of grouped) {
    if (['over', 'under'].every((outcome) => isDecimalOdds(prices[outcome]))) {
      markets[`${baseKey}_${lineKey.replace('.', '_')}`] = prices;
    }
  }
}

function addHandicapMarkets(markets, market, baseKey) {
  const grouped = new Map();
  for (const outcome of activeOutcomes(market)) {
    const parsed = parseHandicapOutcome(outcome.name);
    if (!parsed || !isDecimalOdds(outcome.value)) {
      continue;
    }
    if (!grouped.has(parsed.homeLine)) {
      grouped.set(parsed.homeLine, {});
    }
    grouped.get(parsed.homeLine)[parsed.side] = outcome.value;
  }

  for (const [homeLine, prices] of grouped) {
    if (['home', 'away'].every((outcome) => isDecimalOdds(prices[outcome]))) {
      markets[handicapMarketKey(baseKey, homeLine)] = prices;
    }
  }
}

function addGenericBetOneMarket(markets, market, { homeTeam, awayTeam } = {}) {
  const label = abstractTeamNames(
    market.marketName || market.name || market.displayName || market.marketId,
    { homeTeam, awayTeam },
  );
  const grouped = new Map();
  const unlinedPrices = {};

  for (const outcome of activeOutcomes(market)) {
    const outcomeKey = normalizeOutcomeKey(outcome.name || outcome.displayName || outcome.type);
    if (!outcomeKey || !isDecimalOdds(outcome.value)) {
      continue;
    }

    const line = parseLine(outcome.name || outcome.displayName);
    if (line !== null) {
      const lineKey = formatLine(line);
      if (!grouped.has(lineKey)) {
        grouped.set(lineKey, {});
      }
      grouped.get(lineKey)[outcomeKey] = outcome.value;
    } else {
      unlinedPrices[outcomeKey] = outcome.value;
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

function parsePlusRangeTotal(value) {
  const label = String(value || '').trim();
  const plus = label.match(/^(\d+)\+$/);
  if (plus) {
    return {
      side: 'over',
      lineKey: formatLine(Number(plus[1]) - 0.5),
    };
  }

  const under = label.match(/^0-(\d+)$/);
  if (under) {
    return {
      side: 'under',
      lineKey: formatLine(Number(under[1]) + 0.5),
    };
  }

  if (label === '0G') {
    return { side: 'under', lineKey: '0.5' };
  }
  return null;
}

function parseLineOutcome(value) {
  const label = String(value || '').trim();
  const side = normalizeOutcomeKey(label);
  const line = parseLine(label);
  if (!['over', 'under'].includes(side) || line === null) {
    return null;
  }
  return {
    side,
    lineKey: formatLine(line),
  };
}

function parseHandicapOutcome(value) {
  const match = String(value || '').trim().match(/^H([12])\s*([+-]?\d+(?:[.,]\d+)?)$/i);
  if (!match) {
    return null;
  }

  const side = match[1] === '1' ? 'home' : 'away';
  const line = Number(match[2].replace(',', '.'));
  return {
    side,
    homeLine: side === 'home' ? line : -line,
  };
}

function activeOutcomes(market) {
  return (Array.isArray(market?.outcomes) ? market.outcomes : [])
    .filter((outcome) => outcome && isDecimalOdds(outcome.value));
}

function parseLine(value) {
  const match = String(value || '').match(/[+-]?\d+(?:[.,]\d+)?/);
  return match ? Number(match[0].replace(',', '.')) : null;
}

function isBetOneFootball(event) {
  const sport = String(event.sportName || event.eventTitle || '').toUpperCase();
  return sport.includes('FOTBAL');
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

function betOneHeaders() {
  return {
    accept: 'application/json',
    origin: 'https://sportsbook.betone.ro',
    referer: 'https://sportsbook.betone.ro/',
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
  BETONE_CONTENT_URL,
  BETONE_EVENT_URL,
  BETONE_FOOTBALL_STRUCTURE_ID,
  BETONE_MARKETS,
  DEFAULT_BETONE_DETAILS_CONCURRENCY,
  DEFAULT_BETONE_MAX_DETAIL_EVENTS,
  BetOneProvider,
  extractBetOneFixtures,
  normalizeBetOneEvent,
  normalizeBetOneMarkets,
  normalizeBetOnePayload,
  mergeBetOneDetail,
};
