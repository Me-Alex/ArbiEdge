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
const { bookmakerLinkFields, unibetEventUrl } = require('./event-links');

const UNIBET_LOBBY_URL =
  'https://sportsbff-ams.kindredext.net/sports-api/api/v2/views/lobby?_typ=GetLobbyPageView&category=football&clientOffset=-180';
const UNIBET_CONTEST_PAGE_URL =
  'https://sportsbff-ams.kindredext.net/sports-api/api/v2/views/contest-page';
const UNIBET_QUICKBROWSE_URL =
  'https://sportsbff-ams.kindredext.net/sports-api/api/v2/quickbrowse?_typ=GetQuickBrowse&categoryRn=football&clientOffset=-180';
const UNIBET_LOBBY_BASE_URL =
  'https://sportsbff-ams.kindredext.net/sports-api/api/v2/views/lobby';

class UnibetProvider {
  constructor({
    fetchImpl = globalThis.fetch,
    browserTransport = null,
    categoryLimit = 120,
    detailLimit = 120,
    requestConcurrency = 12,
    timeoutMs = 8000,
  } = {}) {
    this.name = 'Unibet';
    this.fetchImpl = fetchImpl;
    this.browserTransport = browserTransport;
    this.categoryLimit = categoryLimit;
    this.detailLimit = detailLimit;
    this.requestConcurrency = requestConcurrency;
    this.timeoutMs = timeoutMs;
  }

  async getOdds() {
    const headers = unibetHeaders();
    const payloads = await this.fetchFootballPayloads(headers);
    let payload = mergeUnibetPayloads(payloads);
    payload = await this.enrichPayload(payload, headers);
    return normalizeUnibetPayload(payload);
  }

  async fetchJson(url, headers) {
    const response = await this.fetchImpl(url, {
      headers,
      signal: AbortSignal.timeout(this.timeoutMs),
    }).catch((error) => {
      throw new ProviderError(`Unable to reach Unibet: ${error.message}`, { cause: error });
    });

    if (response.ok) {
      return response.json();
    }
    if (this.browserTransport) {
      return this.browserTransport.getJson(url, browserHeaders());
    }
    throw new ProviderError(`Unibet returned HTTP ${response.status}`, {
      status: response.status,
    });
  }

  async fetchJsons(urls, headers) {
    if (urls.length === 0) {
      return [];
    }

    const directPayloads = await mapWithConcurrency(urls, this.requestConcurrency, async (url) => {
      const response = await this.fetchImpl(url, {
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
      }).catch(() => null);
      return response?.ok ? response.json() : null;
    });

    if (directPayloads.every(Boolean)) {
      return directPayloads;
    }
    if (!this.browserTransport) {
      return directPayloads.filter(Boolean);
    }

    const missing = urls
      .map((url, index) => ({ url, index }))
      .filter((entry) => !directPayloads[entry.index]);
    let fallbackPayloads = [];
    if (this.browserTransport.getJsons) {
      fallbackPayloads = await this.browserTransport
        .getJsons(missing.map((entry) => entry.url), browserHeaders())
        .catch(() => []);
    } else {
      fallbackPayloads = await mapWithConcurrency(
        missing,
        this.requestConcurrency,
        (entry) => this.browserTransport.getJson(entry.url, browserHeaders()).catch(() => null),
      );
    }

    const payloads = [...directPayloads];
    missing.forEach((entry, fallbackIndex) => {
      payloads[entry.index] = fallbackPayloads[fallbackIndex] || null;
    });
    return payloads.filter(Boolean);
  }

  async fetchFootballPayloads(headers) {
    const lobbyPayload = await this.fetchJson(UNIBET_LOBBY_URL, headers);
    const categoryUrls = await this.fetchFootballCategoryUrls(headers).catch(() => []);
    const categoryPayloads = await this.fetchJsons(categoryUrls, headers).catch(() => []);
    return [lobbyPayload, ...categoryPayloads].filter(Boolean);
  }

