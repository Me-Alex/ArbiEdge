const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../src/app');

async function withServer(app, callback) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();

  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test('reports application health and configured provider mode', async () => {
  const app = createApp({
    oddsService: {
      getOdds: async () => ({ events: [] }),
      diagnostics: () => ({
        mode: 'demo',
        cache: { fresh: false, ageMs: null, ttlMs: 60000, expiresInMs: 0 },
        inFlight: false,
      }),
    },
    liveConfigured: false,
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: 'ok',
      provider: 'demo',
      diagnostics: {
        mode: 'demo',
        cache: { fresh: false, ageMs: null, ttlMs: 60000, expiresInMs: 0 },
        inFlight: false,
      },
    });
  });
});

test('reports readiness without triggering bookmaker requests', async () => {
  let oddsCalls = 0;
  const app = createApp({
    oddsService: {
      getOdds: async () => {
        oddsCalls += 1;
        return { events: [] };
      },
      diagnostics: () => ({
        mode: 'live',
        cache: { fresh: true, ageMs: 1000, ttlMs: 60000, expiresInMs: 59000 },
        inFlight: false,
        lastRefresh: { status: 'live', events: 4 },
      }),
    },
    liveConfigured: true,
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/readiness`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: 'ready',
      reason: 'fresh odds cache available',
      diagnostics: {
        mode: 'live',
        cache: { fresh: true, ageMs: 1000, ttlMs: 60000, expiresInMs: 59000 },
        inFlight: false,
        lastRefresh: { status: 'live', events: 4 },
      },
    });
    assert.equal(oddsCalls, 0);
  });
});

test('reports warming readiness before the first odds refresh', async () => {
  const app = createApp({
    oddsService: {
      diagnostics: () => ({
        mode: 'live',
        cache: { fresh: false, ageMs: null, ttlMs: 60000, expiresInMs: 0 },
        inFlight: false,
        lastRefresh: null,
      }),
    },
    liveConfigured: true,
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/readiness`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      status: 'warming',
      reason: 'waiting for first odds refresh',
      diagnostics: {
        mode: 'live',
        cache: { fresh: false, ageMs: null, ttlMs: 60000, expiresInMs: 0 },
        inFlight: false,
        lastRefresh: null,
      },
    });
  });
});

