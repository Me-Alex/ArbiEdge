const { ProviderError } = require('./the-odds-api-provider');
const {
  genericMarketKey,
  handicapMarketKey,
  hasAnyCompleteMarket,
  hasCompleteOutcomes,
  isDecimalOdds,
  isMatchDoubleChanceKey,
  isMatchHandicapKey,
  isMatchTotalCornersKey,
  normalizeOutcomeKey,
} = require('./market-utils');
const { bookmakerLinkFields, ufoEventUrl } = require('./event-links');

const FOOTBALL_SPORT_ID = 'ufo:sprt:00';
const MATCH_MARKET_TYPE_ID = 'ufo:mtyp:00-00';
const DOUBLE_CHANCE_MARKET_TYPE_ID = 'ufo:mtyp:00-01';
const DRAW_NO_BET_MARKET_TYPE_ID = 'ufo:mtyp:00-03';
const HALF_TIME_OR_FULL_TIME_MARKET_TYPE_ID = 'ufo:mtyp:00-04';
const TO_QUALIFY_MARKET_TYPE_ID = 'ufo:mtyp:00-12';
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 20;
const MARKET_CHUNK_SIZE = 100;
class UfoProvider {
  constructor({
    name,
    baseUrl,
    fetchImpl = globalThis.fetch,
    maxPages = DEFAULT_MAX_PAGES,
    pageSize = DEFAULT_PAGE_SIZE,
    timeoutMs = 8000,
    now = () => new Date(),
  }) {
    this.name = name;
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
    this.maxPages = maxPages;
    this.pageSize = pageSize;
    this.timeoutMs = timeoutMs;
    this.now = now;
  }

  async getOdds() {
    const payload = await this.fetchFootballPayload();
    return normalizeUfoPayload(payload, {
      bookmaker: this.name,
      fetchedAt: this.now().toISOString(),
    });
  }

  async fetchFootballPayload() {
    const firstPage = await this.fetchMatchesPage(0);
    const pageCount = Math.min(
      Number.isInteger(firstPage.pagingInfo?.pageCount)
        ? firstPage.pagingInfo.pageCount
        : 1,
      this.maxPages,
    );
    const rest = await Promise.all(
      Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) =>
        this.fetchMatchesPage(index + 1),
      ),
    );
    const payload = mergePagedPayloads([firstPage, ...rest]);
    const fixturesWithMarkets = (payload.fixtures || [])
      .filter(
        (fixture) =>
          fixture?.sportId === FOOTBALL_SPORT_ID &&
          fixture.status === 'ACTIVE' &&
          fixture.id,
      )
      .map((fixture) => ({
        id: fixture.id,
        marketTypeIds: Array.isArray(fixture.marketTypeIds)
          ? fixture.marketTypeIds
          : [MATCH_MARKET_TYPE_ID],
      }));
    payload.markets = await this.fetchOverviewMarkets(fixturesWithMarkets);
    return payload;
  }

  async fetchMatchesPage(page) {
    const url = new URL(`${this.baseUrl}/structure/api/v1_0/sport/${FOOTBALL_SPORT_ID}/matches`);
    url.search = new URLSearchParams({
      filter: 'all',
      page: String(page),
      pageSize: String(this.pageSize),
    });
    return this.fetchJson(url);
  }

  async fetchOverviewMarkets(fixtures) {
    const chunks = chunkArray(fixtures, MARKET_CHUNK_SIZE);
    const responses = await Promise.all(
      chunks.map((chunk) => {
        const url = new URL(`${this.baseUrl}/markets/api/v1_0/fixtures/markets/overview`);
        const marketTypeIds = unique(
          chunk.flatMap((fixture) => fixture.marketTypeIds || []),
        );
        url.search = new URLSearchParams({
          fixtureIds: chunk.map((fixture) => fixture.id).join(','),
          marketTypeIds: marketTypeIds.join(','),
        });
        return this.fetchJson(url);
      }),
    );
    return responses.flatMap(flattenMarketsPayload);
  }

  async fetchJson(url, optional = false) {
    let response;
    try {
      response = await this.fetchImpl(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new ProviderError(`Unable to reach ${this.name}: ${error.message}`, { cause: error });
    }
    if (!response.ok) {
      if (optional) return {};
      throw new ProviderError(`${this.name} returned HTTP ${response.status}`, { status: response.status });
    }
    try {
      return await response.json();
    } catch (error) {
      if (optional) return {};
      throw new ProviderError(`${this.name} returned invalid JSON`, { cause: error });
    }
  }
}

