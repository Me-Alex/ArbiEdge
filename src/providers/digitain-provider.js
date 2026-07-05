const { ProviderError } = require('./the-odds-api-provider');
const {
  formatLine,
  genericMarketKey,
  hasAnyCompleteMarket,
  hasCompleteOutcomes,
  isDecimalOdds,
  isMatchDoubleChanceLabel,
  normalizeOutcomeKey,
} = require('./market-utils');
const { bookmakerFootballUrl, bookmakerLinkFields, digitainEventUrl } = require('./event-links');

const DIGITAIN_FOOTBALL_SPORT_ID = '1';

class DigitainProvider {
  constructor({
    name,
    eventsUrl,
    origin,
    fetchImpl = globalThis.fetch,
    timeoutMs = 8000,
    detailBatchSize = 5,
    detailConcurrency = 4,
    lookaheadDays = 8,
    windowDays = lookaheadDays,
    windowConcurrency = 3,
    now = () => new Date(),
  } = {}) {
    if (!name || !eventsUrl) {
      throw new Error('DigitainProvider requires a name and eventsUrl');
    }

    this.name = name;
    this.eventsUrl = eventsUrl;
    this.origin = origin;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.detailBatchSize = detailBatchSize;
    this.detailConcurrency = detailConcurrency;
    this.lookaheadDays = lookaheadDays;
    this.windowDays = windowDays;
    this.windowConcurrency = windowConcurrency;
    this.now = now;
  }

  async getOdds() {
    const start = this.now();
    const enrichedPayload = await this.fetchFootballPayload(start);

    return normalizeDigitainPayload(enrichedPayload, {
      bookmaker: this.name,
      fetchedAt: start.toISOString(),
      origin: this.origin,
    });
  }

  async fetchFootballPayload(start = this.now()) {
    const headers = this.buildHeaders();
    const payloads = await mapWithConcurrency(
      digitainTimeWindows(start, this.lookaheadDays, this.windowDays),
      this.windowConcurrency,
      ({ from, to }) => this.fetchEvents(
        {
          timeFrom: formatUtcSecond(from),
          timeTo: formatUtcSecond(to),
          sportId: DIGITAIN_FOOTBALL_SPORT_ID,
          firstCall: true,
        },
        headers,
      ),
    );
    const payload = mergeDigitainPayloads(payloads);

    return enrichDigitainPayload(payload, {
      detailBatchSize: this.detailBatchSize,
      detailConcurrency: this.detailConcurrency,
      fetchDetails: (ids) => this.fetchEvents({ ids }, headers),
    });
  }

  buildHeaders() {
    const headers = {
      accept: 'application/json',
      'content-type': 'application/json',
    };

    if (this.origin) {
      headers.origin = this.origin;
      headers.referer = `${this.origin}/`;
    }

    return headers;
  }

  async fetchEvents(body, headers) {
    const response = await this.fetchImpl(this.eventsUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    }).catch((error) => {
      throw new ProviderError(`Unable to reach ${this.name}: ${error.message}`, {
        cause: error,
      });
    });

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
}

function digitainTimeWindows(start, lookaheadDays, windowDays) {
  const totalDays = Math.max(1, Number(lookaheadDays) || 1);
  const stepDays = Math.max(1, Number(windowDays) || totalDays);
  const end = new Date(start.getTime() + totalDays * 24 * 60 * 60 * 1000);
  const windows = [];
  let from = new Date(start);
  while (from < end) {
    const to = new Date(Math.min(
      end.getTime(),
      from.getTime() + stepDays * 24 * 60 * 60 * 1000,
    ));
    windows.push({ from, to });
    from = to;
  }
  return windows;
}