  async fetchFootballCategoryUrls(headers) {
    const payload = await this.fetchJson(UNIBET_QUICKBROWSE_URL, headers);
    return extractFootballCategoryRns(payload)
      .filter((categoryRn) => categoryRn !== 'football')
      .slice(0, this.categoryLimit)
      .map((categoryRn) => lobbyUrl(categoryRn));
  }

  async enrichPayload(payload, headers) {
    const contests = getUnibetContests(payload)
      .filter((contest) => shouldFetchContestDetails(contest))
      .slice(0, this.detailLimit);
    if (contests.length === 0) {
      return payload;
    }

    const urls = contests.map((contest) => contestPageUrl(contest.contestKey));
    let detailPayloads = [];
    try {
      detailPayloads = await this.fetchJsons(urls, headers);
    } catch {
      return payload;
    }

    const details = new Map(
      detailPayloads
        .map((detail) => detail?.contest || detail?.view?.contest)
        .filter((contest) => contest?.contestKey)
        .map((contest) => [String(contest.contestKey), contest]),
    );
    if (details.size === 0) {
      return payload;
    }

    return mergeContestDetails(payload, details);
  }
}

function mergeUnibetPayloads(payloads) {
  const contestsByKey = new Map();
  for (const contest of payloads.flatMap(getUnibetContests)) {
    if (!contest?.contestKey) {
      continue;
    }
    contestsByKey.set(String(contest.contestKey), contest);
  }

  return {
    view: {
      matches: [
        {
          contestGroups: [
            {
              contests: [...contestsByKey.values()],
            },
          ],
        },
      ],
    },
  };
}

function normalizeUnibetPayload(payload) {
  const contests = getUnibetContests(payload);
  return contests.map((contest) => {
    const teams = parseUnibetTeams(contest);
    const startsAt = new Date(contest.startDateTimeUtc?.value || contest.startDateTimeUtc?.unixms);
    const markets = normalizeUnibetMarkets(contest.propositions, {
      homeTeam: teams?.homeTeam,
      awayTeam: teams?.awayTeam,
    });
    if (!teams || !hasAnyCompleteMarket(markets) || Number.isNaN(startsAt.getTime())) return null;
    return {
      id: `unibet:${contest.contestKey}`,
      externalIds: contest.contestKey ? { unibetContest: String(contest.contestKey) } : {},
      sport: 'Football',
      competition: contest.categoriesDetailed?.[0]?.name || 'Unibet Football',
      startsAt: startsAt.toISOString(),
      homeTeam: teams.homeTeam,
      awayTeam: teams.awayTeam,
      bookmakers: [{
        name: 'Unibet',
        lastUpdate: firstTimestamp(contest.propositions),
        ...bookmakerLinkFields('Unibet', unibetEventUrl(contest)),
        markets,
      }],
    };
  }).filter(Boolean);
}

function parseUnibetTeams(contest) {
  const participantTeams = parseUnibetParticipantTeams(contest);
  if (participantTeams) {
    return participantTeams;
  }

  const name = String(contest?.name || contest?.eventName || contest?.displayName || '');
  for (const separator of [/\s+vs\.?\s+/i, /\s+v\.?\s+/i, /\s+[-–—]\s+/]) {
    const parts = name.split(separator).map((part) => part.trim()).filter(Boolean);
    if (parts.length === 2) {
      return { homeTeam: parts[0], awayTeam: parts[1] };
    }
  }
  return null;
}

function parseUnibetParticipantTeams(contest) {
  const participants = Array.isArray(contest?.participants)
    ? contest.participants
    : Array.isArray(contest?.competitors)
      ? contest.competitors
      : [];
  const names = participants
    .map((participant) =>
      participant?.name ||
      participant?.participantName ||
      participant?.displayName ||
      participant?.competitorName)
    .map((name) => String(name || '').trim())
    .filter(Boolean);

  return names.length >= 2
    ? { homeTeam: names[0], awayTeam: names[1] }
    : null;
}