function normalizeUfoPayload(payload, { bookmaker, fetchedAt, drawNoBetPayload = {} }) {
  if (!Array.isArray(payload?.fixtures) || !Array.isArray(payload?.markets)) return [];
  const tournaments = new Map((payload.tournaments || []).map((item) => [item.id, item.name]));
  const marketMap = normalizeMarketsByFixture(payload.markets, payload.fixtures);
  const drawNoBet = new Map();
  for (const [fixtureId, markets] of Object.entries(drawNoBetPayload || {})) {
    const prices = marketPrices(markets, DRAW_NO_BET_MARKET_TYPE_ID, ['1', '2'], true);
    if (prices.has(fixtureId)) drawNoBet.set(fixtureId, prices.get(fixtureId));
  }

  return payload.fixtures
    .filter((fixture) =>
      fixture?.sportId === FOOTBALL_SPORT_ID &&
      fixture.status === 'ACTIVE' &&
      hasAnyCompleteMarket(marketMap.get(fixture.id))
    )
    .map((fixture) => {
      const homeTeam = fixture.participants?.find((p) => p.type === 'HOME')?.name;
      const awayTeam = fixture.participants?.find((p) => p.type === 'AWAY')?.name;
      const startsAt = new Date(fixture.startDatetime);
      if (!homeTeam || !awayTeam || Number.isNaN(startsAt.getTime())) return null;
      const markets = { ...marketMap.get(fixture.id) };
      const dnb = drawNoBet.get(fixture.id);
      if (dnb) markets.drawNoBet = { home: dnb['1'], away: dnb['2'] };
      return {
        id: `${normalizeName(bookmaker)}:${fixture.id}`,
        externalIds: {
          [`${normalizeName(bookmaker)}Fixture`]: String(fixture.id),
          ...(fixture.sportradarIds?.[0] ? { sportradar: String(fixture.sportradarIds[0]) } : {}),
        },
        sport: 'Football',
        competition: tournaments.get(fixture.tournamentId) || `${bookmaker} Football`,
        startsAt: startsAt.toISOString(),
        homeTeam,
        awayTeam,
        bookmakers: [{
          name: bookmaker,
          lastUpdate: fetchedAt,
          ...bookmakerLinkFields(bookmaker, ufoEventUrl(bookmaker, fixture)),
          markets,
        }],
      };
    })
    .filter(Boolean);
}

function mergePagedPayloads(pages) {
  return {
    sport: pages.find((page) => page?.sport)?.sport,
    categories: mergeById(pages.flatMap((page) => page?.categories || [])),
    tournaments: mergeById(pages.flatMap((page) => page?.tournaments || [])),
    fixtures: mergeById(pages.flatMap((page) => page?.fixtures || [])),
    markets: mergeById(pages.flatMap((page) => page?.markets || [])),
  };
}

function mergeById(items) {
  const result = new Map();
  for (const item of items) {
    if (item?.id) {
      result.set(item.id, item);
    }
  }
  return [...result.values()];
}

