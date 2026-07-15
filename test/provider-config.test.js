const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  COVERAGE_STATUSES,
  ROMANIAN_BOOKMAKER_COVERAGE,
} = require('../src/bookmaker-coverage');
const {
  bookmakerNamesForProviders,
  buildProviderConfig,
  parseBooleanFlag,
  parseCsv,
  parsePositiveInteger,
  oddsApiSportKeysFromEnv,
  providerOptionsFromEnv,
} = require('../src/provider-config');

test('default provider config loads every direct bookmaker from the coverage registry', () => {
  const { directProviders, configuredProviders, liveProviderName } = buildProviderConfig({});
  const providerNames = bookmakerNamesForProviders(directProviders);
  const directCoverageNames = ROMANIAN_BOOKMAKER_COVERAGE
    .filter((entry) => entry.status === COVERAGE_STATUSES.direct)
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  assert.deepEqual(providerNames, directCoverageNames);
  assert.equal(configuredProviders.length, directProviders.length);
  assert.equal(liveProviderName, 'Romanian bookmakers');
  assert.equal(directProviders.every((provider) => provider.eventTarget === 1000), true);
  assert.equal(
    directProviders.find((provider) => provider.name === 'Winner').lookaheadDays,
    180,
  );
  assert.equal(
    directProviders.find((provider) => provider.name === 'Winner').windowDays,
    7,
  );
  assert.equal(
    directProviders.find((provider) => provider.name === 'Winner').windowConcurrency,
    3,
  );
});

test('expands opt-in sport presets without overriding explicit sport keys', () => {
  assert.deepEqual(oddsApiSportKeysFromEnv({ ODDS_SPORT_KEYS: 'basketball_nba' }), ['basketball_nba']);
  const core = oddsApiSportKeysFromEnv({ ODDS_SPORT_KEYS: '', ODDS_SPORT_PRESET: 'core' });
  assert.ok(core.includes('soccer_fifa_world_cup'));
  assert.ok(core.includes('basketball_nba'));
  assert.ok(core.includes('icehockey_nhl'));
});

test('optional provider config adds Betano and The Odds API when enabled', () => {
  const { configuredProviders, directProviders, liveProviderName } = buildProviderConfig({
    BETANO_BROWSER_ENABLED: '1',
    BETANO_BROWSER_HEADLESS: '0',
    BETANO_BROWSER_SETTLE_MS: '2500',
    BETANO_BROWSER_DETAIL_CONCURRENCY: '2',
    BETANO_BROWSER_MAX_RESPONSE_BYTES: '1048576',
    ODDS_API_KEY: 'test-key',
    ODDS_API_BOOKMAKERS: 'pinnacle,betfair_ex_eu',
    ODDS_API_EVENT_MARKETS: 'btts,alternate_totals',
    ODDS_API_EVENT_DETAIL_CONCURRENCY: '3',
    ODDS_API_MARKETS: 'h2h,totals',
    ODDS_API_MAX_EVENT_DETAIL_REQUESTS_PER_SPORT: '12',
    ODDS_API_DISCOVER_SPORTS: '1',
    ODDS_API_SPORT_GROUPS: 'Soccer,Basketball',
    ODDS_API_MAX_SPORTS: '6',
    ODDS_API_SPORT_CONCURRENCY: '2',
    ODDS_SPORT_KEYS: 'soccer_a,soccer_b',
  });
  const names = bookmakerNamesForProviders(configuredProviders);
  const betano = configuredProviders.find((provider) => provider.name === 'Betano');
  const oddsApi = configuredProviders.find((provider) => provider.name === 'The Odds API');

  assert.equal(liveProviderName, 'Romanian bookmakers + The Odds API');
  assert.equal(names.includes('Betano'), true);
  assert.equal(names.includes('The Odds API'), true);
  assert.equal(configuredProviders.length, directProviders.length + 1);
  assert.equal(betano.eventTarget, 1000);
  assert.equal(betano.transport.maxEvents, 1000);
  assert.equal(betano.transport.settleMs, 2500);
  assert.equal(betano.transport.detailConcurrency, 2);
  assert.equal(betano.transport.maxResponseBytes, 1048576);
  assert.deepEqual(oddsApi.eventMarketKeys, ['btts', 'alternate_totals']);
  assert.equal(oddsApi.maxEventDetailRequests, 12);
  assert.equal(oddsApi.eventDetailConcurrency, 3);
  assert.equal(oddsApi.discoverSports, true);
  assert.deepEqual(oddsApi.sportGroups, ['Soccer', 'Basketball']);
  assert.equal(oddsApi.maxSports, 6);
  assert.equal(oddsApi.sportConcurrency, 2);
});

