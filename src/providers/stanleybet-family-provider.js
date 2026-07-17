const { mergeEvents } = require('./composite-provider');
const { absoluteEventUrl, bookmakerLinkFields } = require('./event-links');
const {
  formatLine,
  genericMarketKey,
  handicapMarketKey,
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

    if (marketKey === 'firstHalfH2h' || marketKey === 'secondHalfH2h') {
      const prices = outcomePrices(market, {
        home: 'home',
        draw: 'draw',
        away: 'away',
      });
      if (hasOutcomes(prices, ['home', 'draw', 'away']) && !normalized[marketKey]) {
        normalized[marketKey] = prices;
      }
      continue;
    }

    if (
      marketKey === 'doubleChance'
      || marketKey === 'firstHalfDoubleChance'
      || marketKey === 'secondHalfDoubleChance'
    ) {
      const doubleChance = outcomePrices(market, {
        homeDraw: 'homeDraw',
        homeAway: 'homeAway',
        drawAway: 'drawAway',
      });
      if (hasOutcomes(doubleChance, ['homeDraw', 'homeAway', 'drawAway']) && !normalized[marketKey]) {
        normalized[marketKey] = doubleChance;
      }
      continue;
    }

    if (
      marketKey === 'drawNoBet'
      || marketKey === 'firstHalfDrawNoBet'
      || marketKey === 'secondHalfDrawNoBet'
    ) {
      const prices = outcomePrices(market, { home: 'home', away: 'away' });
      if (hasOutcomes(prices, ['home', 'away']) && !normalized[marketKey]) {
        normalized[marketKey] = prices;
      }
      continue;
    }

    if (isTotalGoalsMarket(marketKey, market)) {
      addTotalGoalsMarket(normalized, market, totalGoalsBaseKey(marketKey, market));
      continue;
    }

    if (isAsianHandicapMarket(marketKey, market)) {
      addAsianHandicapMarket(normalized, market);
      continue;
    }

    if (isBothTeamsToScoreMarket(marketKey, market)) {
      const prices = outcomePrices(market, {
        yes: 'yes',
        no: 'no',
      });
      const bttsKey = bothTeamsToScoreKey(marketKey, market);
      if (hasOutcomes(prices, ['yes', 'no']) && !normalized[bttsKey]) {
        normalized[bttsKey] = prices;
      }
      continue;
    }

    if (marketKey === 'market_total_goluri_impar_par' || isOddEvenGoalsMarket(market)) {
      const prices = outcomePrices(market, { odd: 'odd', even: 'even' });
      if (hasOutcomes(prices, ['odd', 'even']) && !normalized.market_total_goluri_impar_par) {
        normalized.market_total_goluri_impar_par = prices;
      }
      continue;
    }

    if (isTeamScoreMarket(marketKey, market)) {
      const prices = outcomePrices(market, { yes: 'yes', no: 'no' });
      const scoreKey = teamScoreMarketKey(marketKey, market);
      if (hasOutcomes(prices, ['yes', 'no']) && scoreKey && !normalized[scoreKey]) {
        normalized[scoreKey] = prices;
      }
      continue;
    }

    if (isCleanSheetMarket(marketKey, market)) {
      const prices = outcomePrices(market, { yes: 'yes', no: 'no' });
      const csKey = cleanSheetMarketKey(marketKey, market);
      if (hasOutcomes(prices, ['yes', 'no']) && csKey && !normalized[csKey]) {
        normalized[csKey] = prices;
      }
      continue;
    }

    if (marketKey === 'toQualify' || isToQualifyMarket(market)) {
      const prices = outcomePrices(market, { home: 'home', away: 'away' });
      if (hasOutcomes(prices, ['home', 'away']) && !normalized.toQualify) {
        normalized.toQualify = prices;
      }
      continue;
    }

    const prices = genericOutcomePrices(market);
    if (marketKey && hasAnyCompleteMarket({ [marketKey]: prices }) && !normalized[marketKey]) {
      normalized[marketKey] = prices;
    }
  }
  return normalized;
}

function isTeamScoreMarket(marketKey, market) {
  if (marketKey === 'market_marcheaza_home' || marketKey === 'market_marcheaza_away') return true;
  const key = labelKey(market?.name);
  return key.includes('marcheaza') || key.includes('to_score') || key.includes('sa_inscrie');
}

function teamScoreMarketKey(marketKey, market) {
  if (marketKey === 'market_marcheaza_home' || marketKey === 'market_marcheaza_away') return marketKey;
  const key = labelKey(market?.name);
  if (key.includes('gazda') || key.includes('gazde') || key.includes('home') || key.includes('echipa_1')) {
    return 'market_marcheaza_home';
  }
  if (key.includes('oaspete') || key.includes('oaspeti') || key.includes('away') || key.includes('echipa_2')) {
    return 'market_marcheaza_away';
  }
  return null;
}

function isCleanSheetMarket(marketKey, market) {
  if (marketKey === 'market_clean_sheet_home' || marketKey === 'market_clean_sheet_away') return true;
  const key = labelKey(market?.name);
  return key.includes('clean_sheet') || key.includes('fara_gol_primit');
}

function cleanSheetMarketKey(marketKey, market) {
  if (marketKey === 'market_clean_sheet_home' || marketKey === 'market_clean_sheet_away') return marketKey;
  const key = labelKey(market?.name);
  if (key.includes('gazda') || key.includes('gazde') || key.includes('home')) return 'market_clean_sheet_home';
  if (key.includes('oaspete') || key.includes('oaspeti') || key.includes('away')) return 'market_clean_sheet_away';
  return null;
}

