# ArbiEdge

Normalized football-odds dashboard and arbitrage scanner for Romanian bookmakers.

The default runtime concurrently loads direct Romanian bookmaker adapters for:

- Fortuna
- Favbet
- VictoryBet
- Manhattan
- Casa Pariurilor
- Superbet
- BetOne
- Betmen
- GetsBet
- Winner
- 888
- MrPlay
- Bet7
- EliteSlots
- LasVegas
- Spin
- Winboss
- PowerBet
- Magnumbet
- Excelbet
- MaxBet
- Stanleybet
- GameWorld
- AdmiralBet
- Seven
- RedSevens
- GPCasino
- NetBet
- Winbet
- VivaBet
- LuckySeven
- OneCasino
- MaxWin
- Prowin
- VipBet
- Unibet

Betano can be enabled through a local Chrome session. If one bookmaker fails,
the other results remain available with a provider warning. Demo data is used
only when every configured live source fails.

## Run

Requirements: Node.js 20 or newer and npm.

```powershell
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000).

For free-server deployment notes covering Google Cloud VM, Docker, and Cloud
Run, see [DEPLOY.md](DEPLOY.md).

```powershell
npm test
```

`npm test` runs the non-browser Node suite and the calculator browser smoke.
For the faster non-browser suite only:

```powershell
npm run test:unit
```

For only the calculator browser smoke:

```powershell
npm run test:calc
```

For a browser smoke test of the main UI routes and execution flows:

```powershell
npm run test:ui
```

This requires a local Chromium-based browser such as Microsoft Edge or Chrome.
It starts the app with local demo data, checks the scanner, value bets,
calculator, journal, bookmaker status, and match feed routes on desktop and
mobile viewports, then writes screenshots to `output/playwright/`.

To capture the calculator after loading a demo odds selection:

```powershell
npm run screenshot:calc
```

To run the syntax check, Node suite, calculator smoke, and full UI browser
smoke:

```powershell
npm run test:all
```

To inspect the formula scanner against local demo odds without live bookmaker
requests:

```powershell
npm run find:formula -- --demo
```

The scanner also evaluates compound football formulas such as
`AH1(-0.25) - X - 2` and `Over 2.25 - Under 2.5 - Under 1.5`. These formulas
use a score-state payoff matrix instead of the classic reciprocal-odds test.
Quarter Asian lines are split into their two adjacent component lines, pushes
and half settlements are included, and stakes are chosen to maximize the worst
return across every result or goal-total boundary. A formula is actionable only
when that matrix is complete, the edge is within the safety ceiling, the best
prices are cross-book, and every selected odd is verified.

Additional generated families include result/DNB substitutions, result or
double-chance against half handicaps, opposing quarter-handicap pairs, opposing
quarter-total pairs, and guaranteed total corridors such as
`Over 2 - Under 2.5`. Whole-line opposing pairs with a shared push are not
reported as arbitrage because the push state cannot produce a guaranteed profit.

To spot-check scraped prices against the rendered bookmaker page with
Playwright:

```powershell
npm run verify:odds -- --bookmaker GetsBet --event "Elfsborg" --market totalGoals
```

The verifier fetches a small provider sample, opens the bookmaker URL, checks
the visible page for the event teams and sampled decimal prices, and writes a
JSON report plus screenshot to `output/playwright/`.
Use `--min-hours 12` to skip near-live events where odds often move while the
browser check is running.

## Direct bookmaker integrations

Fortuna and Casa Pariurilor use their current public UFO offer APIs. Superbet
uses its public Romanian Fastly event feed. Winner, 888, MrPlay, and the New
Gambling Solutions brand batch use public Digitain football feeds. Stanleybet,
GameWorld, AdmiralBet, Seven, RedSevens, and GPCasino use their shared public
NSoft distribution endpoint. BetOne, Betmen, GetsBet, LasVegas, MaxBet, NetBet,
Winbet, the Viva Games / EGT brands, and Unibet use their respective public web
sportsbook data endpoints or public sports-board pages.

Betfair remains tracked as a real sportsbook target, but it is not in the
default runtime batch while its current persisted-catalogue endpoint is being
normalized.

Equivalent events are merged by Sportradar ID where available, then by
normalized team names and kickoff time. The output includes match-result
`1 / X / 2` odds plus additional normalized markets when exposed: draw-no-bet,
double chance, both-teams-to-score, totals, team totals, corners, and
handicap/Asian handicap lines.

## Betano

Standalone Betano API requests receive HTTP 403. Its optional provider therefore
runs inside a real Chrome page and is disabled by default so a blocked challenge
cannot delay normal scans:

```powershell
$env:BETANO_BROWSER_ENABLED = "1"
$env:BETANO_BROWSER_HEADLESS = "0"
npm start
```

Chrome must be installed. Visible mode is generally more reliable, but Betano
may still display a Cloudflare challenge or CAPTCHA. This project does not
bypass those controls. When the browser session is blocked, Betano is reported
as unavailable while the other providers continue working.

## Additional bookmakers through The Odds API

Setting `ODDS_API_KEY` adds [The Odds API](https://the-odds-api.com/liveapi/guides/v4/)
as an additional multi-bookmaker source alongside the direct Romanian
providers. By default the app requests the `eu,uk` regions, which can return
bookmakers such as Pinnacle, Betfair, Unibet, William Hill, Ladbrokes, and
others depending on sport coverage and your API plan.

```powershell
$env:ODDS_API_KEY = "your-key"
$env:ODDS_SPORT_KEYS = "soccer_fifa_world_cup"
npm start
```

To target specific Odds API bookmaker keys instead of regions:

```powershell
$env:ODDS_API_BOOKMAKERS = "pinnacle,betfair_ex_eu,onexbet"
npm start
```

The featured markets in `ODDS_API_MARKETS` continue to use the regular
multi-event `/odds` endpoint. To add non-featured or extra markets one event at
a time, set `ODDS_API_EVENT_MARKETS` and keep the per-sport cap conservative:

```powershell
$env:ODDS_API_EVENT_MARKETS = "btts"
$env:ODDS_API_MAX_EVENT_DETAIL_REQUESTS_PER_SPORT = "20"
$env:ODDS_API_EVENT_DETAIL_CONCURRENCY = "2"
npm start
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `ODDS_API_KEY` | empty | Add The Odds API as an extra multi-bookmaker provider |
| `ODDS_SPORT_KEYS` | `soccer_fifa_world_cup` | Comma-separated API sport keys |
| `ODDS_SPORT_PRESET` | `football` | Fallback sport bundle (`football`, `core`, or `extended`) when explicit sport keys are empty |
| `ODDS_API_REGIONS` | `eu,uk` | Comma-separated Odds API regions when no explicit bookmakers are set |
| `ODDS_API_BOOKMAKERS` | empty | Comma-separated Odds API bookmaker keys; takes priority over regions |
| `ODDS_API_MARKETS` | `h2h,spreads,totals` | Comma-separated Odds API market keys |
| `ODDS_API_EVENT_MARKETS` | empty | Extra Odds API market keys fetched through per-event odds requests |
| `ODDS_API_MAX_EVENT_DETAIL_REQUESTS_PER_SPORT` | `20` | Maximum Odds API event-detail odds requests per sport |
| `ODDS_API_EVENT_DETAIL_CONCURRENCY` | `2` | Odds API event-detail request concurrency |
| `ODDS_API_DISCOVER_SPORTS` | `0` | Discover currently active sport keys before collection (opt-in because each odds sport consumes quota) |
| `ODDS_API_SPORT_GROUPS` | empty | Optional active-sport group filter, such as `Soccer,Basketball,Tennis` |
| `ODDS_API_MAX_SPORTS` | `8` | Maximum explicit plus discovered sports collected in one refresh |
| `ODDS_API_SPORT_CONCURRENCY` | `3` | Maximum concurrent sport-level Odds API requests |
| `ODDS_CACHE_TTL_MS` | `60000` | Successful response cache duration |
| `ODDS_WARM_CACHE_ON_START` | `1` | Start one background odds refresh after the server begins listening |
| `ODDS_REQUEST_TIMEOUT_MS` | `12000` | HTTP provider timeout |
| `ODDS_PROVIDER_CONCURRENCY` | `2` | Maximum bookmaker providers collected simultaneously to bound memory use |
| `ODDS_PROGRESS_EVERY_PROVIDERS` | `4` | Emit one full progressive snapshot after this many completed providers |
| `BOOKMAKER_EVENT_TARGET` | `1000` | Target event depth shown in provider status and used as the default detail cap |
| `BETANO_BROWSER_ENABLED` | `0` | Enable optional Playwright network-backed Betano collection |
| `BETANO_BROWSER_HEADLESS` | `1` | Run Betano Chrome headlessly |
| `BETANO_BROWSER_TIMEOUT_MS` | `30000` | Betano navigation timeout |
| `BETANO_BROWSER_SETTLE_MS` | `8000` | Time allowed for sportsbook JSON responses after navigation |
| `BETANO_BROWSER_MAX_EVENTS` | `1000` | Betano browser-collected event limit |
| `BETANO_BROWSER_DETAIL_CONCURRENCY` | `4` | Concurrent in-page event-detail requests |
| `BETANO_BROWSER_MAX_RESPONSE_BYTES` | `20971520` | Maximum captured JSON response size |
| `BETONE_MAX_DETAIL_EVENTS` | `1000` | BetOne events enriched with detail markets |
| `BETONE_DETAILS_CONCURRENCY` | `8` | BetOne detail request concurrency |
| `DIGITAIN_LOOKAHEAD_DAYS` | `180` | Winner/888/MrPlay/New Gambling event lookahead window |
| `DIGITAIN_WINDOW_DAYS` | `7` | Winner/888/MrPlay/New Gambling list-window size to avoid per-request caps |
| `DIGITAIN_WINDOW_CONCURRENCY` | `3` | Winner/888/MrPlay/New Gambling list-window request concurrency |
| `EGT_PAGE_SIZE` | `1000` | Winbet/Viva Games EGT event page size |
| `EGT_MARKET_COUNT` | `160` | Winbet/Viva Games EGT markets requested per event |
| `EGT_LOOKAHEAD_DAYS` | `180` | Winbet/Viva Games EGT lookahead window |
| `GETSBET_MAX_TOURNAMENTS` | `1000` | GetsBet tournament groups scanned |
| `GETSBET_MAX_DETAIL_EVENTS` | `1000` | GetsBet events enriched with detail markets |
| `GETSBET_CONCURRENCY` | `8` | GetsBet WebSocket request concurrency |
| `LASVEGAS_MAX_DETAIL_EVENTS` | `1000` | LasVegas events enriched with detail markets |
| `LASVEGAS_DETAILS_CONCURRENCY` | `8` | LasVegas detail request concurrency |
| `NETBET_MAX_DETAIL_EVENTS` | `1000` | NetBet events enriched with detail markets |
| `NETBET_DETAILS_CONCURRENCY` | `8` | NetBet detail request concurrency |
| `UFO_MAX_PAGES` | `40` | Fortuna/Casa result pages scanned |
| `UFO_PAGE_SIZE` | `100` | Fortuna/Casa page size |
| `UNIBET_CATEGORY_LIMIT` | `1000` | Unibet football category lobbies scanned |
| `UNIBET_DETAIL_LIMIT` | `1000` | Unibet contests enriched with detail markets |
| `UNIBET_REQUEST_CONCURRENCY` | `12` | Unibet category/detail request concurrency |
| `SUPERBET_LOOKAHEAD_DAYS` | `180` | Superbet lookahead window |
| `XSPORT_LOOKAHEAD_DAYS` | `180` | LasVegas day-by-day lookahead window |
| `CORS_ORIGINS` | empty | Comma-separated allowed CORS origins (empty = no CORS headers) |
| `WRITE_RATE_LIMIT_WINDOW_MS` | `60000` | Sliding-window duration for write API rate limiting |
| `WRITE_RATE_LIMIT_MAX` | `60` | Maximum write API requests per IP per window |
| `LOG_LEVEL` | `info` | Logging level: debug, info, warn, or error |
| `LOG_JSON` | `0` | Set to `1` for structured JSON log output |
| `AUTONOMY_ENABLED` | `0` | Run continuous supervised collection, persistence, verification, and alert delivery |
| `DATABASE_URL` | empty | PostgreSQL connection URL; mandatory for autonomous production mode |
| `DATABASE_SSL` | `0` | Enable TLS for PostgreSQL connections |
| `PRODUCTION_FAIL_CLOSED` | `0` | Never substitute demo odds when live collection fails; code defaults it on when `NODE_ENV=production` |
| `AUTONOMY_COLLECTION_INTERVAL_MS` | `15000` | Background evaluation interval for rolling provider snapshots |
| `AUTONOMY_PROGRESSIVE_BATCHES` | `2` | Number of bounded progressive evaluations during one provider collection |
| `AUTONOMY_ADAPTIVE_CADENCE` | `1` | Adapt each provider refresh rate to its measured response duration |
| `AUTONOMY_PROVIDER_BASE_INTERVAL_MS` | `60000` | Initial provider refresh interval before timing data is available |
| `AUTONOMY_PROVIDER_MIN_INTERVAL_MS` | `15000` | Fastest adaptive provider refresh interval |
| `AUTONOMY_PROVIDER_MAX_INTERVAL_MS` | `120000` | Slowest adaptive provider refresh interval |
| `AUTONOMY_PROVIDER_DURATION_MULTIPLIER` | `3` | Multiplier from provider duration to its next refresh interval |
| `AUTONOMY_PROVIDER_CONCURRENCY` | `2` | Maximum supervised bookmaker providers collected simultaneously |
| `AUTONOMY_PROGRESS_EVERY_PROVIDERS` | `4` | Emit one supervised aggregate after this many provider completions |
| `AUTONOMY_STALE_AFTER_MS` | `180000` | Maximum age of cached provider data retained by the supervisor |
| `AUTONOMY_CIRCUIT_FAILURES` | `3` | Consecutive failures before a provider circuit opens |
| `AUTONOMY_CIRCUIT_COOLDOWN_MS` | `300000` | Provider circuit-breaker cooldown |
| `AUTONOMY_OPPORTUNITY_TTL_MS` | `120000` | Maximum lifetime of a detected price combination |
| `AUTONOMY_CONFIRMATION_SNAPSHOTS` | `2` | Distinct quote observations required before an alert can become actionable |
| `AUTONOMY_CONFIRMATION_MIN_INTERVAL_MS` | `2000` | Minimum time between independent price confirmations |
| `AUTONOMY_CONFIRMATION_MAX_INTERVAL_MS` | `90000` | Maximum time allowed between price confirmations |
| `AUTONOMY_MAX_QUOTE_AGE_MS` | `45000` | Oldest selected quote accepted as current |
| `AUTONOMY_MAX_QUOTE_SKEW_MS` | `20000` | Maximum collection-time difference between selected legs |
| `AUTONOMY_ALERT_INTERVAL_MS` | `5000` | Durable alert-outbox delivery interval |
| `AUTONOMY_ENDPOINT_AUDIT_INTERVAL_MS` | `21600000` | Full configured-endpoint audit interval |
| `AUTONOMY_DISCOVERY_INTERVAL_MS` | `86400000` | Remaining-bookmaker discovery interval |
| `AUTONOMY_AUDIT_CONCURRENCY` | `1` | Concurrent providers used by scheduled endpoint audits |
| `AUTONOMY_AUDIT_TIMEOUT_MS` | `35000` | Per-provider scheduled audit timeout |
| `AUTONOMY_FIDELITY_ENABLED` | `0` | Enable rotating browser comparison of endpoint and visible prices |
| `AUTONOMY_CANDIDATE_VERIFICATION_ENABLED` | `0` | Verify browser evidence for the highest-priority arbitrage candidates |
| `AUTONOMY_CANDIDATE_MAX_PAGES` | `8` | Maximum event pages opened by one candidate-verification batch |
| `AUTONOMY_CANDIDATE_MAX_LEGS` | `24` | Maximum candidate legs checked in one verification batch |
| `AUTONOMY_CANDIDATE_CONCURRENCY` | `2` | Parallel browser pages used by candidate verification |
| `AUTONOMY_REVERIFY_COOLDOWN_MS` | `600000` | Cooldown before retrying unchanged failed or ambiguous evidence |
| `AUTONOMY_CHANGED_PRICE_COOLDOWN_MS` | `15000` | Short cooldown before verifying a newly changed endpoint price |
| `AUTONOMY_FIDELITY_INTERVAL_MS` | `600000` | Browser-fidelity rotation interval; covers the default provider set inside the evidence window |
| `AUTONOMY_FIDELITY_MAX_AGE_MS` | `600000` | Maximum age of exact browser fidelity evidence accepted by the opportunity gate |
| `AUTONOMY_FIDELITY_TIMEOUT_MS` | `30000` | Browser-fidelity request timeout |
| `AUTONOMY_RETENTION_INTERVAL_MS` | `86400000` | Interval for bounded snapshot, audit, and fidelity data retention |
| `TELEGRAM_BOT_TOKEN` | empty | Runtime-only Telegram credential; never committed or persisted in the outbox |
| `TELEGRAM_CHAT_ID` | empty | Telegram alert destination |
| `RESULTS_ENABLED` | `0` | Enable authoritative result settlement |
| `RESULTS_API_KEY` | empty | The Odds API key used by the scores endpoint; falls back to `ODDS_API_KEY` |
| `RESULTS_SPORT_KEYS` | `soccer_fifa_world_cup` | Comma-separated result sport/league keys |
| `RESULTS_DAYS_FROM` | `3` | Completed-game lookback, limited by the results API to 1–3 days |
| `RESULTS_TIMEOUT_MS` | `12000` | Result-provider request timeout |
| `RESULTS_INTERVAL_MS` | `900000` | Minimum interval between settlement checks |
| `ALLOW_INFERRED_SETTLEMENT` | `1` | Allow odds-based paper settlement outside autonomous mode |

