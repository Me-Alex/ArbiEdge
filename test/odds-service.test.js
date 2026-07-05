const test = require('node:test');
const assert = require('node:assert/strict');

const { OddsService } = require('../src/odds-service');

const demoEvents = [{ id: 'demo-1' }];
const liveEvents = [{ id: 'live-1' }];

test('uses demo mode when no live provider is configured', async () => {
  const service = new OddsService({
    demoProvider: { getOdds: async () => demoEvents },
    now: () => new Date('2026-06-21T12:00:00Z'),
  });

  const result = await service.getOdds();

  assert.deepEqual(result, {
    mode: 'demo',
    source: 'Built-in demo data',
    fetchedAt: '2026-06-21T12:00:00.000Z',
    warning:
      'Sample prices only; they are not live bookmaker quotes. Set ODDS_API_KEY to load live odds.',
    events: demoEvents,
  });
});

test('uses live mode when the live provider succeeds', async () => {
  const service = new OddsService({
    liveProvider: {
      name: 'Fortuna',
      getOdds: async () => liveEvents,
    },
    demoProvider: { getOdds: async () => demoEvents },
    now: () => new Date('2026-06-21T12:00:00Z'),
  });

  const result = await service.getOdds();

  assert.equal(result.mode, 'live');
  assert.equal(result.source, 'Fortuna');
  assert.equal(result.warning, null);
  assert.deepEqual(result.events, liveEvents);
});

test('reports cache and refresh diagnostics without triggering a refresh', async () => {
  let calls = 0;
  let currentTime = new Date('2026-06-21T12:00:00Z');
  const service = new OddsService({
    liveProvider: {
      name: 'Fortuna',
      getOdds: async () => {
        calls += 1;
        return {
          events: liveEvents,
          providers: [
            { name: 'Fortuna', ok: true, events: 1, durationMs: 420 },
            { name: 'SlowBook', ok: true, events: 2, durationMs: 1800 },
          ],
        };
      },
    },
    demoProvider: { getOdds: async () => demoEvents },
    cacheTtlMs: 60_000,
    now: () => currentTime,
  });

  assert.deepEqual(service.diagnostics(), {
    mode: 'live',
    provider: 'Fortuna',
    cache: {
      fresh: false,
      ageMs: null,
      ttlMs: 60_000,
      expiresInMs: 0,
    },
    inFlight: false,
    lastRefresh: null,
  });
  assert.equal(calls, 0);

  await service.getOdds();
  currentTime = new Date('2026-06-21T12:00:30Z');

  assert.deepEqual(service.diagnostics(), {
    mode: 'live',
    provider: 'Fortuna',
    cache: {
      fresh: true,
      ageMs: 30_000,
      ttlMs: 60_000,
      expiresInMs: 30_000,
    },
    inFlight: false,
    lastRefresh: {
      status: 'live',
      at: '2026-06-21T12:00:00.000Z',
      events: 1,
      providers: 2,
      failedProviders: 0,
      durationMs: 2220,
      slowProviders: [
        { name: 'SlowBook', ok: true, events: 2, durationMs: 1800 },
        { name: 'Fortuna', ok: true, events: 1, durationMs: 420 },
      ],
      audit: {
        status: 'ok',
        warning: null,
        issueCounts: {
          invalidOdds: 0,
          doubleChanceViolations: 0,
          drawNoBetViolations: 0,
          totalLineMonotonicity: 0,
          sameBookUnderround: 0,
          sameBookHighOverround: 0,
          crossBookOutliers: 0,
          highOdds: 0,
        },
      },
      warning: null,
      error: null,
    },
  });
});

test('includes live odds audit results and warning details', async () => {
  const service = new OddsService({
    liveProvider: {
      name: 'Fortuna',
      getOdds: async () => [{
        id: 'live-1',
        homeTeam: 'Home',
        awayTeam: 'Away',
        startsAt: '2026-06-21T12:00:00.000Z',
        bookmakers: [{
          name: 'Fortuna',
          markets: {
            h2h: { home: 1.4, draw: 4.5, away: 8 },
            doubleChance: { homeDraw: 1.2, homeAway: 1.8, drawAway: 1.1 },
          },
        }],
      }],
    },
    demoProvider: { getOdds: async () => demoEvents },
    now: () => new Date('2026-06-21T12:00:00Z'),
  });

  const result = await service.getOdds();

  assert.equal(result.mode, 'live');
  assert.equal(result.audit.status, 'warning');
  assert.equal(result.audit.issueCounts.doubleChanceViolations, 1);
  assert.match(result.warning, /Odds audit flagged/);
  assert.deepEqual(service.diagnostics().lastRefresh.audit, {
    status: 'warning',
    warning: result.audit.warning,
    issueCounts: result.audit.issueCounts,
  });
});

