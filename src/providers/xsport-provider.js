const { ProviderError } = require('./the-odds-api-provider');
const {
  formatLine,
  handicapMarketKey,
  hasAnyCompleteMarket,
  isDecimalOdds,
  splitFixtureName,
} = require('./market-utils');
const { bookmakerFootballUrl, bookmakerLinkFields, xsportEventUrl } = require('./event-links');

const XSPORT_FOOTBALL_SPORT_ID = 1;
const XSPORT_MAIN_FOOTBALL_AGGREGATE_ID = 1;
const XSPORT_ALL_MARKETS_AGGREGATE_ID = -1;
const XSPORT_MARKETS = Object.freeze({
  h2h: 3,
  firstHalfH2h: 14,
  homeDraw: 15,
  drawAway: 16,
  homeAway: 17,
  bothTeamsToScore: 18,
  oddEven: 19,
  handicap: 8,
  totalGoals: 7989,
  drawNoBet: 60011,
  asianHandicap: 60016,
  homeTotal: 1749,
  awayTotal: 1750,
  totalCorners: 975,
});

class XSportProvider {
  constructor({
    name,
    apiBaseUrl,
    eventOrigin,
    systemCode,
    language = 'RO',
    fetchImpl = globalThis.fetch,
    timeoutMs = 8000,
    lookaheadDays = 14,
    maxDetailEvents = 220,
    detailsConcurrency = 10,
    now = () => new Date(),
  } = {}) {
    if (!name || !apiBaseUrl || !eventOrigin || !systemCode) {
      throw new Error('XSportProvider requires name, apiBaseUrl, eventOrigin, and systemCode');
    }

    this.name = name;
    this.apiBaseUrl = apiBaseUrl.replace(/\/+$/g, '');
    this.eventOrigin = eventOrigin.replace(/\/+$/g, '');
    this.systemCode = systemCode;
    this.language = language;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.lookaheadDays = lookaheadDays;
    this.maxDetailEvents = maxDetailEvents;
    this.detailsConcurrency = detailsConcurrency;
    this.now = now;
  }

  async getOdds() {
    const fetchedAt = this.now().toISOString();
    const payloadResults = await Promise.allSettled(
      datesFrom(this.now(), this.lookaheadDays).map((date) =>
        this.fetchFootballPayload(formatXsportDate(date)),
      ),
    );
    const payloads = payloadResults
      .filter((result) => result.status === 'fulfilled')
      .map((result) => result.value);
    const failures = payloadResults.filter((result) => result.status === 'rejected');

    if (payloads.length === 0 && failures.length > 0) {
      throw failures[0].reason;
    }

    const enrichedPayloads = await enrichXsportPayloads(payloads, {
      maxDetailEvents: this.maxDetailEvents,
      detailsConcurrency: this.detailsConcurrency,
      fetchDetail: (event) => this.fetchEventDetail(event),
    });

    return enrichedPayloads
      .flatMap((payload) =>
        normalizeXsportPayload(payload, {
          bookmaker: this.name,
          fetchedAt,
          eventOrigin: this.eventOrigin,
        }),
      )
      .sort((left, right) => new Date(left.startsAt) - new Date(right.startsAt));
  }

  async fetchFootballPayload(date) {
    const url = new URL(`${this.apiBaseUrl}/XSportDatastore/getPalinsestoDelGiorno`);
    url.search = new URLSearchParams({
      systemCode: this.systemCode,
      lingua: this.language,
      hash: '',
      data: date,
      idSport: String(XSPORT_FOOTBALL_SPORT_ID),
      idAggregata: String(XSPORT_MAIN_FOOTBALL_AGGREGATE_ID),
      timezone: '3',
    });
    return this.fetchJson(url);
  }

  async fetchEventDetail(event) {
    const url = new URL(`${this.apiBaseUrl}/XSportDatastore/getEvento`);
    url.search = new URLSearchParams({
      systemCode: this.systemCode,
      lingua: this.language,
      hash: '',
      pal: String(event.p),
      avv: String(event.a),
      idAggregata: String(XSPORT_ALL_MARKETS_AGGREGATE_ID),
      isLive: String(event.lv === true),
    });
    return this.fetchJson(url);
  }