The application reads process environment variables and also loads a local
`.env` file when present. Existing shell or service-manager variables take
priority over `.env` values.

## HTTP API

- `GET /api/health`
- `GET /api/readiness`
- `GET /api/metrics`
- `GET /api/autonomy/status`
- `GET /api/bookmakers`
- `GET /api/odds`
- `GET /api/odds?refresh=1`
- `GET /api/odds/movement`
- `GET /api/opportunities`
- `GET /api/value-bets`
- `GET /api/bets`
- `POST /api/bets`
- `POST /api/bets/import`
- `POST /api/bets/:id/settle`
- `PATCH /api/bets/:id`
- `DELETE /api/bets/:id`
- `GET /api/bets/analytics`
- `POST /api/ai-picks/log`

Health responses include cache age, in-flight refresh state, the latest refresh
result, latest odds-audit status, and the slowest provider timings without triggering a live odds request. Readiness returns `200`
when the service has fresh/usable odds or an odds refresh is already running,
and `503` while the server is only warming up. Metrics returns plain text counters
and gauges for readiness, cache, refresh status, slow provider timings, audit state, and audit issue counts. Odds responses contain normalized
events, bookmaker prices, partial-failure warnings, per-provider status
information including response duration, and a separate bookmaker coverage registry for implemented and
remaining Romanian licensed domains. The registry also keeps licensed domains
that currently look casino-only or poker-only in a separate non-sportsbook
status so they do not count as unfinished sports odds providers, and keeps
domains with announced Romanian shutdowns in a separate inactive status. Domains
that are currently only showing maintenance pages are tracked separately from
implementable sportsbook targets.

