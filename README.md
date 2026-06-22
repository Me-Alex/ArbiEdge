# Odds dashboard

A normalized football-odds dashboard for Romanian bookmakers.

The default runtime concurrently loads:

- Fortuna
- Casa Pariurilor
- Superbet
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

```powershell
npm test
```

## Direct bookmaker integrations

Fortuna and Casa Pariurilor use their current public UFO offer APIs. Superbet
uses its public Romanian Fastly event feed. Unibet uses its Romanian sports
lobby API with the jurisdiction headers sent by its public web application.

Equivalent events are merged by Sportradar ID where available, then by
normalized team names and kickoff time. The output includes match-result
`1 / X / 2` odds and draw-no-bet prices when a source exposes them.

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

## The Odds API

Setting `ODDS_API_KEY` replaces the direct Romanian provider group with
[The Odds API](https://the-odds-api.com/liveapi/guides/v4/):

```powershell
$env:ODDS_API_KEY = "your-key"
$env:ODDS_SPORT_KEYS = "soccer_fifa_world_cup"
npm start
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `ODDS_API_KEY` | empty | Use The Odds API instead of direct providers |
| `ODDS_SPORT_KEYS` | `soccer_fifa_world_cup` | Comma-separated API sport keys |
| `ODDS_CACHE_TTL_MS` | `60000` | Successful response cache duration |
| `ODDS_REQUEST_TIMEOUT_MS` | `8000` | HTTP provider timeout |
| `BETANO_BROWSER_ENABLED` | `0` | Enable browser-backed Betano |
| `BETANO_BROWSER_HEADLESS` | `1` | Run Betano Chrome headlessly |
| `BETANO_BROWSER_TIMEOUT_MS` | `30000` | Betano navigation timeout |

The application reads process environment variables directly and does not
automatically load `.env`.

## HTTP API

- `GET /api/health`
- `GET /api/odds`
- `GET /api/odds?refresh=1`

Responses contain normalized events, bookmaker prices, partial-failure
warnings, and per-provider status information.

## Current limitations

Winner and other operators observed during research use signed POST bodies,
authentication, or unstable application-specific protocols. They are not
presented as working integrations until they can be tested deterministically.
Each can be added independently through the same `getOdds()` provider contract.

## Project structure

```text
public/                 Browser UI
src/app.js              Express routes and static hosting
src/server.js           Provider configuration and process entrypoint
src/odds-service.js     Cache, live metadata, and demo fallback
src/providers/          Bookmaker adapters and event aggregation
test/                   Unit and HTTP integration tests
```