function flattenMarketsPayload(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!payload || typeof payload !== 'object') {
    return [];
  }
  return Object.values(payload)
    .filter(Array.isArray)
    .flat();
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function normalizeMarketsByFixture(markets, fixtures = []) {
  const result = new Map();
  const fixtureContexts = new Map(
    (Array.isArray(fixtures) ? fixtures : [])
      .filter((fixture) => fixture?.id)
      .map((fixture) => [fixture.id, fixtureTeamContext(fixture)]),
  );
  for (const market of markets || []) {
    if (!market?.fixtureId || !Array.isArray(market.outcomes)) {
      continue;
    }

    const normalized = normalizeUfoMarket(
      market,
      fixtureContexts.get(market.fixtureId),
    );
    if (!normalized) {
      continue;
    }

    if (!result.has(market.fixtureId)) {
      result.set(market.fixtureId, {});
    }
    for (const item of Array.isArray(normalized) ? normalized : [normalized]) {
      result.get(market.fixtureId)[item.key] = item.prices;
    }
  }
  return result;
}

function normalizeUfoMarket(market, context = {}) {
  const synthetic = String(market.syntheticGroupKey || '').toLowerCase();

  if (market.marketTypeId === MATCH_MARKET_TYPE_ID || synthetic === 'match') {
    return mapUfoOutcomes(market, 'h2h', { 1: 'home', X: 'draw', 2: 'away' }, ['home', 'draw', 'away']);
  }

  if (market.marketTypeId === DOUBLE_CHANCE_MARKET_TYPE_ID || isMatchDoubleChanceKey(synthetic)) {
    return mapUfoOutcomes(
      market,
      'doubleChance',
      { '1X': 'homeDraw', 12: 'homeAway', X2: 'drawAway' },
      ['homeDraw', 'homeAway', 'drawAway'],
    );
  }

  if (
    synthetic === '1st_half_double_chance'
    || synthetic === 'half_time_double_chance'
    || (synthetic.includes('double_chance') && (
      synthetic.includes('1st_half') || synthetic.includes('half_time') || synthetic.includes('pauza')
    ))
    || (synthetic.includes('sansa_dubla') && (
      synthetic.includes('1st_half') || synthetic.includes('pauza') || synthetic.includes('prima')
    ))
  ) {
    return mapUfoOutcomes(
      market,
      'firstHalfDoubleChance',
      { '1X': 'homeDraw', 12: 'homeAway', X2: 'drawAway' },
      ['homeDraw', 'homeAway', 'drawAway'],
    );
  }
  if (
    synthetic === '2nd_half_double_chance'
    || synthetic === 'second_half_double_chance'
    || (synthetic.includes('double_chance') && (
      synthetic.includes('2nd_half') || synthetic.includes('second_half') || synthetic.includes('a_doua')
    ))
    || (synthetic.includes('sansa_dubla') && (
      synthetic.includes('2nd_half') || synthetic.includes('a_doua')
    ))
  ) {
    return mapUfoOutcomes(
      market,
      'secondHalfDoubleChance',
      { '1X': 'homeDraw', 12: 'homeAway', X2: 'drawAway' },
      ['homeDraw', 'homeAway', 'drawAway'],
    );
  }

  if (market.marketTypeId === DRAW_NO_BET_MARKET_TYPE_ID || synthetic === 'draw_no_bet') {
    return mapUfoOutcomes(market, 'drawNoBet', { 1: 'home', 2: 'away' }, ['home', 'away']);
  }

  if (market.marketTypeId === TO_QUALIFY_MARKET_TYPE_ID || synthetic === 'to_qualify') {
    return mapUfoOutcomes(market, 'toQualify', { 1: 'home', 2: 'away' }, ['home', 'away']);
  }

  if (market.marketTypeId === HALF_TIME_OR_FULL_TIME_MARKET_TYPE_ID || synthetic === 'half_time_or_full_time') {
    return mapUfoOutcomes(
      market,
      'halfTimeOrFullTime',
      { 1: 'home', X: 'draw', 2: 'away' },
      ['home', 'draw', 'away'],
    );
  }

  if (market.marketTypeId === 'ufo:mtyp:00-10') {
    return normalizeUfoLineMarket(market, 'market_total_goluri_home');
  }

  if (market.marketTypeId === 'ufo:mtyp:00-13') {
    return normalizeUfoLineMarket(market, 'market_total_goluri_away');
  }

  if (synthetic === 'total_goals_/_asian_total_goals' || synthetic === 'total_goals') {
    return normalizeUfoLineMarket(market, 'totalGoals');
  }

  // Period asian before period EU totals — labels often contain both "asian" and "total_goal".
  if (
    synthetic === '1st_half_asian_total_goals'
    || synthetic === 'half_time_asian_total_goals'
    || (synthetic.includes('asian') && synthetic.includes('total') && (
      synthetic.includes('1st_half') || synthetic.includes('half_time') || synthetic.includes('pauza')
    ))
  ) {
    return normalizeUfoLineMarket(market, 'firstHalfAsianTotalGoals');
  }

  if (
    synthetic === '2nd_half_asian_total_goals'
    || (synthetic.includes('asian') && synthetic.includes('total') && (
      synthetic.includes('2nd_half') || synthetic.includes('second_half') || synthetic.includes('a_doua')
    ))
  ) {
    return normalizeUfoLineMarket(market, 'secondHalfAsianTotalGoals');
  }

  if (
    synthetic === '1st_half_total_goals'
    || synthetic === 'first_half_total_goals'
    || synthetic === 'half_time_total_goals'
    || (synthetic.includes('1st_half') && synthetic.includes('total_goal') && !synthetic.includes('asian'))
  ) {
    return normalizeUfoLineMarket(market, 'firstHalfTotalGoals');
  }

  if (
    synthetic === '2nd_half_total_goals'
    || synthetic === 'second_half_total_goals'
    || (synthetic.includes('2nd_half') && synthetic.includes('total_goal') && !synthetic.includes('asian'))
  ) {
    return normalizeUfoLineMarket(market, 'secondHalfTotalGoals');
  }

  if (isMatchTotalCornersKey(synthetic)) {
    return normalizeUfoLineMarket(market, 'totalCorners');
  }

  if (
    synthetic.includes('total_card')
    || synthetic.includes('yellow_card')
    || synthetic.includes('booking')
  ) {
    return normalizeUfoLineMarket(market, 'totalCards');
  }

  if (synthetic === 'both_teams_to_score') {
    return mapUfoOutcomes(
      market,
      'bothTeamsToScore',
      { Da: 'yes', Nu: 'no', Yes: 'yes', No: 'no' },
      ['yes', 'no'],
    );
  }

  if (
    synthetic === '1st_half_both_teams_to_score'
    || synthetic === 'half_time_both_teams_to_score'
    || synthetic === 'both_teams_to_score_in_1st_half'
    || (synthetic.includes('1st_half') && synthetic.includes('both_team'))
    || (synthetic.includes('both_team') && synthetic.includes('1st_half'))
  ) {
    return mapUfoOutcomes(
      market,
      'firstHalfBothTeamsToScore',
      { Da: 'yes', Nu: 'no', Yes: 'yes', No: 'no' },
      ['yes', 'no'],
    );
  }

  if (
    synthetic === 'odd_even'
    || synthetic === 'goals_odd_even'
    || synthetic.includes('odd_even')
    || synthetic.includes('par_impar')
  ) {
    return mapUfoOutcomes(
      market,
      'market_total_goluri_impar_par',
      { Par: 'even', Impar: 'odd', Even: 'even', Odd: 'odd' },
      ['odd', 'even'],
    );
  }

  if (
    synthetic === '1st_half'
    || synthetic === 'half_time'
    || synthetic === 'half_time_result'
    || synthetic === '1st_half_result'
  ) {
    return mapUfoOutcomes(market, 'firstHalfH2h', { 1: 'home', X: 'draw', 2: 'away' }, ['home', 'draw', 'away']);
  }

  if (
    synthetic === '2nd_half'
    || synthetic === 'second_half'
    || synthetic === '2nd_half_result'
  ) {
    return mapUfoOutcomes(market, 'secondHalfH2h', { 1: 'home', X: 'draw', 2: 'away' }, ['home', 'draw', 'away']);
  }

  if (
    synthetic === '2nd_half_both_teams_to_score'
    || synthetic === 'both_teams_to_score_in_2nd_half'
    || (synthetic.includes('2nd_half') && synthetic.includes('both_team'))
    || (synthetic.includes('both_team') && synthetic.includes('2nd_half'))
  ) {
    return mapUfoOutcomes(
      market,
      'secondHalfBothTeamsToScore',
      { Da: 'yes', Nu: 'no', Yes: 'yes', No: 'no' },
      ['yes', 'no'],
    );
  }

  if (
    synthetic === '1st_half_draw_no_bet'
    || synthetic === 'half_time_draw_no_bet'
    || (synthetic.includes('draw_no_bet') && synthetic.includes('1st_half'))
    || (synthetic.includes('fara_egal') && synthetic.includes('pauza'))
  ) {
    return mapUfoOutcomes(market, 'firstHalfDrawNoBet', { 1: 'home', 2: 'away' }, ['home', 'away']);
  }

  if (
    synthetic === '2nd_half_draw_no_bet'
    || (synthetic.includes('draw_no_bet') && synthetic.includes('2nd_half'))
  ) {
    return mapUfoOutcomes(market, 'secondHalfDrawNoBet', { 1: 'home', 2: 'away' }, ['home', 'away']);
  }

  if (
    synthetic === 'asian_total_goals'
    || synthetic === 'total_goals_asian'
    || synthetic.includes('asian_total_goal')
  ) {
    return normalizeUfoLineMarket(market, 'asianTotalGoals');
  }

  if (
    synthetic === 'asian_total_corners'
    || (synthetic.includes('asian') && synthetic.includes('corner'))
  ) {
    return normalizeUfoLineMarket(market, 'asianTotalCorners');
  }

  if (
    synthetic === 'asian_total_cards'
    || (synthetic.includes('asian') && (
      synthetic.includes('card') || synthetic.includes('cartonas') || synthetic.includes('booking')
    ))
  ) {
    return normalizeUfoLineMarket(market, 'asianTotalCards');
  }

  if (
    synthetic.includes('home_to_score')
    || synthetic.includes('home_team_to_score')
    || synthetic === 'home_scores'
    || synthetic.includes('gazdele_marcheaza')
    || synthetic.includes('gazda_marcheaza')
    || (synthetic.includes('marcheaza') && (
      synthetic.includes('gazda') || synthetic.includes('gazde') || synthetic.includes('home')
    ))
  ) {
    return mapUfoOutcomes(market, 'market_marcheaza_home', { Da: 'yes', Nu: 'no', Yes: 'yes', No: 'no' }, ['yes', 'no']);
  }

  if (
    synthetic.includes('away_to_score')
    || synthetic.includes('away_team_to_score')
    || synthetic === 'away_scores'
    || synthetic.includes('oaspetii_marcheaza')
    || synthetic.includes('oaspete_marcheaza')
    || (synthetic.includes('marcheaza') && (
      synthetic.includes('oaspete') || synthetic.includes('oaspeti') || synthetic.includes('away')
    ))
  ) {
    return mapUfoOutcomes(market, 'market_marcheaza_away', { Da: 'yes', Nu: 'no', Yes: 'yes', No: 'no' }, ['yes', 'no']);
  }

  if (
    synthetic.includes('clean_sheet')
    || synthetic.includes('fara_gol_primit')
    || synthetic.includes('nu_primeste_gol')
  ) {
    const side = (synthetic.includes('home') || synthetic.includes('gazda') || synthetic.includes('gazde'))
      ? 'home'
      : (synthetic.includes('away') || synthetic.includes('oaspete') || synthetic.includes('oaspeti'))
        ? 'away'
        : null;
    if (side) {
      return mapUfoOutcomes(
        market,
        `market_clean_sheet_${side}`,
        { Da: 'yes', Nu: 'no', Yes: 'yes', No: 'no' },
        ['yes', 'no'],
      );
    }
  }

  if (
    synthetic.includes('home_total')
    || synthetic.includes('team1_total')
    || synthetic.includes('total_goluri_gazde')
    || (synthetic.includes('total_goluri') && (
      synthetic.includes('gazda') || synthetic.includes('gazde') || synthetic.includes('home')
    ))
  ) {
    return normalizeUfoLineMarket(market, 'market_total_goluri_home');
  }

  if (
    synthetic.includes('away_total')
    || synthetic.includes('team2_total')
    || synthetic.includes('total_goluri_oaspeti')
    || (synthetic.includes('total_goluri') && (
      synthetic.includes('oaspete') || synthetic.includes('oaspeti') || synthetic.includes('away')
    ))
  ) {
    return normalizeUfoLineMarket(market, 'market_total_goluri_away');
  }

  if (isMatchHandicapKey(synthetic)) {
    return normalizeUfoHandicapMarket(market, context);
  }

  return normalizeGenericUfoMarket(market);
}

