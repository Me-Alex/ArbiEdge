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

const FORTUNA_UPCOMING_URL =
  'https://api.efortuna.ro/offer/structure/api/v1_0/widget/upcoming';
const FORTUNA_MATCHES_URL =
  'https://api.efortuna.ro/offer/structure/api/v1_0/sport/ufo:sprt:00/matches';
const FORTUNA_MARKETS_URL =
  'https://api.efortuna.ro/offer/markets/api/v1_0/fixtures/markets/overview';
const FOOTBALL_SPORT_ID = 'ufo:sprt:00';
const MATCH_MARKET_TYPE_ID = 'ufo:mtyp:00-00';
const DOUBLE_CHANCE_MARKET_TYPE_ID = 'ufo:mtyp:00-01';
const DRAW_NO_BET_MARKET_TYPE_ID = 'ufo:mtyp:00-03';
const HALF_TIME_OR_FULL_TIME_MARKET_TYPE_ID = 'ufo:mtyp:00-04';
const TO_QUALIFY_MARKET_TYPE_ID = 'ufo:mtyp:00-12';
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 20;
const MARKET_CHUNK_SIZE = 100;
class FortunaProvider {
  constructor({
    fetchImpl = globalThis.fetch,
    maxPages = DEFAULT_MAX_PAGES,
    pageSize = DEFAULT_PAGE_SIZE,
    timeoutMs = 8000,
    now = () => new Date(),
  } = {}) {
    this.name = 'Fortuna';
    this.fetchImpl = fetchImpl;
    this.maxPages = maxPages;
    this.pageSize = pageSize;
    this.timeoutMs = timeoutMs;
    this.now = now;
  }

  async getOdds() {
    const payload = await this.#fetchFootballPayload();

    return normalizeFortunaPayload(
      payload,
      this.now().toISOString(),
    );
  }