AI paper picks are saved locally as newline-delimited JSON in
`data/ai-picks.jsonl`. The file records both `created` and `settled` events so
the paper pick history and actual P&L can be audited outside the browser.

## Autonomous production mode

The autonomous runtime continuously collects every provider without requiring
dashboard traffic. It supervises each adapter independently, opens circuits
after repeated failures, rejects stale cached sources, persists compressed
snapshots and provider runs to PostgreSQL, and processes opportunities through
fidelity and exact-price confirmation before a durable alert is queued.

Start the complete local production stack with PostgreSQL and Chromium:

```powershell
$env:POSTGRES_PASSWORD = "use-a-secret-from-your-password-manager"
docker compose up --build -d
```

No password, bot token, or API key is stored in the repository. For the data
model, lifecycle states, operational checks, and backup procedure, see
[`docs/AUTONOMY.md`](docs/AUTONOMY.md).

## Provider discovery

When network access is available, scan all remaining provider targets from the
coverage registry:

```powershell
node scripts/discover-remaining-bookmakers.js
```

To list the remaining targets without making network requests:

```powershell
node scripts/discover-remaining-bookmakers.js --list
```

To scan only selected domains:

```powershell
$env:DISCOVERY_TARGETS = "PowerBet,Winboss"
node scripts/discover-remaining-bookmakers.js
```

## Current limitations

Other operators observed during research use authentication, CAPTCHA, or
unstable application-specific protocols. They are not presented as working
integrations until they can be tested deterministically. Each can be added
independently through the same `getOdds()` provider contract.

## Project structure

```text
public/                  Browser UI
  css/                   Design tokens, components, and page styling
  js/core/               Browser-side API, state, and alert infrastructure
  js/components/         Reusable UI components
  js/pages/              Page controllers
src/
  index.js               Package API with flat and namespaced exports
  server/                Express application and process bootstrap
  services/              Provider configuration, coverage, and odds orchestration
  engine/                Formula evaluation, arbitrage, and stake sizing
  audit/                 Odds integrity checks
  finance/               Bet tracking, bankroll, tax, settlement, and webhooks
  providers/             Bookmaker adapters and transport implementations
  core/                  Shared environment, logging, sport, and limiter utilities
scripts/                 Verification and operational tooling
test/                    Unit and HTTP integration tests
```

The small JavaScript files directly under `src/` are compatibility facades for
older imports. Application code should import from the domain folders above;
external callers can continue using the existing top-level paths.
