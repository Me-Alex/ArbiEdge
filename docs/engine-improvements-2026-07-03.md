# Arb Desk — Engine Improvement Recommendations

*Generated 2026-07-03 based on full audit of `src/formula-engine.js`, `src/odds-audit.js`, and `src/odds-service.js`*

---

## Current Engine State

The formula engine has 6 detection formulas:
1. Classic cross-book arbitrage (same market, best price per outcome)
2. Cross-market arbitrage (h2h + doubleChance combinations)
3. Middles (over/under line spread)
4. Handicap arbitrage
5. BTTS + team-score combinations
6. Team-match-totals combinations

Plus a value bet detector with z-score and Kelly fraction, and an odds audit with 7 issue types (invalid odds, DC violations, DNB violations, line monotonicity, same-book underround, same-book high overround, high odds).

---

## Detection Logic Improvements

### 1. Dutching across bookmakers for the same outcome
`findBestPrices` picks only the single best price per outcome per market. If two bookmakers both offer 2.50 for "Home" and you want to split stake across both (for stake limits or account-balancing), there's no support. Add a `findDutchablePrices` function that returns the top N prices per outcome and computes optimal stake allocation across them.

### 2. Cross-market arbitrage between h2h and Asian handicap
The engine has cross-market between h2h + doubleChance, but not h2h + Asian handicap. If Bookmaker A offers 1X2 at 2.10/3.40/3.20 and Bookmaker B offers AH -0.5 at 2.08, that's equivalent to a home win at 2.08 — potentially a better price than Bookmaker A's 2.10. The engine should detect when an Asian handicap line is functionally equivalent to a 1X2 outcome and use whichever price is better.

**Equivalent AH lines to 1X2:**
- AH -0.5 = Home win (same as 1X2 "1")
- AH +0.5 = Home win or draw (same as Double Chance "1X")
- AH +1.5 = Home win, draw, or lose by 1 (no 1X2 equivalent, but covers "1X" + 1-goal loss)

### 3. Combinatorial arbitrage across 3+ markets
Currently cross-market arb checks pairs (1X2 vs DC, or totals vs team totals). There are combinations involving 3+ market types that can produce arbs — e.g., 1X2 + BTTS + Total Goals. These are rarer but real. A general "cover all outcomes" solver that tries combinations of markets until it finds a probability sum < 1 would catch these.

**Approach:** For each event, enumerate all possible combinations of 2-4 markets where the outcomes are mutually exclusive and collectively exhaustive (MECE). For each MECE combination, find the best price per outcome and check if implied probability sum < 1. Cap at 4 markets to avoid combinatorial explosion.

### 4. Stake-limitation-aware profit calculation
The engine assumes unlimited liquidity at the listed odds. In reality, bookmakers have max bet limits. If the optimal stake for one leg is 2,000 RON but the bookmaker's limit is 500 RON, the arb is smaller than calculated. Add an optional `maxStake` field per bookmaker that caps the stake and recomputes the effective profit.

**Implementation:** Add `maxStakePerBookmaker` to provider config (env var or hardcoded defaults). In `detectArbitrage`, after computing optimal stakes, clamp each leg's stake to its bookmaker's limit. Recompute the effective profit based on the clamped stakes.

### 5. Settlement risk scoring
Some arbs are "safe" (same settlement rules — e.g., both legs are full-time 1X2) and some are "risky" (one leg is 90-minute only, the other includes overtime). The confidence classifier currently only looks at edge and outcome count. Add a settlement-rule check.

**Settlement rule categories:**
- Full-time 90 min (standard): h2h, doubleChance, drawNoBet, bothTeamsToScore, totalGoals
- First half only: firstHalfH2h, firstHalfDrawNoBet, firstHalfTotalGoals
- Second half only: secondHalfH2h, secondHalfDrawNoBet, secondHalfTotalGoals
- To qualify: potentially includes extra time/penalties
- HT/FT: unique settlement (must predict both halves correctly)

If legs span different time scopes (e.g., firstHalfH2h + h2h), downgrade confidence to "risky" even if the edge looks good.

---

## Value Bet Detection Improvements

### 6. Pinnacle-based sharp line
The current value bet detector uses a trimmed-mean consensus across all bookmakers as the "fair" price. This includes soft bookmakers. The industry standard is to use Pinnacle (or another sharp book) as the reference line.

**Implementation:** If `TheOddsApiProvider` is configured and returns Pinnacle odds, use those as the sharp reference. Falls back to consensus if Pinnacle isn't in the data. Also consider Betfair Exchange (if available) as a sharp reference since it has no bookmaker margin.

### 7. Closing line value (CLV) tracking for value bets
The value bet detector shows the gap between current price and consensus, but doesn't track whether the price was actually better than the closing line. If you persist the value bet recommendation and later compare it to the closing odds, you can verify whether the model is profitable.

**Implementation:** When a value bet is detected, log it to `data/value-bets.jsonl` with timestamp, event, market, bookmaker, price, and consensus. When the event starts (or when the next odds refresh shows the event is in-play/finished), compare the logged price to the latest available price. Store the CLV. Surface in the Analytics page.

