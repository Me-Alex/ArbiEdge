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
const { bookmakerLinkFields, getsBetEventUrl } = require('./event-links');

const GETSBET_WS_URL = 'wss://api-online.getsbet.ro/v2';
const GETSBET_REALM = 'online.getsbet.ro';
const GETSBET_OPERATOR_ID = 2476;
const GETSBET_LANG = 'ro';
const GETSBET_MAIN_GROUP_ID = '2614';
const GETSBET_DETAIL_GROUP = 'Populare';
const DEFAULT_GETSBET_MAX_TOURNAMENTS = 20;
const DEFAULT_GETSBET_MAX_DETAIL_EVENTS = 120;
const DEFAULT_GETSBET_CONCURRENCY = 8;

class GetsBetProvider {
  constructor({
    wsUrl = GETSBET_WS_URL,
    realm = GETSBET_REALM,
    operatorId = GETSBET_OPERATOR_ID,
    lang = GETSBET_LANG,
    fetchImpl,
    WebSocketImpl = globalThis.WebSocket,
    timeoutMs = 12000,
    maxTournaments = DEFAULT_GETSBET_MAX_TOURNAMENTS,
    maxDetailEvents = DEFAULT_GETSBET_MAX_DETAIL_EVENTS,
    concurrency = DEFAULT_GETSBET_CONCURRENCY,
    now = () => new Date(),
  } = {}) {
    this.name = 'GetsBet';
    this.wsUrl = wsUrl;
    this.realm = realm;
    this.operatorId = operatorId;
    this.lang = lang;
    this.fetchImpl = fetchImpl;
    this.WebSocketImpl = WebSocketImpl;
    this.timeoutMs = timeoutMs;
    this.maxTournaments = maxTournaments;
    this.maxDetailEvents = maxDetailEvents;
    this.concurrency = concurrency;
    this.now = now;
  }

  async getOdds() {
    const fetchedAt = this.now().toISOString();
    const client = new GetsBetWampClient({
      wsUrl: this.wsUrl,
      realm: this.realm,
      WebSocketImpl: this.WebSocketImpl,
      timeoutMs: this.timeoutMs,
    });

    try {
      await client.connect();
      const tournamentIds = await discoverGetsBetTournamentIds(client, {
        operatorId: this.operatorId,
        lang: this.lang,
        maxTournaments: this.maxTournaments,
      });
      const listPayloads = await mapWithConcurrency(
        tournamentIds,
        this.concurrency,
        (tournamentId) => client.initialDump(getsBetTournamentMainTopic({
          operatorId: this.operatorId,
          lang: this.lang,
          tournamentId,
        })),
      );
      const listEvents = normalizeGetsBetPayloads(listPayloads, { fetchedAt });
      const detailPayloads = await mapWithConcurrency(
        listEvents.slice(0, this.maxDetailEvents),
        this.concurrency,
        async (event) => {
          try {
            return await client.initialDump(getsBetMatchDetailTopic({
              operatorId: this.operatorId,
              lang: this.lang,
              matchId: event.externalIds.getsbetMatch,
            }));
          } catch {
            return null;
          }
        },
      );
      const detailEvents = normalizeGetsBetPayloads(detailPayloads.filter(Boolean), { fetchedAt });
      return mergeGetsBetListAndDetails(listEvents, detailEvents);
    } finally {
      client.close();
    }
  }
}

class GetsBetWampClient {
  constructor({
    wsUrl = GETSBET_WS_URL,
    realm = GETSBET_REALM,
    WebSocketImpl = globalThis.WebSocket,
    timeoutMs = 12000,
  } = {}) {
    this.wsUrl = wsUrl;
    this.realm = realm;
    this.WebSocketImpl = WebSocketImpl;
    this.timeoutMs = timeoutMs;
    this.nextRequestId = 1;
    this.pending = new Map();
    this.connected = false;
  }