function mergeDigitainPayloads(payloads) {
  const validPayloads = (Array.isArray(payloads) ? payloads : []).filter(Boolean);
  const first = validPayloads.find((payload) => payload?.data) || {};
  const data = first.data || {};
  const eventsById = new Map();
  const eventsWithoutId = [];

  for (const payload of validPayloads) {
    for (const event of Array.isArray(payload?.data?.events) ? payload.data.events : []) {
      if (!event?.idMatch) {
        eventsWithoutId.push(event);
        continue;
      }
      const id = String(event.idMatch);
      eventsById.set(id, richerDigitainEvent(eventsById.get(id), event));
    }
  }

  const events = [...eventsById.values(), ...eventsWithoutId].sort(
    (left, right) => Number(left.matchDateTime || 0) - Number(right.matchDateTime || 0),
  );

  return {
    ...first,
    data: {
      ...data,
      events,
    },
  };
}

function richerDigitainEvent(current, candidate) {
  if (!current) {
    return candidate;
  }
  return digitainMarketCount(candidate) > digitainMarketCount(current) ? candidate : current;
}

function digitainMarketCount(event) {
  return Array.isArray(event?.matchBets) ? event.matchBets.length : 0;
}

function normalizeDigitainPayload(payload, { bookmaker, fetchedAt, origin } = {}) {
  const events = Array.isArray(payload?.data?.events) ? payload.data.events : [];
  return events
    .map((event) => normalizeDigitainEvent(event, { bookmaker, fetchedAt, origin }))
    .filter(Boolean)
    .sort((left, right) => new Date(left.startsAt) - new Date(right.startsAt));
}

function normalizeDigitainEvent(event, { bookmaker, fetchedAt, origin }) {
  if (
    !event ||
    String(event.idSport) !== DIGITAIN_FOOTBALL_SPORT_ID ||
    event.active !== true ||
    event.bettingStatus !== true
  ) {
    return null;
  }

  const homeTeam = localizedText(event.team1Name);
  const awayTeam = localizedText(event.team2Name);
  const startsAt = new Date(event.matchDateTime);
  const markets = normalizeDigitainMarkets(event.matchBets, { homeTeam, awayTeam });

  if (
    !event.idMatch ||
    !homeTeam ||
    !awayTeam ||
    Number.isNaN(startsAt.getTime()) ||
    !hasAnyCompleteMarket(markets)
  ) {
    return null;
  }

  return {
    id: `${slugBookmaker(bookmaker)}:${event.idMatch}`,
    externalIds: extractDigitainExternalIds(event),
    sport: 'Football',
    competition:
      localizedText(event.tournamentName) ||
      localizedText(event.categoryName) ||
      `${bookmaker} Football`,
    startsAt: startsAt.toISOString(),
    homeTeam,
    awayTeam,
    bookmakers: [
      {
        name: bookmaker,
        lastUpdate: fetchedAt,
        ...bookmakerLinkFields(
          bookmaker,
          digitainEventUrl(origin, event),
          bookmakerFootballUrl(bookmaker) || origin,
        ),
        markets,
      },
    ],
  };
}

function extractDigitainExternalIds(event) {
  const ids = {};

  if (event?.idMatch) {
    ids.digitainMatch = String(event.idMatch);
  }

  return ids;
}

async function enrichDigitainPayload(payload, { detailBatchSize, detailConcurrency, fetchDetails }) {
  const events = Array.isArray(payload?.data?.events) ? payload.data.events : [];
  const ids = events
    .filter(shouldFetchDigitainDetails)
    .map((event) => String(event.idMatch));
  if (ids.length === 0) {
    return payload;
  }

  const detailedEvents = [];
  await mapWithConcurrency(chunk(ids, detailBatchSize), detailConcurrency, async (batch) => {
    try {
      const detailPayload = await fetchDetails(batch);
      for (const event of detailPayload?.data?.events || []) {
        detailedEvents.push(event);
      }
    } catch {
      // Keep the lightweight list event if a detail batch is temporarily unavailable.
    }
  });

  if (detailedEvents.length === 0) {
    return payload;
  }

  const detailsById = new Map(
    detailedEvents
      .filter((event) => event?.idMatch)
      .map((event) => [String(event.idMatch), event]),
  );

  return {
    ...payload,
    data: {
      ...payload.data,
      events: events.map((event) => detailsById.get(String(event.idMatch)) || event),
    },
  };
}