function normalizeUnibetMarkets(propositions, { homeTeam, awayTeam } = {}) {
  const markets = {};
  for (const proposition of Array.isArray(propositions) ? propositions : []) {
    if (proposition?.status !== 'Active') {
      continue;
    }

    const normalized = normalizeUnibetProposition(proposition, { homeTeam, awayTeam });
    const items = Array.isArray(normalized) ? normalized : (normalized ? [normalized] : []);
    for (const item of items) {
      if (item?.key && item.prices && !markets[item.key]) {
        markets[item.key] = item.prices;
      }
    }
  }
  return markets;
}

function normalizeUnibetProposition(proposition, { homeTeam, awayTeam }) {
  const type = String(proposition.propositionType || '').toLowerCase();
  const propositionName = normalizeLabel(proposition.name || proposition.displayName);

  if (type === '1x2') {
    return mapUnibetOutcomes(
      proposition,
      'h2h',
      { 1: 'home', x: 'draw', 2: 'away' },
      ['home', 'draw', 'away'],
    );
  }

  if (
    type === '1st_half_1x2'
    || type === 'half_time_result'
    || type === '1st_half_result'
    || propositionName === 'pauza'
    || propositionName === 'prima repriza'
    || propositionName === '1st half'
  ) {
    return mapUnibetOutcomes(
      proposition,
      'firstHalfH2h',
      { 1: 'home', x: 'draw', 2: 'away' },
      ['home', 'draw', 'away'],
    );
  }

  if (
    type === '2nd_half_1x2'
    || type === '2nd_half_result'
    || propositionName === 'a doua repriza'
    || propositionName === '2nd half'
  ) {
    return mapUnibetOutcomes(
      proposition,
      'secondHalfH2h',
      { 1: 'home', x: 'draw', 2: 'away' },
      ['home', 'draw', 'away'],
    );
  }

  if (type === 'double_chance') {
    return mapUnibetOutcomes(
      proposition,
      'doubleChance',
      { '1x': 'homeDraw', 12: 'homeAway', x2: 'drawAway' },
      ['homeDraw', 'homeAway', 'drawAway'],
    );
  }

  if (
    type === '1st_half_double_chance'
    || type === 'half_time_double_chance'
    || propositionName.includes('sansa dubla') && (
      propositionName.includes('pauza') || propositionName.includes('prima')
    )
  ) {
    return mapUnibetOutcomes(
      proposition,
      'firstHalfDoubleChance',
      { '1x': 'homeDraw', 12: 'homeAway', x2: 'drawAway' },
      ['homeDraw', 'homeAway', 'drawAway'],
    );
  }

  if (type === 'both_teams_to_score') {
    return mapUnibetOutcomes(
      proposition,
      'bothTeamsToScore',
      { da: 'yes', yes: 'yes', nu: 'no', no: 'no' },
      ['yes', 'no'],
    );
  }

  if (
    type === '1st_half_both_teams_to_score'
    || type === 'both_teams_to_score_1st_half'
    || (propositionName.includes('ambele') && (
      propositionName.includes('pauza') || propositionName.includes('prima')
    ))
  ) {
    return mapUnibetOutcomes(
      proposition,
      'firstHalfBothTeamsToScore',
      { da: 'yes', yes: 'yes', nu: 'no', no: 'no' },
      ['yes', 'no'],
    );
  }

  if (type === 'total' || type === 'match_total') {
    return mapUnibetLineMarket(proposition, 'totalGoals');
  }

  if (type === 'asian_total' || type === 'asian_total_goals') {
    return mapUnibetLineMarket(proposition, 'asianTotalGoals');
  }

  if (
    type === 'asian_handicap'
    || type === 'asian_handicap_goals'
    || type === 'handicap_asian'
    || propositionName.includes('handicap asiatic')
    || propositionName.includes('asian handicap')
  ) {
    return mapUnibetAsianHandicapMarket(proposition, { homeTeam, awayTeam });
  }

  if (type === '1st_half_total' || type === 'half_time_total') {
    return mapUnibetLineMarket(proposition, 'firstHalfTotalGoals');
  }

  if (type === '2nd_half_total') {
    return mapUnibetLineMarket(proposition, 'secondHalfTotalGoals');
  }

  if (type === 'draw_no_bet') {
    return mapUnibetOutcomes(
      proposition,
      'drawNoBet',
      { 1: 'home', 2: 'away' },
      ['home', 'away'],
    );
  }

  if (
    type === '1st_half_draw_no_bet'
    || type === 'half_time_draw_no_bet'
    || type === 'first_half_draw_no_bet'
    || (
      (propositionName.includes('fara egal') || propositionName.includes('draw no bet'))
      && (propositionName.includes('pauza') || propositionName.includes('prima') || propositionName.includes('1st'))
    )
  ) {
    return mapUnibetOutcomes(
      proposition,
      'firstHalfDrawNoBet',
      { 1: 'home', 2: 'away' },
      ['home', 'away'],
    );
  }

  if (
    type === '2nd_half_draw_no_bet'
    || type === 'second_half_draw_no_bet'
    || (
      (propositionName.includes('fara egal') || propositionName.includes('draw no bet'))
      && (propositionName.includes('a doua') || propositionName.includes('2nd') || propositionName.includes('second'))
    )
  ) {
    return mapUnibetOutcomes(
      proposition,
      'secondHalfDrawNoBet',
      { 1: 'home', 2: 'away' },
      ['home', 'away'],
    );
  }

  if (
    type === '1st_half_asian_total'
    || type === 'half_time_asian_total'
    || type === 'first_half_asian_total'
  ) {
    return mapUnibetLineMarket(proposition, 'firstHalfAsianTotalGoals');
  }

  if (
    type === '2nd_half_asian_total'
    || type === 'second_half_asian_total'
  ) {
    return mapUnibetLineMarket(proposition, 'secondHalfAsianTotalGoals');
  }

  if (
    type === 'odd_even'
    || type === 'goals_odd_even'
    || propositionName.includes('par impar')
    || propositionName.includes('odd even')
  ) {
    return mapUnibetOutcomes(
      proposition,
      'market_total_goluri_impar_par',
      { par: 'even', impar: 'odd', even: 'even', odd: 'odd' },
      ['odd', 'even'],
    );
  }

  if (
    propositionName === 'total cornere'
    || type === 'corner_total'
    || type === 'total_corners'
  ) {
    return mapUnibetLineMarket(proposition, 'totalCorners');
  }

  if (
    propositionName.includes('total cartonase')
    || type === 'card_total'
    || type === 'total_cards'
  ) {
    return mapUnibetLineMarket(proposition, 'totalCards');
  }

  if (type === 'to_qualify' || propositionName.includes('califica') || propositionName.includes('qualify')) {
    return mapUnibetOutcomes(
      proposition,
      'toQualify',
      { 1: 'home', 2: 'away' },
      ['home', 'away'],
    );
  }

  if (
    type === '2nd_half_double_chance'
    || type === 'second_half_double_chance'
    || (propositionName.includes('sansa dubla') && (
      propositionName.includes('a doua') || propositionName.includes('2nd')
    ))
  ) {
    return mapUnibetOutcomes(
      proposition,
      'secondHalfDoubleChance',
      { '1x': 'homeDraw', 12: 'homeAway', x2: 'drawAway' },
      ['homeDraw', 'homeAway', 'drawAway'],
    );
  }

  if (
    type.includes('team_total')
    || propositionName.includes('total goluri gazde')
    || propositionName.includes('total goluri home')
    || (propositionName.includes('total goluri') && (
      propositionName.includes('gazda') || propositionName.includes('echipa 1')
    ))
  ) {
    const home = mapUnibetLineMarket(proposition, 'market_total_goluri_home');
    if (home) return home;
  }

  if (
    propositionName.includes('total goluri oaspeti')
    || propositionName.includes('total goluri away')
    || (propositionName.includes('total goluri') && (
      propositionName.includes('oaspete') || propositionName.includes('echipa 2')
    ))
  ) {
    const away = mapUnibetLineMarket(proposition, 'market_total_goluri_away');
    if (away) return away;
  }

  if (
    propositionName.includes('gazdele marcheaza')
    || propositionName.includes('gazda marcheaza')
    || propositionName.includes('home to score')
    || (propositionName.includes('marcheaza') && (
      propositionName.includes('gazda') || propositionName.includes('gazde')
    ))
  ) {
    return mapUnibetOutcomes(
      proposition,
      'market_marcheaza_home',
      { da: 'yes', yes: 'yes', nu: 'no', no: 'no' },
      ['yes', 'no'],
    );
  }

  if (
    propositionName.includes('oaspetii marcheaza')
    || propositionName.includes('oaspete marcheaza')
    || propositionName.includes('away to score')
    || (propositionName.includes('marcheaza') && (
      propositionName.includes('oaspete') || propositionName.includes('oaspeti')
    ))
  ) {
    return mapUnibetOutcomes(
      proposition,
      'market_marcheaza_away',
      { da: 'yes', yes: 'yes', nu: 'no', no: 'no' },
      ['yes', 'no'],
    );
  }

  if (propositionName.includes('fara gol primit') || propositionName.includes('clean sheet')) {
    const side = (propositionName.includes('gazda') || propositionName.includes('gazde') || propositionName.includes('home'))
      ? 'home'
      : (propositionName.includes('oaspete') || propositionName.includes('oaspeti') || propositionName.includes('away'))
        ? 'away'
        : null;
    if (side) {
      return mapUnibetOutcomes(
        proposition,
        `market_clean_sheet_${side}`,
        { da: 'yes', yes: 'yes', nu: 'no', no: 'no' },
        ['yes', 'no'],
      );
    }
  }

  if (
    type === '2nd_half_both_teams_to_score'
    || (propositionName.includes('ambele') && (
      propositionName.includes('a doua') || propositionName.includes('2nd')
    ))
  ) {
    return mapUnibetOutcomes(
      proposition,
      'secondHalfBothTeamsToScore',
      { da: 'yes', yes: 'yes', nu: 'no', no: 'no' },
      ['yes', 'no'],
    );
  }

  return normalizeGenericUnibetMarket(proposition, { homeTeam, awayTeam });
}

