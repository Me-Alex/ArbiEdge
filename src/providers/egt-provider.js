const { ProviderError } = require('./the-odds-api-provider');
const {
  formatLine,
  genericMarketKey,
  handicapMarketKey,
  hasAnyCompleteMarket,
  hasCompleteOutcomes,
  isDecimalOdds,
  normalizeOutcomeKey,
  splitFixtureName,
} = require('./market-utils');
const { bookmakerFootballUrl, bookmakerLinkFields, egtEventUrl } = require('./event-links');

const EGT_FOOTBALL_SPORT_ID = 1001;
const EGT_MARKET_TEMPLATES = Object.freeze({
  h2h: 100001,
  doubleChance: 100010,
  drawNoBet: 100011,
  totalGoals: 100018,
  asianHandicap: 100016,
  bothTeamsToScore: 100029,
});

class EgtProvider {
  constructor({
    name,
    apiBaseUrl,
    origin,
    fetchImpl = globalThis.fetch,
    timeoutMs = 8000,
    pageSize = 1000,
    marketCount = 64,
    lookaheadDays = 14,
    now = () => new Date(),
  } = {}) {
    if (!name || !apiBaseUrl || !origin) {
      throw new Error('EgtProvider requires name, apiBaseUrl, and origin');
    }

    this.name = name;
    this.apiBaseUrl = apiBaseUrl.replace(/\/+$/g, '');
    this.origin = origin.replace(/\/+$/g, '');
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.pageSize = pageSize;
    this.marketCount = marketCount;
    this.lookaheadDays = lookaheadDays;
    this.now = now;
  }

  async getOdds() {
    const sports = await this.fetchSports();
    const tournamentIds = footballTournamentIds(sports);
    if (tournamentIds.length === 0) {
      return [];
    }

    const payload = await this.fetchFootballEvents(tournamentIds);
    return normalizeEgtPayload(payload, {
      bookmaker: this.name,
      fetchedAt: this.now().toISOString(),
      origin: this.origin,
    });
  }

  async fetchSports() {
    return this.fetchJson(`${this.apiBaseUrl}/api/sportsapi/public/sports`);
  }

  async fetchFootballEvents(tournamentIds) {
    const query = new URLSearchParams({
      Page: '0',
      Size: String(this.pageSize),
      MarketCount: String(this.marketCount),
      ViewType: 'multi',
      ShouldHideEventResult: 'false',
      Days: String(this.lookaheadDays),
      Type: 'days',
    });
    return this.fetchJson(
      `${this.apiBaseUrl}/api/sportsapi/public/sport-events/v2/tournaments/events/${EGT_FOOTBALL_SPORT_ID}?${query}`,
      {
        method: 'POST',
        body: JSON.stringify(tournamentIds),
      },
    );
  }

