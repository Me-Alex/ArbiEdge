const { loadEnvFile } = require('./env-loader');
loadEnvFile();

const { createApp } = require('./app');
const { OddsService } = require('./odds-service');
const { DemoOddsProvider } = require('./providers/demo-provider');
const { CompositeProvider } = require('./providers/composite-provider');
const { createLogger } = require('./logger');
const {
  buildProviderConfig,
  parseBooleanFlag,
  parsePositiveInteger,
} = require('./provider-config');

const log = createLogger({ level: process.env.LOG_LEVEL || 'info', json: process.env.LOG_JSON === '1' });

const port = parsePositiveInteger(process.env.PORT, 3000);
const cacheTtlMs = parsePositiveInteger(
  process.env.ODDS_CACHE_TTL_MS,
  60_000,
);
const { configuredProviders, liveProviderName } = buildProviderConfig(process.env);

if (require.main === module) {
  startServer();
}

function startServer() {
  const liveProvider = new CompositeProvider(configuredProviders, {
    name: liveProviderName,
  });

  const demoOnly = process.env.DEMO_ONLY === '1';
  const oddsService = new OddsService({
    liveProvider: demoOnly ? null : liveProvider,
    demoProvider: new DemoOddsProvider(),
    cacheTtlMs,
  });
  const app = createApp({
    oddsService,
    liveConfigured: !demoOnly && Boolean(liveProvider),
  });

  const server = app.listen(port, () => {
    const mode = demoOnly ? 'demo only' : `${liveProvider.name} with demo fallback`;
    log.info('Odds dashboard listening', { port, mode });
    warmOddsCache({
      enabled: parseBooleanFlag(process.env.ODDS_WARM_CACHE_ON_START, false),
      oddsService,
      logger: log,
    });
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      log.info('Shutting down', { signal });
      server.close(() => process.exit(0));
    });
  }

  return server;
}

function warmOddsCache({ enabled, oddsService, logger = log }) {
  if (!enabled || typeof oddsService?.getOdds !== 'function') {
    return;
  }

  oddsService.getOdds()
    .then((payload) => {
      const eventCount = Array.isArray(payload?.events) ? payload.events.length : 0;
      logger.info('Odds cache warmed', { events: eventCount });
    })
    .catch((error) => {
      logger.warn('Odds cache warm-up failed', { error: error.message });
    });
}

module.exports = { startServer, warmOddsCache };