function mapUnibetOutcomes(proposition, key, outcomeMap, required) {
  const prices = {};
  for (const option of proposition.options || []) {
    const mapped = outcomeMap[normalizeLabel(option.optionDisplayName).replace(/\s+/g, '')];
    if (mapped && isDecimalOdds(option.price)) {
      prices[mapped] = option.price;
    }
  }

  return required.every((outcome) => isDecimalOdds(prices[outcome]))
    ? { key, prices }
    : null;
}

function mapUnibetLineMarket(proposition, baseKey) {
  const prices = {};
  let line = null;
  for (const option of proposition.options || []) {
    const parsed = parseLineOption(option);
    if (!parsed || !isDecimalOdds(option.price)) {
      continue;
    }
    line = line || parsed.line;
    if (parsed.line === line) {
      prices[parsed.side] = option.price;
    }
  }

  return isPositiveLine(line) && ['over', 'under'].every((outcome) => isDecimalOdds(prices[outcome]))
    ? { key: `${baseKey}_${line.replace('.', '_')}`, prices }
    : null;
}

/**
 * Map 2-way Asian handicap. Options may carry handicap/line on the option or
 * embed signed lines in the display name (e.g. "1 (-0.5)").
 * Returns an array of complete line markets (caller merges into event markets).
 */