  async connect() {
    if (typeof this.WebSocketImpl !== 'function') {
      throw new ProviderError('GetsBet requires a WebSocket implementation');
    }

    this.ws = new this.WebSocketImpl(this.wsUrl);
    this.ws.addEventListener('message', (event) => this.handleMessage(event));
    await waitForWebSocketOpen(this.ws, this.timeoutMs);
    this.ws.send(JSON.stringify([
      1,
      this.realm,
      {
        agent: 'Codex odds scraper',
        roles: { caller: {}, subscriber: {} },
        authmethods: ['wampcra'],
        authid: 'webapi-wampy',
      },
    ]));
    await this.waitForWelcome();
    this.connected = true;
  }

  async initialDump(topic) {
    const message = await this.call('/sports#initialDump', { topic });
    return message[4] || {};
  }

  call(procedure, kwargs = {}) {
    if (!this.ws) {
      return Promise.reject(new ProviderError('GetsBet WebSocket is not connected'));
    }
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    this.ws.send(JSON.stringify([48, requestId, {}, procedure, [], kwargs]));
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new ProviderError(`GetsBet WAMP call timed out: ${procedure}`));
      }, this.timeoutMs);
      this.pending.set(requestId, { resolve, reject, timeout });
    });
  }

  waitForWelcome() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new ProviderError('GetsBet WAMP welcome timed out')),
        this.timeoutMs,
      );
      const onMessage = (event) => {
        const message = parseWampMessage(event.data);
        if (message?.[0] === 2) {
          clearTimeout(timeout);
          this.ws.removeEventListener('message', onMessage);
          resolve(message);
        }
      };
      this.ws.addEventListener('message', onMessage);
    });
  }

  handleMessage(event) {
    const message = parseWampMessage(event.data);
    if (!message) {
      return;
    }

    if (message[0] === 50) {
      this.resolvePending(message[1], message);
      return;
    }

    if (message[0] === 8) {
      const requestId = message[2];
      this.rejectPending(
        requestId,
        new ProviderError(`GetsBet WAMP error: ${message[4] || 'unknown'}`),
      );
    }
  }

  resolvePending(requestId, message) {
    const pending = this.pending.get(requestId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pending.delete(requestId);
    pending.resolve(message);
  }

  rejectPending(requestId, error) {
    const pending = this.pending.get(requestId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pending.delete(requestId);
    pending.reject(error);
  }

  close() {
    if (this.ws && this.connected) {
      this.ws.close();
    }
    this.connected = false;
  }
}

async function discoverGetsBetTournamentIds(client, { operatorId, lang, maxTournaments }) {
  const limit = Math.max(1, Number(maxTournaments) || DEFAULT_GETSBET_MAX_TOURNAMENTS);
  const customEvents = await client.initialDump(`/${sportsPath(operatorId, lang)}/custom-events`);
  const footballTournaments = (customEvents.records || [])
    .filter((record) => record?._type === 'TOURNAMENT' && String(record.sportId) === '1')
    .sort(compareGetsBetTournamentInterest);

  const expanded = [];
  const seen = new Set();
  for (const tournament of footballTournaments) {
    if (expanded.length >= limit) {
      break;
    }
    const children = await client.initialDump(
      `/${sportsPath(operatorId, lang)}/tournament-with-children/${tournament.id}`,
    );
    const childIds = (children.records || [])
      .filter((record) =>
        record?._type === 'TOURNAMENT' &&
        record.id !== tournament.id &&
        getsBetTournamentEventCount(record) > 0)
      .sort(compareGetsBetTournamentInterest)
      .map((record) => record.id);
    const ids = childIds.length
      ? childIds
      : getsBetTournamentEventCount(tournament) > 0
        ? [tournament.id]
        : [];

    for (const id of ids) {
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      expanded.push(id);
      if (expanded.length >= limit) {
        break;
      }
    }
  }

  return expanded;
}

function compareGetsBetTournamentInterest(left, right) {
  const countDifference =
    getsBetTournamentEventCount(right) - getsBetTournamentEventCount(left);
  if (countDifference !== 0) {
    return countDifference;
  }
  return String(left?.name || left?.id || '').localeCompare(String(right?.name || right?.id || ''));
}

function getsBetTournamentEventCount(record) {
  const count = Number(record?.numberOfUpcomingMatches ?? record?.numberOfEvents ?? 0);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function normalizeGetsBetPayloads(payloads, { fetchedAt }) {
  return payloads
    .flatMap((payload) => normalizeGetsBetPayload(payload, { fetchedAt }))
    .sort((left, right) => new Date(left.startsAt) - new Date(right.startsAt));
}

function normalizeGetsBetPayload(payload, { fetchedAt }) {
  return normalizeGetsBetRecords(payload?.records || [], { fetchedAt });
}

function normalizeGetsBetRecords(records, { fetchedAt }) {
  const matches = records.filter((record) => record?._type === 'MATCH');
  const marketRows = records.filter((record) => record?._type === 'MARKET');
  const outcomeRows = records.filter((record) => record?._type === 'OUTCOME');
  const relationRows = records.filter((record) => record?._type === 'MARKET_OUTCOME_RELATION');
  const offerRows = records.filter((record) => record?._type === 'BETTING_OFFER');
  const outcomesById = new Map(outcomeRows.map((outcome) => [outcome.id, outcome]));
  const offersByOutcome = new Map(offerRows.map((offer) => [offer.outcomeId, offer]));
  const relationsByMarket = groupBy(relationRows, (relation) => relation.marketId);
  const marketsByEvent = groupBy(marketRows, (market) => market.eventId);

  return matches
    .map((match) => {
      const markets = normalizeGetsBetMarkets(
        marketsByEvent.get(match.id) || [],
        { match, outcomesById, offersByOutcome, relationsByMarket },
      );
      if (!hasAnyCompleteMarket(markets)) {
        return null;
      }
      return {
        id: `getsbet:${match.id}`,
        externalIds: { getsbetMatch: String(match.id) },
        sport: 'Football',
        competition: match.shortParentName || match.parentName || 'GetsBet Football',
        startsAt: new Date(match.startTime).toISOString(),
        homeTeam: match.homeParticipantName,
        awayTeam: match.awayParticipantName,
        bookmakers: [
          {
            name: 'GetsBet',
            lastUpdate: fetchedAt,
            ...bookmakerLinkFields(
              'GetsBet',
              getsBetEventUrl(match),
              'https://www.getsbet.ro/sports',
            ),
            markets,
          },
        ],
      };
    })
    .filter(Boolean);
}

function normalizeGetsBetMarkets(marketRows, context) {
  const result = {};
  for (const market of marketRows) {
    const selections = getsBetMarketSelections(market, context);
    if (selections.length < 2) {
      continue;
    }

    const mapped = normalizeGetsBetMarket(market, selections, context.match);
    for (const item of Array.isArray(mapped) ? mapped : [mapped].filter(Boolean)) {
      if (item.key === 'h2h' && result.h2h && String(market.bettingTypeId) === '693') {
        continue;
      }
      if (item.key === 'h2h' && result.h2h && String(market.bettingTypeId) === '69') {
        result.h2h = item.prices;
        continue;
      }
      if (!result[item.key] && hasCompleteOutcomes(item.prices)) {
        result[item.key] = item.prices;
      }
    }
  }
  return result;
}

function normalizeGetsBetMarket(market, selections, match) {
  const label = normalizeLabel(market.name || market.displayName || market.bettingTypeName);
  const bettingTypeId = String(market.bettingTypeId || '');
  if (bettingTypeId === '69' || bettingTypeId === '693') {
    return outcomeMarket('h2h', selections, { home: 'home', draw: 'draw', away: 'away' }, ['home', 'draw', 'away']);
  }

  if (bettingTypeId === '76' || label.includes('ambele echipe marcheaza') || label.includes('ambele marcheaza')) {
    if (label.includes('pauza') || label.includes('prima repriza') || label.includes('1st half')) {
      return outcomeMarket('firstHalfBothTeamsToScore', selections, { yes: 'yes', no: 'no' }, ['yes', 'no']);
    }
    if (label.includes('a doua') || label.includes('2nd half')) {
      return outcomeMarket('secondHalfBothTeamsToScore', selections, { yes: 'yes', no: 'no' }, ['yes', 'no']);
    }
    return outcomeMarket('bothTeamsToScore', selections, { yes: 'yes', no: 'no' }, ['yes', 'no']);
  }

  if (bettingTypeId === '37' || label.includes('cine merge mai departe')) {
    return outcomeMarket('toQualify', selections, { home: 'home', away: 'away' }, ['home', 'away']);
  }

  if (label.includes('pauza sau final')) {
    return outcomeMarket('halfTimeOrFullTime', selections, {
      home: 'home',
      draw: 'draw',
      away: 'away',
    }, ['home', 'draw', 'away']);
  }

  if (
    label === 'pauza'
    || label === 'prima repriza'
    || label === 'rezultat pauza'
    || (label.includes('1x2') && (label.includes('pauza') || label.includes('prima')))
  ) {
    return outcomeMarket('firstHalfH2h', selections, { home: 'home', draw: 'draw', away: 'away' }, ['home', 'draw', 'away']);
  }

  if (
    label === 'a doua repriza'
    || label === 'rezultat a doua repriza'
    || (label.includes('1x2') && (label.includes('a doua') || label.includes('2nd')))
  ) {
    return outcomeMarket('secondHalfH2h', selections, { home: 'home', draw: 'draw', away: 'away' }, ['home', 'draw', 'away']);
  }

  if (label.includes('pariul se ramburseaza') || label.includes('draw no bet') || label.includes('fara egal')) {
    return outcomeMarket('drawNoBet', selections, { home: 'home', away: 'away' }, ['home', 'away']);
  }

  if (label.includes('sansa dubla') || label.includes('double chance')) {
    const dcKey = (label.includes('pauza') || label.includes('prima'))
      ? 'firstHalfDoubleChance'
      : (label.includes('a doua') || label.includes('2nd'))
        ? 'secondHalfDoubleChance'
        : 'doubleChance';
    return outcomeMarket(dcKey, selections, {
      homeDraw: 'homeDraw',
      homeAway: 'homeAway',
      drawAway: 'drawAway',
    }, ['homeDraw', 'homeAway', 'drawAway']);
  }

  if (
    label.includes('par impar')
    || label.includes('impar par')
    || label.includes('odd even')
    || label.includes('goluri par')
  ) {
    return outcomeMarket('market_total_goluri_impar_par', selections, {
      odd: 'odd',
      even: 'even',
    }, ['odd', 'even']);
  }

  if (label.includes('total cartonase') || label.includes('cartonase peste sub')) {
    return lineMarket(periodLineBaseKey(market, label, {
      fulltime: ['totalCards', 'asianTotalCards'],
      firstHalf: ['firstHalfTotalCards', 'firstHalfAsianTotalCards'],
      secondHalf: ['secondHalfTotalCards', 'secondHalfAsianTotalCards'],
    }), selections, market);
  }

  if (bettingTypeId === '47' && label.includes('total peste sub')) {
    return lineMarket(periodLineBaseKey(market, label, {
      fulltime: ['totalGoals', 'asianTotalGoals'],
      firstHalf: ['firstHalfTotalGoals', 'firstHalfAsianTotalGoals'],
      secondHalf: ['secondHalfTotalGoals', 'secondHalfAsianTotalGoals'],
    }), selections, market);
  }

  if (label.includes('cornere peste sub')) {
    if (teamSideFromMarket(market, match)) {
      return genericGetsBetMarket(market, selections, match);
    }
    return lineMarket(periodLineBaseKey(market, label, {
      fulltime: ['totalCorners', 'asianTotalCorners'],
      firstHalf: ['firstHalfTotalCorners', 'firstHalfAsianTotalCorners'],
      secondHalf: ['secondHalfTotalCorners', 'secondHalfAsianTotalCorners'],
    }), selections, market);
  }

  if (bettingTypeId === '77' && label.includes('total peste sub')) {
    const team = teamSideFromMarket(market, match);
    if (team) {
      return lineMarket(`market_total_goluri_${team}`, selections, market);
    }
  }

  if (label.includes('handicap asiatic')) {
    return handicapMarkets('asianHandicap', selections);
  }

  return genericGetsBetMarket(market, selections, match);
}

function getsBetMarketSelections(market, { outcomesById, offersByOutcome, relationsByMarket, match }) {
  return (relationsByMarket.get(market.id) || [])
    .map((relation) => {
      const outcome = outcomesById.get(relation.outcomeId);
      const offer = offersByOutcome.get(relation.outcomeId);
      if (!outcome || !offer || !isDecimalOdds(offer.odds) || offer.isAvailable === false || String(offer.statusId) !== '1') {
        return null;
      }
      return {
        outcome,
        odds: offer.odds,
        side: getsBetOutcomeSide(outcome, match),
        line: numericLine(outcome.paramFloat1 ?? outcome.paramFloat2 ?? market.paramFloat1 ?? market.paramFloat2),
      };
    })
    .filter(Boolean);
}

function outcomeMarket(key, selections, outcomeMap, required) {
  const prices = {};
  for (const selection of selections) {
    const mapped = outcomeMap[selection.side];
    if (mapped && isDecimalOdds(selection.odds)) {
      prices[mapped] = selection.odds;
    }
  }
  return required.every((outcome) => isDecimalOdds(prices[outcome]))
    ? { key, prices }
    : null;
}

function lineMarket(baseKey, selections, market) {
  const line = numericLine(market.paramFloat1 ?? selections.find((selection) => Number.isFinite(selection.line))?.line);
  if (!Number.isFinite(line)) {
    return null;
  }
  const prices = {};
  for (const selection of selections) {
    if (['over', 'under'].includes(selection.side) && isDecimalOdds(selection.odds)) {
      prices[selection.side] = selection.odds;
    }
  }
  if (!['over', 'under'].every((outcome) => isDecimalOdds(prices[outcome]))) {
    return null;
  }
  return {
    key: `${baseKey}_${formatLine(line).replace('.', '_')}`,
    prices,
  };
}

function periodLineBaseKey(market, label, bases) {
  const period = periodFromMarketLabel(label);
  const [regularKey, asianKey] = bases[period] || bases.fulltime;
  return lineBaseKey(market, regularKey, asianKey);
}

function lineBaseKey(market, regularKey, asianKey) {
  const line = numericLine(market.paramFloat1 ?? market.paramFloat2);
  return Number.isFinite(line) && isHalfLine(line) ? regularKey : asianKey;
}

function periodFromMarketLabel(label) {
  if (/\b(prima repriza|repriza 1|repriza i|pauza|first half|1st half|half time)\b/.test(label)) {
    return 'firstHalf';
  }
  if (/\b(a doua repriza|repriza a doua|repriza 2|repriza ii|second half|2nd half)\b/.test(label)) {
    return 'secondHalf';
  }
  return 'fulltime';
}

function handicapMarkets(baseKey, selections) {
  const grouped = new Map();
  for (const selection of selections) {
    if (!['home', 'away'].includes(selection.side) || !Number.isFinite(selection.line)) {
      continue;
    }
    const homeLine = selection.side === 'home' ? selection.line : -selection.line;
    if (!grouped.has(homeLine)) {
      grouped.set(homeLine, {});
    }
    grouped.get(homeLine)[selection.side] = selection.odds;
  }
  return [...grouped.entries()]
    .filter(([, prices]) => ['home', 'away'].every((outcome) => isDecimalOdds(prices[outcome])))
    .map(([homeLine, prices]) => ({ key: handicapMarketKey(baseKey, homeLine), prices }));
}

function genericGetsBetMarket(market, selections, match) {
  const label = abstractTeamNames(market.name || market.displayName || '', match);
  const line = numericLine(market.paramFloat1 ?? market.paramFloat2);
  const prices = {};
  for (const selection of selections) {
    if (selection.side && isDecimalOdds(selection.odds)) {
      prices[selection.side] = selection.odds;
    }
  }
  const key = genericMarketKey(label, Number.isFinite(line) ? { line: formatLine(line) } : undefined);
  return key && hasCompleteOutcomes(prices) ? { key, prices } : null;
}

function getsBetOutcomeSide(outcome, match) {
  const header = normalizeOutcomeKey(outcome.headerNameKey || outcome.headerName || '');
  if (['home', 'draw', 'away', 'over', 'under', 'yes', 'no'].includes(header)) {
    return header;
  }

  const label = normalizeLabel(outcome.translatedName || outcome.shortTranslatedName || outcome.typeName);
  if (sameTeam(label, match.homeParticipantName)) {
    return 'home';
  }
  if (sameTeam(label, match.awayParticipantName)) {
    return 'away';
  }
  if (label.includes('1x')) {
    return 'homeDraw';
  }
  if (label.includes('x2')) {
    return 'drawAway';
  }
  if (label === '12' || label.includes('1 2')) {
    return 'homeAway';
  }
  return normalizeOutcomeKey(label);
}

function teamSideFromMarket(market, match) {
  const label = normalizeLabel(market.name || '');
  if (normalizeLabel(match.homeParticipantName) && label.includes(normalizeLabel(match.homeParticipantName))) {
    return 'home';
  }
  if (normalizeLabel(match.awayParticipantName) && label.includes(normalizeLabel(match.awayParticipantName))) {
    return 'away';
  }
  return null;
}

function mergeGetsBetListAndDetails(listEvents, detailEvents) {
  const byId = new Map(listEvents.map((event) => [event.externalIds.getsbetMatch, event]));
  for (const detailEvent of detailEvents) {
    byId.set(detailEvent.externalIds.getsbetMatch, detailEvent);
  }
  return [...byId.values()].sort((left, right) => new Date(left.startsAt) - new Date(right.startsAt));
}

function getsBetTournamentMainTopic({ operatorId, lang, tournamentId }) {
  return `/${sportsPath(operatorId, lang)}/tournament-aggregator-groups-overview/${tournamentId}/default-event-info/NOT_LIVE/${GETSBET_MAIN_GROUP_ID}`;
}

function getsBetMatchDetailTopic({ operatorId, lang, matchId }) {
  return `/${sportsPath(operatorId, lang)}/${matchId}/match-odds/market-group/${GETSBET_DETAIL_GROUP}`;
}

function sportsPath(operatorId, lang) {
  return `sports/${operatorId}/${lang}`;
}

function waitForWebSocketOpen(ws, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new ProviderError('GetsBet WebSocket connection timed out')),
      timeoutMs,
    );
    ws.addEventListener('open', () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
    ws.addEventListener('error', (error) => {
      clearTimeout(timeout);
      reject(new ProviderError(`Unable to reach GetsBet WebSocket: ${error.message || 'connection error'}`));
    }, { once: true });
  });
}

