'use strict';

const WebSocket = require('ws');
const { bookmakerLinkFields } = require('./event-links');
const {
  formatLine,
  handicapMarketKey,
  hasAnyCompleteMarket,
  isDecimalOdds,
  normalizeOutcomeKey,
} = require('./market-utils');
const { ProviderError } = require('./the-odds-api-provider');

const BETCONSTRUCT_SOCCER_ALIAS = 'Soccer';
const BETCONSTRUCT_DESKTOP_SOURCE = 42;
const BETCONSTRUCT_PREMATCH_TYPE = 0;
const DEFAULT_MAX_EVENTS = 1000;
const DEFAULT_TIMEOUT_MS = 12_000;
const SPECIAL_COMPETITION_PATTERN =
  /antepost|pariuri pe|transfer|antrenor|statistic|mythical|alternative|sferturi|quarters?|hydration|special/i;

class BetconstructProvider {
  constructor({
    name,
    socketUrl,
    siteId,
    releaseDate,
    language,
    pageUrl,
    source = BETCONSTRUCT_DESKTOP_SOURCE,
    maxEvents = DEFAULT_MAX_EVENTS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    now = () => new Date(),
    webSocketFactory = (url) => new WebSocket(url),
    configUrl = '',
    configRefreshMs = 6 * 60 * 60_000,
    fetchImpl = global.fetch,
  } = {}) {
    if (!name || !socketUrl || !siteId || !releaseDate || !language || !pageUrl) {
      throw new Error(
        'BetconstructProvider requires name, socketUrl, siteId, releaseDate, language, and pageUrl',
      );
    }
    this.name = name;
    this.socketUrl = socketUrl;
    this.siteId = siteId;
    this.releaseDate = releaseDate;
    this.language = language;
    this.pageUrl = pageUrl;
    this.source = source;
    this.maxEvents = maxEvents;
    this.timeoutMs = timeoutMs;
    this.now = now;
    this.webSocketFactory = webSocketFactory;
    this.configUrl = configUrl;
    this.configRefreshMs = configRefreshMs;
    this.fetchImpl = fetchImpl;
    this.configCheckedAt = null;
    this.configError = null;
  }

  async getOdds() {
    await this.refreshConfig();
    const fetchedAt = this.now().toISOString();
    const payload = await fetchBetconstructPayload({
      socketUrl: this.socketUrl,
      siteId: this.siteId,
      releaseDate: this.releaseDate,
      language: this.language,
      source: this.source,
      timeoutMs: this.timeoutMs,
      webSocketFactory: this.webSocketFactory,
    });
    return normalizeBetconstructPayload(payload, {
      bookmaker: this.name,
      bookmakerUrl: this.pageUrl,
      fetchedAt,
      maxEvents: this.maxEvents,
      now: this.now(),
      siteId: this.siteId,
    });
  }