function mapUnibetAsianHandicapMarket(proposition, { homeTeam, awayTeam } = {}) {
  const grouped = new Map();
  for (const option of proposition.options || []) {
    if (!isDecimalOdds(option.price)) continue;
    const parsed = parseUnibetHandicapOption(option, { homeTeam, awayTeam });
    if (!parsed) continue;
    if (!grouped.has(parsed.homeLine)) grouped.set(parsed.homeLine, {});
    grouped.get(parsed.homeLine)[parsed.side] = option.price;
  }

  const results = [];
  for (const [homeLine, prices] of grouped.entries()) {
    if (['home', 'away'].every((side) => isDecimalOdds(prices[side]))) {
      const key = handicapMarketKey('asianHandicap', homeLine);
      if (key) results.push({ key, prices });
    }
  }
  return results.length > 0 ? results : null;
}

function parseUnibetHandicapOption(option, { homeTeam, awayTeam } = {}) {
  const raw = String(option.optionDisplayName || option.name || '').trim();
  const rawLine = option.handicap ?? option.line ?? option.point ?? option.points;
  const fromName = raw.match(/^([12]|home|away|1|2)\s*[(\[]?\s*([+-]?\d+(?:[.,]\d+)?)\s*[)\]]?$/i)
    || raw.match(/^H([12])\s*([+-]?\d+(?:[.,]\d+)?)$/i);
  if (fromName) {
    const token = String(fromName[1]).toLowerCase();
    const side = (token === '1' || token === 'home' || token === 'h1') ? 'home' : 'away';
    // H([12]) capture is only 1|2
    const sideFromH = raw.match(/^H([12])/i);
    const resolvedSide = sideFromH
      ? (sideFromH[1] === '1' ? 'home' : 'away')
      : side;
    const line = Number(String(fromName[2]).replace(',', '.'));
    if (!Number.isFinite(line)) return null;
    return { side: resolvedSide, homeLine: resolvedSide === 'home' ? line : -line };
  }

  const sideKey = normalizeUnibetOutcomeKey(raw, { homeTeam, awayTeam })
    || normalizeOutcomeKey(raw);
  const line = Number(rawLine);
  if (['home', 'away'].includes(sideKey) && Number.isFinite(line)) {
    return { side: sideKey, homeLine: sideKey === 'home' ? line : -line };
  }
  return null;
}