test('falls back to demo mode when the live provider fails', async () => {
  const service = new OddsService({
    liveProvider: {
      name: 'Fortuna',
      getOdds: async () => {
        throw new Error('upstream unavailable');
      },
    },
    demoProvider: { getOdds: async () => demoEvents },
    now: () => new Date('2026-06-21T12:00:00Z'),
  });

  const result = await service.getOdds();

  assert.equal(result.mode, 'demo');
  assert.match(result.warning, /upstream unavailable/);
  assert.deepEqual(result.events, demoEvents);
  assert.equal(service.diagnostics().lastRefresh.status, 'fallback');
  assert.match(service.diagnostics().lastRefresh.warning, /upstream unavailable/);
});

test('returns partial provider warnings from a composite live provider', async () => {
  const service = new OddsService({
    liveProvider: {
      name: 'Romanian bookmakers',
      getOdds: async () => ({
        events: liveEvents,
        providers: [
          { name: 'Fortuna', ok: true, events: 1 },
          { name: 'Betano', ok: false, events: 0, error: 'challenge' },
        ],
      }),
    },
    demoProvider: { getOdds: async () => demoEvents },
    now: () => new Date('2026-06-21T12:00:00Z'),
  });

  const result = await service.getOdds();

  assert.equal(result.mode, 'live');
  assert.match(result.warning, /Betano: challenge/);
  assert.deepEqual(result.providers[0], {
    name: 'Fortuna',
    ok: true,
    events: 1,
  });
});

test('streams live odds snapshots from a progressive live provider', async () => {
  let resolveSecond;
  const secondReady = new Promise((resolve) => {
    resolveSecond = resolve;
  });
  const service = new OddsService({
    liveProvider: {
      name: 'Romanian bookmakers',
      totalProviders: 2,
      async *getOddsProgress() {
        yield {
          events: liveEvents,
          providers: [{ name: 'Fortuna', ok: true, events: 1 }],
          progress: { done: 1, total: 2, complete: false },
        };
        await secondReady;
        yield {
          events: liveEvents,
          providers: [
            { name: 'Fortuna', ok: true, events: 1 },
            { name: 'Superbet', ok: true, events: 1 },
          ],
          progress: { done: 2, total: 2, complete: true },
        };
      },
    },
    demoProvider: { getOdds: async () => demoEvents },
    now: () => new Date('2026-06-21T12:00:00Z'),
  });

  const iterator = service.streamOdds();
  const initial = await iterator.next();
  assert.equal(initial.done, false);
  assert.deepEqual(initial.value.progress, { done: 0, total: 2, complete: false });
  assert.deepEqual(initial.value.events, []);

  const first = await iterator.next();
  assert.equal(first.done, false);
  assert.deepEqual(first.value.progress, { done: 1, total: 2, complete: false });
  assert.deepEqual(first.value.providers, [{ name: 'Fortuna', ok: true, events: 1 }]);

  resolveSecond();
  const second = await iterator.next();
  assert.equal(second.done, false);
  assert.deepEqual(second.value.progress, { done: 2, total: 2, complete: true });
  assert.equal(second.value.providers.length, 2);
});

test('reuses cached results until the TTL expires', async () => {
  let calls = 0;
  let currentTime = new Date('2026-06-21T12:00:00Z');
  const service = new OddsService({
    liveProvider: {
      name: 'Fortuna',
      getOdds: async () => {
        calls += 1;
        return liveEvents;
      },
    },
    demoProvider: { getOdds: async () => demoEvents },
    cacheTtlMs: 60_000,
    now: () => currentTime,
  });

  const first = await service.getOdds();
  currentTime = new Date('2026-06-21T12:00:30Z');
  const second = await service.getOdds();
  currentTime = new Date('2026-06-21T12:01:01Z');
  const third = await service.getOdds();

  assert.strictEqual(second, first);
  assert.notStrictEqual(third, first);
  assert.equal(calls, 2);
});

test('coalesces concurrent refresh requests', async () => {
  let resolveLive;
  let calls = 0;
  const livePromise = new Promise((resolve) => {
    resolveLive = resolve;
  });
  const service = new OddsService({
    liveProvider: {
      name: 'Fortuna',
      getOdds: async () => {
        calls += 1;
        return livePromise;
      },
    },
    demoProvider: { getOdds: async () => demoEvents },
  });

  const firstRequest = service.getOdds();
  const secondRequest = service.getOdds();
  resolveLive(liveEvents);

  const [first, second] = await Promise.all([firstRequest, secondRequest]);

  assert.strictEqual(second, first);
  assert.equal(calls, 1);
});
