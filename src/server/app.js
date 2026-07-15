const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const {
  ROMANIAN_BOOKMAKER_COVERAGE,
  coverageSummary,
} = require('../services/bookmaker-coverage');
const { getAllOpportunities, getValueBets, describeMarket } = require('../engine/formula-engine');
const { createLogger } = require('../core/logger');
const { BetTracker, VALID_STATUSES } = require('../finance/bet-tracker');
const { RateLimiter } = require('../core/limiter');
const { runAutoSettle, getPendingPicks, readAiPicks } = require('../finance/ai-pick-settler');
const { generateAnafReport } = require('../finance/tax-calculator');
const { allSportOptions, sportCanonical, parseSportList } = require('../core/sports');

const log = createLogger({ level: process.env.LOG_LEVEL || 'info', json: process.env.LOG_JSON === '1' });

const FRONTEND_ROUTES = [
  '/scanner',
  '/value',
  '/ai',
  '/calculator',
  '/journal',
  '/analytics',
  '/movement',
  '/bookmakers',
  '/matches',
];

const DEFAULT_AI_PICK_LOG_PATH = path.join(__dirname, '..', '..', 'data', 'ai-picks.jsonl');
const DEFAULT_BET_LOG_PATH = path.join(__dirname, '..', '..', 'data', 'bets.jsonl');
const DEFAULT_ARB_LOG_PATH = path.join(__dirname, '..', '..', 'data', 'arbs.jsonl');

const AUDIT_ISSUE_METRICS = {
  invalidOdds: 'odds_audit_invalid_odds',
  doubleChanceViolations: 'odds_audit_double_chance_violations',
  drawNoBetViolations: 'odds_audit_draw_no_bet_violations',
  totalLineMonotonicity: 'odds_audit_total_line_monotonicity',
  sameBookUnderround: 'odds_audit_same_book_underround',
  sameBookHighOverround: 'odds_audit_same_book_high_overround',
  highOdds: 'odds_audit_high_odds',
  impossibleLineMarkets: 'odds_audit_impossible_line_markets',
  fidelityMismatches: 'odds_audit_fidelity_mismatches',
};