function mapUfoOutcomes(market, key, outcomeMap, required) {
  const prices = {};
  for (const outcome of market.outcomes || []) {
    const mapped = outcomeMap[String(outcome.name || '').trim()];
    if (mapped && isDecimalOdds(outcome.odds)) {
      prices[mapped] = outcome.odds;
    }
  }
  return required.every((outcome) => isDecimalOdds(prices[outcome]))
    ? { key, prices }
    : null;
}

function normalizeUfoLineMarket(market, baseKey) {
  const prices = {};
  let line = null;
  for (const outcome of market.outcomes || []) {
    const parsed = parseLineOutcome(outcome.name);
    if (!parsed || !isDecimalOdds(outcome.odds)) {
      continue;
    }
    line = line || parsed.line;
    if (parsed.line === line) {
      prices[parsed.side] = outcome.odds;
    }
  }
  return line && ['over', 'under'].every((outcome) => isDecimalOdds(prices[outcome]))
    ? { key: `${baseKey}_${line.replace('.', '_')}`, prices }
    : null;
}

function normalizeUfoHandicapMarket(market, context = {}) {
  const groups = new Map();
  for (const outcome of market.outcomes || []) {
    const parsed = parseHandicapOutcome(outcome.name, context);
    if (!parsed || !isDecimalOdds(outcome.odds)) {
      continue;
    }
    const homeLine = parsed.side === 'home' ? parsed.line : -parsed.line;
    const key = formatLine(homeLine);
    if (!groups.has(key)) {
      groups.set(key, { homeLine, prices: {} });
    }
    groups.get(key).prices[parsed.side] = outcome.odds;
  }
  const markets = [...groups.values()]
    .filter(({ prices }) => ['home', 'away'].every((outcome) => isDecimalOdds(prices[outcome])))
    .map(({ homeLine, prices }) => ({ key: handicapMarketKey('handicap', homeLine), prices }));
  return markets.length === 1 ? markets[0] : markets.length ? markets : null;
}

