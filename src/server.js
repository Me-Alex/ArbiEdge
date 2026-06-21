const { createApp } = require('./app');
const { OddsService } = require('./odds-service');
const { DemoOddsProvider } = require('./providers/demo-provider');
const { TheOddsApiProvider } = require('./providers/the-odds-api-provider');

const port = parsePositiveInteger(process.env.PORT, 3000);
const timeoutMs = parsePositiveInteger(
  process.env.ODDS_REQUEST_TIMEOUT_MS,
  8000,
);
const cacheTtlMs = parsePositiveInteger(
  process.env.ODDS_CACHE_TTL_MS,
  60_000,
);
const sportKeys = (process.env.ODDS_SPORT_KEYS || 'soccer_fifa_world_cup')
  .split(',')
  .map((key) => key.trim())
  .filter(Boolean);

const liveProvider = process.env.ODDS_API_KEY
  ? new TheOddsApiProvider({
      apiKey: process.env.ODDS_API_KEY,
      sportKeys,
      timeoutMs,
    })
  : null;

const oddsService = new OddsService({
  liveProvider,
  demoProvider: new DemoOddsProvider(),
  cacheTtlMs,
});
const app = createApp({
  oddsService,
  liveConfigured: Boolean(liveProvider),
});

const server = app.listen(port, () => {
  const mode = liveProvider ? 'live API with demo fallback' : 'demo';
  console.log(`Odds dashboard listening on http://localhost:${port} (${mode})`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
