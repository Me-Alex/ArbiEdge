# REST API Specification

The Express application (`src/server/app.js`) exposes the following endpoints:

---

## 1. Scanner & Analytics Endpoints

### `GET /api/opportunities`
Fetches all calculated arbitrage opportunities across scraped bookmakers.

**Query Parameters:**
* `minEdge` *(number)*: Minimum percentage edge to include (e.g. `1` for $\ge 1\%$).
* `profitOnly` *(1|0)*: Filter for positive profit opportunities.
* `trustedOnly` *(1|0)*: Filter strictly for `trusted` confidence opportunities.
* `sort` *('edge'|'profit'|'confidence')*: Sort order. Default: `edge`.
* `limit` *(number)*: Maximum results to return.

**Response Example:**
```json
{
  "opportunities": [
    {
      "marketKey": "cross_btts_team_score",
      "marketLabel": "BTTS Yes + Team Clean Sheets",
      "type": "cross-market",
      "legs": [
        { "outcome": "yes", "label": "BTTS Yes", "bookmaker": "Betano", "price": 3.10, "stake": 33.33 },
        { "outcome": "homeNo", "label": "Home to Score: No", "bookmaker": "Fortuna", "price": 3.10, "stake": 33.33 },
        { "outcome": "awayNo", "label": "Away to Score: No", "bookmaker": "Market average", "price": 3.10, "stake": 33.33 }
      ],
      "edge": 0.0322,
      "profit": 3.33,
      "confidence": "trusted",
      "eligibility": "actionable",
      "allLegsVerified": true,
      "quoteTiming": {
        "status": "fresh",
        "actionable": true,
        "maxAgeMs": 8200,
        "skewMs": 3100
      },
      "eventName": "Romania vs Brazil",
      "competition": "FIFA World Cup"
    }
  ],
  "total": 1,
  "fetchedAt": "2026-07-13T20:00:00.000Z"
}
```

`eligibility="actionable"` is stricter than a positive mathematical edge. It
also requires an approved exhaustive formula, independent feed groups, exact
browser fidelity for every leg, fresh synchronized quote timestamps, and—in
autonomous alerting—the configured number of distinct quote confirmations.

---

### `GET /api/value-bets`
Fetches value betting opportunities identified by comparing outlier odds against sharp benchmark/consensus fair odds.

**Query Parameters:**
* `minGap` *(number)*: Minimum edge gap percentage.
* `limit` *(number)*: Maximum return limit (default 30).

---

### `GET /api/health`
Returns server operational status, active mode (`live` vs `demo`), and diagnostics.

```json
{
  "status": "ok",
  "provider": "live",
  "diagnostics": {
    "mode": "live",
    "provider": "Romanian bookmakers",
    "cache": "active",
    "inFlight": false
  }
}
```

---

### `GET /api/movement`
Tracks odds movement across time snapshots.

### `GET /api/odds`
Returns full normalized odds payload for all active events.

---

## 2. Bankroll & Tracking Endpoints

### `GET /api/bets` & `POST /api/bets`
Retrieves or logs wager entries to persistent storage.

### `GET /api/bankroll` & `POST /api/bankroll`
Retrieves or updates balance allocations across bookmaker wallets.