  async fetchJson(url) {
    let response;
    try {
      response = await this.fetchImpl(url, {
        headers: {
          accept: '*/*',
          'user-agent': 'Mozilla/5.0',
        },
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

    const text = await response.text();
    if (!text.trim()) {
      return {};
    }

    try {
      return JSON.parse(text);
    } catch (error) {
      throw new ProviderError(`${this.name} returned invalid JSON`, {
        cause: error,
      });
    }
  }
}

async function enrichXsportPayloads(
  payloads,
  { maxDetailEvents = 0, detailsConcurrency = 1, fetchDetail } = {},
) {
  if (!maxDetailEvents || typeof fetchDetail !== 'function') {
    return payloads;
  }

  const candidates = [];
  payloads.forEach((payload, payloadIndex) => {
    for (const event of Array.isArray(payload?.avs?.avs) ? payload.avs.avs : []) {
      if (shouldFetchXsportDetail(event)) {
        candidates.push({ payloadIndex, event });
      }
    }
  });

  const limited = candidates.slice(0, maxDetailEvents);
  if (limited.length === 0) {
    return payloads;
  }

  const details = new Map();
  await mapWithConcurrency(limited, detailsConcurrency, async ({ payloadIndex, event }) => {
    try {
      const detail = await fetchDetail(event);
      if (detail?.p && detail?.a && Array.isArray(detail.scs) && detail.scs.length > 0) {
        details.set(xsportDetailKey(payloadIndex, event), detail);
      }
    } catch {
      // Keep the list event when an event detail endpoint is temporarily unavailable.
    }
  });

  if (details.size === 0) {
    return payloads;
  }

  return payloads.map((payload, payloadIndex) => ({
    ...payload,
    avs: {
      ...payload.avs,
      avs: (Array.isArray(payload?.avs?.avs) ? payload.avs.avs : []).map((event) =>
        mergeXsportDetail(event, details.get(xsportDetailKey(payloadIndex, event))),
      ),
    },
  }));
}

function shouldFetchXsportDetail(event) {
  return event && event.lv !== true && event.p && event.a && Array.isArray(event.scs);
}

function mergeXsportDetail(event, detail) {
  if (!detail) {
    return event;
  }

  return {
    ...event,
    ...detail,
    dsl: event.dsl || detail.dsl,
    ic: event.ic,
    it: event.it,
    tournamentName: event.tournamentName,
    scs: Array.isArray(detail.scs) && detail.scs.length > 0 ? detail.scs : event.scs,
  };
}

function xsportDetailKey(payloadIndex, event) {
  return `${payloadIndex}:${event?.p}:${event?.a}`;
}

function normalizeXsportPayload(payload, { bookmaker, fetchedAt, eventOrigin } = {}) {
  const tournamentNames = payload?.dts || {};
  return (Array.isArray(payload?.avs?.avs) ? payload.avs.avs : [])
    .map((event) =>
      normalizeXsportEvent(
        {
          ...event,
          tournamentName: tournamentNames[`RO_${event.it}`] || tournamentNames[`EN_${event.it}`],
        },
        { bookmaker, fetchedAt, eventOrigin },
      ),
    )
    .filter(Boolean);
}

function normalizeXsportEvent(event, { bookmaker, fetchedAt, eventOrigin } = {}) {
  if (!event || event.lv === true || !Array.isArray(event.scs)) {
    return null;
  }

  const teams = splitFixtureName(localizedText(event.dsl));
  const startsAt = parseXsportDateTime(event.ts);
  const markets = normalizeXsportMarkets(event.scs);

  if (
    !event.a ||
    teams.length !== 2 ||
    Number.isNaN(startsAt.getTime()) ||
    !hasAnyCompleteMarket(markets)
  ) {
    return null;
  }

  return {
    id: `${slugBookmaker(bookmaker)}:${event.p}:${event.a}`,
    externalIds: {
      xsportFixture: `${event.p}:${event.a}`,
      xsportPalinsesto: String(event.p),
      xsportEvent: String(event.a),
      ...(event.bid ? { sportradar: String(event.bid) } : {}),
    },
    sport: 'Football',
    competition: event.tournamentName || `${bookmaker} Football`,
    startsAt: startsAt.toISOString(),
    homeTeam: teams[0],
    awayTeam: teams[1],
    bookmakers: [
      {
        name: bookmaker,
        lastUpdate: fetchedAt,
        ...bookmakerLinkFields(
          bookmaker,
          xsportEventUrl(eventOrigin, event),
          bookmakerFootballUrl(bookmaker) || `${eventOrigin}/sport`,
        ),
        markets,
      },
    ],
  };
}

function normalizeXsportMarkets(markets) {
  const normalized = {};
  const h2hMarket = markets.find((market) => Number(market.cs) === XSPORT_MARKETS.h2h);
  const h2h = {
    home: xsportOdd(h2hMarket?.eqs?.find((outcome) => Number(outcome.ce) === 1)?.q),
    draw: xsportOdd(h2hMarket?.eqs?.find((outcome) => Number(outcome.ce) === 2)?.q),
    away: xsportOdd(h2hMarket?.eqs?.find((outcome) => Number(outcome.ce) === 3)?.q),
  };
  if (hasOutcomes(h2h, ['home', 'draw', 'away'])) {
    normalized.h2h = h2h;
  }

  const doubleChance = {
    homeDraw: doubleChanceOdd(markets, XSPORT_MARKETS.homeDraw, 1),
    drawAway: doubleChanceOdd(markets, XSPORT_MARKETS.drawAway, 2),
    homeAway: doubleChanceOdd(markets, XSPORT_MARKETS.homeAway, 2),
  };
  if (hasOutcomes(doubleChance, ['homeDraw', 'homeAway', 'drawAway'])) {
    normalized.doubleChance = doubleChance;
  }

  for (const market of markets) {
    const marketId = Number(market.cs);
    if (marketId === XSPORT_MARKETS.firstHalfH2h) {
      addXsportOutcomeMarket(normalized, 'firstHalfH2h', market, {
        1: 'home',
        2: 'draw',
        3: 'away',
      }, ['home', 'draw', 'away']);
      continue;
    }
    if (marketId === XSPORT_MARKETS.bothTeamsToScore) {
      addXsportOutcomeMarket(normalized, 'bothTeamsToScore', market, {
        1: 'yes',
        2: 'no',
      }, ['yes', 'no']);
      continue;
    }
    if (marketId === XSPORT_MARKETS.oddEven) {
      addXsportOutcomeMarket(normalized, 'market_total_goluri_impar_par', market, {
        1: 'odd',
        2: 'even',
      }, ['odd', 'even']);
      continue;
    }
    if (marketId === XSPORT_MARKETS.drawNoBet) {
      addXsportOutcomeMarket(normalized, 'drawNoBet', market, {
        1: 'home',
        2: 'away',
      }, ['home', 'away']);
      continue;
    }
    if (marketId === XSPORT_MARKETS.totalGoals) {
      addXsportOverUnderMarket(normalized, market, 'totalGoals');
      continue;
    }
    if (marketId === XSPORT_MARKETS.homeTotal) {
      addXsportOverUnderMarket(normalized, market, 'market_total_goluri_home');
      continue;
    }
    if (marketId === XSPORT_MARKETS.awayTotal) {
      addXsportOverUnderMarket(normalized, market, 'market_total_goluri_away');
      continue;
    }
    if (marketId === XSPORT_MARKETS.totalCorners) {
      addXsportOverUnderMarket(normalized, market, 'totalCorners');
      continue;
    }
    if (marketId === XSPORT_MARKETS.asianHandicap) {
      addXsportHandicapMarket(
        normalized,
        market,
        'asianHandicap',
        { 1: 'home', 2: 'away' },
        ['home', 'away'],
      );
      continue;
    }
    if (marketId === XSPORT_MARKETS.handicap) {
      addXsportHandicapMarket(
        normalized,
        market,
        'handicap',
        { 1: 'home', 2: 'draw', 3: 'away' },
        ['home', 'draw', 'away'],
      );
      continue;
    }

    // Label fallback when brand/template ids differ across XSport RO skins.
    routeXsportLabelMarket(normalized, market);
  }

  return normalized;
}

function normalizeXsportLabel(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}+\-.]+/gu, ' ')
    .trim();
}