function createApp({
  oddsService,
  liveConfigured,
  bookmakerCoverage = ROMANIAN_BOOKMAKER_COVERAGE,
  aiPickLogPath = DEFAULT_AI_PICK_LOG_PATH,
  betLogPath = DEFAULT_BET_LOG_PATH,
  arbLogPath = DEFAULT_ARB_LOG_PATH,
  betTracker: providedBetTracker = null,
  autonomyRuntime = null,
  allowInferredSettlement = true,
  writeRateLimiter = createWriteRateLimiter(),
  logger = log,
  publicDirectory = path.join(__dirname, '..', '..', 'public'),
}) {
  const app = express();
  const frontendHtml = fs.readFileSync(path.join(publicDirectory, 'index.html'), 'utf8');
  app.disable('x-powered-by');
  app.use(express.json({ limit: '512kb' }));

  // Security headers
  app.use((request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'SAMEORIGIN');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    next();
  });

  // CORS — configurable via env
  const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  if (corsOrigins.length > 0) {
    app.use((request, response, next) => {
      const origin = request.headers.origin;
      if (origin && corsOrigins.includes(origin)) {
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        response.setHeader('Access-Control-Max-Age', '86400');
      }
      if (request.method === 'OPTIONS') {
        response.status(204).end();
        return;
      }
      next();
    });
  }

  const betTracker = providedBetTracker || new BetTracker({ logPath: betLogPath });
  const checkWriteRateLimit = writeRateLimitMiddleware(writeRateLimiter, logger);

  // Rate-limit ?refresh=1 to protect bookmaker APIs
  const REFRESH_MIN_INTERVAL_MS = 30_000;
  let lastRefreshRequestMs = 0;

  app.get('/api/health', (request, response) => {
    const diagnostics = serviceDiagnostics(oddsService);
    response.json({
      status: 'ok',
      provider: liveConfigured ? 'live' : 'demo',
      diagnostics,
      ...(autonomyRuntime ? { autonomy: autonomyRuntime.diagnostics?.() || { enabled: true } } : {}),
    });
  });

  app.get('/api/readiness', (request, response) => {
    const diagnostics = serviceDiagnostics(oddsService);
    const autonomy = autonomyRuntime?.diagnostics?.() || null;
    const ready = isServiceReady(diagnostics)
      && (!autonomy || (autonomy.started && autonomy.lastCycle?.ok !== false));
    response.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'warming',
      reason: readinessReason(diagnostics),
      diagnostics,
      ...(autonomy ? { autonomy } : {}),
    });
  });

  app.get('/api/metrics', (request, response) => {
    response
      .type('text/plain; version=0.0.4; charset=utf-8')
      .send(`${metricsText(serviceDiagnostics(oddsService))}${autonomyMetricsText(autonomyRuntime?.diagnostics?.())}`);
  });

  app.get('/api/autonomy/status', (request, response) => {
    response.json(autonomyRuntime?.diagnostics?.() || { enabled: false });
  });

  app.get('/api/bookmakers', (request, response) => {
    response.json(coverageSummary(bookmakerCoverage));
  });

  app.get('/api/tax/report', (request, response) => {
    try {
      const year = request.query.year || new Date().getFullYear();
      const bets = betTracker.readAll();
      const report = generateAnafReport(bets, year);
      response.json(report);
    } catch (error) {
      logger.error('Failed to generate ANAF fiscal report', { error: error.message });
      response.status(500).json({ error: 'Failed to generate ANAF fiscal report' });
    }
  });

  app.post('/api/ai-picks/log', checkWriteRateLimit, (request, response) => {
    try {
      const record = aiPickLogRecord(request.body);
      appendAiPickLog(aiPickLogPath, record);
      logger.info('AI pick logged', { action: record.action });
      response.status(201).json({ ok: true, path: aiPickLogPath });
    } catch (error) {
      logger.error('Unable to save AI pick log', { error: error.message });
      response.status(400).json({ error: 'Unable to save AI pick log' });
    }
  });

  // ===== AI Pick auto-settlement =====
  app.get('/api/ai-picks', (request, response) => {
    try {
      const picks = readAiPicks(aiPickLogPath);
      const pending = picks.filter(p => p.action === 'created');
      const settled = picks.filter(p => p.action === 'settled');
      response.json({
        total: picks.length,
        pending: pending.length,
        settled: settled.length,
        picks: picks.slice(-100).reverse(),
      });
    } catch (error) {
      logger.error('Unable to read AI picks', { error: error.message });
      response.status(500).json({ error: 'Unable to read AI picks' });
    }
  });

  app.post('/api/ai-picks/settle', async (request, response) => {
    if (!allowInferredSettlement) {
      response.status(409).json({ error: 'Odds-inferred settlement is disabled; authoritative results are required.' });
      return;
    }
    try {
      const data = await oddsService.getOdds();
      const liveEvents = data.events || [];
      const previousSnapshot = oddsService.snapshots?.length >= 2
        ? oddsService.snapshots[oddsService.snapshots.length - 2].events
        : [];
      const result = runAutoSettle({
        logPath: aiPickLogPath,
        liveEvents,
        previousEvents: previousSnapshot,
      });
      logger.info('AI pick auto-settle ran', {
        settled: result.settled.length,
        reviewed: result.reviewed.length,
        unchanged: result.unchanged.length,
      });
      response.json(result);
    } catch (error) {
      logger.error('Unable to auto-settle AI picks', { error: error.message });
      response.status(500).json({ error: 'Unable to auto-settle AI picks' });
    }
  });

  // Auto-settle helper (closes over logger, oddsService, aiPickLogPath)
  let _autoSettleRunning = false;
  function runBackgroundAutoSettle() {
    if (!allowInferredSettlement) return;
    if (_autoSettleRunning) return;
    _autoSettleRunning = true;
    setImmediate(() => {
      try {
        const data = oddsService.cache?.value;
        if (!data?.events) { _autoSettleRunning = false; return; }
        const liveEvents = data.events;
        const previousSnapshot = oddsService.snapshots?.length >= 2
          ? oddsService.snapshots[oddsService.snapshots.length - 2].events
          : [];
        const result = runAutoSettle({
          logPath: aiPickLogPath,
          liveEvents,
          previousEvents: previousSnapshot,
        });
        if (result.settled.length > 0 || result.reviewed.length > 0) {
          logger.info('Background auto-settle completed', {
            settled: result.settled.length,
            reviewed: result.reviewed.length,
            unchanged: result.unchanged.length,
          });
        }
      } catch (error) {
        logger.error('Background auto-settle failed', { error: error.message });
      } finally {
        _autoSettleRunning = false;
      }
    });
  }

  app.get('/api/odds', async (request, response) => {
    try {
      if (request.query.refresh === '1') {
        const now = Date.now();
        if (now - lastRefreshRequestMs < REFRESH_MIN_INTERVAL_MS) {
          response.status(429).json({
            error: 'Refresh rate limited',
            retryAfterMs: REFRESH_MIN_INTERVAL_MS - (now - lastRefreshRequestMs),
          });
          return;
        }
        lastRefreshRequestMs = now;
        oddsService.clearCache?.();
        logger.info('Odds refresh requested', { ip: request.ip });
      }

      const data = await oddsService.getOdds();

      // Sport filter: return only events matching the requested sport
      const sportFilter = request.query.sport;
      if (sportFilter) {
        const canonical = sportCanonical(String(sportFilter).toLowerCase().replace(/\s+/g, ''));
        const filtered = {
          ...data,
          events: (data.events || []).filter(
            (event) => !event.sport || event.sport === canonical,
          ),
        };
        response.json(filtered);
      } else {
        response.json(data);
      }

      // Auto-settle AI picks in background after each odds refresh
      runBackgroundAutoSettle();
    } catch (error) {
      logger.error('Unable to load odds', { error: error.message });
      response.status(500).json({ error: 'Unable to load odds' });
    }
  });

  app.get('/api/odds/stream', async (request, response) => {
    try {
      if (request.query.refresh === '1') {
        const now = Date.now();
        if (now - lastRefreshRequestMs < REFRESH_MIN_INTERVAL_MS) {
          response.status(429).json({
            error: 'Refresh rate limited',
            retryAfterMs: REFRESH_MIN_INTERVAL_MS - (now - lastRefreshRequestMs),
          });
          return;
        }
        lastRefreshRequestMs = now;
        oddsService.clearCache?.();
      }

      logger.info('Odds stream started', { ip: request.ip });

      response.writeHead(200, {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      });

      const snapshots = typeof oddsService.streamOdds === 'function'
        ? oddsService.streamOdds()
        : [await oddsService.getOdds()];

      for await (const snapshot of snapshots) {
        if (request.destroyed) {
          return;
        }
        response.write(`${JSON.stringify(snapshot)}\n`);
      }
      response.end();
    } catch (error) {
      logger.error('Unable to stream odds', { error: error.message });
      if (!response.headersSent) {
        response.status(500).json({ error: 'Unable to stream odds' });
        return;
      }
      response.write(`${JSON.stringify({ error: 'Unable to stream odds' })}\n`);
      response.end();
    }
  });

  app.get('/api/odds/movement', (request, response) => {
    try {
      const movement = oddsService.getOddsMovement?.();
      if (!movement) {
        response.status(503).json({ error: 'Odds movement tracking not available' });
        return;
      }
      response.json(movement);
    } catch (error) {
      logger.error('Unable to compute odds movement', { error: error.message });
      response.status(500).json({ error: 'Unable to compute odds movement' });
    }
  });

  app.get('/api/opportunities', async (request, response) => {
    try {
      const data = await oddsService.getOdds();
      const events = data.events || [];
      let opps = getAllOpportunities(events);

      // Enrich with market descriptions
      for (const opp of opps) {
        if (!opp.marketDescription) {
          opp.marketDescription = describeMarket(opp.marketKey) || null;
        }
      }

      const minEdge = Number(request.query.minEdge) || 0;
      const profitOnly = request.query.profitOnly === '1';
      const trustedOnly = request.query.trustedOnly === '1';
      const limit = Number(request.query.limit) || undefined;

      if (profitOnly) opps = opps.filter((o) => o.profit > 0);
      if (trustedOnly) opps = opps.filter((o) => o.confidence === 'trusted');
      if (minEdge > 0) opps = opps.filter((o) => o.edge * 100 >= minEdge);

      const sort = request.query.sort || 'edge';
      switch (sort) {
        case 'profit':
          opps.sort((a, b) => b.profit - a.profit);
          break;
        case 'confidence':
          opps.sort((a, b) => {
            const order = { high: 4, trusted: 3, review: 2, risky: 1 };
            return (order[b.confidence] || 0) - (order[a.confidence] || 0);
          });
          break;
        default:
          opps.sort((a, b) => b.edge - a.edge);
      }

      response.json({
        opportunities: opps.slice(0, limit),
        total: opps.length,
        fetchedAt: data.fetchedAt,
      });
    } catch (error) {
      logger.error('Unable to compute opportunities', { error: error.message });
      response.status(500).json({ error: 'Unable to compute opportunities' });
    }
  });

  // ===== Arb history =====
  app.post('/api/arbs/log', checkWriteRateLimit, (request, response) => {
    try {
      const body = request.body || {};
      if (!Array.isArray(body.opportunities) || body.opportunities.length === 0) {
        response.status(400).json({ error: 'Missing opportunities array' });
        return;
      }
      const record = {
        loggedAt: new Date().toISOString(),
        count: body.opportunities.length,
        opportunities: body.opportunities.map((opp) => ({
          eventName: opp.eventName || '',
          marketKey: opp.marketKey || '',
          marketLabel: opp.marketLabel || '',
          edge: Number(opp.edge) || 0,
          profit: Number(opp.profit) || 0,
          confidence: opp.confidence || '',
          competition: opp.competition || '',
          legs: (opp.legs || []).map((leg) => ({
            outcome: leg.outcome || '',
            label: leg.label || '',
            bookmaker: leg.bookmaker || '',
            price: Number(leg.price) || 0,
          })),
        })),
      };
      fs.mkdirSync(path.dirname(arbLogPath), { recursive: true });
      fs.appendFileSync(arbLogPath, `${JSON.stringify(record)}\n`, 'utf8');
      response.status(201).json({ ok: true, count: record.count });
    } catch (error) {
      logger.error('Unable to save arb history', { error: error.message });
      response.status(500).json({ error: 'Unable to save arb history' });
    }
  });

  app.get('/api/arbs', (request, response) => {
    try {
      if (!fs.existsSync(arbLogPath)) {
        response.json({ records: [], total: 0 });
        return;
      }
      const limit = Number(request.query.limit) || 100;
      const lines = fs.readFileSync(arbLogPath, 'utf8').split('\n').filter(Boolean);
      const records = [];
      for (const line of lines) {
        try { records.push(JSON.parse(line)); } catch { /* skip */ }
      }
      records.reverse();
      response.json({
        records: records.slice(0, limit),
        total: records.length,
      });
    } catch (error) {
      logger.error('Unable to fetch arb history', { error: error.message });
      response.status(500).json({ error: 'Unable to fetch arb history' });
    }
  });

  app.get('/api/value-bets', async (request, response) => {
    try {
      const data = await oddsService.getOdds();
      const events = data.events || [];
      const limit = Number(request.query.limit) || 30;
      const bets = getValueBets(events, limit);

      response.json({
        valueBets: bets,
        total: bets.length,
        fetchedAt: data.fetchedAt,
      });
    } catch (error) {
      logger.error('Unable to compute value bets', { error: error.message });
      response.status(500).json({ error: 'Unable to compute value bets' });
    }
  });

  // ===== Sport configuration =====
  app.get('/api/sports', (request, response) => {
    response.json({
      sports: allSportOptions(),
      defaultSport: 'football',
    });
  });

  // ===== Bet tracker =====
  app.get('/api/bets', (request, response) => {
    try {
      const bets = betTracker.query({
        status: request.query.status || undefined,
        sport: request.query.sport || undefined,
        bookmaker: request.query.bookmaker || undefined,
        market: request.query.market || undefined,
        type: request.query.type || undefined,
        limit: request.query.limit ? Number(request.query.limit) : undefined,
      });
      response.json({ bets, total: bets.length });
    } catch (error) {
      logger.error('Unable to fetch bets', { error: error.message });
      response.status(500).json({ error: 'Unable to fetch bets' });
    }
  });

  app.post('/api/bets', checkWriteRateLimit, (request, response) => {
    try {
      const input = validateBetInput(request.body || {});
      const bet = betTracker.create({
        ...input,
        id: undefined,
        loggedAt: undefined,
        result: null,
        settledAt: null,
        status: 'pending',
      });
      logger.info('Bet created', { id: bet.id });
      response.status(201).json(bet);
    } catch (error) {
      logger.error('Unable to create bet', { error: error.message });
      response.status(400).json({ error: error.message });
    }
  });

  app.post('/api/bets/import', checkWriteRateLimit, (request, response) => {
    try {
      const records = betImportRecords(request.body || {});
      if (records.length === 0) {
        response.status(400).json({ error: 'No importable bets found' });
        return;
      }
      if (records.length > 1000) {
        response.status(400).json({ error: 'Import is limited to 1000 bets at a time' });
        return;
      }

      const existingIds = new Set(betTracker.readAll().map((bet) => bet.id).filter(Boolean));
      const importIds = new Set();
      const created = records.map((record) => {
        if (!record.id || existingIds.has(record.id) || importIds.has(record.id)) {
          delete record.id;
        } else {
          importIds.add(record.id);
        }
        return betTracker.create(record);
      });
      const annotated = betTracker.refreshTaxFields();
      const createdIds = new Set(created.map((bet) => bet.id));
      const importedBets = annotated.filter((bet) => createdIds.has(bet.id));
      logger.info('Bets imported', { count: importedBets.length });
      response.status(201).json({
        ok: true,
        imported: importedBets.length,
        total: annotated.length,
        bets: importedBets,
      });
    } catch (error) {
      logger.error('Unable to import bets', { error: error.message });
      response.status(400).json({ error: error.message });
    }
  });

  app.post('/api/bets/:id/settle', checkWriteRateLimit, (request, response) => {
    try {
      const result = String(request.body?.result || '').trim();
      const closingOdds = request.body?.closingOdds;
      const notes = request.body?.notes;
      const bet = betTracker.settle(request.params.id, result, { closingOdds, notes });
      logger.info('Bet settled', { id: bet.id, result: bet.result });
      response.json(bet);
    } catch (error) {
      logger.error('Unable to settle bet', { error: error.message });
      const status = error.message.includes('not found') ? 404 : 400;
      response.status(status).json({ error: error.message });
    }
  });

  app.patch('/api/bets/:id', checkWriteRateLimit, (request, response) => {
    try {
      const bet = betTracker.update(request.params.id, request.body || {});
      response.json(bet);
    } catch (error) {
      logger.error('Unable to update bet', { error: error.message });
      const status = error.message.includes('not found') ? 404 : 400;
      response.status(status).json({ error: error.message });
    }
  });

  app.delete('/api/bets/:id', checkWriteRateLimit, (request, response) => {
    try {
      const removed = betTracker.remove(request.params.id);
      if (!removed) {
        response.status(404).json({ error: 'Bet not found' });
        return;
      }
      response.json({ ok: true });
    } catch (error) {
      logger.error('Unable to delete bet', { error: error.message });
      response.status(500).json({ error: 'Unable to delete bet' });
    }
  });

  app.get('/api/bets/analytics', (request, response) => {
    try {
      const analytics = betTracker.analytics({
        sport: request.query.sport || undefined,
      });
      response.json(analytics);
    } catch (error) {
      logger.error('Unable to compute bet analytics', { error: error.message });
      response.status(500).json({ error: 'Unable to compute analytics' });
    }
  });

  app.use(express.static(publicDirectory));

  app.use('/api', (request, response) => {
    response.status(404).json({ error: 'API route not found' });
  });

  app.get(FRONTEND_ROUTES, (request, response) => {
    response.type('html').send(frontendHtml);
  });

  return app;
}