  async #fetchFootballPayload() {
    const firstPage = await this.#fetchMatchesPage(0);
    const pageCount = Math.min(
      Number.isInteger(firstPage.pagingInfo?.pageCount)
        ? firstPage.pagingInfo.pageCount
        : 1,
      this.maxPages,
    );
    const rest = await Promise.all(
      Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) =>
        this.#fetchMatchesPage(index + 1),
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
    payload.markets = await this.#fetchOverviewMarkets(fixturesWithMarkets);
    return payload;
  }

  async #fetchMatchesPage(page) {
    const url = new URL(FORTUNA_MATCHES_URL);
    url.search = new URLSearchParams({
      filter: 'all',
      page: String(page),
      pageSize: String(this.pageSize),
    });
    return this.#fetchJson(url);
  }

  async #fetchOverviewMarkets(fixtures) {
    const chunks = chunkArray(fixtures, MARKET_CHUNK_SIZE);
    const responses = await Promise.all(
      chunks.map((chunk) => {
        const marketsUrl = new URL(FORTUNA_MARKETS_URL);
        const marketTypeIds = unique(
          chunk.flatMap((fixture) => fixture.marketTypeIds || []),
        );
        marketsUrl.search = new URLSearchParams({
          fixtureIds: chunk.map((fixture) => fixture.id).join(','),
          marketTypeIds: marketTypeIds.join(','),
        });
        return this.#fetchJson(marketsUrl);
      }),
    );
    return responses.flatMap(flattenMarketsPayload);
  }

  async #fetchJson(url, { optional = false } = {}) {
    let response;
    try {
      response = await this.fetchImpl(url, {
        headers: {
          accept: 'application/json',
          referer: 'https://efortuna.ro/',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new ProviderError(`Unable to reach Fortuna: ${error.message}`, {
        cause: error,
      });
    }

    if (!response.ok) {
      if (optional) {
        return {};
      }

      throw new ProviderError(`Fortuna returned HTTP ${response.status}`, {
        status: response.status,
      });
    }

    try {
      return await response.json();
    } catch (error) {
      if (error instanceof ProviderError) {
        throw error;
      }

      if (optional) {
        return {};
      }

      throw new ProviderError('Fortuna returned invalid JSON', {
        cause: error,
      });
    }
  }
}

function normalizeFortunaPayload(payload, fetchedAt, drawNoBetPayload = {}) {
  if (
    !payload ||
    !Array.isArray(payload.fixtures) ||
    !Array.isArray(payload.markets)
  ) {
    return [];
  }

  const tournaments = new Map(
    (Array.isArray(payload.tournaments) ? payload.tournaments : [])
      .filter((tournament) => tournament?.id)
      .map((tournament) => [tournament.id, tournament.name]),
  );
  const marketsByFixture = normalizeMarketsByFixture(payload.markets, payload.fixtures);
  const drawNoBetMarkets = normalizeDrawNoBetMarkets(drawNoBetPayload);

  return payload.fixtures
    .filter(
      (fixture) =>
        fixture?.sportId === FOOTBALL_SPORT_ID &&
        fixture.status === 'ACTIVE' &&
        hasAnyCompleteMarket(marketsByFixture.get(fixture.id)),
    )
    .map((fixture) =>
      normalizeFixture(
        fixture,
        marketsByFixture,
        drawNoBetMarkets,
        tournaments,
        fetchedAt,
      ),
    )
    .filter(Boolean)
    .sort((left, right) => new Date(left.startsAt) - new Date(right.startsAt));
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

function normalizeDrawNoBetMarkets(payload) {
  const result = new Map();
  if (!payload || typeof payload !== 'object') {
    return result;
  }

  for (const [fixtureId, markets] of Object.entries(payload)) {
    const market = Array.isArray(markets)
      ? markets.find(
          (candidate) =>
            candidate?.marketTypeId === DRAW_NO_BET_MARKET_TYPE_ID ||
            candidate?.syntheticGroupKey === 'draw_no_bet',
        )
      : null;
    if (!market) {
      continue;
    }

    const prices = Object.fromEntries(
      (Array.isArray(market.outcomes) ? market.outcomes : [])
        .filter(
          (outcome) =>
            ['1', '2'].includes(outcome?.name) &&
            isDecimalOdds(outcome.odds),
        )
        .map((outcome) => [outcome.name, outcome.odds]),
    );
    if (isDecimalOdds(prices['1']) && isDecimalOdds(prices['2'])) {
      result.set(fixtureId, {
        home: prices['1'],
        away: prices['2'],
      });
    }
  }

  return result;
}

function normalizeFixture(
  fixture,
  marketsByFixture,
  drawNoBetMarkets,
  tournaments,
  fetchedAt,
) {
  const homeTeam = fixture.participants?.find(
    (participant) => participant?.type === 'HOME',
  )?.name;
  const awayTeam = fixture.participants?.find(
    (participant) => participant?.type === 'AWAY',
  )?.name;
  const startsAt = new Date(fixture.startDatetime);

  if (
    !homeTeam ||
    !awayTeam ||
    Number.isNaN(startsAt.getTime()) ||
    !fixture.id
  ) {
    return null;
  }

  const markets = { ...marketsByFixture.get(fixture.id) };
  if (drawNoBetMarkets.has(fixture.id)) {
    markets.drawNoBet = drawNoBetMarkets.get(fixture.id);
  }

  return {
    id: `fortuna:${fixture.id}`,
    externalIds: {
      fortunaFixture: String(fixture.id),
      ...(fixture.sportradarIds?.[0]
        ? { sportradar: String(fixture.sportradarIds[0]) }
        : {}),
    },
    sport: 'Football',
    competition: tournaments.get(fixture.tournamentId) || 'Fortuna Football',
    startsAt: startsAt.toISOString(),
    homeTeam,
    awayTeam,
    bookmakers: [
      {
        name: 'Fortuna',
        lastUpdate: fetchedAt,
        ...bookmakerLinkFields('Fortuna', ufoEventUrl('Fortuna', fixture)),
        markets,
      },
    ],
  };
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

    const normalized = normalizeFortunaMarket(
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

function normalizeFortunaMarket(market, context = {}) {
  const synthetic = String(market.syntheticGroupKey || '').toLowerCase();

  if (market.marketTypeId === MATCH_MARKET_TYPE_ID || synthetic === 'match') {
    return mapOutcomes(market, 'h2h', { 1: 'home', X: 'draw', 2: 'away' }, ['home', 'draw', 'away']);
  }
  if (market.marketTypeId === DOUBLE_CHANCE_MARKET_TYPE_ID || isMatchDoubleChanceKey(synthetic)) {
    return mapOutcomes(
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
    return mapOutcomes(
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
    return mapOutcomes(
      market,
      'secondHalfDoubleChance',
      { '1X': 'homeDraw', 12: 'homeAway', X2: 'drawAway' },
      ['homeDraw', 'homeAway', 'drawAway'],
    );
  }
  if (market.marketTypeId === DRAW_NO_BET_MARKET_TYPE_ID || synthetic === 'draw_no_bet') {
    return mapOutcomes(market, 'drawNoBet', { 1: 'home', 2: 'away' }, ['home', 'away']);
  }
  if (market.marketTypeId === TO_QUALIFY_MARKET_TYPE_ID || synthetic === 'to_qualify') {
    return mapOutcomes(market, 'toQualify', { 1: 'home', 2: 'away' }, ['home', 'away']);
  }
  if (market.marketTypeId === HALF_TIME_OR_FULL_TIME_MARKET_TYPE_ID || synthetic === 'half_time_or_full_time') {
    return mapOutcomes(
      market,
      'halfTimeOrFullTime',
      { 1: 'home', X: 'draw', 2: 'away' },
      ['home', 'draw', 'away'],
    );
  }
  if (market.marketTypeId === 'ufo:mtyp:00-10') {
    return normalizeLineMarket(market, 'market_total_goluri_home');
  }
  if (market.marketTypeId === 'ufo:mtyp:00-13') {
    return normalizeLineMarket(market, 'market_total_goluri_away');
  }
  if (synthetic === 'total_goals_/_asian_total_goals' || synthetic === 'total_goals') {
    return normalizeLineMarket(market, 'totalGoals');
  }
  // Period asian before period EU totals — labels often contain both "asian" and "total_goal".
  if (
    synthetic === '1st_half_asian_total_goals'
    || synthetic === 'half_time_asian_total_goals'
    || (synthetic.includes('asian') && synthetic.includes('total') && (
      synthetic.includes('1st_half') || synthetic.includes('half_time') || synthetic.includes('pauza')
    ))
  ) {
    return normalizeLineMarket(market, 'firstHalfAsianTotalGoals');
  }
  if (
    synthetic === '2nd_half_asian_total_goals'
    || (synthetic.includes('asian') && synthetic.includes('total') && (
      synthetic.includes('2nd_half') || synthetic.includes('second_half') || synthetic.includes('a_doua')
    ))
  ) {
    return normalizeLineMarket(market, 'secondHalfAsianTotalGoals');
  }
  if (
    synthetic === '1st_half_total_goals'
    || synthetic === 'first_half_total_goals'
    || synthetic === 'half_time_total_goals'
    || (synthetic.includes('1st_half') && synthetic.includes('total_goal') && !synthetic.includes('asian'))
  ) {
    return normalizeLineMarket(market, 'firstHalfTotalGoals');
  }
  if (
    synthetic === '2nd_half_total_goals'
    || synthetic === 'second_half_total_goals'
    || (synthetic.includes('2nd_half') && synthetic.includes('total_goal') && !synthetic.includes('asian'))
  ) {
    return normalizeLineMarket(market, 'secondHalfTotalGoals');
  }
  if (isMatchTotalCornersKey(synthetic)) {
    return normalizeLineMarket(market, 'totalCorners');
  }
  if (
    synthetic.includes('total_card')
    || synthetic.includes('yellow_card')
    || synthetic.includes('booking')
  ) {
    return normalizeLineMarket(market, 'totalCards');
  }
  if (synthetic === 'both_teams_to_score') {
    return mapOutcomes(
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
    return mapOutcomes(
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
    return mapOutcomes(
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
    return mapOutcomes(market, 'firstHalfH2h', { 1: 'home', X: 'draw', 2: 'away' }, ['home', 'draw', 'away']);
  }
  if (
    synthetic === '2nd_half'
    || synthetic === 'second_half'
    || synthetic === '2nd_half_result'
  ) {
    return mapOutcomes(market, 'secondHalfH2h', { 1: 'home', X: 'draw', 2: 'away' }, ['home', 'draw', 'away']);
  }
  if (
    synthetic === '2nd_half_both_teams_to_score'
    || synthetic === 'both_teams_to_score_in_2nd_half'
    || (synthetic.includes('2nd_half') && synthetic.includes('both_team'))
    || (synthetic.includes('both_team') && synthetic.includes('2nd_half'))
  ) {
    return mapOutcomes(
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
    return mapOutcomes(market, 'firstHalfDrawNoBet', { 1: 'home', 2: 'away' }, ['home', 'away']);
  }
  if (
    synthetic === '2nd_half_draw_no_bet'
    || (synthetic.includes('draw_no_bet') && synthetic.includes('2nd_half'))
  ) {
    return mapOutcomes(market, 'secondHalfDrawNoBet', { 1: 'home', 2: 'away' }, ['home', 'away']);
  }
  if (
    synthetic === 'asian_total_goals'
    || synthetic === 'total_goals_asian'
    || synthetic.includes('asian_total_goal')
  ) {
    return normalizeLineMarket(market, 'asianTotalGoals');
  }
  if (
    synthetic === 'asian_total_corners'
    || synthetic.includes('asian') && synthetic.includes('corner')
  ) {
    return normalizeLineMarket(market, 'asianTotalCorners');
  }
  if (
    synthetic === 'asian_total_cards'
    || (synthetic.includes('asian') && (
      synthetic.includes('card') || synthetic.includes('cartonas') || synthetic.includes('booking')
    ))
  ) {
    return normalizeLineMarket(market, 'asianTotalCards');
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
    return mapOutcomes(market, 'market_marcheaza_home', { Da: 'yes', Nu: 'no', Yes: 'yes', No: 'no' }, ['yes', 'no']);
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
    return mapOutcomes(market, 'market_marcheaza_away', { Da: 'yes', Nu: 'no', Yes: 'yes', No: 'no' }, ['yes', 'no']);
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
      return mapOutcomes(
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
    return normalizeLineMarket(market, 'market_total_goluri_home');
  }
  if (
    synthetic.includes('away_total')
    || synthetic.includes('team2_total')
    || synthetic.includes('total_goluri_oaspeti')
    || (synthetic.includes('total_goluri') && (
      synthetic.includes('oaspete') || synthetic.includes('oaspeti') || synthetic.includes('away')
    ))
  ) {
    return normalizeLineMarket(market, 'market_total_goluri_away');
  }
  if (isMatchHandicapKey(synthetic)) {
    return normalizeHandicapMarket(market, context);
  }
  return normalizeGenericMarket(market);
}

function mapOutcomes(market, key, outcomeMap, required) {
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

function normalizeLineMarket(market, baseKey) {
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

function normalizeHandicapMarket(market, context = {}) {
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
  // 2-way AH markets (no draw) use asianHandicap_* so H2H/DC×AH formulas and
  // classic AH scanners can see Fortuna/UFO lines alongside other RO books.
  const markets = [...groups.values()]
    .filter(({ prices }) => ['home', 'away'].every((outcome) => isDecimalOdds(prices[outcome])))
    .map(({ homeLine, prices }) => ({ key: handicapMarketKey('asianHandicap', homeLine), prices }));
  return markets.length === 1 ? markets[0] : markets.length ? markets : null;
}

function normalizeGenericMarket(market) {
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
  // RO / EN labels used by UFO-family feeds (Fortuna, Casa, etc.).
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

module.exports = {
  FORTUNA_MATCHES_URL,
  FORTUNA_UPCOMING_URL,
  FortunaProvider,
  normalizeFortunaPayload,
};