function routeXsportLabelMarket(normalized, market) {
  const label = normalizeXsportLabel(market?.d || market?.n || market?.name);
  if (!label) return;

  if (
    (label.includes('a doua') || label.includes('2nd') || label.includes('second'))
    && (label.includes('1x2') || label.includes('rezultat') || label === 'a doua repriza' || label === '2nd half')
  ) {
    addXsportOutcomeMarket(normalized, 'secondHalfH2h', market, {
      1: 'home',
      2: 'draw',
      3: 'away',
    }, ['home', 'draw', 'away']);
    return;
  }

  if (label.includes('ambele') && (label.includes('marcheaza') || label.includes('gg'))) {
    const key = (label.includes('pauza') || label.includes('prima') || label.includes('1st'))
      ? 'firstHalfBothTeamsToScore'
      : (label.includes('a doua') || label.includes('2nd') || label.includes('second'))
        ? 'secondHalfBothTeamsToScore'
        : 'bothTeamsToScore';
    addXsportOutcomeMarket(normalized, key, market, {
      1: 'yes',
      2: 'no',
    }, ['yes', 'no']);
    return;
  }

  if (label.includes('fara egal') || label.includes('draw no bet') || label.includes('dnb')) {
    const key = (label.includes('pauza') || label.includes('prima') || label.includes('1st'))
      ? 'firstHalfDrawNoBet'
      : (label.includes('a doua') || label.includes('2nd') || label.includes('second'))
        ? 'secondHalfDrawNoBet'
        : 'drawNoBet';
    addXsportOutcomeMarket(normalized, key, market, {
      1: 'home',
      2: 'away',
    }, ['home', 'away']);
    return;
  }

  if (
    (label.includes('total goluri') || label.includes('total goals') || label.includes('over under'))
    && (label.includes('pauza') || label.includes('prima') || label.includes('1st half'))
  ) {
    addXsportOverUnderMarket(normalized, market, 'firstHalfTotalGoals');
    return;
  }

  if (
    (label.includes('total goluri') || label.includes('total goals') || label.includes('over under'))
    && (label.includes('a doua') || label.includes('2nd') || label.includes('second'))
  ) {
    addXsportOverUnderMarket(normalized, market, 'secondHalfTotalGoals');
    return;
  }

  if (label.includes('total cartonase') || label.includes('total cards') || label.includes('yellow')) {
    addXsportOverUnderMarket(normalized, market, 'totalCards');
    return;
  }

  if (label.includes('total cornere') || label.includes('total corners')) {
    addXsportOverUnderMarket(normalized, market, 'totalCorners');
    return;
  }

  if (
    (label.includes('total') && (label.includes('asiatic') || label.includes('asian')))
    && (label.includes('gol') || label.includes('goal'))
  ) {
    const base = (label.includes('pauza') || label.includes('prima') || label.includes('1st'))
      ? 'firstHalfAsianTotalGoals'
      : (label.includes('a doua') || label.includes('2nd') || label.includes('second'))
        ? 'secondHalfAsianTotalGoals'
        : 'asianTotalGoals';
    addXsportOverUnderMarket(normalized, market, base);
    return;
  }

  if (label.includes('sansa dubla') || label.includes('double chance')) {
    const key = (label.includes('pauza') || label.includes('prima') || label.includes('1st'))
      ? 'firstHalfDoubleChance'
      : (label.includes('a doua') || label.includes('2nd') || label.includes('second'))
        ? 'secondHalfDoubleChance'
        : 'doubleChance';
    // XSport often splits DC into separate markets; try full three-way first.
    addXsportOutcomeMarket(normalized, key, market, {
      1: 'homeDraw',
      2: 'homeAway',
      3: 'drawAway',
    }, ['homeDraw', 'homeAway', 'drawAway']);
    return;
  }

  if (
    (label.includes('marcheaza') || label.includes('to score') || label.includes('sa inscrie'))
    && (label.includes('gazda') || label.includes('gazde') || label.includes('home'))
  ) {
    addXsportOutcomeMarket(normalized, 'market_marcheaza_home', market, {
      1: 'yes',
      2: 'no',
    }, ['yes', 'no']);
    return;
  }

  if (
    (label.includes('marcheaza') || label.includes('to score') || label.includes('sa inscrie'))
    && (label.includes('oaspete') || label.includes('oaspeti') || label.includes('away'))
  ) {
    addXsportOutcomeMarket(normalized, 'market_marcheaza_away', market, {
      1: 'yes',
      2: 'no',
    }, ['yes', 'no']);
    return;
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
      addXsportOutcomeMarket(normalized, `market_clean_sheet_${side}`, market, {
        1: 'yes',
        2: 'no',
      }, ['yes', 'no']);
    }
    return;
  }

  if (
    label.includes('se califica')
    || label.includes('to qualify')
    || label.includes('calificare')
    || label.includes('merge mai departe')
  ) {
    addXsportOutcomeMarket(normalized, 'toQualify', market, {
      1: 'home',
      2: 'away',
    }, ['home', 'away']);
  }
}