function serviceDiagnostics(oddsService) {
  return typeof oddsService.diagnostics === 'function'
    ? oddsService.diagnostics()
    : null;
}

function isServiceReady(diagnostics) {
  if (!diagnostics) {
    return true;
  }
  return Boolean(
    diagnostics.inFlight ||
    diagnostics.cache?.fresh ||
    diagnostics.lastRefresh?.events > 0,
  );
}

function readinessReason(diagnostics) {
  if (!diagnostics) {
    return 'diagnostics unavailable';
  }
  if (diagnostics.inFlight) {
    return 'odds refresh in progress';
  }
  if (diagnostics.cache?.fresh) {
    return 'fresh odds cache available';
  }
  if (diagnostics.lastRefresh?.events > 0) {
    return 'last refresh has usable events';
  }
  return 'waiting for first odds refresh';
}

function metricsText(diagnostics) {
  const auditIssueMetrics = auditIssueCountMetrics(diagnostics?.lastRefresh?.audit?.issueCounts);
  const metrics = {
    odds_ready: isServiceReady(diagnostics) ? 1 : 0,
    odds_cache_fresh: diagnostics?.cache?.fresh ? 1 : 0,
    odds_cache_age_ms: numericMetric(diagnostics?.cache?.ageMs),
    odds_cache_expires_in_ms: numericMetric(diagnostics?.cache?.expiresInMs),
    odds_refresh_in_flight: diagnostics?.inFlight ? 1 : 0,
    odds_last_refresh_events: numericMetric(diagnostics?.lastRefresh?.events),
    odds_last_refresh_providers: numericMetric(diagnostics?.lastRefresh?.providers),
    odds_last_refresh_failed_providers: numericMetric(diagnostics?.lastRefresh?.failedProviders),
    odds_last_refresh_duration_ms: numericMetric(diagnostics?.lastRefresh?.durationMs),
    odds_last_refresh_live: diagnostics?.lastRefresh?.status === 'live' ? 1 : 0,
    odds_last_refresh_fallback: diagnostics?.lastRefresh?.status === 'fallback' ? 1 : 0,
    odds_last_refresh_error: diagnostics?.lastRefresh?.status === 'error' ? 1 : 0,
    odds_audit_warning: diagnostics?.lastRefresh?.audit?.status === 'warning' ? 1 : 0,
    odds_audit_review: diagnostics?.lastRefresh?.audit?.status === 'review' ? 1 : 0,
    odds_audit_issues_total: Object.values(auditIssueMetrics)
      .reduce((total, value) => total + value, 0),
    ...auditIssueMetrics,
  };
  const scalarLines = Object.entries(metrics)
    .map(([key, value]) => `${key} ${value}`);
  const providerLines = providerTimingMetricLines(diagnostics?.lastRefresh?.slowProviders);

  return `${[
    ...scalarLines,
    ...providerLines,
  ].join('\n')}\n`;
}

