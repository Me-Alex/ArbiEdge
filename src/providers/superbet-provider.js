const { ProviderError } = require('./the-odds-api-provider');
const {
  formatLine,
  genericMarketKey,
  handicapMarketKey,
  hasAnyCompleteMarket,
  hasCompleteOutcomes,
  isDecimalOdds,
  isMatchBothTeamsToScoreLabel,
  isMatchDrawNoBetLabel,
  isMatchDoubleChanceLabel,
  normalizeOutcomeKey,
  splitFixtureName,
} = require('./market-utils');
const { bookmakerLinkFields, superbetEventUrl } = require('./event-links');

const SUPERBET_EVENTS_URL =
  'https://production-superbet-offer-ro.freetls.fastly.net/v2/ro-RO/events/by-date';
const SUPERBET_EVENT_DETAILS_URL =
  'https://production-superbet-offer-ro.freetls.fastly.net/v2/ro-RO/events';
const DEFAULT_LOOKAHEAD_DAYS = 60;
const DEFAULT_DETAILS_CONCURRENCY = 8;

class SuperbetProvider {
  constructor({
    detailsConcurrency = DEFAULT_DETAILS_CONCURRENCY,
    fetchImpl = globalThis.fetch,
    lookaheadDays = DEFAULT_LOOKAHEAD_DAYS,
    timeoutMs = 8000,
    now = () => new Date(),
  } = {}) {
    this.name = 'Superbet';
    this.fetchImpl = fetchImpl;
    this.lookaheadDays = lookaheadDays;
    this.timeoutMs = timeoutMs;
    this.now = now;
    this.detailsConcurrency = detailsConcurrency;
  }

  async getOdds() {
    const start = this.now();
    const end = new Date(start.getTime() + this.lookaheadDays * 24 * 60 * 60 * 1000);
    const url = new URL(SUPERBET_EVENTS_URL);
    url.search = new URLSearchParams({
      currentStatus: 'active',
      offerState: 'prematch',
      startDate: formatDate(start),
      endDate: formatDate(end),
      sportId: '5',
    });
    const response = await this.fetchImpl(url, {
      headers: { accept: 'application/json', referer: 'https://superbet.ro/' },
      signal: AbortSignal.timeout(this.timeoutMs),
    }).catch((error) => {
      throw new ProviderError(`Unable to reach Superbet: ${error.message}`, { cause: error });
    });
    if (!response.ok) throw new ProviderError(`Superbet returned HTTP ${response.status}`, { status: response.status });
    const payload = await response.json();
    return normalizeSuperbetPayload(
      await this.hydrateEventDetails(payload),
      start.toISOString(),
    );
  }

  async hydrateEventDetails(payload) {
    const events = Array.isArray(payload?.data) ? payload.data : [];
    if (events.length === 0) {
      return payload;
    }

    return {
      ...payload,
      data: await mapWithConcurrency(
        events,
        this.detailsConcurrency,
        (event) => this.fetchEventDetails(event),
      ),
    };
  }

  async fetchEventDetails(event) {
    if (!event?.eventId) {
      return event;
    }

    const url = new URL(`${SUPERBET_EVENT_DETAILS_URL}/${event.eventId}`);
    const response = await this.fetchImpl(url, {
      headers: { accept: 'application/json', referer: 'https://superbet.ro/' },
      signal: AbortSignal.timeout(this.timeoutMs),
    }).catch(() => null);

    if (!response?.ok) {
      return event;
    }

    const payload = await response.json().catch(() => null);
    const details = Array.isArray(payload?.data) ? payload.data[0] : payload?.data;
    if (
      details &&
      Array.isArray(details.odds) &&
      details.odds.length >= (event.odds?.length || 0)
    ) {
      return { ...event, ...details };
    }

    return event;
  }
}

