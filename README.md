# Odds dashboard

A small football-odds dashboard that replaces the original 2022 Betano/eFortuna prototype with a normalized, tested application.

The app always starts:

- **Live Fortuna mode** uses Fortuna's current public offer API and requires no account or API key.
- **Multi-bookmaker mode** uses [The Odds API](https://the-odds-api.com/liveapi/guides/v4/) when `ODDS_API_KEY` is configured.
- **Demo mode** is used only if the configured live provider fails.
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

## Default live odds

No key is required. `npm start` loads Fortuna's current upcoming football fixtures, including:

- match result (`1 / X / 2`);
- draw no bet (`1 / 2`, called “Victorie fără egal” by Fortuna).

The current public endpoints reconstructed from Fortuna's web application are:

```text
https://api.efortuna.ro/offer/structure/api/v1_0/widget/upcoming
https://api.efortuna.ro/offer/markets/api/v1_0/fixtures/markets/overview
```

## Enable multi-bookmaker odds

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
| `ODDS_API_KEY` | empty | Replaces direct Fortuna mode with The Odds API |
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
  "mode": "live",
  "source": "Fortuna",
  "fetchedAt": "2026-06-21T12:00:00.000Z",
  "warning": null,
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
          "name": "Fortuna",
          "lastUpdate": "2026-06-21T12:00:00.000Z",
          "markets": {
            "h2h": {
              "home": 1.85,
              "draw": 3.35,
              "away": 3.65
            },
            "drawNoBet": {
              "home": 1.42,
              "away": 2.93
            }
          }
        }
      ]
    }
  ]
}
```

Use `GET /api/odds?refresh=1` to clear the server cache before loading.

## Endpoint research and limitations

The original repository and its later sibling, `Me-Alex/oddsScraper`, show that the intended workflow was:

1. collect Betano and Fortuna events;
2. align the same match using Sportradar IDs;
3. compare `1/X/2` and “Niciun pariu pe egal” / “Victorie fără egal” prices.

The former Fortuna `/live3` endpoint is obsolete, but its replacement above works publicly. Betano now loads data from endpoints including `/api/sports/FOOT/...`; standalone server requests currently receive Cloudflare HTTP 403. The old public Sportradar feeds now respond with `Unauthorized feed`.

This project does not attempt to bypass Betano's anti-bot controls. Betano and other bookmaker comparisons can be supplied through The Odds API by setting `ODDS_API_KEY`.

## Project structure

```text
public/                 Browser UI
src/app.js              Express routes and static hosting
src/server.js           Runtime configuration and process entrypoint
src/odds-service.js     Provider selection, cache, and fallback
src/providers/          Live and demo provider adapters
test/                   Unit and HTTP integration tests
```