function autonomyMetricsText(diagnostics) {
  if (!diagnostics?.enabled) return 'odds_autonomy_enabled 0\n';
  const lastCycle = diagnostics.lastCycle || {};
  const opportunities = lastCycle.opportunities || {};
  const verification = lastCycle.candidateVerification || {};
  const verificationStatuses = verification.statusCounts || {};
  const quoteTiming = opportunities.quoteTiming || {};
  const providers = diagnostics.supervisor?.providers || [];
  return [
    'odds_autonomy_enabled 1',
    `odds_autonomy_started ${diagnostics.started ? 1 : 0}`,
    `odds_autonomy_cycle_running ${diagnostics.cycleRunning ? 1 : 0}`,
    `odds_autonomy_last_cycle_ok ${lastCycle.ok ? 1 : 0}`,
    `odds_autonomy_last_cycle_events ${Number(lastCycle.events || 0)}`,
    `odds_autonomy_last_cycle_providers ${Number(lastCycle.providers || 0)}`,
    `odds_autonomy_last_cycle_duration_ms ${Number(lastCycle.durationMs || 0)}`,
    `odds_autonomy_progressive_snapshots ${Number(lastCycle.snapshotsProcessed || 0)}`,
    `odds_autonomy_opportunities_total ${Number(opportunities.total || 0)}`,
    `odds_autonomy_opportunities_actionable ${Number(opportunities.actionable || 0)}`,
    `odds_autonomy_opportunities_awaiting_fidelity ${Number(opportunities.awaitingFidelity || 0)}`,
    `odds_autonomy_opportunities_awaiting_freshness ${Number(opportunities.awaitingFreshness || 0)}`,
    `odds_autonomy_opportunities_awaiting_recheck ${Number(opportunities.awaitingRecheck || 0)}`,
    `odds_autonomy_quotes_fresh ${Number(quoteTiming.fresh || 0)}`,
    `odds_autonomy_quotes_stale ${Number(quoteTiming.stale || 0)}`,
    `odds_autonomy_quotes_skewed ${Number(quoteTiming.skewed || 0)}`,
    `odds_autonomy_verification_candidates ${Number(verification.candidates || 0)}`,
    `odds_autonomy_verification_legs ${Number(verification.legs || 0)}`,
    `odds_autonomy_verification_records ${Number(verification.records || 0)}`,
    `odds_autonomy_verification_verified ${Number(verificationStatuses.verified || 0)}`,
    `odds_autonomy_verification_mismatch ${Number(verificationStatuses.mismatch || 0)}`,
    `odds_autonomy_providers_stale ${providers.filter((provider) => provider.stale).length}`,
    `odds_autonomy_providers_circuit_open ${providers.filter((provider) => provider.circuitState === 'open').length}`,
    `odds_autonomy_fidelity_records ${Number(diagnostics.storage?.fidelityRecords || 0)}`,
    `odds_autonomy_pending_alerts ${Number(diagnostics.storage?.pendingAlerts || 0)}`,
    '',
  ].join('\n');
}