function parseWampMessage(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function groupBy(values, keyFn) {
  const groups = new Map();
  for (const value of values) {
    const key = keyFn(value);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(value);
  }
  return groups;
}

function mapWithConcurrency(items, concurrency, iteratee) {
  const limit = Math.max(1, Number(concurrency) || 1);
  const results = new Array(items.length);
  let index = 0;
  return Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (index < items.length) {
        const currentIndex = index;
        index += 1;
        results[currentIndex] = await iteratee(items[currentIndex], currentIndex);
      }
    }),
  ).then(() => results);
}

function numericLine(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : Number.NaN;
}

function isHalfLine(value) {
  return Math.abs(Math.abs(value % 1) - 0.5) < 0.000001;
}

function normalizeLabel(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}+.\-]+/gu, ' ')
    .trim();
}

function sameTeam(value, team) {
  return value && team && value === normalizeLabel(team);
}

function abstractTeamNames(value, match) {
  let label = String(value || '');
  if (match.homeParticipantName) {
    label = label.replaceAll(match.homeParticipantName, 'Home');
  }
  if (match.awayParticipantName) {
    label = label.replaceAll(match.awayParticipantName, 'Away');
  }
  return label;
}

module.exports = {
  DEFAULT_GETSBET_CONCURRENCY,
  DEFAULT_GETSBET_MAX_DETAIL_EVENTS,
  DEFAULT_GETSBET_MAX_TOURNAMENTS,
  GETSBET_DETAIL_GROUP,
  GETSBET_MAIN_GROUP_ID,
  GETSBET_OPERATOR_ID,
  GETSBET_REALM,
  GETSBET_WS_URL,
  GetsBetProvider,
  GetsBetWampClient,
  discoverGetsBetTournamentIds,
  getsBetMatchDetailTopic,
  getsBetTournamentMainTopic,
  normalizeGetsBetPayload,
  normalizeGetsBetRecords,
};
