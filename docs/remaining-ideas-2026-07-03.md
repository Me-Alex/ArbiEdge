# Arb Desk — Remaining Implementation Ideas

*Generated 2026-07-03 · Cross-referenced against all prior backlogs and implemented features*

---

## ✅ Already Done (not repeated here)

- Original audit fixes (#1–#14 from first roadmap): test fixes, security headers, CORS, atomic writes, validation, Kelly, SSE, analytics, movement, refresh control, theme, notifications
- UX polish (#10–#14): favorites, arb history, auto-stake, system theme, sound
- PWA (#11): manifest, service worker, offline cache
- Arb detail modal (#12): deep links, copy stake, save to journal
- Market depth toggle (#14): show all markets
- UX polish round 2: toasts, dense view, activity timeline, bet slip drawer, quick stakes, color dots, keyboard shortcuts, journal filters, confidence filter, pinned arbs, empty states
- Engine docs: 15 engine improvements documented in `engine-improvements-2026-07-03.md`

---

## Still To Implement

### A. From the Original Backlog (items #1–#100, not yet done)

These items from the 2026-06-29 backlog are still relevant:

**Architecture & Performance**
1. **#085 Virtual scrolling for large event lists** — With 600+ events, the Matches page renders all DOM nodes at once. Virtual scrolling (only render visible items) would cut initial render from ~2s to <100ms.
2. **#087 Event detail drawer with all markets** — Currently the Matches page shows 3 markets per bookmaker in a flat table. A click-through drawer showing every market for a single event (all bookmakers, all markets, side-by-side) would be the natural "deep dive" view.
3. **#092 JSON export for diagnostics** — Add a "Download diagnostics" button that exports the current state (odds, opportunities, audit, provider status) as a JSON file for bug reports.
4. **#096 Precompute event market specs server-side** — The frontend currently classifies markets client-side. Move this to the server so the API returns pre-classified market metadata.
5. **#097 Memoize market classification** — Cache classification results so repeated renders don't recompute.
6. **#098 Debounce search input** — Currently every keystroke triggers a full re-render. Debounce by 150ms.
7. **#099 Diff-based DOM updates** — Instead of `innerHTML = ''` and full rebuild on every filter change, diff the visible items and only add/remove changed nodes.
8. **#100 Split app.js into modules** — The frontend `app.js` is now ~52KB. Split into `state.js`, `render.js`, `calc.js`, `api.js` using ES modules.

**Odds Correctness**
9. **#004 Quarantine bucket for suspicious markets** — Instead of silently discarding flagged markets, keep them in a "quarantine" section visible in the audit output, so users can see what was rejected and why.
10. **#007 Debug panel showing normalization trace** — Show how a normalized odd was derived from raw provider data (raw market ID → normalized key → outcome mapping → final price).
11. **#009 Timestamp validation per market** — Some providers return market-level timestamps. Validate these and flag markets older than the event's other markets.
12. **#017 Per-market confidence score** — Combine source reliability, known market type, outcome completeness, and invariant checks into a 0-100 confidence score per market.
13. **#018 Per-market status field** — `usable`, `suspicious`, `excluded`, `stale`, or `incomplete`. Surface in API and UI.

**Event Matching**
14. **#026 Review list for fuzzy merges** — Low-confidence event merges currently happen silently. Add a "Review matches" panel showing fuzzy-only merges that the user can approve or reject.
15. **#031 Match confidence badge on event cards** — Show whether an event was merged by shared ID (green), fuzzy high (blue), or fuzzy low (amber).
16. **#035 Nightly matching quality report** — Snapshot live data, run matching, and produce a report of merge success rates, fuzzy match distribution, and unmatched events per provider.

**Provider Resilience**
17. **#048 The Odds API quota tracking** — The API returns remaining-request headers. Track and surface these in the health endpoint so users know when they're running low.
18. **#049 Skip events that have already started** — Unless a live mode is explicitly enabled, filter out in-play events to avoid stale pre-match odds.

### B. From the Updated Roadmap (not yet implemented)

19. **Romanian gambling tax calculator** — 3% tax on winnings above 10,000 RON/year. Add to calculator and journal settlement.
20. **Keyboard shortcuts** — Already partially done (`R`, `1-9`, `/`, `S`, `F`, `D`, `Esc`). Still missing: `J` for journal save from modal, arrow navigation between arb cards.
21. **Bet export/import (CSV)** — Journal CSV export already implemented. Import still missing.
22. **Historical odds archive** — Persist snapshots to `data/odds-history/` for backtesting.
23. **Arb history analytics** — Summary panel showing top bookmaker pairs, edge trends, best time windows.
24. **API rate limiting on write endpoints** — Only `?refresh=1` is throttled.
25. **Bookmaker reliability scoring** — Track per-provider uptime, response time, event yield.
26. **Per-provider health check** — Extend `/api/health` with provider-level status.
27. **Graceful shutdown** — Wait for in-flight requests before exiting.
28. **Tests for new features** — Analytics, movement, bet validation, arb history, security headers.
29. **OpenAPI spec** — `openapi.yaml` documenting all endpoints.
30. **Docker Compose** — With healthcheck, restart policy, volume mounts.
31. **PM2/systemd config** — Process manager config for non-Docker deployments.
32. **Multi-sport expansion** — Volleyball, handball, rugby, MMA.
33. **Telegram/Discord alerts** — Outbound webhook for high-edge arbs.
34. **Bet auto-settlement** — Integrate results API to settle pending bets.
35. **EV calculator for value bets** — Show expected value in RON per value bet card.
36. **Bookmaker margin comparison view** — New page showing average overround per bookmaker.

### C. Brand New Ideas (not in any prior backlog)

**User Accounts & Sync**
37. **Multi-user with simple auth** — Add a PIN or password login so multiple users can share one deployment with separate journals and settings. Use a simple `users.json` or SQLite store.
38. **Cross-device settings sync** — Store favorites, theme, sound preference, and filter state server-side tied to a user account, so they sync across devices instead of being localStorage-only.
39. **Shared arb feed** — Let users mark an arb as "taken" and share it with other users on the same deployment, so a team can coordinate bet placement without double-booking.

**Advanced Betting Tools**
40. **Bankroll management with session tracking** — Track starting bankroll, current bankroll, profit/loss per day/week/month. Show a bankroll chart on the Analytics page. Alert when bankroll drops below a configurable threshold.
41. **Stake sizing by confidence tier** — Instead of flat 100 RON per arb, automatically size stakes based on confidence: trusted = 2% of bankroll, review = 1%, risky = 0.5%. Configurable per-tier percentages.
42. **Arb lifetime tracker** — When an arb appears, start a timer. When it disappears, record the lifetime. Over time this reveals how long you typically have to place a bet after spotting an arb (5 seconds? 30 seconds? 2 minutes?). Critical for real-world execution.
43. **Bookmaker balance tracker** — A simple ledger tracking deposits/withdrawals per bookmaker, showing current balance in each account. Helps ensure you have funds spread across books for arb execution.
44. **Tax-aware profit calculator** — Romanian gambling tax (3% above 10,000 RON/year) automatically deducted from profit calculations. Track cumulative yearly winnings. Show both pre-tax and post-tax profit.

**Notification & Alerting**
45. **Email digest of daily arbs** — A daily email summary showing the best arbs found that day, total profit potential, and bookmaker reliability stats. Uses nodemailer or a simple SMTP relay.
46. **Webhook system for custom integrations** — Let users register a webhook URL. When an arb above their threshold appears, POST the arb data to their endpoint. Enables custom Slack/Teams/Discord integrations without building each one.
47. **Scheduled reports** — Weekly summary email or downloadable PDF showing: arbs found, bets placed, profit/loss, hit rate, CLV, and bookmaker performance. Like the Analytics page but in a shareable format.

**Data & Analytics**
48. **Bookmaker margin heatmap** — A matrix showing each bookmaker's margin (overround) by market type (1X2, DC, BTTS, totals, etc.). Helps identify which books are softest for which markets.
49. **Arb frequency by time-of-day chart** — A bar chart on the Scanner history showing arb count per hour. Reveals peak arb windows (e.g., 14:00-16:00 when European bookmakers update lines).
50. **Edge distribution histogram** — A chart showing the distribution of edges across all detected arbs. Helps calibrate the alert threshold — if most arbs are 1-2%, setting the threshold at 3% means missing most opportunities.
51. **Bookmaker correlation matrix** — Which bookmaker pairs produce the most arbs? A heatmap of bookmaker × bookmaker showing arb count. Helps users know which books to fund.
52. **Seasonal trend analysis** — Track arb frequency over weeks/months. Football season vs off-season, Champions League nights vs regular weekends. Helps users know when to be active.

**Provider Expansion**
53. **Bet365 adapter** — Bet365 is not in the current provider list. Even though it's not Romanian-licensed, many Romanian users have accounts via other jurisdictions. A direct adapter would add a major bookmaker.
54. **Exchange integration (Betfair Exchange)** — The current Betfair provider scrapes the sportsbook page. A Betfair Exchange integration (via API-NG) would give true exchange odds with known commission rates, enabling exchange-backed arbitrage.
55. **Live/in-play odds support** — Currently all providers return pre-match odds only. Adding in-play odds (where available) would enable live arbitrage detection, though with higher execution risk.
56. **Esports odds support** — Some Romanian bookmakers (Betano, Superbet) offer esports. Adding esports as a sport category with provider-specific endpoints would capture a growing market.

**Infrastructure**
57. **Redis cache for multi-instance deployments** — The current in-memory cache doesn't share across instances. A Redis backend would enable horizontal scaling behind a load balancer.
58. **Prometheus metrics exporter** — The `/api/metrics` endpoint returns Prometheus-format text. Add a proper Prometheus client library with histograms for response times, counters for arb detection, and gauges for cache hit rates.
59. **Structured logging with request IDs** — Add a request ID to every API call and include it in logs. Makes tracing issues across provider calls, audit, and cache much easier.
60. **Health check webhook** — When the service goes unhealthy (all providers failing, cache expired), send a webhook alert. More proactive than waiting for a monitoring tool to poll `/api/health`.

---

## Recommended Next Steps

| Priority | Items | Why |
|----------|-------|-----|
| **Immediate** | #19 Tax calc, #21 Bet import, #24 Rate limiting | Quick wins, real daily value |
| **Soon** | #1 Virtual scrolling, #7 Diff DOM, #8 Split modules | Performance ceiling approaching with 600+ events |
| **Soon** | #22 Historical archive, #23 Arb analytics, #42 Arb lifetime | Data depth for real execution strategy |
| **Medium** | #37 Simple auth, #40 Bankroll management, #44 Tax-aware calc | Multi-user and real-money workflow |
| **Medium** | #46 Webhook system, #48 Margin heatmap, #51 Bookmaker correlation | Platform value for serious users |
| **Long term** | #54 Exchange API, #55 In-play odds, #57 Redis cache | Scale and new markets |