function normalizeSuperbetPayload(payload, fetchedAt) {
  return (Array.isArray(payload?.data) ? payload.data : []).map((event) => {
    const teams = splitFixtureName(event.matchName);
    const startsAt = new Date(event.utcDate || event.unixDateMillis);
    const markets = normalizeSuperbetMarkets(event.odds, {
      homeTeam: teams[0],
      awayTeam: teams[1],
    });

    if (
      teams.length !== 2 ||
      !hasAnyCompleteMarket(markets) ||
      Number.isNaN(startsAt.getTime())
    ) {
      return null;
    }

    return {
      id: `superbet:${event.eventId}`,
      externalIds: {
        superbetEvent: String(event.eventId),
        ...(event.uuid ? { superbetUuid: String(event.uuid) } : {}),
        ...(event.betradarId ? { sportradar: String(event.betradarId) } : {}),
      },
      sport: 'Football',
      competition: event.tournamentName || 'Superbet Football',
      startsAt: startsAt.toISOString(),
      homeTeam: teams[0],
      awayTeam: teams[1],
      bookmakers: [{
        name: 'Superbet',
        lastUpdate: fetchedAt,
        ...bookmakerLinkFields('Superbet', superbetEventUrl(event)),
        markets,
      }],
    };
  }).filter(Boolean);
}

function normalizeSuperbetMarkets(odds, { homeTeam, awayTeam } = {}) {
  const markets = {};
  for (const group of groupSuperbetOdds(odds)) {
    const normalized = normalizeSuperbetMarketGroup(group, { homeTeam, awayTeam });
    for (const market of Array.isArray(normalized) ? normalized : [normalized].filter(Boolean)) {
      addMarket(markets, market.key, market.prices);
    }
  }
  return markets;
}

function groupSuperbetOdds(odds) {
  const groups = new Map();
  for (const odd of Array.isArray(odds) ? odds : []) {
    if (odd?.status !== 'active' || !isDecimalOdds(odd.price)) {
      continue;
    }

    const key = odd.marketUuid ||
      [
        odd.marketId,
        odd.marketName,
        odd.specialBetValue || odd.showSpecialBetValue || '',
      ].join(':');
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(odd);
  }
  return [...groups.values()];
}