function auditIssueCountMetrics(issueCounts = {}) {
  return Object.fromEntries(
    Object.entries(AUDIT_ISSUE_METRICS).map(([issueKey, metricKey]) => [
      metricKey,
      numericMetric(issueCounts?.[issueKey]),
    ]),
  );
}

function numericMetric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function aiPickLogRecord(body = {}) {
  const action = String(body.action || '').trim();
  if (!['created', 'settled'].includes(action)) {
    throw new Error('Unsupported AI pick log action');
  }
  if (!body.entry || typeof body.entry !== 'object') {
    throw new Error('Missing AI pick log entry');
  }

  const entry = {
    ...body.entry,
    id: body.entry.id || `pick_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    loggedAt: body.entry.loggedAt || new Date().toISOString(),
  };

  return {
    loggedAt: new Date().toISOString(),
    action,
    entry,
  };
}

function appendAiPickLog(logPath, record) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `${JSON.stringify(record)}\n`, 'utf8');
}

function createWriteRateLimiter() {
  return new RateLimiter({
    windowMs: positiveInteger(process.env.WRITE_RATE_LIMIT_WINDOW_MS, 60_000),
    maxRequests: positiveInteger(process.env.WRITE_RATE_LIMIT_MAX, 60),
  });
}

function writeRateLimitMiddleware(rateLimiter, logger) {
  return (request, response, next) => {
    if (!rateLimiter || typeof rateLimiter.check !== 'function') {
      next();
      return;
    }

    const result = rateLimiter.check(request.ip || request.socket?.remoteAddress);
    if (result.allowed) {
      next();
      return;
    }

    const retryAfterMs = result.retryAfterMs || 1000;
    response.setHeader('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
    logger.warn('Write API rate limited', {
      ip: request.ip,
      path: request.path,
      retryAfterMs,
    });
    response.status(429).json({
      error: 'Write rate limited',
      retryAfterMs,
    });
  };
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function betImportRecords(body) {
  const rows = Array.isArray(body.bets)
    ? body.bets
    : typeof body.csv === 'string'
      ? parseCsvObjects(body.csv)
      : [];

  return rows
    .filter((row) => row && typeof row === 'object')
    .map((row, index) => importRowToBet(row, index));
}

function importRowToBet(row, index) {
  const loggedAt = normalizeImportDate(fieldValue(row, ['Saved', 'LoggedAt', 'loggedAt', 'timestamp']));
  const status = normalizeImportStatus(fieldValue(row, ['Status', 'status'])) || 'pending';
  const settledAt =
    normalizeImportDate(fieldValue(row, ['Settled', 'SettledAt', 'settledAt'])) ||
    (status === 'pending' ? null : loggedAt);
  const input = {
    id: cleanImportValue(fieldValue(row, ['ID', 'Id', 'id'])),
    event: fieldValue(row, ['Event', 'event', 'Match', 'match']),
    sport: fieldValue(row, ['Sport', 'sport']) || 'Football',
    competition: fieldValue(row, ['Competition', 'competition']),
    market: fieldValue(row, ['Market', 'market']),
    selection: fieldValue(row, ['Selection', 'selection']),
    bookmaker: fieldValue(row, ['Bookmaker', 'bookmaker']),
    odds: fieldValue(row, ['Odds', 'odds']),
    stake: fieldValue(row, ['Stake', 'stake']),
    status,
    type: fieldValue(row, ['Type', 'type']) || 'manual-import',
    notes: fieldValue(row, ['Notes', 'notes']),
    closingOdds: fieldValue(row, ['ClosingOdds', 'closingOdds', 'Closing odds']),
    loggedAt,
    settledAt,
    result: status === 'pending' ? null : status,
  };

  try {
    return validateBetInput(input);
  } catch (error) {
    throw new Error(`Row ${index + 1}: ${error.message}`);
  }
}

function normalizeImportStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  return VALID_STATUSES.includes(status) ? status : null;
}

function normalizeImportDate(value) {
  const text = cleanImportValue(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function fieldValue(row, names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null && row[name] !== '') {
      return row[name];
    }
  }
  const lowerMap = Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key.toLowerCase(), value]),
  );
  for (const name of names) {
    const value = lowerMap[name.toLowerCase()];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
}

function cleanImportValue(value) {
  return String(value ?? '').trim();
}

function parseCsvObjects(text) {
  const rows = parseCsvRows(String(text || '').replace(/^\uFEFF/, ''));
  if (rows.length === 0) return [];
  const headers = rows[0].map((header) => cleanImportValue(header));
  if (headers.every((header) => !header)) return [];

  return rows.slice(1)
    .filter((row) => row.some((value) => cleanImportValue(value)))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function providerTimingMetricLines(providers = []) {
  if (!Array.isArray(providers)) {
    return [];
  }

  return providers
    .filter((provider) => provider?.name)
    .flatMap((provider) => {
      const label = `name="${escapeMetricLabel(provider.name)}"`;
      return [
        `odds_slow_provider_duration_ms{${label}} ${numericMetric(provider.durationMs)}`,
        `odds_slow_provider_events{${label}} ${numericMetric(provider.events)}`,
        `odds_slow_provider_ok{${label}} ${provider.ok ? 1 : 0}`,
      ];
    });
}

function escapeMetricLabel(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/"/g, '\\"');
}

function validateBetInput(input) {
  const errors = [];
  const event = String(input.event || '').trim();
  const odds = Number(input.odds);
  const stake = Number(input.stake);

  if (!event) errors.push('event is required');
  if (!Number.isFinite(odds) || odds <= 1) errors.push('odds must be a number greater than 1');
  if (!Number.isFinite(stake) || stake < 0) errors.push('stake must be a non-negative number');
  if (stake > 1_000_000) errors.push('stake seems unreasonably large');

  if (errors.length > 0) {
    throw new Error(errors.join('; '));
  }

  return { ...input, event, odds, stake };
}

module.exports = { createApp };
