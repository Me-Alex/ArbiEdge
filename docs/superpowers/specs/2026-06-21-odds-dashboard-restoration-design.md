# Odds Dashboard Restoration Design

## Goal

Restore the abandoned odds scraper as a reliable local web application that displays normalized football odds, remains usable when external providers are unavailable, and can be extended without coupling the UI to a bookmaker's private response format.

## Current constraints

- The former Heroku deployment returns HTTP 404.
- Betano's former JSON endpoint rejects automated requests with HTTP 403.
- eFortuna's former live endpoint currently returns HTTP 502.
- The original application has no tests, error handling, stable data model, or maintained dependencies.
- There is no dependable, keyless, public live-odds API suitable for an always-working application.

## Chosen approach

Use a provider adapter architecture with two modes:

1. `TheOddsApiProvider` supplies live data when `ODDS_API_KEY` is configured.
2. `DemoOddsProvider` supplies clearly labeled sample data when no key is configured or the live provider fails.

This keeps the application functional immediately while providing a supported path to live data. Direct circumvention of bookmaker bot protection is intentionally excluded because it is brittle and unsuitable for a maintainable application.

## Architecture

The Express server serves the frontend and exposes:

- `GET /api/health` for application and provider status.
- `GET /api/odds` for normalized football events.

Provider responses are converted into one internal event shape:

```json
{
  "id": "event-id",
  "sport": "Football",
  "competition": "Competition",
  "startsAt": "2026-06-21T18:00:00.000Z",
  "homeTeam": "Home",
  "awayTeam": "Away",
  "bookmakers": [
    {
      "name": "Bookmaker",
      "lastUpdate": "2026-06-21T17:55:00.000Z",
      "markets": {
        "h2h": {
          "home": 2.1,
          "draw": 3.2,
          "away": 3.4
        }
      }
    }
  ]
}
```

The provider service caches successful results briefly, reports whether data is `live` or `demo`, and falls back to demo data with a visible warning when live retrieval fails.

## Frontend

The frontend remains framework-free to keep the project small. It will:

- show data mode and last refresh time;
- render responsive event cards;
- show each bookmaker's home/draw/away prices;
- filter events by team or competition;
- refresh data without reloading the page;
- present loading, empty, and error states;
- never mutate the page with fragile `childNodes` indexes or `innerHTML +=`.

## Configuration

Environment variables:

- `PORT`, default `3000`;
- `ODDS_API_KEY`, optional;
- `ODDS_SPORT_KEYS`, optional comma-separated The Odds API sport keys;
- `ODDS_CACHE_TTL_MS`, default `60000`;
- `ODDS_REQUEST_TIMEOUT_MS`, default `8000`.

No secret is committed. `.env.example` documents configuration.

## Error handling

- Upstream requests use an abort timeout.
- Non-2xx responses become typed provider errors.
- Malformed upstream records are ignored rather than crashing the response.
- A total live-provider failure triggers demo fallback and a warning in API metadata.
- Express returns structured JSON for unexpected API failures.

## Testing

Use Node's built-in test runner:

- unit tests for provider normalization;
- unit tests for provider selection, caching, and fallback;
- HTTP integration tests for health, odds, static assets, and API errors;
- browser smoke testing for desktop and mobile rendering, refresh behavior, filtering, and console health.

## Repository cleanup

- Remove committed `node_modules` and generated screenshots.
- Add `.gitignore`.
- Replace unsupported and unnecessary dependencies.
- Add a README with setup, live-mode configuration, API format, and limitations.
- Use meaningful scripts and commit history.

## Out of scope

- Circumventing Betano or eFortuna anti-bot controls.
- Automated wagering or account interaction.
- Historical odds storage.
- Authentication, databases, or production deployment.
- Claiming demo data is live.
