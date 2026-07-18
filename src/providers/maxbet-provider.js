const { ProviderError } = require('./the-odds-api-provider');
const {
  formatLine,
  genericMarketKey,
  handicapMarketKey,
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

    const marketId = Number(market.b);
    const label = String(market.c || market.name || '').trim();
    const labelKey = normalizeMaxBetLabel(label);

    if (marketId === NSOFT_MARKETS.final || labelKey === 'final' || labelKey === 'rezultat final') {
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

    if (
      labelKey === 'pauza'
      || labelKey === 'prima repriza'
      || labelKey === '1st half'
      || labelKey === 'rezultat pauza'
    ) {
      const prices = nsoftPrices(market, {
        '1': 'home',
        X: 'draw',
        '2': 'away',
      });
      if (hasOutcomes(prices, ['home', 'draw', 'away']) && !normalized.firstHalfH2h) {
        normalized.firstHalfH2h = prices;
      }
      continue;
    }

    if (
      labelKey === 'a doua repriza'
      || labelKey === '2nd half'
      || labelKey === 'second half'
      || labelKey === 'rezultat a doua repriza'
    ) {
      const prices = nsoftPrices(market, {
        '1': 'home',
        X: 'draw',
        '2': 'away',
      });
      if (hasOutcomes(prices, ['home', 'draw', 'away']) && !normalized.secondHalfH2h) {
        normalized.secondHalfH2h = prices;
      }
      continue;
    }

    // Period asian before FT asian (labels share "total goluri asiatice").
    if (
      (labelKey.includes('total goluri asiatice') || labelKey.includes('asian total'))
      && (labelKey.includes('pauza') || labelKey.includes('prima') || labelKey.includes('1st'))
    ) {
      addMaxBetLineMarket(normalized, market, 'firstHalfAsianTotalGoals');
      continue;
    }

    if (
      (labelKey.includes('total goluri asiatice') || labelKey.includes('asian total'))
      && (labelKey.includes('a doua') || labelKey.includes('2nd') || labelKey.includes('second'))
    ) {
      addMaxBetLineMarket(normalized, market, 'secondHalfAsianTotalGoals');
      continue;
    }

    if (
      labelKey.includes('total goluri asiatice')
      || labelKey.includes('asian total goals')
      || labelKey === 'total goluri asian'
    ) {
      addMaxBetLineMarket(normalized, market, 'asianTotalGoals');
      continue;
    }

    if (
      labelKey.includes('handicap asiatic')
      || labelKey.includes('asian handicap')
      || labelKey === 'handicap asiatic'
    ) {
      addMaxBetHandicapMarket(normalized, market, 'asianHandicap');
      continue;
    }

    if (
      (labelKey.includes('marcheaza') || labelKey.includes('to score'))
      && (labelKey.includes('gazde') || labelKey.includes('gazda') || labelKey.includes('home'))
    ) {
      const prices = nsoftPrices(market, {
        Da: 'yes', Nu: 'no', Yes: 'yes', No: 'no',
      });
      if (hasOutcomes(prices, ['yes', 'no']) && !normalized.market_marcheaza_home) {
        normalized.market_marcheaza_home = prices;
      }
      continue;
    }

    if (
      (labelKey.includes('marcheaza') || labelKey.includes('to score'))
      && (labelKey.includes('oaspeti') || labelKey.includes('oaspete') || labelKey.includes('away'))
    ) {
      const prices = nsoftPrices(market, {
        Da: 'yes', Nu: 'no', Yes: 'yes', No: 'no',
      });
      if (hasOutcomes(prices, ['yes', 'no']) && !normalized.market_marcheaza_away) {
        normalized.market_marcheaza_away = prices;
      }
      continue;
    }

    if (
      labelKey.includes('fara gol primit')
      || labelKey.includes('clean sheet')
      || labelKey.includes('nu primeste gol')
    ) {
      const prices = nsoftPrices(market, {
        Da: 'yes', Nu: 'no', Yes: 'yes', No: 'no',
      });
      const side = (labelKey.includes('gazda') || labelKey.includes('gazde') || labelKey.includes('home'))
        ? 'home'
        : (labelKey.includes('oaspete') || labelKey.includes('oaspeti') || labelKey.includes('away'))
          ? 'away'
          : null;
      if (side && hasOutcomes(prices, ['yes', 'no'])) {
        const key = `market_clean_sheet_${side}`;
        if (!normalized[key]) normalized[key] = prices;
      }
      continue;
    }

    if (
      labelKey.includes('total goluri')
      && (labelKey.includes('gazde') || labelKey.includes('gazda') || labelKey.includes('home') || labelKey.includes('echipa 1'))
    ) {
      addMaxBetLineMarket(normalized, market, 'market_total_goluri_home');
      continue;
    }

    if (
      labelKey.includes('total goluri')
      && (labelKey.includes('oaspeti') || labelKey.includes('oaspete') || labelKey.includes('away') || labelKey.includes('echipa 2'))
    ) {
      addMaxBetLineMarket(normalized, market, 'market_total_goluri_away');
      continue;
    }

    if (
      labelKey === 'sansa dubla'
      || labelKey === 'double chance'
      || labelKey.includes('sansa dubla')
      || labelKey.includes('double chance')
    ) {
      const doubleChance = nsoftPrices(market, {
        '1X': 'homeDraw',
        '12': 'homeAway',
        X2: 'drawAway',
      });
      const dcKey = (labelKey.includes('pauza') || labelKey.includes('prima') || labelKey.includes('1st'))
        ? 'firstHalfDoubleChance'
        : (labelKey.includes('a doua') || labelKey.includes('2nd') || labelKey.includes('second'))
          ? 'secondHalfDoubleChance'
          : 'doubleChance';
      if (hasOutcomes(doubleChance, ['homeDraw', 'homeAway', 'drawAway']) && !normalized[dcKey]) {
        normalized[dcKey] = doubleChance;
      }
      continue;
    }

    if (
      labelKey === 'fara egal'
      || labelKey === 'draw no bet'
      || labelKey.includes('egal pariu')
      || labelKey.includes('fara egal')
      || labelKey.includes('draw no bet')
    ) {
      const prices = nsoftPrices(market, {
        '1': 'home',
        '2': 'away',
      });
      const dnbKey = (labelKey.includes('pauza') || labelKey.includes('prima') || labelKey.includes('1st'))
        ? 'firstHalfDrawNoBet'
        : (labelKey.includes('a doua') || labelKey.includes('2nd') || labelKey.includes('second'))
          ? 'secondHalfDrawNoBet'
          : 'drawNoBet';
      if (hasOutcomes(prices, ['home', 'away']) && !normalized[dnbKey]) {
        normalized[dnbKey] = prices;
      }
      continue;
    }

    if (marketId === NSOFT_MARKETS.totalGoals || labelKey === 'total goluri' || labelKey === 'total goals') {
      addMaxBetLineMarket(normalized, market, 'totalGoals');
      continue;
    }

    if (
      labelKey.includes('total goluri')
      && (labelKey.includes('pauza') || labelKey.includes('prima'))
    ) {
      addMaxBetLineMarket(normalized, market, 'firstHalfTotalGoals');
      continue;
    }

    if (
      labelKey.includes('total goluri')
      && (labelKey.includes('a doua') || labelKey.includes('2nd') || labelKey.includes('second'))
    ) {
      addMaxBetLineMarket(normalized, market, 'secondHalfTotalGoals');
      continue;
    }

    if (labelKey === 'total cornere' || labelKey === 'total corners') {
      addMaxBetLineMarket(normalized, market, 'totalCorners');
      continue;
    }

    if (labelKey.includes('total cartonase') || labelKey.includes('total cards')) {
      addMaxBetLineMarket(normalized, market, 'totalCards');
      continue;
    }

    if (marketId === NSOFT_MARKETS.bothTeamsToScore || isMaxBetBttsLabel(labelKey)) {
      const prices = nsoftPrices(market, {
        Da: 'yes',
        Nu: 'no',
        Yes: 'yes',
        No: 'no',
      });
      const bttsKey = labelKey.includes('pauza') || labelKey.includes('prima')
        ? 'firstHalfBothTeamsToScore'
        : labelKey.includes('a doua') || labelKey.includes('repriza 2')
          ? 'secondHalfBothTeamsToScore'
          : 'bothTeamsToScore';
      if (hasOutcomes(prices, ['yes', 'no']) && !normalized[bttsKey]) {
        normalized[bttsKey] = prices;
      }
      continue;
    }

    if (marketId === NSOFT_MARKETS.oddEvenGoals || labelKey.includes('par') && labelKey.includes('impar')) {
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
      continue;
    }

    if (
      labelKey.includes('se califica')
      || labelKey.includes('to qualify')
      || labelKey.includes('merge mai departe')
      || labelKey.includes('calificare')
      || labelKey === 'to qualify'
    ) {
      const prices = nsoftPrices(market, {
        '1': 'home',
        '2': 'away',
      });
      if (hasOutcomes(prices, ['home', 'away']) && !normalized.toQualify) {
        normalized.toQualify = prices;
      }
      continue;
    }

    // Generic fallback — harvest any remaining complete 2/3-way markets by label.
    addMaxBetGenericMarket(normalized, market, label);
  }
  return normalized;
}