function normalizeSuperbetMarketGroup(group, { homeTeam, awayTeam }) {
  const label = group[0]?.marketName || group[0]?.name || '';
  const normalizedLabel = normalizeLabel(label);

  if (normalizedLabel === 'final') {
    return mapSuperbetOutcomes(
      group,
      'h2h',
      { 1: 'home', x: 'draw', 2: 'away' },
      ['home', 'draw', 'away'],
    );
  }

  // Period 1X2 — common Superbet RO labels
  if (
    normalizedLabel === 'pauza'
    || normalizedLabel === 'prima repriza'
    || normalizedLabel === '1st half'
    || normalizedLabel === 'half time'
  ) {
    return mapSuperbetOutcomes(
      group,
      'firstHalfH2h',
      { 1: 'home', x: 'draw', 2: 'away' },
      ['home', 'draw', 'away'],
    );
  }

  if (
    normalizedLabel === 'a doua repriza'
    || normalizedLabel === 'repriza 2'
    || normalizedLabel === '2nd half'
    || normalizedLabel === 'second half'
  ) {
    return mapSuperbetOutcomes(
      group,
      'secondHalfH2h',
      { 1: 'home', x: 'draw', 2: 'away' },
      ['home', 'draw', 'away'],
    );
  }

  if (isMatchDoubleChanceLabel(label)) {
    return mapSuperbetOutcomes(
      group,
      'doubleChance',
      { '1x': 'homeDraw', 12: 'homeAway', x2: 'drawAway' },
      ['homeDraw', 'homeAway', 'drawAway'],
    );
  }

  if (
    normalizedLabel === 'sansa dubla pauza'
    || normalizedLabel === 'sansa dubla prima repriza'
    || normalizedLabel === 'double chance 1st half'
    || normalizedLabel === '1st half double chance'
  ) {
    return mapSuperbetOutcomes(
      group,
      'firstHalfDoubleChance',
      { '1x': 'homeDraw', 12: 'homeAway', x2: 'drawAway' },
      ['homeDraw', 'homeAway', 'drawAway'],
    );
  }

  if (
    normalizedLabel === 'sansa dubla a doua repriza'
    || normalizedLabel === 'sansa dubla repriza 2'
    || normalizedLabel === '2nd half double chance'
    || normalizedLabel === 'double chance 2nd half'
  ) {
    return mapSuperbetOutcomes(
      group,
      'secondHalfDoubleChance',
      { '1x': 'homeDraw', 12: 'homeAway', x2: 'drawAway' },
      ['homeDraw', 'homeAway', 'drawAway'],
    );
  }

  if (isMatchBothTeamsToScoreLabel(label)) {
    return mapSuperbetOutcomes(
      group,
      'bothTeamsToScore',
      { da: 'yes', yes: 'yes', nu: 'no', no: 'no' },
      ['yes', 'no'],
    );
  }

  if (
    normalizedLabel === 'ambele marcheaza pauza'
    || normalizedLabel === 'ambele echipe marcheaza pauza'
    || normalizedLabel === 'ambele marcheaza prima repriza'
    || normalizedLabel === 'gg ng pauza'
  ) {
    return mapSuperbetOutcomes(
      group,
      'firstHalfBothTeamsToScore',
      { da: 'yes', yes: 'yes', nu: 'no', no: 'no' },
      ['yes', 'no'],
    );
  }

  if (
    normalizedLabel.includes('fara egal')
    || normalizedLabel.includes('draw no bet')
    || normalizedLabel.includes('egal pariu')
    || isMatchDrawNoBetLabel(label)
  ) {
    const dnbKey = (normalizedLabel.includes('pauza') || normalizedLabel.includes('prima'))
      ? 'firstHalfDrawNoBet'
      : (normalizedLabel.includes('a doua') || normalizedLabel.includes('2nd'))
        ? 'secondHalfDrawNoBet'
        : 'drawNoBet';
    return mapSuperbetTeamOutcomes(group, dnbKey, { homeTeam, awayTeam });
  }

  if (normalizedLabel === 'pauza sau final') {
    return mapSuperbetTeamOutcomes(group, 'halfTimeOrFullTime', {
      homeTeam,
      awayTeam,
      includeDraw: true,
    });
  }

  if (
    normalizedLabel === 'total goluri par impar'
    || normalizedLabel === 'total goluri impar par'
    || normalizedLabel === 'goluri par impar'
    || normalizedLabel === 'odd even'
    || normalizedLabel === 'par impar'
  ) {
    return mapSuperbetOutcomes(
      group,
      'market_total_goluri_impar_par',
      {
        par: 'even',
        even: 'even',
        impar: 'odd',
        odd: 'odd',
      },
      ['odd', 'even'],
    );
  }

  if (normalizedLabel === 'total goluri') {
    return mapSuperbetLineMarket(group, 'totalGoals');
  }

  if (
    normalizedLabel === 'prima repriza total goluri'
    || normalizedLabel === 'total goluri pauza'
    || normalizedLabel === 'total goluri prima repriza'
  ) {
    return mapSuperbetLineMarket(group, 'firstHalfTotalGoals');
  }

  if (
    normalizedLabel === 'a doua repriza total goluri'
    || normalizedLabel === 'total goluri a doua repriza'
    || normalizedLabel === 'total goluri repriza 2'
  ) {
    return mapSuperbetLineMarket(group, 'secondHalfTotalGoals');
  }

  if (normalizedLabel === 'total goluri asiatice') {
    return mapSuperbetLineMarket(group, 'asianTotalGoals');
  }

  if (
    normalizedLabel === 'prima repriza total goluri asiatice'
    || normalizedLabel === 'total goluri asiatice pauza'
    || normalizedLabel === '1st half asian total goals'
  ) {
    return mapSuperbetLineMarket(group, 'firstHalfAsianTotalGoals');
  }

  if (
    normalizedLabel === 'a doua repriza total goluri asiatice'
    || normalizedLabel === 'total goluri asiatice a doua repriza'
    || normalizedLabel === '2nd half asian total goals'
  ) {
    return mapSuperbetLineMarket(group, 'secondHalfAsianTotalGoals');
  }

  if (
    normalizedLabel === 'total cartonase asiatice'
    || normalizedLabel === 'cartonase asiatice'
    || normalizedLabel === 'asian total cards'
  ) {
    return mapSuperbetLineMarket(group, 'asianTotalCards');
  }

  if (normalizedLabel === 'total cornere' || normalizedLabel === 'total corners') {
    return mapSuperbetLineMarket(group, 'totalCorners');
  }

  if (
    normalizedLabel === 'total cartonase'
    || normalizedLabel === 'total cartonase galbene'
    || normalizedLabel === 'total cards'
  ) {
    return mapSuperbetLineMarket(group, 'totalCards');
  }

  if (normalizedLabel === 'handicap' || normalizedLabel === 'handicap asiatic') {
    return mapSuperbetHandicapMarket(
      group,
      normalizedLabel === 'handicap' ? 'handicap' : 'asianHandicap',
    );
  }

  if (
    normalizedLabel === 'ambele marcheaza a doua repriza'
    || normalizedLabel === 'ambele echipe marcheaza a doua repriza'
    || normalizedLabel === 'gg ng a doua repriza'
    || normalizedLabel === '2nd half both teams to score'
  ) {
    return mapSuperbetOutcomes(
      group,
      'secondHalfBothTeamsToScore',
      { da: 'yes', yes: 'yes', nu: 'no', no: 'no' },
      ['yes', 'no'],
    );
  }

  if (
    normalizedLabel === 'total cornere asiatice'
    || normalizedLabel === 'cornere asiatice'
    || normalizedLabel === 'asian total corners'
  ) {
    return mapSuperbetLineMarket(group, 'asianTotalCorners');
  }

  if (
    normalizedLabel.includes('total goluri')
    && (normalizedLabel.includes('gazde') || normalizedLabel.includes('home') || normalizedLabel.includes('echipa 1'))
  ) {
    return mapSuperbetLineMarket(group, 'market_total_goluri_home');
  }

  if (
    normalizedLabel.includes('total goluri')
    && (normalizedLabel.includes('oaspeti') || normalizedLabel.includes('away') || normalizedLabel.includes('echipa 2'))
  ) {
    return mapSuperbetLineMarket(group, 'market_total_goluri_away');
  }

  if (
    normalizedLabel === 'gazdele marcheaza'
    || normalizedLabel === 'gazde marcheaza'
    || normalizedLabel === 'home to score'
    || normalizedLabel === 'echipa gazda marcheaza'
  ) {
    return mapSuperbetOutcomes(
      group,
      'market_marcheaza_home',
      { da: 'yes', yes: 'yes', nu: 'no', no: 'no' },
      ['yes', 'no'],
    );
  }

  if (
    normalizedLabel === 'oaspetii marcheaza'
    || normalizedLabel === 'oaspeti marcheaza'
    || normalizedLabel === 'away to score'
    || normalizedLabel === 'echipa oaspete marcheaza'
  ) {
    return mapSuperbetOutcomes(
      group,
      'market_marcheaza_away',
      { da: 'yes', yes: 'yes', nu: 'no', no: 'no' },
      ['yes', 'no'],
    );
  }

  if (
    normalizedLabel.includes('fara gol primit')
    || normalizedLabel.includes('clean sheet')
  ) {
    const side = (normalizedLabel.includes('gazde') || normalizedLabel.includes('home') || normalizedLabel.includes('gazda'))
      ? 'home'
      : (normalizedLabel.includes('oaspeti') || normalizedLabel.includes('away') || normalizedLabel.includes('oaspete'))
        ? 'away'
        : null;
    if (side) {
      return mapSuperbetOutcomes(
        group,
        `market_clean_sheet_${side}`,
        { da: 'yes', yes: 'yes', nu: 'no', no: 'no' },
        ['yes', 'no'],
      );
    }
  }

  if (
    normalizedLabel.includes('se califica')
    || normalizedLabel.includes('cine merge mai departe')
    || normalizedLabel === 'to qualify'
  ) {
    return mapSuperbetTeamOutcomes(group, 'toQualify', { homeTeam, awayTeam });
  }

  return normalizeGenericSuperbetMarket(group, { homeTeam, awayTeam });
}

