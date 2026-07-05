# Odds dashboard

A normalized football-odds dashboard for Romanian bookmakers.

The default runtime concurrently loads direct Romanian bookmaker adapters for:

- Fortuna
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

Standalone Betano API requests receive HTTP 403. Its provider therefore runs
inside a real Chrome page:

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
| `ODDS_API_REGIONS` | `eu,uk` | Comma-separated Odds API regions when no explicit bookmakers are set |
| `ODDS_API_BOOKMAKERS` | empty | Comma-separated Odds API bookmaker keys; takes priority over regions |
| `ODDS_API_MARKETS` | `h2h,spreads,totals` | Comma-separated Odds API market keys |
| `ODDS_API_EVENT_MARKETS` | empty | Extra Odds API market keys fetched through per-event odds requests |
| `ODDS_API_MAX_EVENT_DETAIL_REQUESTS_PER_SPORT` | `20` | Maximum Odds API event-detail odds requests per sport |
| `ODDS_API_EVENT_DETAIL_CONCURRENCY` | `2` | Odds API event-detail request concurrency |
| `ODDS_CACHE_TTL_MS` | `60000` | Successful response cache duration |
| `ODDS_WARM_CACHE_ON_START` | `0` | Start one background odds refresh after the server begins listening |
| `ODDS_REQUEST_TIMEOUT_MS` | `12000` | HTTP provider timeout |
| `BOOKMAKER_EVENT_TARGET` | `1000` | Target event depth shown in provider status and used as the default detail cap |
| `BETANO_BROWSER_ENABLED` | `0` | Enable browser-backed Betano |
| `BETANO_BROWSER_HEADLESS` | `1` | Run Betano Chrome headlessly |
| `BETANO_BROWSER_TIMEOUT_MS` | `30000` | Betano navigation timeout |
| `BETANO_BROWSER_MAX_EVENTS` | `1000` | Betano browser-collected event limit |
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

The application reads process environment variables and also loads a local
`.env` file when present. Existing shell or service-manager variables take
priority over `.env` values.

## HTTP API

- `GET /api/health`
- `GET /api/readiness`
- `GET /api/metrics`
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
public/                 Browser UI
src/app.js              Express routes and static hosting
src/server.js           Provider configuration and process entrypoint
src/provider-config.js  Testable provider wiring for enabled bookmaker sources
src/odds-service.js     Cache, live metadata, and demo fallback
src/providers/          Bookmaker adapters and event aggregation
test/                   Unit and HTTP integration tests
```