  async refreshConfig({ force = false } = {}) {
    if (!this.configUrl || typeof this.fetchImpl !== 'function') return null;
    const nowMs = this.now().getTime();
    if (!force && this.configCheckedAt && nowMs - new Date(this.configCheckedAt).getTime() < this.configRefreshMs) {
      return null;
    }
    this.configCheckedAt = this.now().toISOString();
    try {
      const response = await this.fetchImpl(this.configUrl, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(Math.min(this.timeoutMs, 10_000)),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const config = resolveBetconstructConfig(await response.json());
      if (config.siteId) this.siteId = config.siteId;
      if (config.releaseDate) this.releaseDate = config.releaseDate;
      if (config.socketUrl) this.socketUrl = config.socketUrl;
      this.configError = null;
      return config;
    } catch (error) {
      this.configError = error.message;
      return null;
    }
  }
}

function resolveBetconstructConfig(config) {
  const nodes = flattenObjects(config);
  return {
    siteId: positiveNumber(firstValue(nodes, ['site_id', 'siteId', 'siteid'])),
    releaseDate: stringValue(firstValue(nodes, ['release_date', 'releaseDate', 'releasedate'])),
    socketUrl: firstSocket(nodes, ['websocket', 'socket', 'socketUrl', 'swarm_url', 'swarmUrl']),
    language: stringValue(firstValue(nodes, ['language', 'lang'])),
  };
}

function flattenObjects(value, result = [], seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return result;
  seen.add(value);
  result.push(value);
  for (const child of Object.values(value)) flattenObjects(child, result, seen);
  return result;
}

function firstValue(nodes, keys) {
  for (const node of nodes) {
    for (const key of keys) {
      if (node[key] !== undefined && node[key] !== null && node[key] !== '') return node[key];
    }
  }
  return null;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function stringValue(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function socketValue(value) {
  const socket = stringValue(value);
  return socket
    && /^wss?:\/\//i.test(socket)
    && !/jackpot|rocket-bet/i.test(socket)
    && /swarm|betconstruct|victorybet/i.test(socket)
    ? socket
    : null;
}

function firstSocket(nodes, keys) {
  for (const node of nodes) {
    for (const key of keys) {
      const socket = socketValue(node[key]);
      if (socket) return socket;
    }
  }
  return null;
}

function fetchBetconstructPayload({
  socketUrl,
  siteId,
  releaseDate,
  language,
  source = BETCONSTRUCT_DESKTOP_SOURCE,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  webSocketFactory = (url) => new WebSocket(url),
} = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let socket;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (socket && socket.readyState < 2) {
        socket.close();
      }
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(
      new ProviderError(`BetConstruct feed timed out after ${timeoutMs}ms`),
    ), timeoutMs);

    try {
      socket = webSocketFactory(socketUrl);
    } catch (error) {
      finish(new ProviderError(`Unable to create BetConstruct WebSocket: ${error.message}`, {
        cause: error,
      }));
      return;
    }

    socket.on('open', () => {
      socket.send(JSON.stringify(buildSessionRequest({
        siteId,
        releaseDate,
        language,
        source,
      })));
    });
    socket.on('message', (data) => {
      const message = parseSocketMessage(data);
      if (!message) return;

      if (Number(message.rid) === 1) {
        if (Number(message.code) !== 0) {
          finish(new ProviderError(
            `BetConstruct session rejected with code ${message.code}`,
          ));
          return;
        }
        socket.send(JSON.stringify(buildFootballRequest()));
        return;
      }

      if (Number(message.rid) === 2) {
        if (Number(message.code) !== 0) {
          finish(new ProviderError(
            `BetConstruct football feed returned code ${message.code}`,
          ));
          return;
        }
        finish(null, message?.data?.data || message?.data || {});
      }
    });
    socket.on('error', (error) => finish(new ProviderError(
      `BetConstruct WebSocket failed: ${error.message || 'unknown error'}`,
      { cause: error },
    )));
    socket.on('close', (code) => {
      if (!settled) {
        finish(new ProviderError(`BetConstruct WebSocket closed before data arrived (${code})`));
      }
    });
  });
}

function buildSessionRequest({ siteId, releaseDate, language, source }) {
  return {
    command: 'request_session',
    params: {
      language,
      release_date: releaseDate,
      site_id: Number(siteId),
      source: Number(source),
    },
    rid: 1,
  };
}

function buildFootballRequest() {
  return {
    command: 'get',
    params: {
      source: 'betting',
      subscribe: false,
      what: {
        sport: ['id', 'name', 'alias'],
        region: ['id', 'name', 'alias'],
        competition: ['id', 'name'],
        game: [
          'id',
          'team1_id',
          'team2_id',
          'team1_name',
          'team2_name',
          'start_ts',
          'type',
          'markets_count',
          'is_statistical',
        ],
        market: ['id', 'name', 'type', 'base'],
        event: ['id', 'price', 'name', 'type', 'base'],
      },
      where: {
        sport: { alias: BETCONSTRUCT_SOCCER_ALIAS },
        game: { type: BETCONSTRUCT_PREMATCH_TYPE },
      },
    },
    rid: 2,
  };
}