test('parses provider environment options defensively', () => {
  assert.equal(parsePositiveInteger('12', 1), 12);
  assert.equal(parsePositiveInteger('0', 1), 1);
  assert.equal(parseBooleanFlag('1'), true);
  assert.equal(parseBooleanFlag('true'), true);
  assert.equal(parseBooleanFlag('yes'), true);
  assert.equal(parseBooleanFlag('0', true), false);
  assert.equal(parseBooleanFlag('false', true), false);
  assert.equal(parseBooleanFlag('unexpected', true), true);
  assert.deepEqual(parseCsv(' a, ,b '), ['a', 'b']);

  const options = providerOptionsFromEnv({
    BOOKMAKER_EVENT_TARGET: '1200',
    ODDS_API_EVENT_MARKETS: 'btts,alternate_spreads',
    ODDS_API_EVENT_DETAIL_CONCURRENCY: '3',
    ODDS_API_MAX_EVENT_DETAIL_REQUESTS_PER_SPORT: '12',
    ODDS_REQUEST_TIMEOUT_MS: '9000',
    SUPERBET_LOOKAHEAD_DAYS: '21',
    UFO_MAX_PAGES: '3',
  });

  assert.equal(options.eventTarget, 1200);
  assert.equal(options.timeoutMs, 9000);
  assert.equal(options.superbetLookaheadDays, 21);
  assert.equal(options.ufoMaxPages, 3);
  assert.equal(options.ufoPageSize, 100);
  assert.equal(options.netbetMaxDetailEvents, 1200);
  assert.equal(options.betoneMaxDetailEvents, 1200);
  assert.equal(options.digitainLookaheadDays, 180);
  assert.equal(options.digitainWindowDays, 7);
  assert.equal(options.digitainWindowConcurrency, 3);
  assert.equal(options.egtMarketCount, 160);
  assert.equal(options.egtLookaheadDays, 180);
  assert.equal(options.getsbetMaxTournaments, 1200);
  assert.equal(options.getsbetMaxDetailEvents, 1200);
  assert.deepEqual(options.oddsApiEventMarketKeys, ['btts', 'alternate_spreads']);
  assert.equal(options.oddsApiMaxEventDetailRequests, 12);
  assert.equal(options.oddsApiEventDetailConcurrency, 3);
  assert.equal(options.oddsApiDiscoverSports, false);
  assert.deepEqual(options.oddsApiSportGroups, []);
  assert.equal(options.oddsApiMaxSports, 8);
  assert.equal(options.oddsApiSportConcurrency, 3);
  assert.equal(options.unibetDetailLimit, 1200);
  assert.equal(options.unibetRequestConcurrency, 12);
  assert.equal(options.xsportLookaheadDays, 180);
});

