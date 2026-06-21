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