function addXsportOutcomeMarket(normalized, key, market, outcomeMap, required) {
  const prices = xsportPrices(market, outcomeMap);
  if (!normalized[key] && hasOutcomes(prices, required)) {
    normalized[key] = prices;
  }
}

function addXsportOverUnderMarket(normalized, market, baseKey) {
  const line = xsportLine(market);
  if (!Number.isFinite(line)) {
    return;
  }
  const key = `${baseKey}_${formatLine(line).replace('.', '_')}`;
  addXsportOutcomeMarket(normalized, key, market, {
    1: 'under',
    2: 'over',
  }, ['over', 'under']);
}

function addXsportHandicapMarket(normalized, market, baseKey, outcomeMap, required) {
  const line = xsportLine(market);
  if (!Number.isFinite(line)) {
    return;
  }
  const key = handicapMarketKey(baseKey, line);
  if (!key) {
    return;
  }
  addXsportOutcomeMarket(normalized, key, market, outcomeMap, required);
}

function xsportPrices(market, outcomeMap) {
  const prices = {};
  for (const outcome of Array.isArray(market?.eqs) ? market.eqs : []) {
    const key = outcomeMap[Number(outcome.ce)];
    const odd = xsportOdd(outcome.q);
    if (key && isDecimalOdds(odd)) {
      prices[key] = odd;
    }
  }
  return prices;
}