test('reports plain text operational metrics from diagnostics', async () => {
  const app = createApp({
    oddsService: {
      diagnostics: () => ({
        mode: 'live',
        cache: { fresh: true, ageMs: 1500, ttlMs: 60000, expiresInMs: 58500 },
        inFlight: false,
        lastRefresh: {
          status: 'live',
          events: 42,
          providers: 6,
          failedProviders: 1,
          durationMs: 2345,
          slowProviders: [
            { name: 'Casa "Pariurilor"', ok: true, events: 346, durationMs: 1450 },
            { name: 'Fortuna\\Live', ok: false, events: 0, durationMs: 780 },
          ],
          audit: {
            status: 'warning',
            issueCounts: {
              invalidOdds: 2,
              doubleChanceViolations: 1,
              drawNoBetViolations: 0,
              totalLineMonotonicity: 0,
              sameBookUnderround: 1,
              sameBookHighOverround: 3,
              highOdds: 0,
              impossibleLineMarkets: 0,
              fidelityMismatches: 0,
            },
          },
        },
      }),
    },
    liveConfigured: true,
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/metrics`);
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/plain/);
    assert.match(text, /^odds_ready 1$/m);
    assert.match(text, /^odds_cache_fresh 1$/m);
    assert.match(text, /^odds_cache_age_ms 1500$/m);
    assert.match(text, /^odds_last_refresh_events 42$/m);
    assert.match(text, /^odds_last_refresh_failed_providers 1$/m);
    assert.match(text, /^odds_last_refresh_duration_ms 2345$/m);
    assert.match(text, /^odds_last_refresh_live 1$/m);
    assert.match(text, /^odds_last_refresh_fallback 0$/m);
    assert.match(text, /^odds_last_refresh_error 0$/m);
    assert.match(text, /^odds_audit_warning 1$/m);
    assert.match(text, /^odds_audit_review 0$/m);
    assert.match(text, /^odds_audit_issues_total 7$/m);
    assert.match(text, /^odds_audit_invalid_odds 2$/m);
    assert.match(text, /^odds_audit_double_chance_violations 1$/m);
    assert.match(text, /^odds_audit_draw_no_bet_violations 0$/m);
    assert.match(text, /^odds_audit_total_line_monotonicity 0$/m);
    assert.match(text, /^odds_audit_same_book_underround 1$/m);
    assert.match(text, /^odds_audit_same_book_high_overround 3$/m);
    assert.match(text, /^odds_audit_high_odds 0$/m);
    assert.match(text, /^odds_audit_impossible_line_markets 0$/m);
    assert.match(text, /^odds_audit_fidelity_mismatches 0$/m);
    assert.match(text, /^odds_slow_provider_duration_ms\{name="Casa \\"Pariurilor\\""\} 1450$/m);
    assert.match(text, /^odds_slow_provider_events\{name="Casa \\"Pariurilor\\""\} 346$/m);
    assert.match(text, /^odds_slow_provider_ok\{name="Casa \\"Pariurilor\\""\} 1$/m);
    assert.match(text, /^odds_slow_provider_duration_ms\{name="Fortuna\\\\Live"\} 780$/m);
    assert.match(text, /^odds_slow_provider_events\{name="Fortuna\\\\Live"\} 0$/m);
    assert.match(text, /^odds_slow_provider_ok\{name="Fortuna\\\\Live"\} 0$/m);
  });
});

test('reports warming metrics before the first odds refresh', async () => {
  const app = createApp({
    oddsService: {
      diagnostics: () => ({
        mode: 'live',
        cache: { fresh: false, ageMs: null, ttlMs: 60000, expiresInMs: 0 },
        inFlight: false,
        lastRefresh: null,
      }),
    },
    liveConfigured: true,
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/metrics`);
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.match(text, /^odds_ready 0$/m);
    assert.match(text, /^odds_cache_fresh 0$/m);
    assert.match(text, /^odds_last_refresh_events 0$/m);
    assert.match(text, /^odds_last_refresh_live 0$/m);
    assert.match(text, /^odds_last_refresh_fallback 0$/m);
    assert.match(text, /^odds_last_refresh_error 0$/m);
    assert.match(text, /^odds_audit_issues_total 0$/m);
    assert.match(text, /^odds_audit_invalid_odds 0$/m);
  });
});

test('returns normalized odds from the injected service', async () => {
  const payload = { mode: 'demo', events: [{ id: 'event-1' }] };
  const app = createApp({
    oddsService: { getOdds: async () => payload },
    liveConfigured: false,
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/odds`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), payload);
  });
});

test('streams odds snapshots as newline-delimited JSON', async () => {
  let clears = 0;
  const app = createApp({
    oddsService: {
      clearCache: () => {
        clears += 1;
      },
      async *streamOdds() {
        yield {
          mode: 'live',
          events: [{ id: 'event-1' }],
          providers: [{ name: 'Fortuna', ok: true, events: 1 }],
          progress: { done: 1, total: 2, complete: false },
        };
        yield {
          mode: 'live',
          events: [{ id: 'event-1' }, { id: 'event-2' }],
          providers: [
            { name: 'Fortuna', ok: true, events: 1 },
            { name: 'Superbet', ok: true, events: 1 },
          ],
          progress: { done: 2, total: 2, complete: true },
        };
      },
    },
    liveConfigured: true,
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/odds/stream?refresh=1`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /application\/x-ndjson/);

    const lines = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(clears, 1);
    assert.equal(lines.length, 2);
    assert.deepEqual(lines[0].progress, { done: 1, total: 2, complete: false });
    assert.deepEqual(lines[1].progress, { done: 2, total: 2, complete: true });
    assert.equal(lines[1].events.length, 2);
  });
});

