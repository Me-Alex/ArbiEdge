const { createApp } = require('./app');
const { OddsService } = require('./odds-service');
const { DemoOddsProvider } = require('./providers/demo-provider');
const { BetanoBrowserTransport } = require('./providers/betano-browser-transport');
const { BetanoProvider } = require('./providers/betano-provider');
const { BrowserJsonTransport } = require('./providers/browser-json-transport');
const { CasaPariurilorProvider } = require('./providers/casa-pariurilor-provider');
const { CompositeProvider } = require('./providers/composite-provider');
const { FortunaProvider } = require('./providers/fortuna-provider');
const { SuperbetProvider } = require('./providers/superbet-provider');
const { TheOddsApiProvider } = require('./providers/the-odds-api-provider');
const { UnibetProvider } = require('./providers/unibet-provider');

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

const directProviders = [
  new FortunaProvider({ timeoutMs }),
  new CasaPariurilorProvider({ timeoutMs }),
  new SuperbetProvider({ timeoutMs }),
  new UnibetProvider({
    timeoutMs,
    browserTransport: new BrowserJsonTransport({
      pageUrl: 'https://www.unibet.ro/betting/odds/football',
      timeoutMs: 30_000,
    }),
  }),
];
if (process.env.BETANO_BROWSER_ENABLED === '1') {
  directProviders.push(
    new BetanoProvider({
      transport: new BetanoBrowserTransport({
        headless: process.env.BETANO_BROWSER_HEADLESS !== '0',
        timeoutMs: parsePositiveInteger(
          process.env.BETANO_BROWSER_TIMEOUT_MS,
          30_000,
        ),
      }),
    }),
  );
}

const liveProvider = process.env.ODDS_API_KEY
  ? new TheOddsApiProvider({
      apiKey: process.env.ODDS_API_KEY,
      sportKeys,
      timeoutMs,
    })
  : new CompositeProvider(directProviders);

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
  const mode = `${liveProvider.name} with demo fallback`;
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