function isToQualifyMarket(market) {
  const key = labelKey(market?.name);
  return key.includes('califica') || key.includes('to_qualify') || key.includes('merge_mai_departe');
}

function addTotalGoalsMarket(markets, market, baseKey = 'totalGoals') {
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
      markets[`${baseKey}_${formatLine(line).replace('.', '_')}`] = prices;
    }
  }
}

function totalGoalsBaseKey(marketKey, market) {
  if ([
    'totalGoals',
    'asianTotalGoals',
    'firstHalfTotalGoals',
    'secondHalfTotalGoals',
    'totalCorners',
    'totalCards',
    'firstHalfTotalCorners',
    'secondHalfTotalCorners',
  ].includes(marketKey)) {
    return marketKey;
  }
  const key = labelKey(market?.name);
  if (key.includes('cornere') || key.includes('corner')) {
    if (key.includes('pauza') || key.includes('prima') || key.includes('1st')) return 'firstHalfTotalCorners';
    if (key.includes('a_doua') || key.includes('2nd')) return 'secondHalfTotalCorners';
    return 'totalCorners';
  }
  if (key.includes('cartonas') || key.includes('card') || key.includes('booking')) {
    return 'totalCards';
  }
  if (key.includes('asiatic') || key.includes('asian')) return 'asianTotalGoals';
  if (key.includes('pauza') || key.includes('prima_repriza') || key.includes('1st_half')) {
    return 'firstHalfTotalGoals';
  }
  if (key.includes('a_doua') || key.includes('repriza_2') || key.includes('2nd_half')) {
    return 'secondHalfTotalGoals';
  }
  return 'totalGoals';
}

function bothTeamsToScoreKey(marketKey, market) {
  if (
    marketKey === 'firstHalfBothTeamsToScore'
    || marketKey === 'secondHalfBothTeamsToScore'
    || marketKey === 'bothTeamsToScore'
  ) {
    return marketKey;
  }
  const key = labelKey(market?.name);
  if (key.includes('pauza') || key.includes('prima') || key.includes('1st')) {
    return 'firstHalfBothTeamsToScore';
  }
  if (key.includes('a_doua') || key.includes('2nd')) {
    return 'secondHalfBothTeamsToScore';
  }
  return 'bothTeamsToScore';
}

function isOddEvenGoalsMarket(market) {
  const key = labelKey(market?.name);
  return (
    (key.includes('par') && key.includes('impar'))
    || key.includes('odd_even')
    || key.includes('oddeven')
  );
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

function isAsianHandicapMarket(marketKey, market) {
  if (marketKey === 'asianHandicap' || marketKey === 'handicap') return true;
  const key = labelKey(market?.name);
  return (
    key.includes('handicap_asiatic')
    || key.includes('asian_handicap')
    || key.includes('handicap_asiat')
    || (key.includes('handicap') && key.includes('asiatic'))
    || key === 'handicap_asiatic'
  );
}

function addAsianHandicapMarket(markets, market) {
  const grouped = new Map();
  for (const outcome of activeOutcomes(market)) {
    const parsed = parseStanleybetHandicapOutcome(outcome.name || outcome.shortcut);
    if (!parsed || !isDecimalOdds(outcome.odd)) continue;
    if (!grouped.has(parsed.homeLine)) grouped.set(parsed.homeLine, {});
    grouped.get(parsed.homeLine)[parsed.side] = outcome.odd;
  }
  for (const [homeLine, prices] of grouped.entries()) {
    if (hasOutcomes(prices, ['home', 'away'])) {
      const key = handicapMarketKey('asianHandicap', homeLine);
      if (key && !markets[key]) markets[key] = prices;
    }
  }
}

function parseStanleybetHandicapOutcome(value) {
  const raw = String(value || '').trim();
  // H1 -0.5 / H2 +0.5
  let match = raw.match(/^H([12])\s*([+-]?\d+(?:[.,]\d+)?)$/i);
  if (match) {
    const side = match[1] === '1' ? 'home' : 'away';
    const line = Number(match[2].replace(',', '.'));
    return { side, homeLine: side === 'home' ? line : -line };
  }
  // 1 (-0.5) / 2 (+0.5)
  match = raw.match(/^([12])\s*[(\[]?\s*([+-]?\d+(?:[.,]\d+)?)\s*[)\]]?$/);
  if (match) {
    const side = match[1] === '1' ? 'home' : 'away';
    const line = Number(match[2].replace(',', '.'));
    return { side, homeLine: side === 'home' ? line : -line };
  }
  // Home (-0.5) / Away (+0.5) after normalizeOutcomeKey paths
  match = raw.match(/^(home|away|1|2|gazda|oaspete)\s*[(\[]?\s*([+-]?\d+(?:[.,]\d+)?)\s*[)\]]?$/i);
  if (match) {
    const token = match[1].toLowerCase();
    const side = (token === '1' || token === 'home' || token === 'gazda') ? 'home' : 'away';
    const line = Number(match[2].replace(',', '.'));
    return { side, homeLine: side === 'home' ? line : -line };
  }
  return null;
}

function isBothTeamsToScoreMarket(marketKey, market) {
  if (
    marketKey === 'bothTeamsToScore'
    || marketKey === 'firstHalfBothTeamsToScore'
    || marketKey === 'secondHalfBothTeamsToScore'
  ) {
    return true;
  }
  const key = labelKey(market?.name);
  return (
    key.includes('ambele_inscriu')
    || key.includes('ambele_marcheaza')
    || key.includes('both_teams_to_score')
    || key === 'gg_ng'
  );
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