### 8. Non-result market value bets
`detectValueBet` runs on all markets, but the z-score and consensus logic is tuned for 1X2-style markets. For totals and handicaps, the "consensus" should be the line itself (e.g., if the consensus total is 2.5 and one book offers 2.0, that's a line-value bet, not an odds-value bet).

**Implementation:** Add a separate `detectLineValue` function that:
1. Groups all totalGoals/totalCorners markets by line
2. Finds the consensus line (most common across bookmakers)
3. Flags bookmakers offering a different (better) line at similar odds
4. Also flags bookmakers offering the same line at significantly better odds than consensus

---

## Odds Audit Improvements

### 9. Cross-book implied probability sanity check
The audit checks within a single bookmaker (same-book underround/high overround) and cross-market within a book (DC vs h2h violations). But it doesn't check cross-book consistency — e.g., if Bookmaker A has 1.50/6.00/6.00 and Bookmaker B has 3.50/3.50/3.50 for the same event, one of them is likely wrong.

**Implementation:** For each event and market key, compute the z-score of each bookmaker's implied probability per outcome. Flag any bookmaker whose implied probability is more than 3 standard deviations from the cross-book mean. This catches misparsed odds that pass individual bookmaker checks but are wildly different from the market consensus.

### 10. Void/cancellation rule mismatch detection
Different bookmakers have different rules for voiding bets (e.g., tennis retirement rules, football abandonment thresholds). If two bookmakers in an arb have different void rules, the arb isn't guaranteed.

**Known rule mismatches:**
- Tennis: Some books void if player retires, others settle at current score
- Football: Some books void if match abandoned before 90 min, others settle at current score
- Basketball: Some books include overtime, others don't (especially for totals)

**Implementation:** Maintain a rule-mismatch table per sport. When an arb is detected across two bookmakers with known rule mismatches, add a `settlementWarning` field. The audit can also flag this proactively.

---

## Performance Improvements

### 11. Parallel opportunity detection
`getAllOpportunities` iterates events sequentially. For each event it runs 6 formula detectors, each of which iterates all market keys. With 1000+ events and 20+ markets per event, this is millions of iterations.

**Implementation:** Split events into batches and process in parallel using `Promise.all` with chunking (e.g., 50 events per batch). For Node.js, consider worker threads for CPU-bound detection. Benchmark: current sequential processing on 1000 events takes ~200ms; parallel should cut this to ~50ms.

### 12. Market key indexing
`getEventMarkets` and `findBestPrices` iterate all bookmakers for every market key. Pre-building an index per event would turn O(bookmakers × markets) lookups into O(1).

**Implementation:** Add a `buildEventIndex(event)` function that returns:
```js
{
  marketsByBookmaker: Map<bookmakerName, Map<marketKey, prices>>,
  bookmakersByMarket: Map<marketKey, Map<bookmakerName, prices>>,
  allMarketKeys: Set<marketKey>
}
```
Pass this index to all detection functions instead of having them re-iterate `event.bookmakers` each time.

---

## Data Quality Improvements

### 13. Stale odds detection
The engine processes whatever odds the providers return, but doesn't check whether the odds are stale (e.g., a provider returning cached data from 2 hours ago).

**Implementation:** If a bookmaker's `fetchedAt` timestamp (from the provider status) is more than X minutes old (default 10 min), flag those odds as potentially stale. Downgrade confidence on any arbs involving that bookmaker from "trusted" to "review". Add a `staleBookmakers` field to the audit output.

### 14. Line movement reversal detection
If Bookmaker A's odds for "Home" moved from 2.10 to 2.50 in a single refresh, that's suspicious — it could be a data error or a rapid line move. The audit should flag large single-snapshot movements (>15% change) as a review item.

**Implementation:** In `odds-service.js`, the `getOddsMovement()` function already computes movements. Feed these movements into the audit: any price change > 15% between snapshots gets flagged as `largeMovement` in the audit issues. This catches misparsed data that would otherwise produce fake arbitrage edges.

### 15. Bookmaker pair profitability tracking
The engine doesn't track which bookmaker pairs historically produce the most profitable arbs. Over time, this metadata would help users focus on reliable pairs and avoid problematic ones.

**Implementation:** When arbs are logged to `data/arbs.jsonl`, extract the bookmaker pair from the legs. In the arb history analytics (roadmap #5), add a "Top bookmaker pairs" breakdown showing:
- Most frequent pairs (by arb count)
- Average edge per pair
- Settlement success rate (if linked to journal data)
- Voided/failed count per pair

---

## Recommended Priority

| Priority | Items | Effort | Impact |
|----------|-------|--------|--------|
| **Phase 1** | #2 AH+h2h equivalence, #5 Settlement risk, #9 Cross-book outlier | Medium | Catches more real arbs, fewer false positives |
| **Phase 2** | #6 Pinnacle sharp line, #8 Line value bets, #12 Market indexing | Medium | Better value detection, faster engine |
| **Phase 3** | #3 Combinatorial solver, #4 Stake limits, #11 Parallel detection | High | Edge cases, real-world constraints, scale |
| **Phase 4** | #1 Dutching, #7 CLV tracking, #10 Void rules, #13 Stale detection | Medium | Polish and safety |
| **Phase 5** | #14 Movement reversal, #15 Pair profitability | Low | Data quality insights |