  async fetchJson(url, options = {}) {
    let response;
    try {
      response = await this.fetchImpl(url, {
        method: options.method || 'GET',
        headers: this.headers(),
        body: options.body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new ProviderError(`Unable to reach ${this.name}: ${error.message}`, {
        cause: error,
      });
    }

    if (!response.ok) {
      throw new ProviderError(`${this.name} returned HTTP ${response.status}`, {
        status: response.status,
      });
    }

    try {
      return await response.json();
    } catch (error) {
      throw new ProviderError(`${this.name} returned invalid JSON`, {
        cause: error,
      });
    }
  }

  headers() {
    return {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-platform-device': 'ONLINE',
      'x-platform-lang': 'ro',
      'x-platform-origin': this.origin,
      'x-platform-timezone': 'Europe/Bucharest',
    };
  }
}

function normalizeEgtPayload(payload, { bookmaker, fetchedAt, origin } = {}) {
  const events = payload?.events && typeof payload.events === 'object'
    ? Object.values(payload.events)
    : [];
  return events
    .map((event) => normalizeEgtEvent(event, { bookmaker, fetchedAt, origin }))
    .filter(Boolean)
    .sort((left, right) => new Date(left.startsAt) - new Date(right.startsAt));
}

function normalizeEgtEvent(event, { bookmaker, fetchedAt, origin } = {}) {
  if (
    !event ||
    Number(event.sportId) !== EGT_FOOTBALL_SPORT_ID ||
    event.sportEventType !== 'match' ||
    event.hasActiveMarkets === false ||
    event.isProducerDown === true
  ) {
    return null;
  }

  const { homeTeam, awayTeam } = egtTeamNames(event);
  const startsAt = new Date(event.startTime || event.scheduledTime || event.date);
  const markets = normalizeEgtMarkets(event.markets);
  const eventId = event.sportEventId || event.eventId;

  if (
    !eventId ||
    !homeTeam ||
    !awayTeam ||
    Number.isNaN(startsAt.getTime()) ||
    !hasAnyCompleteMarket(markets)
  ) {
    return null;
  }

  return {
    id: `${slugBookmaker(bookmaker)}:${eventId}`,
    externalIds: {
      egtEvent: String(eventId),
      ...(event.radarMatchId ? { sportradar: String(event.radarMatchId) } : {}),
    },
    sport: 'Football',
    competition: stringValue(event.tournamentName) || `${bookmaker} Football`,
    startsAt: startsAt.toISOString(),
    homeTeam,
    awayTeam,
    bookmakers: [
      {
        name: bookmaker,
        lastUpdate: fetchedAt,
        ...bookmakerLinkFields(
          bookmaker,
          egtEventUrl(origin, event),
          bookmakerFootballUrl(bookmaker) || `${origin}/sports`,
        ),
        markets,
      },
    ],
  };
}

function normalizeEgtMarkets(markets) {
  const normalized = {};
  for (const market of Array.isArray(markets) ? markets : []) {
    if (!isActiveMarket(market)) {
      continue;
    }

    if (Number(market.marketTemplateId) === EGT_MARKET_TEMPLATES.h2h) {
      const prices = egtPrices(market, {
        '1': 'home',
        X: 'draw',
        '2': 'away',
      });
      if (hasOutcomes(prices, ['home', 'draw', 'away'])) {
        normalized.h2h = prices;
      }
      continue;
    }

    if (Number(market.marketTemplateId) === EGT_MARKET_TEMPLATES.doubleChance) {
      const prices = egtPrices(market, {
        '1X': 'homeDraw',
        '12': 'homeAway',
        X2: 'drawAway',
      });
      if (hasOutcomes(prices, ['homeDraw', 'homeAway', 'drawAway'])) {
        normalized.doubleChance = prices;
      }
      continue;
    }

    if (Number(market.marketTemplateId) === EGT_MARKET_TEMPLATES.drawNoBet) {
      const prices = egtPrices(market, {
        '1': 'home',
        '2': 'away',
      });
      if (hasOutcomes(prices, ['home', 'away'])) {
        normalized.drawNoBet = prices;
      }
      continue;
    }

    if (Number(market.marketTemplateId) === EGT_MARKET_TEMPLATES.totalGoals) {
      addEgtTotalGoals(normalized, market);
      continue;
    }

    if (Number(market.marketTemplateId) === EGT_MARKET_TEMPLATES.asianHandicap) {
      addEgtAsianHandicap(normalized, market);
      continue;
    }

    if (Number(market.marketTemplateId) === EGT_MARKET_TEMPLATES.bothTeamsToScore) {
      const prices = egtPrices(market, {
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

    // Label-based routing when template ids differ by brand or feed version.
    const label = normalizeEgtLabel(egtMarketLabel(market));
    if (routeEgtLabelMarket(normalized, market, label)) {
      continue;
    }

    addGenericEgtMarket(normalized, market);
  }
  return normalized;
}

function normalizeEgtLabel(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}+\-.]+/gu, ' ')
    .trim();
}

function routeEgtLabelMarket(normalized, market, label) {
  if (!label) return false;

  if (
    label === 'pauza'
    || label === 'prima repriza'
    || label === '1st half'
    || label === 'rezultat pauza'
    || label === 'half time'
  ) {
    const prices = egtPrices(market, { '1': 'home', X: 'draw', '2': 'away' });
    if (hasOutcomes(prices, ['home', 'draw', 'away']) && !normalized.firstHalfH2h) {
      normalized.firstHalfH2h = prices;
      return true;
    }
  }

  if (
    label === 'a doua repriza'
    || label === '2nd half'
    || label === 'rezultat a doua repriza'
    || label === 'second half'
  ) {
    const prices = egtPrices(market, { '1': 'home', X: 'draw', '2': 'away' });
    if (hasOutcomes(prices, ['home', 'draw', 'away']) && !normalized.secondHalfH2h) {
      normalized.secondHalfH2h = prices;
      return true;
    }
  }

  if (label.includes('sansa dubla') || label.includes('double chance')) {
    const prices = egtPrices(market, {
      '1X': 'homeDraw',
      '12': 'homeAway',
      X2: 'drawAway',
    });
    const key = (label.includes('pauza') || label.includes('prima'))
      ? 'firstHalfDoubleChance'
      : (label.includes('a doua') || label.includes('2nd'))
        ? 'secondHalfDoubleChance'
        : 'doubleChance';
    if (hasOutcomes(prices, ['homeDraw', 'homeAway', 'drawAway']) && !normalized[key]) {
      normalized[key] = prices;
      return true;
    }
  }

  if (
    label.includes('ambele marcheaza')
    || label.includes('ambele echipe marcheaza')
    || label.includes('both teams to score')
    || label === 'gg ng'
  ) {
    const prices = egtPrices(market, {
      Da: 'yes', Nu: 'no', Yes: 'yes', No: 'no',
    });
    const key = (label.includes('pauza') || label.includes('prima'))
      ? 'firstHalfBothTeamsToScore'
      : (label.includes('a doua') || label.includes('2nd'))
        ? 'secondHalfBothTeamsToScore'
        : 'bothTeamsToScore';
    if (hasOutcomes(prices, ['yes', 'no']) && !normalized[key]) {
      normalized[key] = prices;
      return true;
    }
  }

  if (label.includes('fara egal') || label.includes('draw no bet') || label.includes('egal pariu')) {
    const prices = egtPrices(market, { '1': 'home', '2': 'away' });
    const dnbKey = (label.includes('pauza') || label.includes('prima') || label.includes('1st'))
      ? 'firstHalfDrawNoBet'
      : (label.includes('a doua') || label.includes('2nd') || label.includes('second'))
        ? 'secondHalfDrawNoBet'
        : 'drawNoBet';
    if (hasOutcomes(prices, ['home', 'away']) && !normalized[dnbKey]) {
      normalized[dnbKey] = prices;
      return true;
    }
  }

  if ((label.includes('par') && label.includes('impar')) || label.includes('odd even')) {
    const prices = egtPrices(market, {
      Par: 'even', Impar: 'odd', Even: 'even', Odd: 'odd',
      par: 'even', impar: 'odd',
    });
    // egtPrices uses exact column names — also try normalizeOutcomeKey path via generic
    const viaGeneric = {};
    for (const outcome of activeOutcomes(market)) {
      const key = normalizeOutcomeKey(outcome.columnName || outcome.name || outcome.shortName);
      if ((key === 'odd' || key === 'even') && isDecimalOdds(outcome.odds)) {
        viaGeneric[key] = outcome.odds;
      }
    }
    const oddEven = hasOutcomes(prices, ['odd', 'even']) ? prices : viaGeneric;
    if (hasOutcomes(oddEven, ['odd', 'even']) && !normalized.market_total_goluri_impar_par) {
      normalized.market_total_goluri_impar_par = oddEven;
      return true;
    }
  }

  if (
    label.includes('total goluri')
    && (label.includes('pauza') || label.includes('prima'))
  ) {
    addEgtLineMarket(normalized, market, 'firstHalfTotalGoals');
    return Boolean(Object.keys(normalized).some((k) => k.startsWith('firstHalfTotalGoals_')));
  }

  if (
    label.includes('total goluri')
    && (label.includes('a doua') || label.includes('2nd'))
  ) {
    addEgtLineMarket(normalized, market, 'secondHalfTotalGoals');
    return Boolean(Object.keys(normalized).some((k) => k.startsWith('secondHalfTotalGoals_')));
  }

  if (label.includes('total cornere') || label.includes('total corners')) {
    addEgtLineMarket(normalized, market, 'totalCorners');
    return Boolean(Object.keys(normalized).some((k) => k.startsWith('totalCorners_')));
  }

  if (label.includes('total cartonase') || label.includes('total cards') || label.includes('yellow card')) {
    addEgtLineMarket(normalized, market, 'totalCards');
    return Boolean(Object.keys(normalized).some((k) => k.startsWith('totalCards_')));
  }

  return false;
}

function addEgtLineMarket(markets, market, baseKey) {
  const line = lineValue(market);
  if (!line) return;
  const prices = {};
  for (const outcome of activeOutcomes(market)) {
    const key = normalizeOutcomeKey(outcome.columnName || outcome.name || outcome.shortName);
    if (['over', 'under'].includes(key) && isDecimalOdds(outcome.odds)) {
      prices[key] = outcome.odds;
    }
  }
  if (hasOutcomes(prices, ['over', 'under'])) {
    markets[`${baseKey}_${formatLine(line).replace('.', '_')}`] = prices;
  }
}

function addEgtTotalGoals(markets, market) {
  const line = lineValue(market);
  if (!line) {
    return;
  }

  const prices = {};
  for (const outcome of activeOutcomes(market)) {
    const key = normalizeOutcomeKey(outcome.columnName || outcome.name || outcome.shortName);
    if (['over', 'under'].includes(key) && isDecimalOdds(outcome.odds)) {
      prices[key] = outcome.odds;
    }
  }

  if (hasOutcomes(prices, ['over', 'under'])) {
    markets[`totalGoals_${formatLine(line).replace('.', '_')}`] = prices;
  }
}

function addEgtAsianHandicap(markets, market) {
  const prices = {};
  let homeLine = null;
  for (const outcome of activeOutcomes(market)) {
    const key = normalizeOutcomeKey(outcome.columnName || outcome.name);
    if (key === 'home' && isDecimalOdds(outcome.odds)) {
      prices.home = outcome.odds;
      homeLine = parseLine(outcome.specifier || outcome.shortName || outcome.name);
    }
    if (key === 'away' && isDecimalOdds(outcome.odds)) {
      prices.away = outcome.odds;
    }
  }

  if (homeLine !== null && hasOutcomes(prices, ['home', 'away'])) {
    markets[handicapMarketKey('asianHandicap', homeLine)] = prices;
  }
}

function addGenericEgtMarket(markets, market) {
  const label = egtMarketLabel(market);
  const grouped = new Map();
  const unlinedPrices = {};

  for (const outcome of activeOutcomes(market)) {
    const outcomeKey = normalizeOutcomeKey(outcome.columnName || outcome.name || outcome.shortName);
    if (!outcomeKey || !isDecimalOdds(outcome.odds)) {
      continue;
    }

    const line = egtOutcomeLine(market, outcome);
    if (Number.isFinite(line)) {
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

function egtMarketLabel(market) {
  return stringValue(
    market.marketName ||
      market.name ||
      market.marketTemplateName ||
      market.templateName ||
      market.displayName ||
      market.marketTemplateId,
  );
}

function egtOutcomeLine(market, outcome) {
  return parseLine(
    outcome.specifier ||
      outcome.argument ||
      market.marketSpecifier ||
      outcome.shortName,
  );
}

function egtPrices(market, outcomeMap) {
  const prices = {};
  for (const outcome of activeOutcomes(market)) {
    const key = outcomeMap[stringValue(outcome.columnName || outcome.name || outcome.shortName)];
    if (key && isDecimalOdds(outcome.odds)) {
      prices[key] = outcome.odds;
    }
  }
  return prices;
}

function activeOutcomes(market) {
  return (Array.isArray(market?.outcomes) ? market.outcomes : []).filter(
    (outcome) => outcome?.isActive !== false,
  );
}

function isActiveMarket(market) {
  return market?.marketStatus === 'Active' && Array.isArray(market.outcomes);
}

function footballTournamentIds(sports) {
  const football = Array.isArray(sports)
    ? sports.find((sport) => Number(sport.id || sport.sportId) === EGT_FOOTBALL_SPORT_ID)
    : null;
  const ids = [];
  collectFootballTournamentIds(football, ids);
  return [...new Set(ids)];
}

function collectFootballTournamentIds(node, ids) {
  if (!node || typeof node !== 'object') {
    return;
  }

  const before = ids.length;
  for (const child of egtNodeChildren(node)) {
    collectFootballTournamentIds(child, ids);
  }
  if (ids.length > before) {
    return;
  }

  const eventsCount = Number(
    node.eventsCount ?? node.eventCount ?? node.sportEventsCount ?? node.events?.length ?? 0,
  );
  const id = node.id ?? node.tournamentId ?? node.leagueId;
  if (id && eventsCount > 0) {
    ids.push(id);
  }
}

function egtNodeChildren(node) {
  return [
    node.data,
    node.children,
    node.items,
    node.tournaments,
    node.leagues,
    node.regions,
    node.categories,
  ].flatMap((value) => (Array.isArray(value) ? value : []));
}

function lineValue(market) {
  return parseLine(market?.marketSpecifier || market?.outcomes?.[0]?.specifier);
}

function egtTeamNames(event) {
  const directHome = stringValue(
    event.homeTeam ||
      event.homeTeamName ||
      event.competitor1Name ||
      event.team1Name ||
      event.homeCompetitorName,
  );
  const directAway = stringValue(
    event.awayTeam ||
      event.awayTeamName ||
      event.competitor2Name ||
      event.team2Name ||
      event.awayCompetitorName,
  );
  if (directHome && directAway) {
    return { homeTeam: directHome, awayTeam: directAway };
  }

  const parsed = parseFixtureTeams(
    event.eventTitle || event.eventName || event.name || event.eventPath || event.path,
  );
  return {
    homeTeam: directHome || parsed.homeTeam,
    awayTeam: directAway || parsed.awayTeam,
  };
}

function parseFixtureTeams(value) {
  const parts = splitFixtureName(value);
  if (parts.length !== 2) {
    return { homeTeam: '', awayTeam: '' };
  }
  return { homeTeam: parts[0], awayTeam: parts[1] };
}

function parseLine(value) {
  const match = String(value || '').match(/[+-]?\d+(?:[.,]\d+)?/);
  return match ? Number(match[0].replace(',', '.')) : null;
}

function hasOutcomes(prices, outcomes) {
  return outcomes.every((outcome) => isDecimalOdds(prices[outcome]));
}

function stringValue(value) {
  return String(value || '').trim();
}

function slugBookmaker(bookmaker) {
  return String(bookmaker)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

module.exports = {
  EGT_FOOTBALL_SPORT_ID,
  EGT_MARKET_TEMPLATES,
  EgtProvider,
  footballTournamentIds,
  normalizeEgtPayload,
};
