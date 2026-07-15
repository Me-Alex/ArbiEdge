# Autonomous Runtime

## Safety boundary

Autonomous mode collects, validates, stores, compares, alerts, and settles
recorded bets. It does not log in to bookmakers or place real-money wagers.
Production is fail closed: if every live source fails, the API reports an error
instead of substituting sample prices.

## Collection and recovery

`ProviderSupervisor` maintains independent state for every adapter. Successful
events remain usable only until `AUTONOMY_STALE_AFTER_MS`. Retryable transport
errors receive bounded retries; repeated failures open a timed circuit. A
process restart restores the latest compressed normalized snapshot from
PostgreSQL before the first collection cycle.

Every bookmaker row is stamped with the time it was actually observed. The
supervisor adapts each provider cadence to measured response duration and the
runtime evaluates bounded progressive snapshots, so one slow adapter does not
hold every faster quote until the end of a full collection.

BetConstruct adapters also refresh their public runtime configuration on a
bounded interval. Config refresh failures retain the last validated site ID,
release date, and socket rather than interrupting a working feed.

## Independent price sources

Every bookmaker row carries both a platform group and a price-feed group.
Brands known to share the same exact source, including the Stanleybet family
and the shared Digitain micros feed, do not count as independent evidence.
Mathematical opportunities using one correlated feed are rejected even when
the labels show multiple brands.

## Opportunity lifecycle

The lifecycle is:

1. `rejected` or `analysis` for unsafe/non-guaranteed formulas.
2. `awaiting_freshness` when a quote is old, missing a collection timestamp, or
   collected too far apart from another selected leg.
3. `awaiting_fidelity` until every selected price has current independent
   browser evidence for the exact event, market, line, outcome, and price.
4. `awaiting_recheck` after structural, timing, and fidelity gates pass.
5. `actionable` only when the exact bookmaker, market, outcome, and price tuple
   appears in the configured number of distinct quote observations. Re-running
   the scanner over unchanged cached data does not count as confirmation.
6. `expired` when the tuple disappears or its short TTL elapses.

Candidate fidelity verification is opportunity-first. It ranks structurally
approved candidates, groups their missing legs by event page, enforces page and
leg budgets, and avoids retrying unchanged evidence during the cooldown. A
failed browser check never promotes a candidate.

Alert dedupe keys contain both the opportunity identity and price fingerprint.
Webhook URLs are resolved from the local webhook registry during delivery;
Telegram tokens stay in process environment variables and are never written
to the outbox.

## Monitoring and discovery

- Provider health is collected every normal scan.
- Full endpoint audits run every six hours by default.
- Remaining bookmaker pages and bundles are scanned every 24 hours.
- Browser fidelity rotates through provider adapters when enabled.
- Candidate-first browser fidelity verifies the opportunities nearest to the
  actionable gate when enabled.
- Normalized schema fingerprints and circuit status are stored with provider
  runs. Invalid normalized payloads are quarantined by the supervisor.

Discovery reports candidates only. They do not rewrite a production adapter
without tests and review.

The optional independent Odds API provider supports football, basketball,
tennis, ice hockey, handball, volleyball, and American football normalization.
Explicit sport keys remain the default. Active-sport discovery is opt-in and
bounded by group, sport count, and concurrency because sport-level odds calls
consume API quota.

## Authoritative settlement

When `RESULTS_ENABLED=1`, completed games are loaded through The Odds API scores
endpoint. Supported 1X2, totals, and both-teams-to-score bets are settled from
the final score and recorded in the settlement ledger. Odds-inferred settlement
is disabled automatically in autonomous mode.

## Database and backups

The migration creates tables for compressed snapshots, provider runs,
opportunities and transitions, fidelity evidence, alert deliveries, monitoring
runs, and settlements. PostgreSQL storage is mandatory when autonomous mode is
started with `NODE_ENV=production`.

Back up the Compose database with a secret supplied outside the command history:

```powershell
docker compose exec -T postgres pg_dump -U odds_dashboard -d odds_dashboard -Fc > odds-dashboard.dump
```

Restore into a separate validation database first and run `/api/readiness`,
`/api/health`, and `/api/autonomy/status` before replacing production storage.

## Production acceptance

Before treating an installation as unattended, require:

- a 72-hour soak with no unbounded memory or request growth;
- a seven-day run with provider circuit recovery observed;
- successful database restore rehearsal;
- no demo-mode payloads in production logs;
- alert retry and deduplication evidence;
- authoritative settlement reconciliation;
- all CI tests and the live endpoint audit passing.
