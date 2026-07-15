/**
 * Application Bootstrapper & Server Lifecyle Manager Component.
 */

const { loadEnvFile } = require('../core/env');
loadEnvFile();

const { createApp } = require('./app');
const { OddsService } = require('../services/odds-service');
const { DemoOddsProvider } = require('../providers/demo-provider');
const { CompositeProvider } = require('../providers/composite-provider');
const { ProviderSupervisor } = require('../autonomy/provider-supervisor');
const { DurableAlertOutbox } = require('../autonomy/alert-outbox');
const { OpportunityPipeline } = require('../autonomy/opportunity-pipeline');
const { CandidateVerificationBroker } = require('../autonomy/candidate-verification-broker');
const { AutonomyMonitor } = require('../autonomy/autonomy-monitor');
const { AutonomousRuntime } = require('../autonomy/autonomous-runtime');
const { createAutonomyStore } = require('../storage/autonomy-store');
const { BetTracker } = require('../finance/bet-tracker');
const { WebhookManager } = require('../finance/webhook-manager');
const { SettlementService } = require('../results/settlement-service');
const { TheOddsApiResultsProvider } = require('../results/the-odds-api-results-provider');
const { createLogger } = require('../core/logger');
const {
  buildProviderConfig,
  parseBooleanFlag,
  parsePositiveInteger,
} = require('../services/provider-config');

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
  const autonomyEnabled = parseBooleanFlag(process.env.AUTONOMY_ENABLED, false);
  const failClosed = parseBooleanFlag(
    process.env.PRODUCTION_FAIL_CLOSED,
    process.env.NODE_ENV === 'production',
  );
  const collectionIntervalMs = parsePositiveInteger(process.env.AUTONOMY_COLLECTION_INTERVAL_MS, 15_000);
  const fidelityEnabled = parseBooleanFlag(process.env.AUTONOMY_FIDELITY_ENABLED, false);
  const candidateVerificationEnabled = parseBooleanFlag(
    process.env.AUTONOMY_CANDIDATE_VERIFICATION_ENABLED,
    fidelityEnabled,
  );
  const liveProvider = autonomyEnabled
    ? new ProviderSupervisor(configuredProviders, {
      name: liveProviderName,
      intervalMs: parsePositiveInteger(process.env.AUTONOMY_PROVIDER_BASE_INTERVAL_MS, 60_000),
      adaptiveCadence: parseBooleanFlag(process.env.AUTONOMY_ADAPTIVE_CADENCE, true),
      minIntervalMs: parsePositiveInteger(process.env.AUTONOMY_PROVIDER_MIN_INTERVAL_MS, 15_000),
      maxIntervalMs: parsePositiveInteger(process.env.AUTONOMY_PROVIDER_MAX_INTERVAL_MS, 120_000),
      durationMultiplier: parsePositiveInteger(process.env.AUTONOMY_PROVIDER_DURATION_MULTIPLIER, 3),
      concurrency: parsePositiveInteger(process.env.AUTONOMY_PROVIDER_CONCURRENCY, 2),
      progressEvery: parsePositiveInteger(process.env.AUTONOMY_PROGRESS_EVERY_PROVIDERS, 4),
      staleAfterMs: parsePositiveInteger(process.env.AUTONOMY_STALE_AFTER_MS, 180_000),
      circuitFailures: parsePositiveInteger(process.env.AUTONOMY_CIRCUIT_FAILURES, 3),
      circuitCooldownMs: parsePositiveInteger(process.env.AUTONOMY_CIRCUIT_COOLDOWN_MS, 300_000),
      logger: log,
    })
    : new CompositeProvider(configuredProviders, {
      name: liveProviderName,
      concurrency: parsePositiveInteger(process.env.ODDS_PROVIDER_CONCURRENCY, 2),
      progressEvery: parsePositiveInteger(process.env.ODDS_PROGRESS_EVERY_PROVIDERS, 4),
    });
  const demoOnly = process.env.DEMO_ONLY === '1';
  const store = autonomyEnabled ? createAutonomyStore(process.env) : null;
  const oddsService = new OddsService({
    liveProvider: demoOnly ? null : liveProvider,
    demoProvider: new DemoOddsProvider(),
    cacheTtlMs,
    snapshotStore: store,
    failClosed: failClosed && !demoOnly,
  });
  const betTracker = new BetTracker();
  const alertOutbox = autonomyEnabled ? new DurableAlertOutbox({
    store,
    webhookManager: new WebhookManager(),
    telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
    telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
    logger: log,
  }) : null;
  const opportunityPipeline = autonomyEnabled ? new OpportunityPipeline({
    store,
    alertOutbox,
    opportunityTtlMs: parsePositiveInteger(process.env.AUTONOMY_OPPORTUNITY_TTL_MS, 120_000),
    confirmationSnapshots: parsePositiveInteger(process.env.AUTONOMY_CONFIRMATION_SNAPSHOTS, 2),
    confirmationMinIntervalMs: parsePositiveInteger(process.env.AUTONOMY_CONFIRMATION_MIN_INTERVAL_MS, 2_000),
    confirmationMaxIntervalMs: parsePositiveInteger(process.env.AUTONOMY_CONFIRMATION_MAX_INTERVAL_MS, 90_000),
    maxQuoteAgeMs: parsePositiveInteger(process.env.AUTONOMY_MAX_QUOTE_AGE_MS, 45_000),
    maxQuoteSkewMs: parsePositiveInteger(process.env.AUTONOMY_MAX_QUOTE_SKEW_MS, 20_000),
    logger: log,
  }) : null;
  const candidateVerificationBroker = autonomyEnabled ? new CandidateVerificationBroker({
    store,
    enabled: candidateVerificationEnabled,
    maxCandidates: parsePositiveInteger(process.env.AUTONOMY_CANDIDATE_MAX_PAGES, 8),
    maxLegs: parsePositiveInteger(process.env.AUTONOMY_CANDIDATE_MAX_LEGS, 24),
    reverifyCooldownMs: parsePositiveInteger(process.env.AUTONOMY_REVERIFY_COOLDOWN_MS, 600_000),
    changedPriceCooldownMs: parsePositiveInteger(process.env.AUTONOMY_CHANGED_PRICE_COOLDOWN_MS, 15_000),
    timeoutMs: parsePositiveInteger(process.env.AUTONOMY_FIDELITY_TIMEOUT_MS, 30_000),
    concurrency: parsePositiveInteger(process.env.AUTONOMY_CANDIDATE_CONCURRENCY, 2),
    maxQuoteAgeMs: parsePositiveInteger(process.env.AUTONOMY_MAX_QUOTE_AGE_MS, 45_000),
    maxQuoteSkewMs: parsePositiveInteger(process.env.AUTONOMY_MAX_QUOTE_SKEW_MS, 20_000),
    logger: log,
  }) : null;
  const settlementService = buildSettlementService({ store, betTracker, logger: log });
  const monitor = autonomyEnabled ? new AutonomyMonitor({
    store,
    endpointIntervalMs: parsePositiveInteger(process.env.AUTONOMY_ENDPOINT_AUDIT_INTERVAL_MS, 21_600_000),
    discoveryIntervalMs: parsePositiveInteger(process.env.AUTONOMY_DISCOVERY_INTERVAL_MS, 86_400_000),
    fidelityIntervalMs: parsePositiveInteger(process.env.AUTONOMY_FIDELITY_INTERVAL_MS, 600_000),
    fidelityEnabled,
    providerNames: configuredProviders.map((provider) => provider.name),
    logger: log,
  }) : null;
  const autonomyRuntime = autonomyEnabled ? new AutonomousRuntime({
    oddsService,
    store,
    opportunityPipeline,
    candidateVerificationBroker,
    alertOutbox,
    monitor,
    settlementService,
    collectionIntervalMs,
    alertIntervalMs: parsePositiveInteger(process.env.AUTONOMY_ALERT_INTERVAL_MS, 5_000),
    fidelityMaxAgeMs: parsePositiveInteger(process.env.AUTONOMY_FIDELITY_MAX_AGE_MS, 600_000),
    retentionIntervalMs: parsePositiveInteger(process.env.AUTONOMY_RETENTION_INTERVAL_MS, 86_400_000),
    progressiveBatches: parsePositiveInteger(process.env.AUTONOMY_PROGRESSIVE_BATCHES, 2),
    logger: log,
  }) : null;
  const app = createApp({
    oddsService,
    liveConfigured: !demoOnly && Boolean(liveProvider),
    betTracker,
    autonomyRuntime,
    allowInferredSettlement: !autonomyEnabled
      && parseBooleanFlag(process.env.ALLOW_INFERRED_SETTLEMENT, true),
  });

  const server = app.listen(port, () => {
    const mode = demoOnly
      ? 'demo only'
      : `${liveProvider.name}${failClosed ? ' (fail closed)' : ' with demo fallback'}`;
    log.info('Odds dashboard listening', { port, mode });
    if (autonomyRuntime) {
      autonomyRuntime.start().catch((error) => {
        log.error('Autonomous runtime failed to start', { error: error.message });
      });
    } else {
      warmOddsCache({
        enabled: parseBooleanFlag(process.env.ODDS_WARM_CACHE_ON_START, false),
        oddsService,
        logger: log,
      });
    }
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      log.info('Shutting down', { signal });
      Promise.resolve(autonomyRuntime?.stop?.())
        .catch((error) => log.warn('Autonomous runtime shutdown failed', { error: error.message }))
        .finally(() => server.close(() => process.exit(0)));
    });
  }

  return server;
}

function buildSettlementService({ store, betTracker, logger = log } = {}) {
  const enabled = parseBooleanFlag(process.env.RESULTS_ENABLED, false);
  const apiKey = process.env.RESULTS_API_KEY || process.env.ODDS_API_KEY || '';
  if (!enabled || !apiKey) return null;
  const sportKeys = String(process.env.RESULTS_SPORT_KEYS || process.env.ODDS_SPORT_KEYS || '')
    .split(',').map((value) => value.trim()).filter(Boolean);
  if (sportKeys.length === 0) return null;
  return new SettlementService({
    resultsProvider: new TheOddsApiResultsProvider({
      apiKey,
      sportKeys,
      daysFrom: parsePositiveInteger(process.env.RESULTS_DAYS_FROM, 3),
      timeoutMs: parsePositiveInteger(process.env.RESULTS_TIMEOUT_MS, 12_000),
    }),
    betTracker,
    store,
    intervalMs: parsePositiveInteger(process.env.RESULTS_INTERVAL_MS, 900_000),
    logger,
  });
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

module.exports = { buildSettlementService, startServer, warmOddsCache };