function normalizeBetconstructPayload(payload, {
  bookmaker,
  bookmakerUrl,
  fetchedAt = new Date().toISOString(),
  maxEvents = DEFAULT_MAX_EVENTS,
  now = new Date(),
  siteId = '',
} = {}) {
  const rows = [];
  for (const sport of objectValues(payload?.sport)) {
    for (const region of objectValues(sport?.region)) {
      for (const competition of objectValues(region?.competition)) {
        for (const game of objectValues(competition?.game)) {
          const event = normalizeBetconstructGame(game, {
            bookmaker,
            bookmakerUrl,
            competition,
            fetchedAt,
            now,
            siteId,
          });
          if (event) rows.push(event);
        }
      }
    }
  }
  return rows
    .sort((left, right) => new Date(left.startsAt) - new Date(right.startsAt))
    .slice(0, maxEvents);
}

function normalizeBetconstructGame(game, {
  bookmaker,
  bookmakerUrl,
  competition,
  fetchedAt,
  now,
  siteId,
}) {
  const homeTeam = String(game?.team1_name || '').trim();
  const awayTeam = String(game?.team2_name || '').trim();
  const competitionName = String(competition?.name || '').trim();
  const startTimestamp = Number(game?.start_ts) * 1000;
  const earliestAllowed = new Date(now).getTime() - 15 * 60 * 1000;
  if (
    !game?.id
    || !game?.team1_id
    || !game?.team2_id
    || !homeTeam
    || !awayTeam
    || !Number.isFinite(startTimestamp)
    || startTimestamp < earliestAllowed
    || SPECIAL_COMPETITION_PATTERN.test(competitionName)
  ) {
    return null;
  }

  const markets = normalizeBetconstructMarkets(game.market, { homeTeam, awayTeam });
  if (!hasAnyCompleteMarket(markets)) {
    return null;
  }

  return {
    id: `betconstruct:${siteId}:${game.id}`,
    sport: 'Football',
    competition: competitionName || 'Football',
    startsAt: new Date(startTimestamp).toISOString(),
    homeTeam,
    awayTeam,
    bookmakers: [{
      name: bookmaker,
      markets,
      lastUpdate: fetchedAt,
      ...bookmakerLinkFields(bookmaker, null, bookmakerUrl),
    }],
  };
}

function normalizeBetconstructMarkets(rawMarkets, { homeTeam, awayTeam } = {}) {
  const normalized = {};
  for (const market of objectValues(rawMarkets)) {
    const type = String(market?.type || '');
    const typeKey = type.toLowerCase();
    const line = Number(market?.base);
    const events = objectValues(market?.event);

    if (typeKey === 'p1xp2') {
      addOutcomeMarket(normalized, 'h2h', events, {
        P1: 'home', X: 'draw', P2: 'away',
      }, ['home', 'draw', 'away']);
      continue;
    }
    if (typeKey === '1x12x2') {
      addOutcomeMarket(normalized, 'doubleChance', events, {
        '1X': 'homeDraw', '12': 'homeAway', X2: 'drawAway',
      }, ['homeDraw', 'homeAway', 'drawAway']);
      continue;
    }
    if (typeKey === 'halftimeresult') {
      addOutcomeMarket(normalized, 'firstHalfH2h', events, {
        P1: 'home', X: 'draw', P2: 'away',
      }, ['home', 'draw', 'away']);
      continue;
    }
    if (typeKey === 'halftimedoublechance') {
      addOutcomeMarket(normalized, 'firstHalfDoubleChance', events, {
        '1X': 'homeDraw', '12': 'homeAway', X2: 'drawAway',
      }, ['homeDraw', 'homeAway', 'drawAway']);
      continue;
    }
    if (typeKey === 'bothteamstoscore') {
      addOutcomeMarket(normalized, 'bothTeamsToScore', events, {
        Yes: 'yes', No: 'no',
      }, ['yes', 'no']);
      continue;
    }
    if (typeKey === 'halformatchresult') {
      addOutcomeMarket(normalized, 'halfTimeOrFullTime', events, {
        P1: 'home', X: 'draw', P2: 'away',
      }, ['home', 'draw', 'away']);
      continue;
    }
    if (typeKey === 'overunder' && Number.isFinite(line)) {
      const base = /asiatic/i.test(String(market?.name || ''))
        ? 'asianTotalGoals'
        : 'totalGoals';
      addOverUnderMarket(normalized, `${base}_${lineKey(line)}`, events);
      continue;
    }
    if (typeKey === 'halftimeoverunder' && Number.isFinite(line)) {
      addOverUnderMarket(normalized, `firstHalfTotalGoals_${lineKey(line)}`, events);
      continue;
    }
    if (typeKey === 'halftimeoverunderasian' && Number.isFinite(line)) {
      addOverUnderMarket(normalized, `firstHalfAsianTotalGoals_${lineKey(line)}`, events);
      continue;
    }
    if (['team1overunder', 'team1totaloverunderasian'].includes(typeKey) && Number.isFinite(line)) {
      addOverUnderMarket(normalized, `market_total_goluri_home_${lineKey(line)}`, events);
      continue;
    }
    if (['team2overunder', 'team2totaloverunderasian'].includes(typeKey) && Number.isFinite(line)) {
      addOverUnderMarket(normalized, `market_total_goluri_away_${lineKey(line)}`, events);
      continue;
    }
    if (typeKey === 'team1scoreyes/no') {
      addOutcomeMarket(normalized, 'market_marcheaza_home', events, {
        Yes: 'yes', No: 'no',
      }, ['yes', 'no']);
      continue;
    }
    if (typeKey === 'team2scoreyes/no') {
      addOutcomeMarket(normalized, 'market_marcheaza_away', events, {
        Yes: 'yes', No: 'no',
      }, ['yes', 'no']);
      continue;
    }
    if (typeKey === 'asianhandicap') {
      addHandicapMarket(normalized, events, { homeTeam, awayTeam });
    }
  }
  return normalized;
}

