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
const DEFAULT_BETONE_MAX_DETAIL_EVENTS = 220;
const DEFAULT_BETONE_DETAILS_CONCURRENCY = 10;
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

    // Label routing when market ids differ by feed version.
    const label = normalizeBetOneLabel(market.marketName || market.name || market.displayName);
    if (routeBetOneLabelMarket(normalized, market, label, { homeTeam, awayTeam })) {
      continue;
    }

    addGenericBetOneMarket(normalized, market, { homeTeam, awayTeam });
  }
  return normalized;
}

function normalizeBetOneLabel(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}+\-.]+/gu, ' ')
    .trim();
}

function routeBetOneLabelMarket(normalized, market, label, { homeTeam, awayTeam } = {}) {
  if (!label) return false;

  if (
    label === 'a doua repriza'
    || label === '2nd half'
    || label === 'rezultat a doua repriza'
    || label === 'second half'
  ) {
    addOutcomeMarket(normalized, 'secondHalfH2h', market, {
      '1': 'home', X: 'draw', '2': 'away',
    }, ['home', 'draw', 'away']);
    return Boolean(normalized.secondHalfH2h);
  }

  if (label.includes('sansa dubla') || label.includes('double chance')) {
    const key = (label.includes('pauza') || label.includes('prima'))
      ? 'firstHalfDoubleChance'
      : (label.includes('a doua') || label.includes('2nd'))
        ? 'secondHalfDoubleChance'
        : 'doubleChance';
    addOutcomeMarket(normalized, key, market, {
      '1X': 'homeDraw', '12': 'homeAway', X2: 'drawAway',
    }, ['homeDraw', 'homeAway', 'drawAway']);
    return Boolean(normalized[key]);
  }

  if (
    label.includes('ambele marcheaza')
    || label.includes('ambele echipe marcheaza')
    || label.includes('both teams to score')
    || label === 'gg ng'
  ) {
    const key = (label.includes('pauza') || label.includes('prima'))
      ? 'firstHalfBothTeamsToScore'
      : (label.includes('a doua') || label.includes('2nd'))
        ? 'secondHalfBothTeamsToScore'
        : 'bothTeamsToScore';
    addOutcomeMarket(normalized, key, market, {
      GG: 'yes', Da: 'yes', Yes: 'yes', NG: 'no', Nu: 'no', No: 'no',
    }, ['yes', 'no']);
    return Boolean(normalized[key]);
  }

  if ((label.includes('par') && label.includes('impar')) || label.includes('odd even')) {
    addOutcomeMarket(normalized, 'market_total_goluri_impar_par', market, {
      Par: 'even', Impar: 'odd', Even: 'even', Odd: 'odd',
      par: 'even', impar: 'odd',
    }, ['odd', 'even']);
    return Boolean(normalized.market_total_goluri_impar_par);
  }

  if (
    label.includes('total goluri')
    && (label.includes('a doua') || label.includes('2nd'))
  ) {
    addPlusRangeTotals(normalized, market, 'secondHalfTotalGoals');
    addLineMarkets(normalized, market, 'secondHalfTotalGoals');
    return Object.keys(normalized).some((k) => k.startsWith('secondHalfTotalGoals_'));
  }

  if (label.includes('total cartonase') || label.includes('total cards') || label.includes('yellow')) {
    addLineMarkets(normalized, market, 'totalCards');
    return Object.keys(normalized).some((k) => k.startsWith('totalCards_'));
  }

  if (
    label.includes('total goluri asiatice')
    || label.includes('asian total goals')
  ) {
    const base = (label.includes('pauza') || label.includes('prima'))
      ? 'firstHalfAsianTotalGoals'
      : (label.includes('a doua') || label.includes('2nd'))
        ? 'secondHalfAsianTotalGoals'
        : 'asianTotalGoals';
    addLineMarkets(normalized, market, base);
    return Object.keys(normalized).some((k) => k.startsWith(base));
  }

  if (label.includes('handicap asiatic') || label.includes('asian handicap')) {
    addHandicapMarkets(normalized, market, 'asianHandicap');
    return Object.keys(normalized).some((k) => k.startsWith('asianHandicap'));
  }

  if (label.includes('cornere asiatice') || label.includes('asian corner')) {
    addLineMarkets(normalized, market, 'asianTotalCorners');
    return Object.keys(normalized).some((k) => k.startsWith('asianTotalCorners_'));
  }

  if (
    label.includes('fara egal')
    || label.includes('draw no bet')
    || label.includes('egal pariu')
  ) {
    const dnbKey = (label.includes('pauza') || label.includes('prima') || label.includes('1st'))
      ? 'firstHalfDrawNoBet'
      : (label.includes('a doua') || label.includes('2nd') || label.includes('second'))
        ? 'secondHalfDrawNoBet'
        : 'drawNoBet';
    addOutcomeMarket(normalized, dnbKey, market, {
      '1': 'home',
      '2': 'away',
    }, ['home', 'away']);
    return Boolean(normalized[dnbKey]);
  }

  if (
    label.includes('fara gol primit')
    || label.includes('clean sheet')
    || label.includes('nu primeste gol')
  ) {
    const side = (label.includes('gazda') || label.includes('gazde') || label.includes('home'))
      ? 'home'
      : (label.includes('oaspete') || label.includes('oaspeti') || label.includes('away'))
        ? 'away'
        : null;
    if (side) {
      const key = `market_clean_sheet_${side}`;
      addOutcomeMarket(normalized, key, market, {
        Da: 'yes', Yes: 'yes', Nu: 'no', No: 'no',
      }, ['yes', 'no']);
      return Boolean(normalized[key]);
    }
  }

  if (
    label.includes('total goluri')
    && (label.includes('gazde') || label.includes('home') || label.includes('echipa 1'))
  ) {
    addLineMarkets(normalized, market, 'market_total_goluri_home');
    return Object.keys(normalized).some((k) => k.startsWith('market_total_goluri_home_'));
  }

  if (
    label.includes('total goluri')
    && (label.includes('oaspeti') || label.includes('away') || label.includes('echipa 2'))
  ) {
    addLineMarkets(normalized, market, 'market_total_goluri_away');
    return Object.keys(normalized).some((k) => k.startsWith('market_total_goluri_away_'));
  }

  if (
    label.includes('marcheaza')
    && (label.includes('gazde') || label.includes('gazda') || label.includes('home'))
  ) {
    addOutcomeMarket(normalized, 'market_marcheaza_home', market, {
      Da: 'yes', Yes: 'yes', Nu: 'no', No: 'no',
    }, ['yes', 'no']);
    return Boolean(normalized.market_marcheaza_home);
  }

  if (
    label.includes('marcheaza')
    && (label.includes('oaspeti') || label.includes('oaspete') || label.includes('away'))
  ) {
    addOutcomeMarket(normalized, 'market_marcheaza_away', market, {
      Da: 'yes', Yes: 'yes', Nu: 'no', No: 'no',
    }, ['yes', 'no']);
    return Boolean(normalized.market_marcheaza_away);
  }

  if (label.includes('se califica') || label.includes('to qualify') || label.includes('merge mai departe')) {
    addOutcomeMarket(normalized, 'toQualify', market, {
      '1': 'home', '2': 'away',
    }, ['home', 'away']);
    // Team-name outcomes via generic if 1/2 missing.
    if (!normalized.toQualify) {
      addGenericBetOneMarket(normalized, { ...market, marketName: 'toQualify' }, { homeTeam, awayTeam });
    }
    return Boolean(normalized.toQualify);
  }

  return false;
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
