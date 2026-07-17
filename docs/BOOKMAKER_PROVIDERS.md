# Bookmaker Scrapers & Integration Architecture

## Overview

The `src/providers/` directory houses modular scraping modules for 20+ Romanian licensed sportsbooks and international feeds. Each scraper converts proprietary API schemas into normalized `EventOdds` objects.

---

## Supported Provider Architecture

| Provider Key | Brand Name | Protocol / Feed Strategy | Detail Enrichment |
|---|---|---|---|
| `superbet` | Superbet | Direct JSON REST API (`fastly.net`) | Concurrency-throttled details hydration |
| `fortuna` | Fortuna (eFortuna) | Public UFO REST API | Pre-match & line market extraction |
| `getsbet` | GetsBet | WAMP Websocket + HTTP API | Real-time topic subscription |
| `unibet` | Unibet | Kambi REST Lobby API | Multi-level category quickbrowse |
| `betano` | Betano | REST / Browser Transport | Headless browser transport fallback |
| `betfair` | Betfair | Open Exchange REST API | Sharp price reference source |
| `digitain` | Winner, Betmen, MaxBet | Digitain Public Endpoint | Grouped market normalization |
| `egt` | Winbet | EGT Interactive Endpoint | Live event feed parsing |
| `stanleybet` | Stanleybet Family | NSoft Feed API | Shared timestamp-cached payload |
| `xsport` | LasVegas, Spin, Winboss, PowerBet, Magnumbet, Excelbet | XSportDatastore JSON | Day-window schedule + event detail enrichment |
| `theoddsapi` | The Odds API | International Aggregate API | Backup provider & regional coverage |
| `demo` | Demo Mock Provider | Simulated edge dataset | Instant offline testing fallback |

---

## Data Normalization Standard

Every scraper normalizes market names and outcomes into standard keys using `src/providers/market-utils.js`:

```javascript
{
  id: "provider:event_id",
  sport: "Football",
  competition: "Romania Liga 1",
  startsAt: "2026-07-15T18:00:00.000Z",
  homeTeam: "FCSB",
  awayTeam: "CFR Cluj",
  bookmakers: [
    {
      name: "Superbet",
      lastUpdate: "2026-07-13T20:00:00.000Z",
      eventUrl: "https://superbet.ro/cote/...",
      markets: {
        h2h: { home: 2.10, draw: 3.30, away: 3.60 },
        bothTeamsToScore: { yes: 1.85, no: 1.95 },
        totalGoals_2_5: { over: 1.90, under: 1.90 },
        asianHandicap_minus_0_5: { home: 2.10, away: 1.80 }
      }
    }
  ]
}
```

---

## Error Handling & Resiliency

1. **Timeout Control**: All provider HTTP requests utilize `AbortSignal.timeout(timeoutMs)` to prevent hanging calls.
2. **Graceful Fallback**: If a live provider fails or suffers rate limits, `CompositeProvider` falls back to cached snapshots or demo mode while logging operational warnings.
3. **Fidelity Auditing**: `src/audit/odds-audit.js` validates price integrity before surfacing edges to users.
