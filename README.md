# Odds dashboard

A small football-odds dashboard that replaces the original 2022 Betano/eFortuna prototype with a normalized, tested application.

The app always starts:

- **Demo mode** uses clearly labeled sample prices and requires no account or API key.
- **Live mode** uses [The Odds API](https://the-odds-api.com/liveapi/guides/v4/) when `ODDS_API_KEY` is configured.
- If the live provider fails, the server returns demo data with a visible warning instead of leaving the page broken.

## Requirements

- Node.js 20 or newer
- npm

## Run locally

```powershell
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000).

Run the tests:

```powershell
npm test
```

## Enable live odds

Create an API key through The Odds API, then set environment variables before starting:

```powershell
$env:ODDS_API_KEY = "your-key"
$env:ODDS_SPORT_KEYS = "soccer_fifa_world_cup"
npm start
```

Multiple competitions can be requested with comma-separated sport keys:

```powershell
$env:ODDS_SPORT_KEYS = "soccer_fifa_world_cup,soccer_uefa_champs_league"
```

Each sport consumes API quota independently. Use only the competitions you need.

Available configuration:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `ODDS_API_KEY` | empty | Enables live mode |
| `ODDS_SPORT_KEYS` | `soccer_fifa_world_cup` | Comma-separated provider sport keys |
| `ODDS_CACHE_TTL_MS` | `60000` | Successful response cache duration |
| `ODDS_REQUEST_TIMEOUT_MS` | `8000` | Upstream request timeout |

See [.env.example](.env.example) for the same configuration template. The application reads process environment variables directly; it does not automatically load `.env`.

## HTTP API

### `GET /api/health`

Reports whether the server was configured for live or demo mode.

### `GET /api/odds`

Returns metadata and normalized events:

```json
{
  "mode": "demo",
  "source": "Built-in demo data",
  "fetchedAt": "2026-06-21T12:00:00.000Z",
  "warning": "Sample prices only; they are not live bookmaker quotes. Set ODDS_API_KEY to load live odds.",
  "events": [
    {
      "id": "demo-romania-brazil",
      "sport": "Football",
      "competition": "FIFA World Cup",
      "startsAt": "2026-06-21T14:00:00.000Z",
      "homeTeam": "Romania",
      "awayTeam": "Brazil",
      "bookmakers": [
        {
          "name": "Betano (sample)",
          "lastUpdate": "2026-06-21T12:00:00.000Z",
          "markets": {
            "h2h": {
              "home": 1.85,
              "draw": 3.35,
              "away": 3.65
            }
          }
        }
      ]
    }
  ]
}
```

Use `GET /api/odds?refresh=1` to clear the server cache before loading.

## Why direct Betano/eFortuna scraping was removed

The endpoints used by the original project are no longer dependable:

- the old Heroku deployment returns HTTP 404;
- the former Betano endpoint rejects automated requests with HTTP 403;
- the former eFortuna endpoint currently returns HTTP 502.

The application therefore uses a provider adapter instead of coupling the frontend to undocumented bookmaker response formats. It does not attempt to bypass anti-bot controls.

## Project structure

```text
public/                 Browser UI
src/app.js              Express routes and static hosting
src/server.js           Runtime configuration and process entrypoint
src/odds-service.js     Provider selection, cache, and fallback
src/providers/          Live and demo provider adapters
test/                   Unit and HTTP integration tests
```