function addOutcomeMarket(target, marketKey, events, aliases, required) {
  const prices = {};
  for (const event of events) {
    const inferred = normalizeOutcomeKey(event?.name);
    const key = aliases[String(event?.type || '')]
      || (required.includes(inferred) ? inferred : null);
    const price = Number(event?.price);
    if (key && isDecimalOdds(price)) prices[key] = price;
  }
  if (required.every((key) => isDecimalOdds(prices[key]))) {
    target[marketKey] = prices;
  }
}

function addOverUnderMarket(target, marketKey, events) {
  const prices = {};
  for (const event of events) {
    const key = normalizeOutcomeKey(event?.type || event?.name);
    const price = Number(event?.price);
    if (['over', 'under'].includes(key) && isDecimalOdds(price)) {
      prices[key] = price;
    }
  }
  if (isDecimalOdds(prices.over) && isDecimalOdds(prices.under)) {
    target[marketKey] = prices;
  }
}

function addHandicapMarket(target, events, { homeTeam, awayTeam }) {
  let home;
  let away;
  for (const event of events) {
    const type = String(event?.type || '').toLowerCase();
    const name = String(event?.name || '').trim().toLowerCase();
    if (type === 'home' || name === String(homeTeam || '').trim().toLowerCase()) home = event;
    if (type === 'away' || name === String(awayTeam || '').trim().toLowerCase()) away = event;
  }
  const homeLine = Number(home?.base);
  const homePrice = Number(home?.price);
  const awayPrice = Number(away?.price);
  if (Number.isFinite(homeLine) && isDecimalOdds(homePrice) && isDecimalOdds(awayPrice)) {
    target[handicapMarketKey('asianHandicap', homeLine)] = {
      home: homePrice,
      away: awayPrice,
    };
  }
}

function parseSocketMessage(data) {
  try {
    return JSON.parse(String(data));
  } catch {
    return null;
  }
}

function objectValues(value) {
  return value && typeof value === 'object' ? Object.values(value) : [];
}

function lineKey(value) {
  return formatLine(value).replace('.', '_');
}

module.exports = {
  BETCONSTRUCT_DESKTOP_SOURCE,
  BETCONSTRUCT_PREMATCH_TYPE,
  BETCONSTRUCT_SOCCER_ALIAS,
  BetconstructProvider,
  buildFootballRequest,
  buildSessionRequest,
  fetchBetconstructPayload,
  normalizeBetconstructMarkets,
  normalizeBetconstructPayload,
  resolveBetconstructConfig,
};