function shouldFetchDigitainDetails(event) {
  if (
    !event?.idMatch ||
    String(event.idSport) !== DIGITAIN_FOOTBALL_SPORT_ID ||
    event.active !== true ||
    event.bettingStatus !== true
  ) {
    return false;
  }

  const listedMarkets = Array.isArray(event.matchBets) ? event.matchBets.length : 0;
  const availableMarkets = Number(event.marketCount);
  return Number.isFinite(availableMarkets) && availableMarkets > listedMarkets;
}

function normalizeDigitainMarkets(matchBets, { homeTeam, awayTeam } = {}) {
  const markets = {};

  for (const market of Array.isArray(matchBets) ? matchBets : []) {
    if (!market || market.mbActive === false) {
      continue;
    }

    if (isFinalMarket(market)) {
      const prices = digitainPrices(market, {
        '1': 'home',
        X: 'draw',
        '2': 'away',
      });
      if (hasOutcomes(prices, ['home', 'draw', 'away'])) {
        markets.h2h = prices;
      }
      continue;
    }

    if (String(market.idBet) === '37' || isMatchDoubleChanceLabel(localizedText(market.mbDisplayName))) {
      const prices = digitainPrices(market, {
        '1X': 'homeDraw',
        '12': 'homeAway',
        X2: 'drawAway',
      });
      if (hasOutcomes(prices, ['homeDraw', 'homeAway', 'drawAway'])) {
        markets.doubleChance = prices;
      }
      continue;
    }

    const marketName = localizedText(market.mbDisplayName).toLowerCase();
    if (String(market.idBet) === '3' || ['total goluri', 'total goals'].includes(marketName)) {
      addDigitainLineMarkets(markets, market, 'totalGoals');
      continue;
    }

    if (String(market.idBet) === '105' || ['total cornere', 'total corners'].includes(marketName)) {
      addDigitainLineMarkets(markets, market, 'totalCorners');
      continue;
    }

    if (isStandardBothTeamsToScoreMarket(market)) {
      const prices = digitainPrices(market, {
        Da: 'yes',
        Nu: 'no',
        Yes: 'yes',
        No: 'no',
      });
      if (!markets.bothTeamsToScore && hasOutcomes(prices, ['yes', 'no'])) {
        markets.bothTeamsToScore = prices;
      }
      continue;
    }

    addGenericDigitainMarket(markets, market, { homeTeam, awayTeam });
  }

  return markets;
}

function addDigitainLineMarkets(markets, market, baseKey) {
  const grouped = new Map();
  for (const outcome of Array.isArray(market.mbOutcomes) ? market.mbOutcomes : []) {
    if (outcome?.mboActive === false || !Number.isFinite(outcome.argument)) {
      continue;
    }
    const line = formatLine(outcome.argument);
    if (!grouped.has(line)) {
      grouped.set(line, {});
    }
    const key = normalizeOverUnder(localizedText(outcome.mboType || outcome.mboDisplayName));
    const odd = isDecimalOdds(outcome.mboOddValue) ? outcome.mboOddValue : outcome.bValue;
    if (key && isDecimalOdds(odd)) {
      grouped.get(line)[key] = odd;
    }
  }

  for (const [line, prices] of grouped) {
    if (hasOutcomes(prices, ['over', 'under'])) {
      markets[`${baseKey}_${line.replace('.', '_')}`] = prices;
    }
  }
}

