const { BetanoBrowserTransport } = require('./providers/betano-browser-transport');
const { BetmenProvider } = require('./providers/betmen-provider');
const { BetOneProvider } = require('./providers/betone-provider');
const { BetanoProvider } = require('./providers/betano-provider');
const { BrowserJsonTransport } = require('./providers/browser-json-transport');
const { CasaPariurilorProvider } = require('./providers/casa-pariurilor-provider');
const { EightEightEightProvider } = require('./providers/eight-eight-eight-provider');
const { FortunaProvider } = require('./providers/fortuna-provider');
const { GetsBetProvider } = require('./providers/getsbet-provider');
const { LasVegasProvider } = require('./providers/lasvegas-provider');
const { MaxBetProvider } = require('./providers/maxbet-provider');
const { MrPlayProvider } = require('./providers/mrplay-provider');
const { NetBetProvider } = require('./providers/netbet-provider');
const { NewGamblingBrandsProvider } = require('./providers/new-gambling-brands-provider');
const { StanleybetFamilyProvider } = require('./providers/stanleybet-family-provider');
const { SuperbetProvider } = require('./providers/superbet-provider');
const { TheOddsApiProvider } = require('./providers/the-odds-api-provider');
const { UnibetProvider } = require('./providers/unibet-provider');
const { createVivaGamesProviders } = require('./providers/viva-games-provider');
const { WinnerProvider } = require('./providers/winner-provider');
const { WinbetProvider } = require('./providers/winbet-provider');

const DEFAULT_BOOKMAKER_EVENT_TARGET = 1000;
const DEFAULT_ODDS_API_EVENT_DETAIL_CONCURRENCY = 2;
const DEFAULT_ODDS_API_MAX_EVENT_DETAIL_REQUESTS = 20;
const DEFAULT_LOOKAHEAD_DAYS = 180;
const DEFAULT_PROVIDER_TIMEOUT_MS = 12_000;
const DEFAULT_SUPERBET_LOOKAHEAD_DAYS = 180;

function buildProviderConfig(env = process.env) {
  const options = providerOptionsFromEnv(env);
  const directProviders = buildDirectProviders(options);

  if (env.BETANO_BROWSER_ENABLED === '1') {
    directProviders.push(buildBetanoProvider(env, options.eventTarget));
  }

  const configuredProviders = [...directProviders];
  if (env.ODDS_API_KEY) {
    configuredProviders.push(buildTheOddsApiProvider(env, options.timeoutMs, options));
  }

  return {
    configuredProviders,
    directProviders,
    liveProviderName: env.ODDS_API_KEY
      ? 'Romanian bookmakers + The Odds API'
      : 'Romanian bookmakers',
  };
}