test('returns bookmaker coverage from the configured registry', async () => {
  const app = createApp({
    oddsService: { getOdds: async () => ({ events: [] }) },
    liveConfigured: false,
    bookmakerCoverage: [
      {
        name: 'Implemented',
        domain: 'implemented.test',
        status: 'direct',
        adapter: 'ImplementedProvider',
      },
      {
        name: 'Remaining',
        domain: 'remaining.test',
        status: 'remainingProvider',
        note: 'Needs endpoint discovery.',
      },
    ],
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/bookmakers`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      total: 2,
      active: 1,
      remaining: 1,
      counts: {
        direct: 1,
        browserOptional: 0,
        remainingProvider: 1,
        needsTriage: 0,
        notSportsbook: 0,
        inactive: 0,
        temporarilyUnavailable: 0,
      },
      entries: [
        {
          name: 'Implemented',
          domain: 'implemented.test',
          status: 'direct',
          adapter: 'ImplementedProvider',
        },
        {
          name: 'Remaining',
          domain: 'remaining.test',
          status: 'remainingProvider',
          note: 'Needs endpoint discovery.',
        },
      ],
    });
  });
});

test('appends AI pick events to a local JSONL log', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'odds-ai-picks-'));
  const aiPickLogPath = path.join(tempDir, 'ai-picks.jsonl');
  const app = createApp({
    oddsService: { getOdds: async () => ({ events: [] }) },
    liveConfigured: false,
    aiPickLogPath,
  });

  await withServer(app, async (baseUrl) => {
    const created = await fetch(`${baseUrl}/api/ai-picks/log`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'created',
        entry: {
          id: 'journal-ai-1',
          type: 'ai-value',
          match: 'Romania vs Brazil',
          bookmaker: 'DemoBook',
          odds: 2.2,
        },
      }),
    });
    assert.equal(created.status, 201);

    const settled = await fetch(`${baseUrl}/api/ai-picks/log`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'settled',
        entry: {
          id: 'journal-ai-1',
          type: 'ai-value',
          result: 'won',
          actualProfit: 120,
        },
      }),
    });
    assert.equal(settled.status, 201);
  });

  const records = fs.readFileSync(aiPickLogPath, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(records.length, 2);
  assert.equal(records[0].action, 'created');
  assert.equal(records[0].entry.match, 'Romania vs Brazil');
  assert.equal(records[1].action, 'settled');
  assert.equal(records[1].entry.result, 'won');
});

test('creates server-backed bets with closing odds intact', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'odds-bets-'));
  const betLogPath = path.join(tempDir, 'bets.jsonl');
  const app = createApp({
    oddsService: { getOdds: async () => ({ events: [] }) },
    liveConfigured: false,
    betLogPath,
  });

  await withServer(app, async (baseUrl) => {
    const created = await fetch(`${baseUrl}/api/bets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        event: 'Romania vs Brazil',
        market: '1X2',
        selection: 'Romania',
        odds: 2.3,
        stake: 100,
        closingOdds: '2.12',
      }),
    });
    assert.equal(created.status, 201);
    const createdBet = await created.json();
    assert.equal(createdBet.closingOdds, 2.12);

    const listed = await fetch(`${baseUrl}/api/bets`);
    const payload = await listed.json();
    assert.equal(payload.bets.length, 1);
    assert.equal(payload.bets[0].closingOdds, 2.12);
  });
});

