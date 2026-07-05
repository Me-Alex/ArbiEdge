const { mergeEvents } = require('./composite-provider');
const { absoluteEventUrl, bookmakerLinkFields } = require('./event-links');
const {
  formatLine,
  genericMarketKey,
  hasAnyCompleteMarket,
  isDecimalOdds,
  normalizeOutcomeKey,
  splitFixtureName,
} = require('./market-utils');
const { ProviderError } = require('./the-odds-api-provider');

const STANLEYBET_FAMILY_EVENTS_URL =
  'https://sportsbook-sm-distribution-api.nsoft.com/api/v1/events';
const STANLEYBET_FAMILY_COMPANY_UUID = '682e6a38-b5ad-4c58-a743-3b06c79e55cd';
const STANLEYBET_FOOTBALL_SPORT_ID = 4;
const DEFAULT_LOOKAHEAD_DAYS = 14;

const STANLEYBET_FAMILY_BRANDS = Object.freeze([
  { name: 'Stanleybet', origin: 'https://www.stanleybet.ro' },
  { name: 'GameWorld', origin: 'https://www.gameworld.ro' },
  { name: 'AdmiralBet', origin: 'https://www.admiralbet.ro' },
  { name: 'Seven', origin: 'https://www.seven.ro' },
  { name: 'RedSevens', origin: 'https://www.redsevens.ro' },
  { name: 'GPCasino', origin: 'https://www.gpcasino.ro' },
]);

class StanleybetFamilyProvider {
  constructor({
    brands = STANLEYBET_FAMILY_BRANDS,
    companyUuid = STANLEYBET_FAMILY_COMPANY_UUID,
    eventsUrl = STANLEYBET_FAMILY_EVENTS_URL,
    fetchImpl = globalThis.fetch,
    lookaheadDays = DEFAULT_LOOKAHEAD_DAYS,
    now = () => new Date(),
    timeoutMs = 8000,
  } = {}) {
    this.name = 'Stanleybet family';
    this.brands = normalizeBrands(brands);
    this.companyUuid = companyUuid;
    this.eventsUrl = eventsUrl;
    this.fetchImpl = fetchImpl;
    this.lookaheadDays = lookaheadDays;
    this.now = now;
    this.timeoutMs = timeoutMs;

    if (this.brands.length === 0) {
      throw new Error('StanleybetFamilyProvider requires at least one brand');
    }
  }

  async getOdds() {
    const start = this.now();
    const payload = await this.fetchEventsPayload(start);
    const fetchedAt = start.toISOString();

    return mergeEvents(
      this.brands.flatMap((brand) =>
        normalizeStanleybetFamilyPayload(payload, {
          bookmaker: brand.name,
          fetchedAt,
          origin: brand.origin,
        }),
      ),
    );
  }