function buildDirectProviders(options = providerOptionsFromEnv()) {
  const {
    betoneDetailsConcurrency,
    betoneMaxDetailEvents,
    digitainLookaheadDays,
    digitainWindowConcurrency,
    digitainWindowDays,
    egtLookaheadDays,
    egtMarketCount,
    egtPageSize,
    eventTarget,
    getsbetConcurrency,
    getsbetMaxDetailEvents,
    getsbetMaxTournaments,
    lasVegasDetailsConcurrency,
    lasVegasMaxDetailEvents,
    netbetDetailsConcurrency,
    netbetMaxDetailEvents,
    superbetLookaheadDays,
    timeoutMs,
    ufoMaxPages,
    ufoPageSize,
    unibetCategoryLimit,
    unibetDetailLimit,
    unibetRequestConcurrency,
    xsportLookaheadDays,
  } = options;

  const providers = [
    new FortunaProvider({ maxPages: ufoMaxPages, pageSize: ufoPageSize, timeoutMs }),
    new CasaPariurilorProvider({ maxPages: ufoMaxPages, pageSize: ufoPageSize, timeoutMs }),
    new SuperbetProvider({ lookaheadDays: superbetLookaheadDays, timeoutMs }),
    new BetOneProvider({
      timeoutMs,
      maxDetailEvents: betoneMaxDetailEvents,
      detailsConcurrency: betoneDetailsConcurrency,
    }),
    new BetmenProvider({ timeoutMs }),
    new GetsBetProvider({
      timeoutMs: Math.max(timeoutMs, 12_000),
      maxTournaments: getsbetMaxTournaments,
      maxDetailEvents: getsbetMaxDetailEvents,
      concurrency: getsbetConcurrency,
    }),
    new WinnerProvider({
      timeoutMs,
      lookaheadDays: digitainLookaheadDays,
      windowDays: digitainWindowDays,
      windowConcurrency: digitainWindowConcurrency,
    }),
    new EightEightEightProvider({
      timeoutMs,
      lookaheadDays: digitainLookaheadDays,
      windowDays: digitainWindowDays,
      windowConcurrency: digitainWindowConcurrency,
    }),
    new MrPlayProvider({
      timeoutMs,
      lookaheadDays: digitainLookaheadDays,
      windowDays: digitainWindowDays,
      windowConcurrency: digitainWindowConcurrency,
    }),
    new NewGamblingBrandsProvider({
      timeoutMs,
      lookaheadDays: digitainLookaheadDays,
      windowDays: digitainWindowDays,
      windowConcurrency: digitainWindowConcurrency,
    }),
    new StanleybetFamilyProvider({
      timeoutMs,
    }),
    new LasVegasProvider({
      timeoutMs,
      lookaheadDays: xsportLookaheadDays,
      maxDetailEvents: lasVegasMaxDetailEvents,
      detailsConcurrency: lasVegasDetailsConcurrency,
    }),
    new MaxBetProvider({ timeoutMs }),
    new NetBetProvider({
      timeoutMs,
      maxDetailEvents: netbetMaxDetailEvents,
      detailsConcurrency: netbetDetailsConcurrency,
    }),
    new WinbetProvider({
      timeoutMs,
      pageSize: egtPageSize,
      marketCount: egtMarketCount,
      lookaheadDays: egtLookaheadDays,
    }),
    ...createVivaGamesProviders({
      timeoutMs,
      pageSize: egtPageSize,
      marketCount: egtMarketCount,
      lookaheadDays: egtLookaheadDays,
    }),
    new UnibetProvider({
      timeoutMs,
      categoryLimit: unibetCategoryLimit,
      detailLimit: unibetDetailLimit,
      requestConcurrency: unibetRequestConcurrency,
      browserTransport: new BrowserJsonTransport({
        pageUrl: 'https://www.unibet.ro/betting/odds/football',
        timeoutMs: 30_000,
      }),
    }),
  ];

  return providers.map((provider) => attachProviderEventTarget(provider, eventTarget));
}

function providerOptionsFromEnv(env = process.env) {
  const eventTarget = parsePositiveInteger(
    env.BOOKMAKER_EVENT_TARGET || env.ODDS_EVENT_TARGET,
    DEFAULT_BOOKMAKER_EVENT_TARGET,
  );
  const timeoutMs = parsePositiveInteger(env.ODDS_REQUEST_TIMEOUT_MS, DEFAULT_PROVIDER_TIMEOUT_MS);
  const ufoPageSize = parsePositiveInteger(env.UFO_PAGE_SIZE, 100);
  return {
    eventTarget,
    timeoutMs,
    superbetLookaheadDays: parsePositiveInteger(
      env.SUPERBET_LOOKAHEAD_DAYS || env.ODDS_LOOKAHEAD_DAYS,
      DEFAULT_SUPERBET_LOOKAHEAD_DAYS,
    ),
    ufoMaxPages: parsePositiveInteger(
      env.UFO_MAX_PAGES,
      Math.max(40, Math.ceil(eventTarget / ufoPageSize)),
    ),
    ufoPageSize,
    netbetMaxDetailEvents: parsePositiveInteger(env.NETBET_MAX_DETAIL_EVENTS, eventTarget),
    netbetDetailsConcurrency: parsePositiveInteger(env.NETBET_DETAILS_CONCURRENCY, 8),
    betoneMaxDetailEvents: parsePositiveInteger(env.BETONE_MAX_DETAIL_EVENTS, eventTarget),
    betoneDetailsConcurrency: parsePositiveInteger(env.BETONE_DETAILS_CONCURRENCY, 8),
    digitainLookaheadDays: parsePositiveInteger(
      env.DIGITAIN_LOOKAHEAD_DAYS,
      DEFAULT_LOOKAHEAD_DAYS,
    ),
    digitainWindowDays: parsePositiveInteger(env.DIGITAIN_WINDOW_DAYS, 7),
    digitainWindowConcurrency: parsePositiveInteger(env.DIGITAIN_WINDOW_CONCURRENCY, 3),
    egtPageSize: parsePositiveInteger(env.EGT_PAGE_SIZE, 1000),
    egtMarketCount: parsePositiveInteger(env.EGT_MARKET_COUNT, 160),
    egtLookaheadDays: parsePositiveInteger(env.EGT_LOOKAHEAD_DAYS, DEFAULT_LOOKAHEAD_DAYS),
    getsbetMaxTournaments: parsePositiveInteger(
      env.GETSBET_MAX_TOURNAMENTS,
      Math.max(160, eventTarget),
    ),
    getsbetMaxDetailEvents: parsePositiveInteger(env.GETSBET_MAX_DETAIL_EVENTS, eventTarget),
    getsbetConcurrency: parsePositiveInteger(env.GETSBET_CONCURRENCY, 8),
    lasVegasMaxDetailEvents: parsePositiveInteger(env.LASVEGAS_MAX_DETAIL_EVENTS, eventTarget),
    lasVegasDetailsConcurrency: parsePositiveInteger(env.LASVEGAS_DETAILS_CONCURRENCY, 8),
    oddsApiEventMarketKeys: parseCsv(env.ODDS_API_EVENT_MARKETS || ''),
    oddsApiMaxEventDetailRequests: parsePositiveInteger(
      env.ODDS_API_MAX_EVENT_DETAIL_REQUESTS_PER_SPORT,
      DEFAULT_ODDS_API_MAX_EVENT_DETAIL_REQUESTS,
    ),
    oddsApiEventDetailConcurrency: parsePositiveInteger(
      env.ODDS_API_EVENT_DETAIL_CONCURRENCY,
      DEFAULT_ODDS_API_EVENT_DETAIL_CONCURRENCY,
    ),
    unibetCategoryLimit: parsePositiveInteger(env.UNIBET_CATEGORY_LIMIT, eventTarget),
    unibetDetailLimit: parsePositiveInteger(env.UNIBET_DETAIL_LIMIT, eventTarget),
    unibetRequestConcurrency: parsePositiveInteger(env.UNIBET_REQUEST_CONCURRENCY, 12),
    xsportLookaheadDays: parsePositiveInteger(env.XSPORT_LOOKAHEAD_DAYS, DEFAULT_LOOKAHEAD_DAYS),
  };
}