function addMaxBetLineMarket(markets, market, baseKey) {
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
    markets[`${baseKey}_${formatLine(parsedLine).replace('.', '_')}`] = prices;
  }
}

function addMaxBetHandicapMarket(markets, market, baseKey) {
  const marketLine = parseLine(market.g?.[0] || market.h?.[0]?.f);
  const grouped = new Map();

  for (const outcome of activeOutcomes(market)) {
    if (!isDecimalOdds(outcome.g)) continue;
    let parsed = parseMaxBetHandicapOutcome(outcome.e);
    if (!parsed && marketLine !== null) {
      const sideKey = normalizeOutcomeKey(outcome.e);
      if (sideKey === 'home' || String(outcome.e).trim() === '1') {
        parsed = { side: 'home', homeLine: marketLine };
      } else if (sideKey === 'away' || String(outcome.e).trim() === '2') {
        parsed = { side: 'away', homeLine: marketLine };
      }
    }
    if (!parsed) continue;
    if (!grouped.has(parsed.homeLine)) grouped.set(parsed.homeLine, {});
    grouped.get(parsed.homeLine)[parsed.side] = outcome.g;
  }

  for (const [homeLine, prices] of grouped.entries()) {
    if (hasOutcomes(prices, ['home', 'away'])) {
      const key = handicapMarketKey(baseKey, homeLine);
      if (key && !markets[key]) markets[key] = prices;
    }
  }
}