function normalizeGenericUnibetMarket(proposition, { homeTeam, awayTeam }) {
  const label = abstractTeamNames(
    proposition.name ||
      proposition.propositionType ||
      proposition.criterionLabel ||
      proposition.criterionName,
    { homeTeam, awayTeam },
  );
  const prices = {};
  for (const option of proposition.options || []) {
    const outcomeKey = normalizeUnibetOutcomeKey(option.optionDisplayName, {
      homeTeam,
      awayTeam,
    });
    if (outcomeKey && isDecimalOdds(option.price)) {
      prices[outcomeKey] = option.price;
    }
  }

  const key = genericMarketKey(label, extractLine(proposition) ? { line: extractLine(proposition) } : undefined);
  return key && hasCompleteOutcomes(prices) ? { key, prices } : null;
}

function parseLineOption(option) {
  const fromName = normalizeLabel(option.optionDisplayName).match(/\b(over|under|peste|sub)\s+([0-9]+(?:[.,][0-9]+)?)/);
  if (fromName) {
    return {
      side: ['over', 'peste'].includes(fromName[1]) ? 'over' : 'under',
      line: formatLine(fromName[2].replace(',', '.')),
    };
  }

  const side = normalizeOutcomeKey(option.optionDisplayName);
  const rawLine = option.line ?? option.handicap ?? option.point ?? option.points ?? option.total;
  if (['over', 'under'].includes(side) && isPositiveLine(rawLine)) {
    return {
      side,
      line: formatLine(rawLine),
    };
  }

  return null;
}