function buildBetanoProvider(env = process.env, eventTarget = DEFAULT_BOOKMAKER_EVENT_TARGET) {
  const provider = new BetanoProvider({
    transport: new BetanoBrowserTransport({
      headless: env.BETANO_BROWSER_HEADLESS !== '0',
      timeoutMs: parsePositiveInteger(env.BETANO_BROWSER_TIMEOUT_MS, 30_000),
      maxEvents: parsePositiveInteger(env.BETANO_BROWSER_MAX_EVENTS, eventTarget),
    }),
  });
  return attachProviderEventTarget(provider, eventTarget);
}

function buildTheOddsApiProvider(
  env = process.env,
  timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS,
  options = providerOptionsFromEnv(env),
) {
  return new TheOddsApiProvider({
    apiKey: env.ODDS_API_KEY,
    sportKeys: parseCsv(env.ODDS_SPORT_KEYS || 'soccer_fifa_world_cup'),
    regions: parseCsv(env.ODDS_API_REGIONS || 'eu,uk'),
    bookmakers: parseCsv(env.ODDS_API_BOOKMAKERS || ''),
    marketKeys: parseCsv(env.ODDS_API_MARKETS || 'h2h,spreads,totals'),
    eventMarketKeys: options.oddsApiEventMarketKeys,
    maxEventDetailRequests: options.oddsApiMaxEventDetailRequests,
    eventDetailConcurrency: options.oddsApiEventDetailConcurrency,
    timeoutMs,
  });
}

function bookmakerNamesForProviders(providers) {
  return [...new Set(
    (Array.isArray(providers) ? providers : []).flatMap((provider) => {
      if (Array.isArray(provider?.brands)) {
        return provider.brands.map((brand) => brand.name);
      }
      return provider?.name ? [provider.name] : [];
    }),
  )].sort((left, right) => left.localeCompare(right));
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBooleanFlag(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase())) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase())) {
    return false;
  }
  return fallback;
}

function parseCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function attachProviderEventTarget(provider, eventTarget) {
  if (provider && Number.isInteger(eventTarget) && eventTarget > 0) {
    provider.eventTarget = eventTarget;
  }
  return provider;
}

module.exports = {
  bookmakerNamesForProviders,
  buildDirectProviders,
  buildProviderConfig,
  parseBooleanFlag,
  parseCsv,
  parsePositiveInteger,
  providerOptionsFromEnv,
};