function normalizeGenericUfoMarket(market) {
  const label =
    market.name ||
    market.marketName ||
    market.syntheticGroupKey ||
    market.marketTypeId;
  const linePrices = {};
  let line = null;
  let lineOutcomeCount = 0;

  for (const outcome of market.outcomes || []) {
    const parsed = parseLineOutcome(outcome.name);
    if (!parsed || !isDecimalOdds(outcome.odds)) {
      continue;
    }
    line = line || parsed.line;
    if (parsed.line === line) {
      linePrices[parsed.side] = outcome.odds;
      lineOutcomeCount += 1;
    }
  }

  if (lineOutcomeCount > 0) {
    const key = genericMarketKey(label, { line });
    return key && hasCompleteOutcomes(linePrices)
      ? { key, prices: linePrices }
      : null;
  }

  const prices = {};
  for (const outcome of market.outcomes || []) {
    const outcomeKey = normalizeOutcomeKey(outcome.name || outcome.longName);
    if (outcomeKey && isDecimalOdds(outcome.odds)) {
      prices[outcomeKey] = outcome.odds;
    }
  }

  const key = genericMarketKey(label);
  return key && hasCompleteOutcomes(prices) ? { key, prices } : null;
}

function parseLineOutcome(value) {
  const raw = String(value || '').trim();
  const signed = raw.match(/^([+-])\s*([0-9]+(?:[.,][0-9]+)?)$/);
  if (signed) {
    return {
      side: signed[1] === '+' ? 'over' : 'under',
      line: formatLine(signed[2].replace(',', '.')),
    };
  }
  // RO / EN labels used across UFO-family sportsbooks.
  const labeled = raw.match(/^(peste|over|sub|under)\s*([0-9]+(?:[.,][0-9]+)?)$/i);
  if (labeled) {
    const side = /^(peste|over)$/i.test(labeled[1]) ? 'over' : 'under';
    return {
      side,
      line: formatLine(labeled[2].replace(',', '.')),
    };
  }
  return null;
}