  async fetchEventsPayload(start = this.now()) {
    const url = new URL(this.eventsUrl);
    const params = stanleybetFamilyRequestParams({
      companyUuid: this.companyUuid,
      lookaheadDays: this.lookaheadDays,
      now: start,
    });
    for (const [key, value] of params.entries()) {
      url.searchParams.set(key, value);
    }

    let response;
    try {
      response = await this.fetchImpl(url, {
        headers: {
          accept: 'application/json',
          origin: this.brands[0].origin,
          referer: `${this.brands[0].origin}/pariuri-sportive`,
          'user-agent': 'Mozilla/5.0',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new ProviderError(
        `Unable to reach Stanleybet family events feed: ${error.message}`,
        { cause: error },
      );
    }

    if (!response.ok) {
      throw new ProviderError(`Stanleybet family events feed returned HTTP ${response.status}`, {
        status: response.status,
      });
    }

    const body = await response.json();
    if (!Array.isArray(body?.data?.events) && !Array.isArray(body?.events)) {
      throw new ProviderError('Stanleybet family events feed did not include events data');
    }
    return body;
  }
}

function normalizeStanleybetFamilyPayload(payload, { bookmaker, fetchedAt, origin } = {}) {
  return eventList(payload)
    .map((event) => normalizeStanleybetFamilyEvent(event, { bookmaker, fetchedAt, origin }))
    .filter(Boolean)
    .sort((left, right) => new Date(left.startsAt) - new Date(right.startsAt));
}

function normalizeStanleybetFamilyEvent(event, { bookmaker, fetchedAt, origin } = {}) {
  if (
    !event ||
    Number(event.sportId) !== STANLEYBET_FOOTBALL_SPORT_ID ||
    Number(event.active) !== 1 ||
    !Array.isArray(event.markets)
  ) {
    return null;
  }

  const [homeTeam, awayTeam] = splitFixtureName(event.name);
  const startsAt = new Date(event.startsAt);
  const markets = normalizeStanleybetFamilyMarkets(event.markets);

  if (
    !event.id ||
    !homeTeam ||
    !awayTeam ||
    Number.isNaN(startsAt.getTime()) ||
    !hasAnyCompleteMarket(markets)
  ) {
    return null;
  }

  return {
    id: `${bookmakerKey(bookmaker)}:${event.id}`,
    externalIds: {
      nsoftEvent: String(event.id),
      ...(event.rootEventId ? { nsoftRootEvent: String(event.rootEventId) } : {}),
    },
    sport: 'Football',
    competition: event.tournamentName || event.categoryName || 'Stanleybet Football',
    startsAt: startsAt.toISOString(),
    homeTeam,
    awayTeam,
    bookmakers: [
      {
        name: bookmaker,
        lastUpdate: fetchedAt,
        ...bookmakerLinkFields(bookmaker, stanleybetFamilyEventUrl(origin, event)),
        markets,
      },
    ],
  };
}

function normalizeStanleybetFamilyMarkets(markets) {
  const normalized = {};
  for (const market of Array.isArray(markets) ? markets : []) {
    if (Number(market?.active) !== 1 || !Array.isArray(market.outcomes)) {
      continue;
    }

    const marketKey = genericMarketKey(market.name);
    if (marketKey === 'h2h') {
      const h2h = outcomePrices(market, {
        home: 'home',
        draw: 'draw',
        away: 'away',
      });
      if (hasOutcomes(h2h, ['home', 'draw', 'away'])) {
        normalized.h2h = h2h;
      }

      const doubleChance = outcomePrices(market, {
        homeDraw: 'homeDraw',
        homeAway: 'homeAway',
        drawAway: 'drawAway',
      });
      if (hasOutcomes(doubleChance, ['homeDraw', 'homeAway', 'drawAway'])) {
        normalized.doubleChance = doubleChance;
      }
      continue;
    }

    if (isTotalGoalsMarket(marketKey, market)) {
      addTotalGoalsMarket(normalized, market);
      continue;
    }

    if (isBothTeamsToScoreMarket(marketKey, market)) {
      const prices = outcomePrices(market, {
        yes: 'yes',
        no: 'no',
      });
      if (hasOutcomes(prices, ['yes', 'no'])) {
        normalized.bothTeamsToScore = prices;
      }
      continue;
    }

    const prices = genericOutcomePrices(market);
    if (hasAnyCompleteMarket({ [marketKey]: prices })) {
      normalized[marketKey] = prices;
    }
  }
  return normalized;
}

function addTotalGoalsMarket(markets, market) {
  const pricesByLine = new Map();
  for (const outcome of activeOutcomes(market)) {
    const line = parseLine(outcome.name || outcome.shortcut || market.name);
    const outcomeKey = normalizeOutcomeKey(outcome.name || outcome.shortcut);
    if (line === null || !['over', 'under'].includes(outcomeKey) || !isDecimalOdds(outcome.odd)) {
      continue;
    }

    const prices = pricesByLine.get(line) || {};
    prices[outcomeKey] = outcome.odd;
    pricesByLine.set(line, prices);
  }

  for (const [line, prices] of pricesByLine.entries()) {
    if (hasOutcomes(prices, ['over', 'under'])) {
      markets[`totalGoals_${formatLine(line).replace('.', '_')}`] = prices;
    }
  }
}

function outcomePrices(market, expectedKeys) {
  const prices = {};
  for (const outcome of activeOutcomes(market)) {
    const key = expectedKeys[normalizeOutcomeKey(outcome.name || outcome.shortcut)];
    if (key && isDecimalOdds(outcome.odd)) {
      prices[key] = outcome.odd;
    }
  }
  return prices;
}

function genericOutcomePrices(market) {
  const prices = {};
  for (const outcome of activeOutcomes(market)) {
    const key = normalizeOutcomeKey(outcome.name || outcome.shortcut);
    if (key && isDecimalOdds(outcome.odd)) {
      prices[key] = outcome.odd;
    }
  }
  return prices;
}

function activeOutcomes(market) {
  return (Array.isArray(market?.outcomes) ? market.outcomes : []).filter(
    (outcome) => Number(outcome?.active) === 1,
  );
}

function stanleybetFamilyRequestParams({
  companyUuid = STANLEYBET_FAMILY_COMPANY_UUID,
  language = 'ro',
  lookaheadDays = DEFAULT_LOOKAHEAD_DAYS,
  now = new Date(),
} = {}) {
  const start = now instanceof Date ? now : new Date(now);
  const end = new Date(start.getTime() + Math.max(1, Number(lookaheadDays) || 1) * 24 * 60 * 60 * 1000);
  const params = new URLSearchParams();
  params.set('companyUuid', companyUuid);
  params.set('filter[from]', formatBucharestDateTime(start));
  params.set('filter[to]', formatBucharestDateTime(end));
  params.set('timezone', 'Europe/Bucharest');
  params.set('language', JSON.stringify({
    default: language,
    tournament: language,
    category: language,
    sport: language,
  }));
  return params;
}

function formatBucharestDateTime(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      hour: '2-digit',
      hour12: false,
      minute: '2-digit',
      month: '2-digit',
      second: '2-digit',
      timeZone: 'Europe/Bucharest',
      year: 'numeric',
    })
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

function eventList(payload) {
  if (Array.isArray(payload?.data?.events)) {
    return payload.data.events;
  }
  return Array.isArray(payload?.events) ? payload.events : [];
}

function normalizeBrands(brands) {
  return (Array.isArray(brands) ? brands : [])
    .map((brand) => ({
      name: String(brand?.name || '').trim(),
      origin: String(brand?.origin || '').replace(/\/+$/g, ''),
    }))
    .filter((brand) => brand.name && brand.origin);
}

function stanleybetFamilyEventUrl(origin, event) {
  return event?.id ? absoluteEventUrl(`/pariu-sportiv/${event.id}`, origin) : null;
}

function isTotalGoalsMarket(marketKey, market) {
  if (['totalGoals', 'asianTotalGoals', 'firstHalfTotalGoals', 'secondHalfTotalGoals']
    .includes(marketKey)) {
    return true;
  }
  const key = labelKey(market?.name);
  return key.includes('total_goluri') &&
    !key.includes('par_impar') &&
    activeOutcomes(market).some((outcome) =>
      ['over', 'under'].includes(normalizeOutcomeKey(outcome.name || outcome.shortcut)),
    );
}

function isBothTeamsToScoreMarket(marketKey, market) {
  if (marketKey === 'bothTeamsToScore') {
    return true;
  }
  return ['ambele_inscriu', 'ambele_marcheaza'].includes(labelKey(market?.name));
}

function parseLine(value) {
  const match = String(value || '').match(/[+-]?\d+(?:[.,]\d+)?/);
  return match ? Number(match[0].replace(',', '.')) : null;
}

function hasOutcomes(prices, outcomes) {
  return outcomes.every((outcome) => isDecimalOdds(prices[outcome]));
}

function bookmakerKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'stanleybet-family';
}

function labelKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

module.exports = {
  STANLEYBET_FAMILY_BRANDS,
  STANLEYBET_FAMILY_COMPANY_UUID,
  STANLEYBET_FAMILY_EVENTS_URL,
  STANLEYBET_FOOTBALL_SPORT_ID,
  StanleybetFamilyProvider,
  normalizeStanleybetFamilyPayload,
  stanleybetFamilyRequestParams,
};