function mapSuperbetOutcomes(group, key, outcomeMap, required) {
  const prices = {};
  for (const odd of group) {
    const mapped = outcomeMap[normalizeLabel(odd.name).replace(/\s+/g, '')];
    if (mapped && isDecimalOdds(odd.price)) {
      prices[mapped] = odd.price;
    }
  }
  return required.every((outcome) => isDecimalOdds(prices[outcome]))
    ? { key, prices }
    : null;
}

function mapSuperbetTeamOutcomes(group, key, { homeTeam, awayTeam, includeDraw = false }) {
  const prices = {};
  for (const odd of group) {
    const outcome = normalizeSuperbetOutcomeKey(odd.name, { homeTeam, awayTeam });
    if (['home', 'away'].includes(outcome) || (includeDraw && outcome === 'draw')) {
      prices[outcome] = odd.price;
    }
  }

  const required = includeDraw ? ['home', 'draw', 'away'] : ['home', 'away'];
  return required.every((outcome) => isDecimalOdds(prices[outcome]))
    ? { key, prices }
    : null;
}

function mapSuperbetLineMarket(group, baseKey) {
  const prices = {};
  let line = null;
  for (const odd of group) {
    const parsed = parseSuperbetLineOutcome(odd.name);
    if (!parsed) {
      continue;
    }
    line = line || parsed.line;
    if (parsed.line === line && isDecimalOdds(odd.price)) {
      prices[parsed.side] = odd.price;
    }
  }

  return line && ['over', 'under'].every((outcome) => isDecimalOdds(prices[outcome]))
    ? { key: `${baseKey}_${line.replace('.', '_')}`, prices }
    : null;
}