function parseMaxBetHandicapOutcome(value) {
  const raw = String(value || '').trim();
  let match = raw.match(/^H([12])\s*([+-]?\d+(?:[.,]\d+)?)$/i);
  if (match) {
    const side = match[1] === '1' ? 'home' : 'away';
    const line = Number(match[2].replace(',', '.'));
    return { side, homeLine: side === 'home' ? line : -line };
  }
  match = raw.match(/^([12])\s*[(\[]?\s*([+-]?\d+(?:[.,]\d+)?)\s*[)\]]?$/);
  if (match) {
    const side = match[1] === '1' ? 'home' : 'away';
    const line = Number(match[2].replace(',', '.'));
    return { side, homeLine: side === 'home' ? line : -line };
  }
  return null;
}

function addMaxBetGenericMarket(markets, market, label) {
  const key = genericMarketKey(label);
  if (!key || markets[key]) return;

  const line = market.g?.[0] || market.h?.[0]?.f || market.h?.[0]?.e;
  const parsedLine = parseLine(line);
  const prices = {};
  for (const outcome of activeOutcomes(market)) {
    const outcomeKey = normalizeOutcomeKey(outcome.e);
    if (outcomeKey && isDecimalOdds(outcome.g)) {
      prices[outcomeKey] = outcome.g;
    }
  }

  if (parsedLine !== null && ['over', 'under'].every((side) => isDecimalOdds(prices[side]))) {
    const lineKey = `${key}_${formatLine(parsedLine).replace('.', '_')}`;
    if (!markets[lineKey]) markets[lineKey] = { over: prices.over, under: prices.under };
    return;
  }

  const values = Object.values(prices);
  if (values.length >= 2 && values.length <= 3 && values.every(isDecimalOdds) && !markets[key]) {
    markets[key] = prices;
  }
}

function normalizeMaxBetLabel(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}+\-.]+/gu, ' ')
    .trim();
}

function isMaxBetBttsLabel(labelKey) {
  return (
    labelKey === 'ambele marcheaza'
    || labelKey === 'both teams to score'
    || labelKey.includes('ambele marcheaza')
    || labelKey.includes('both teams to score')
    || labelKey === 'gg ng'
  );
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
