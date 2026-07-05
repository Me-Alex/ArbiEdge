# Arb Desk — Updated Improvement Roadmap

*Updated 2026-07-03 · Items #10–#14 from original roadmap are now implemented*

---

## ✅ Already Implemented

| # | Feature | Status |
|---|---------|--------|
| 10 | Bookmaker favorites (pin/hide on Matches page) | ✅ Done |
| 11 | Arbitrage history tracking (`/api/arbs` endpoints + Scanner history section) | ✅ Done |
| 12 | Auto-stake allocation (Calculator page) | ✅ Done |
| 13 | System theme detection (Dark / Light / System cycle) | ✅ Done |
| 14 | Sound alerts (Web Audio API, configurable) | ✅ Done |

Also completed earlier: test fixes, journal clear bug, Ice Hockey dropdown, dead code cleanup, security headers, CORS, atomic writes, bet validation, Kelly calculation fix, error retry, dead file cleanup, SSE streaming, analytics page, movement page, refresh interval control, dark/light theme, browser notifications.

---

## Remaining Improvements

### Tier 1 — Immediate Value

**1. Romanian gambling tax calculator**
Add a 3% tax layer for winnings above 10,000 RON/year to the calculator and journal settlement. Track cumulative yearly winnings so the threshold is visible. Without this, profit numbers are misleading for a Romanian user.

**2. Keyboard shortcuts**
- `R` — refresh odds
- `1`–`9` — switch pages
- `/` — focus search
- `Esc` — clear filters
- `S` — save calculator selection to journal
- `F` — toggle favorites-only on Matches

**3. Bet export/import (CSV)**
The scanner already exports opportunities as CSV, but the journal has no export. Add `GET /api/bets/export` and a download button on the Journal page. Useful for backups and spreadsheet analysis.

**4. Historical odds archive + backtesting**
Persist odds snapshots to `data/odds-history/YYYY-MM-DD.jsonl` instead of just keeping 5 in memory. Enables backtesting strategies, tracking bookmaker line quality over time, and verifying if past arbs would have settled.

**5. Arb history analytics**
The arb history is now logged but has no analytics view. Add a summary panel to the Scanner history section showing:
- Bookmaker pairs that produce the most arbs
- Average edge over time (shrinking or growing?)
- Best time windows for arbs
- Top competitions by arb frequency

### Tier 2 — Reliability

**6. API rate limiting on write endpoints**
Only `?refresh=1` is rate-limited. Add a simple in-memory limiter (60 req/min per IP) to `POST /api/bets`, `POST /api/ai-picks/log`, `POST /api/arbs/log`, and settlement endpoints.

**7. Bookmaker reliability scoring**
Track per-provider success rate, average response time, and event yield over time. Surface on the Bookmakers page as a reliability badge. Helps users know which providers to trust.

**8. Health check with per-provider status**
Extend `GET /api/health` to include a compact provider status summary (last success, consecutive failures, event count). Lets monitoring tools alert when a specific bookmaker goes down.

**9. Graceful shutdown**
Track in-flight requests and give them a 5-second grace period before force-exiting on SIGINT/SIGTERM. Currently stream connections and provider requests can be cut mid-flight.

**10. Tests for new features**
Add dedicated test files for analytics, movement, bet validation, arb history endpoints, and security header assertions.

### Tier 3 — UX Polish

**11. PWA with offline support**
Add `manifest.json` + service worker caching static assets and the last odds payload. Makes Arb Desk installable on mobile with offline access to cached data.

**12. Arb detail modal**
Clicking an arb card in the Scanner opens a modal with:
- Full leg breakdown with deep links to each bookmaker's event page
- Copy-to-clipboard for stake calculations
- One-click "Save to journal" for each leg
- Historical edge trend for this event/market

**13. Bookmaker deep links from Scanner**
Arb cards show bookmaker names but no clickable links. Add `eventUrl` from the leg data so users can click through directly to place the bet.

**14. Match page market depth toggle**
Currently shows only the first 3 markets per bookmaker. Add a toggle to show all markets (1X2, DC, BTTS, totals, handicaps, etc.) for power users who want to find cross-market arbs manually.

**15. Scanner confidence filter**
Add a dropdown to filter by confidence level (trusted / review / risky) alongside the min-edge filter. Lets users focus on high-confidence arbs only.

**16. Journal search and filter**
The journal page has no filtering. Add filters for status (pending/won/lost), bookmaker, date range, and a search box. Essential once you have 50+ bets logged.

### Tier 4 — Deployment & Documentation

**17. Docker Compose with health checks**
`docker-compose.yml` with healthcheck, restart policy, volume mounts for `data/`, and a Caddyfile template for HTTPS.

**18. PM2 / systemd config**
Ship `ecosystem.config.js` for PM2 or a systemd unit file. Auto-restart, log rotation, env management.

**19. OpenAPI spec**
`openapi.yaml` at project root documenting all endpoints, request/response schemas, and error codes. Enables Swagger UI and programmatic integration.

**20. Environment-based configuration profile**
Add `NODE_ENV`-aware defaults: production gets stricter rate limits, JSON logging, cache warming; development gets verbose console logging and relaxed throttling.

### Tier 5 — Advanced

**21. Multi-sport support expansion**
Currently only football, basketball, tennis, and ice hockey are configured. Add volleyball, handball, rugby, and MMA — all covered by Romanian bookmakers. Each needs sport IDs in `sport-config.js` and provider-specific filters.

**22. Telegram/Discord bot integration**
Send high-edge arb alerts to a Telegram channel or Discord webhook. The notification infrastructure is already there — just need outbound HTTP delivery to messaging platforms.

**23. Bet auto-settlement via results API**
Integrate with a football results API (e.g., API-Football, SportMonks) to automatically settle pending bets when the match ends. The `attemptAutoSettle()` stub was removed; this would be the real implementation.

**24. Expected value (EV) calculator for value bets**
The value bets page shows gap and Kelly %, but not the expected value in RON. Add EV = (probability × potential_profit) - (1 - probability) × stake, displayed per value bet card.

**25. Bookmaker margin comparison view**
A new page showing each bookmaker's average margin (overround) across markets, computed from the current odds data. Helps users identify which books are softest.

---

## Recommended Next Steps

| Priority | Items | Why |
|----------|-------|-----|
| **Do next** | #1 Tax calc, #2 Keyboard shortcuts, #3 Bet export | Quick wins, high daily value |
| **Do soon** | #4 Historical archive, #5 Arb analytics, #13 Deep links | Data depth and workflow speed |
| **Do later** | #6–#10 | Production hardening before public deployment |
| **When needed** | #11–#16 | UX polish for heavy users |
| **Long term** | #17–#25 | Scale and platform expansion |