test('.env.example mirrors provider option defaults', () => {
  const envExample = parseEnvExample();
  const defaults = providerOptionsFromEnv({});

  assert.equal(Number(envExample.ODDS_REQUEST_TIMEOUT_MS), defaults.timeoutMs);
  assert.equal(Number(envExample.BOOKMAKER_EVENT_TARGET), defaults.eventTarget);
  assert.equal(Number(envExample.SUPERBET_LOOKAHEAD_DAYS), defaults.superbetLookaheadDays);
  assert.equal(Number(envExample.UFO_MAX_PAGES), defaults.ufoMaxPages);
  assert.equal(Number(envExample.UFO_PAGE_SIZE), defaults.ufoPageSize);
  assert.equal(Number(envExample.NETBET_MAX_DETAIL_EVENTS), defaults.netbetMaxDetailEvents);
  assert.equal(Number(envExample.NETBET_DETAILS_CONCURRENCY), defaults.netbetDetailsConcurrency);
  assert.equal(Number(envExample.BETONE_MAX_DETAIL_EVENTS), defaults.betoneMaxDetailEvents);
  assert.equal(Number(envExample.BETONE_DETAILS_CONCURRENCY), defaults.betoneDetailsConcurrency);
  assert.equal(Number(envExample.DIGITAIN_LOOKAHEAD_DAYS), defaults.digitainLookaheadDays);
  assert.equal(Number(envExample.DIGITAIN_WINDOW_DAYS), defaults.digitainWindowDays);
  assert.equal(Number(envExample.DIGITAIN_WINDOW_CONCURRENCY), defaults.digitainWindowConcurrency);
  assert.equal(Number(envExample.EGT_PAGE_SIZE), defaults.egtPageSize);
  assert.equal(Number(envExample.EGT_MARKET_COUNT), defaults.egtMarketCount);
  assert.equal(Number(envExample.EGT_LOOKAHEAD_DAYS), defaults.egtLookaheadDays);
  assert.equal(Number(envExample.GETSBET_MAX_TOURNAMENTS), defaults.getsbetMaxTournaments);
  assert.equal(Number(envExample.GETSBET_MAX_DETAIL_EVENTS), defaults.getsbetMaxDetailEvents);
  assert.equal(Number(envExample.GETSBET_CONCURRENCY), defaults.getsbetConcurrency);
  assert.equal(Number(envExample.LASVEGAS_MAX_DETAIL_EVENTS), defaults.lasVegasMaxDetailEvents);
  assert.equal(Number(envExample.LASVEGAS_DETAILS_CONCURRENCY), defaults.lasVegasDetailsConcurrency);
  assert.equal(Number(envExample.UNIBET_CATEGORY_LIMIT), defaults.unibetCategoryLimit);
  assert.equal(Number(envExample.UNIBET_DETAIL_LIMIT), defaults.unibetDetailLimit);
  assert.equal(Number(envExample.UNIBET_REQUEST_CONCURRENCY), defaults.unibetRequestConcurrency);
  assert.equal(Number(envExample.XSPORT_LOOKAHEAD_DAYS), defaults.xsportLookaheadDays);
  assert.equal(envExample.ODDS_API_REGIONS, 'eu,uk');
  assert.equal(envExample.ODDS_API_MARKETS, 'h2h,spreads,totals');
  assert.deepEqual(parseCsv(envExample.ODDS_API_EVENT_MARKETS), defaults.oddsApiEventMarketKeys);
  assert.equal(
    Number(envExample.ODDS_API_MAX_EVENT_DETAIL_REQUESTS_PER_SPORT),
    defaults.oddsApiMaxEventDetailRequests,
  );
  assert.equal(
    Number(envExample.ODDS_API_EVENT_DETAIL_CONCURRENCY),
    defaults.oddsApiEventDetailConcurrency,
  );
});

test('README configuration table documents every .env.example variable', () => {
  const envExample = parseEnvExample();
  const readmeDefaults = parseReadmeConfigurationDefaults();

  for (const [key, value] of Object.entries(envExample)) {
    assert.ok(key in readmeDefaults, `${key} should be documented in README`);
    assert.equal(readmeDefaults[key], value || 'empty', `${key} README default should match .env.example`);
  }
});

function parseEnvExample() {
  return Object.fromEntries(
    fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

function parseReadmeConfigurationDefaults() {
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  const section = readme.match(/## Configuration\n\n\| Variable \| Default \| Purpose \|\n\| --- \| --- \| --- \|\n(?<rows>(?:\| .+\n)+)/);
  assert.ok(section, 'README should include a configuration table');

  return Object.fromEntries(
    section.groups.rows
      .trim()
      .split(/\r?\n/)
      .map((line) => {
        const cells = line
          .split('|')
          .slice(1, -1)
          .map((cell) => cell.trim().replace(/^`|`$/g, ''));
        return [cells[0], cells[1]];
      }),
  );
}