test('imports journal CSV rows into server-backed bets', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'odds-bets-import-'));
  const betLogPath = path.join(tempDir, 'bets.jsonl');
  const app = createApp({
    oddsService: { getOdds: async () => ({ events: [] }) },
    liveConfigured: false,
    betLogPath,
  });

  await withServer(app, async (baseUrl) => {
    const csv = [
      'ID,Event,Market,Selection,Bookmaker,Odds,Stake,Status,Type,Saved',
      'csv-1,Romania vs Brazil,1X2,Romania,Fortuna,2.5,100,won,manual,2026-01-02T00:00:00.000Z',
    ].join('\n');
    const imported = await fetch(`${baseUrl}/api/bets/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ csv }),
    });

    assert.equal(imported.status, 201);
    const importPayload = await imported.json();
    assert.equal(importPayload.imported, 1);
    assert.equal(importPayload.bets[0].status, 'won');
    assert.equal(importPayload.bets[0].netProfitAfterTax, 150);

    const listed = await fetch(`${baseUrl}/api/bets`);
    const payload = await listed.json();
    assert.equal(payload.bets.length, 1);
    assert.equal(payload.bets[0].id, 'csv-1');
    assert.equal(payload.bets[0].status, 'won');
  });
});

test('rate limits write endpoints', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'odds-bets-rate-'));
  const betLogPath = path.join(tempDir, 'bets.jsonl');
  let checks = 0;
  const app = createApp({
    oddsService: { getOdds: async () => ({ events: [] }) },
    liveConfigured: false,
    betLogPath,
    writeRateLimiter: {
      check: () => {
        checks += 1;
        return checks === 1
          ? { allowed: true, retryAfterMs: 0 }
          : { allowed: false, retryAfterMs: 2500 };
      },
    },
  });

  await withServer(app, async (baseUrl) => {
    const body = {
      event: 'Romania vs Brazil',
      market: '1X2',
      selection: 'Romania',
      odds: 2.3,
      stake: 100,
    };
    const first = await fetch(`${baseUrl}/api/bets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(first.status, 201);

    const second = await fetch(`${baseUrl}/api/bets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(second.status, 429);
    assert.equal(second.headers.get('retry-after'), '3');
    assert.deepEqual(await second.json(), {
      error: 'Write rate limited',
      retryAfterMs: 2500,
    });
  });
});

test('clears the service cache when refresh=1 is requested', async () => {
  let clears = 0;
  const app = createApp({
    oddsService: {
      clearCache: () => {
        clears += 1;
      },
      getOdds: async () => ({ events: [] }),
    },
    liveConfigured: false,
  });

  await withServer(app, async (baseUrl) => {
    await fetch(`${baseUrl}/api/odds?refresh=1`);
    assert.equal(clears, 1);
  });
});

test('serves the dashboard HTML', async () => {
  const app = createApp({
    oddsService: { getOdds: async () => ({ events: [] }) },
    liveConfigured: false,
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(baseUrl);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.match(html, /Arb Desk/i);
  });
});

test('serves the dashboard HTML for frontend page routes', async () => {
  const app = createApp({
    oddsService: { getOdds: async () => ({ events: [] }) },
    liveConfigured: false,
  });

  await withServer(app, async (baseUrl) => {
    for (const route of ['/scanner', '/value', '/ai', '/calculator', '/journal', '/bookmakers', '/matches']) {
      const response = await fetch(`${baseUrl}${route}`);
      const html = await response.text();
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /text\/html/);
      assert.match(html, /Arb desk/i);
    }
  });
});

test('returns structured JSON for unknown API routes', async () => {
  const app = createApp({
    oddsService: { getOdds: async () => ({ events: [] }) },
    liveConfigured: false,
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/missing`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: 'API route not found',
    });
  });
});

test('returns structured JSON when the odds service fails unexpectedly', async () => {
  const app = createApp({
    oddsService: {
      getOdds: async () => {
        throw new Error('unexpected');
      },
    },
    liveConfigured: false,
    logger: { error: () => {} },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/odds`);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: 'Unable to load odds',
    });
  });
});


// Tests for /api/ai-picks and /api/ai-picks/settle endpoints
// These get appended to app.test.js

test('GET /api/ai-picks returns pick list with status counts', async () => {
  const app = createApp({
    oddsService: { getOdds: () => Promise.resolve({ events: [] }), cache: {} },
    liveConfigured: false,
    logger: { error: () => {}, info: () => {} },
  });

  await withServer(app, async (baseUrl) => {
    const r = await fetch(baseUrl + '/api/ai-picks');
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.ok('total' in body);
    assert.ok('pending' in body);
    assert.ok('settled' in body);
    assert.ok(Array.isArray(body.picks));
  });
});

test('POST /api/ai-picks/settle runs settlement and returns results', async () => {
  const app = createApp({
    oddsService: {
      getOdds: () => Promise.resolve({ events: [] }),
      cache: { value: { events: [] } },
      snapshots: [],
    },
    liveConfigured: false,
    logger: { error: () => {}, info: () => {} },
  });

  await withServer(app, async (baseUrl) => {
    const r = await fetch(baseUrl + '/api/ai-picks/settle', { method: 'POST' });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.ok('settled' in body);
    assert.ok('reviewed' in body);
    assert.ok('unchanged' in body);
    assert.ok('total' in body);
  });
});