function addGenericDigitainMarket(markets, market, { homeTeam, awayTeam } = {}) {
  const label = abstractTeamNames(
    localizedText(market.mbDisplayName) ||
      localizedText(market.betName) ||
      String(market.idBet || ''),
    { homeTeam, awayTeam },
  );
  const outcomes = Array.isArray(market.mbOutcomes) ? market.mbOutcomes : [];
  const lineGroups = new Map();

  for (const outcome of outcomes) {
    if (outcome?.mboActive === false) {
      continue;
    }

    const odd = isDecimalOdds(outcome.mboOddValue) ? outcome.mboOddValue : outcome.bValue;
    const outcomeKey = normalizeOutcomeKey(
      localizedText(outcome.mboType || outcome.mboDisplayName),
    );
    if (!outcomeKey || !isDecimalOdds(odd)) {
      continue;
    }

    const line = Number.isFinite(outcome.argument) ? formatLine(outcome.argument) : null;
    if (line) {
      if (!lineGroups.has(line)) {
        lineGroups.set(line, {});
      }
      lineGroups.get(line)[outcomeKey] = odd;
    }
  }

  for (const [line, prices] of lineGroups) {
    const key = genericMarketKey(label, { line });
    if (key && !markets[key] && hasCompleteOutcomes(prices)) {
      markets[key] = prices;
    }
  }

  if (lineGroups.size > 0) {
    return;
  }

  const prices = {};
  for (const outcome of outcomes) {
    if (outcome?.mboActive === false) {
      continue;
    }
    const odd = isDecimalOdds(outcome.mboOddValue) ? outcome.mboOddValue : outcome.bValue;
    const outcomeKey = normalizeOutcomeKey(
      localizedText(outcome.mboType || outcome.mboDisplayName),
    );
    if (outcomeKey && isDecimalOdds(odd)) {
      prices[outcomeKey] = odd;
    }
  }

  const key = genericMarketKey(label);
  if (key && !markets[key] && hasCompleteOutcomes(prices)) {
    markets[key] = prices;
  }
}

function digitainPrices(market, outcomeMap) {
  const prices = {};
  for (const outcome of Array.isArray(market?.mbOutcomes) ? market.mbOutcomes : []) {
    if (outcome?.mboActive === false) {
      continue;
    }
    const source = localizedText(outcome.mboType || outcome.mboDisplayName);
    const key = outcomeMap[source];
    const odd = isDecimalOdds(outcome.mboOddValue) ? outcome.mboOddValue : outcome.bValue;
    if (key && isDecimalOdds(odd)) {
      prices[key] = odd;
    }
  }
  return prices;
}

function isFinalMarket(market) {
  if (!market || market.mbActive === false) {
    return false;
  }

  const names = [
    market.idBet,
    localizedText(market.mbDisplayName),
    localizedText(market.betName),
  ].map((value) => String(value || '').toLowerCase());
  return names.includes('1') || names.includes('final') || names.includes('result');
}

function isStandardBothTeamsToScoreMarket(market) {
  if (String(market?.idBet) === '26') {
    return true;
  }

  const name = normalizeLabel(localizedText(market?.mbDisplayName));
  return [
    'ambele echipe marcheaza gg',
    'ambele echipe marcheaza',
    'both teams to score',
  ].includes(name);
}

function localizedText(value) {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (value && typeof value === 'object') {
    return String(value['42'] || value['2'] || Object.values(value)[0] || '').trim();
  }

  return '';
}

function normalizeLabel(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}+\-.]+/gu, ' ')
    .trim();
}

function normalizeOverUnder(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'peste' || normalized === 'over') {
    return 'over';
  }
  if (normalized === 'sub' || normalized === 'under') {
    return 'under';
  }
  return null;
}

function hasOutcomes(prices, outcomes) {
  return outcomes.every((outcome) => isDecimalOdds(prices[outcome]));
}

function formatUtcSecond(date) {
  return date.toISOString().slice(0, 19) + 'Z';
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

function slugBookmaker(bookmaker) {
  return String(bookmaker)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function chunk(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function mapWithConcurrency(items, concurrency, iteratee) {
  const results = [];
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await iteratee(items[currentIndex], currentIndex);
    }
  });
  await Promise.all(workers);
  return results;
}

module.exports = {
  DIGITAIN_FOOTBALL_SPORT_ID,
  DigitainProvider,
  normalizeDigitainPayload,
};