function mapSuperbetHandicapMarket(group, baseKey) {
  const groups = new Map();
  for (const odd of group) {
    const parsed = parseSuperbetHandicapOutcome(odd.name);
    if (!parsed || !isDecimalOdds(odd.price)) {
      continue;
    }
    const homeLine = parsed.side === 'home' ? parsed.line : -parsed.line;
    const key = formatLine(homeLine);
    if (!groups.has(key)) {
      groups.set(key, { homeLine, prices: {} });
    }
    groups.get(key).prices[parsed.side] = odd.price;
  }

  return [...groups.values()]
    .filter(({ prices }) => ['home', 'away'].every((outcome) => isDecimalOdds(prices[outcome])))
    .map(({ homeLine, prices }) => ({ key: handicapMarketKey(baseKey, homeLine), prices }));
}

function normalizeGenericSuperbetMarket(group, { homeTeam, awayTeam }) {
  const label = abstractTeamNames(group[0]?.marketName || group[0]?.name || '', {
    homeTeam,
    awayTeam,
  });
  const prices = {};
  for (const odd of group) {
    const outcomeKey = normalizeSuperbetOutcomeKey(odd.name, { homeTeam, awayTeam });
    if (outcomeKey && isDecimalOdds(odd.price)) {
      prices[outcomeKey] = odd.price;
    }
  }

  const line = extractSuperbetLine(group);
  const key = genericMarketKey(label, line ? { line } : undefined);
  return key && hasCompleteOutcomes(prices) ? { key, prices } : null;
}

function parseSuperbetLineOutcome(value) {
  const match = normalizeLabel(value).match(/\b(peste|over|sub|under)\s+([0-9]+(?:[.,][0-9]+)?)/);
  if (!match) {
    return null;
  }
  return {
    side: ['peste', 'over'].includes(match[1]) ? 'over' : 'under',
    line: formatLine(match[2].replace(',', '.')),
  };
}

function parseSuperbetHandicapOutcome(value) {
  const match = String(value || '').trim().match(/^(1|2)\s*\(?([+-]?[0-9]+(?:[.,][0-9]+)?)\)?/);
  if (!match) {
    return null;
  }

  return {
    side: match[1] === '1' ? 'home' : 'away',
    line: Number(match[2].replace(',', '.')),
  };
}

function extractSuperbetLine(group) {
  const value = group[0]?.specialBetValue;
  if (/^[+-]?[0-9]+(?:[.,][0-9]+)?$/.test(String(value || ''))) {
    return formatLine(String(value).replace(',', '.'));
  }

  for (const odd of group) {
    const parsed = parseSuperbetLineOutcome(odd.name);
    if (parsed) {
      return parsed.line;
    }
  }

  const labelMatch = String(group[0]?.marketName || '').match(/\(([0-9]+(?:[.,][0-9]+)?)\)/);
  return labelMatch ? formatLine(labelMatch[1].replace(',', '.')) : null;
}

function normalizeSuperbetOutcomeKey(value, { homeTeam, awayTeam }) {
  const normalized = normalizeLabel(value);
  if (sameTeamLabel(normalized, homeTeam)) {
    return 'home';
  }
  if (sameTeamLabel(normalized, awayTeam)) {
    return 'away';
  }
  if (normalized === 'egalitate' || normalized === 'egal') {
    return 'draw';
  }
  return normalizeOutcomeKey(value);
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

function sameTeamLabel(value, team) {
  return value && team && value === normalizeLabel(team);
}

function normalizeLabel(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}+\-.]+/gu, ' ')
    .trim();
}

function addMarket(markets, key, prices) {
  if (!markets[key]) {
    markets[key] = prices;
  }
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

function formatDate(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

module.exports = {
  DEFAULT_DETAILS_CONCURRENCY,
  DEFAULT_LOOKAHEAD_DAYS,
  SUPERBET_EVENT_DETAILS_URL,
  SUPERBET_EVENTS_URL,
  SuperbetProvider,
  normalizeSuperbetMarkets,
  normalizeSuperbetPayload,
};