function parseHandicapOutcome(value, { homeTeam, awayTeam } = {}) {
  const raw = String(value || '').trim();
  const match = raw.match(/^([12])\s*([+-]?[0-9]+(?:[.,][0-9]+)?)/);
  if (match) {
    return {
      side: match[1] === '1' ? 'home' : 'away',
      line: Number(match[2].replace(',', '.')),
    };
  }

  const teamMatch = raw.match(/^(.+?)\s+([+-]?[0-9]+(?:[.,][0-9]+)?)/);
  const side = teamMatch ? teamSide(teamMatch[1], { homeTeam, awayTeam }) : null;
  if (side) {
    return {
      side,
      line: Number(teamMatch[2].replace(',', '.')),
    };
  }

  return null;
}

function fixtureTeamContext(fixture) {
  return {
    homeTeam: fixture.participants?.find((participant) => participant?.type === 'HOME')?.name,
    awayTeam: fixture.participants?.find((participant) => participant?.type === 'AWAY')?.name,
  };
}

function teamSide(value, { homeTeam, awayTeam }) {
  const normalized = normalizeTeamToken(value);
  if (normalized && normalized === normalizeTeamToken(homeTeam)) {
    return 'home';
  }
  if (normalized && normalized === normalizeTeamToken(awayTeam)) {
    return 'away';
  }
  return null;
}

function normalizeTeamToken(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim();
}

function formatLine(value) {
  const number = Number(value);
  if (Number.isInteger(number)) return number.toFixed(0);
  return Number.isInteger(number * 2) ? number.toFixed(1) : number.toFixed(2);
}

function marketPrices(markets, typeId, names, nested = false) {
  const result = new Map();
  for (const market of markets || []) {
    if (market?.marketTypeId !== typeId && !(typeId === MATCH_MARKET_TYPE_ID && market?.syntheticGroupKey === 'match')) continue;
    const values = Object.fromEntries((market.outcomes || []).filter((o) => names.includes(o.name) && isDecimalOdds(o.odds)).map((o) => [o.name, o.odds]));
    if (names.every((name) => isDecimalOdds(values[name]))) {
      result.set(market.fixtureId || (nested ? market.fixtureId : undefined), values);
    }
  }
  return result;
}

function normalizeName(value) {
  return value.toLowerCase().replace(/\W+/g, '-');
}

module.exports = {
  DRAW_NO_BET_MARKET_TYPE_ID,
  MATCH_MARKET_TYPE_ID,
  UfoProvider,
  normalizeUfoPayload,
};