function extractLine(proposition) {
  const optionLine = (proposition.options || []).map(parseLineOption).find(Boolean);
  if (optionLine) {
    return optionLine.line;
  }

  const rawLine = proposition.line ??
    proposition.handicap ??
    proposition.point ??
    proposition.points ??
    proposition.total;
  return isPositiveLine(rawLine) ? formatLine(rawLine) : null;
}

function isPositiveLine(value) {
  const line = Number(value);
  return Number.isFinite(line) && line > 0;
}

function normalizeUnibetOutcomeKey(value, { homeTeam, awayTeam }) {
  const normalized = normalizeLabel(value);
  if (normalized && homeTeam && normalized === normalizeLabel(homeTeam)) {
    return 'home';
  }
  if (normalized && awayTeam && normalized === normalizeLabel(awayTeam)) {
    return 'away';
  }
  if (normalized === 'draw' || normalized === 'egal' || normalized === 'egalitate') {
    return 'draw';
  }
  return normalizeOutcomeKey(value);
}

function firstTimestamp(propositions) {
  const proposition = (propositions || []).find((item) => item?.timeStampBFFUtc);
  return proposition?.timeStampBFFUtc || null;
}

function getUnibetContests(payload) {
  return (payload?.view?.matches || [])
    .flatMap((match) => match.contestGroups || [])
    .flatMap((group) => group.contests || []);
}

function shouldFetchContestDetails(contest) {
  return Boolean(
    contest?.contestKey &&
      Number(contest.propositionCount || 0) > (contest.propositions?.length || 0),
  );
}

function contestPageUrl(contestKey) {
  return `${UNIBET_CONTEST_PAGE_URL}?${new URLSearchParams({
    _typ: 'GetContestWithPricesReq',
    contestKey,
  }).toString()}`;
}

function lobbyUrl(category) {
  return `${UNIBET_LOBBY_BASE_URL}?${new URLSearchParams({
    _typ: 'GetLobbyPageView',
    category,
    clientOffset: '-180',
  }).toString()}`;
}

function extractFootballCategoryRns(payload) {
  const categories = [];
  const visit = (items) => {
    for (const item of Array.isArray(items) ? items : []) {
      const categoryRn = item?.category?.categoryRn;
      if (typeof categoryRn === 'string' && categoryRn.startsWith('football')) {
        categories.push(categoryRn);
      }
      visit(item?.children);
    }
  };
  visit(payload?.quickBrowseItems);
  return [...new Set(categories)];
}

function mergeContestDetails(payload, details) {
  return {
    ...payload,
    view: {
      ...payload.view,
      matches: (payload.view?.matches || []).map((match) => ({
        ...match,
        contestGroups: (match.contestGroups || []).map((group) => ({
          ...group,
          contests: (group.contests || []).map((contest) =>
            details.get(String(contest.contestKey)) || contest,
          ),
        })),
      })),
    },
  };
}

function unibetHeaders() {
  return {
    accept: 'application/json',
    referer: 'https://www.unibet.ro/',
    origin: 'https://www.unibet.ro',
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36',
    ...browserHeaders(),
  };
}

function browserHeaders() {
  return {
    ksp_jurisdiction: 'mga',
    jurisdiction: 'RO',
    'content-type': 'application/json',
    locale: 'ro_RO',
    brand: 'unibet',
  };
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

function normalizeLabel(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}+\-.]+/gu, ' ')
    .trim();
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

module.exports = {
  UNIBET_CONTEST_PAGE_URL,
  UNIBET_LOBBY_URL,
  UNIBET_QUICKBROWSE_URL,
  UnibetProvider,
  extractFootballCategoryRns,
  normalizeUnibetMarkets,
  normalizeUnibetPayload,
};