function doubleChanceOdd(markets, marketId, outcomeId) {
  const market = markets.find((item) => Number(item.cs) === marketId);
  return xsportOdd(market?.eqs?.find((outcome) => Number(outcome.ce) === outcomeId)?.q);
}

function xsportOdd(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number / 100 : null;
}

function xsportLine(market) {
  const line = Number(market?.h);
  return Number.isFinite(line) ? line / 100 : Number.NaN;
}

function parseXsportDateTime(value) {
  const match = String(value || '').match(/^(\d{4})(\d{2})(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) {
    return new Date(Number.NaN);
  }
  const [, year, month, day, hour, minute, second] = match;
  return new Date(Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  ));
}

function formatXsportDate(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('');
}

function datesFrom(start, days) {
  return Array.from({ length: Math.max(1, days) }, (_, index) => {
    const date = new Date(start.getTime());
    date.setUTCDate(date.getUTCDate() + index);
    return date;
  });
}

async function mapWithConcurrency(items, concurrency, iteratee) {
  const results = [];
  let index = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await iteratee(items[currentIndex], currentIndex);
    }
  });
  await Promise.all(workers);
  return results;
}

function localizedText(value) {
  if (typeof value === 'string') {
    return value.trim();
  }
  return String(value?.RO || value?.EN || value?.ORIGINAL_FROM_DB || Object.values(value || {})[0] || '').trim();
}

function hasOutcomes(prices, outcomes) {
  return outcomes.every((outcome) => isDecimalOdds(prices[outcome]));
}

function slugBookmaker(bookmaker) {
  return String(bookmaker)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

module.exports = {
  XSPORT_FOOTBALL_SPORT_ID,
  XSPORT_ALL_MARKETS_AGGREGATE_ID,
  XSPORT_MAIN_FOOTBALL_AGGREGATE_ID,
  XSPORT_MARKETS,
  XSportProvider,
  mergeXsportDetail,
  formatXsportDate,
  normalizeXsportPayload,
  normalizeXsportMarkets,
};
