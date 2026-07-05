'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { OddsService } = require('../src/odds-service');
const { DemoOddsProvider } = require('../src/providers/demo-provider');

function makeDemoService() {
  return new OddsService({
    liveProvider: null,
    demoProvider: new DemoOddsProvider(),
    cacheTtlMs: 1000,
  });
}

test('getOddsMovement returns empty when fewer than 2 snapshots', async () => {
  const service = makeDemoService();
  await service.getOdds(); // first snapshot
  const movement = service.getOddsMovement();
  assert.strictEqual(movement.movements.length, 0);
  assert.strictEqual(movement.fetchedAt, null);
});

test('getOddsMovement detects price changes between snapshots', async () => {
  const service = new OddsService({
    liveProvider: {
      name: 'test',
      async getOdds() {
        return {
          events: [
            {
              homeTeam: 'Team A',
              awayTeam: 'Team B',
              startsAt: '2026-07-15T18:00:00Z',
              competition: 'Test',
              bookmakers: [
                {
                  name: 'BookA',
                  markets: { h2h: { home: 2.0, draw: 3.0, away: 4.0 } },
                },
              ],
            },
          ],
          providers: [{ name: 'BookA', ok: true, events: 1 }],
        };
      },
    },
    demoProvider: new DemoOddsProvider(),
    cacheTtlMs: 0, // always refresh
  });

  // First fetch
  await service.getOdds();

  // Change odds and fetch again
  service.liveProvider.getOdds = async () => ({
    events: [
      {
        homeTeam: 'Team A',
        awayTeam: 'Team B',
        startsAt: '2026-07-15T18:00:00Z',
        competition: 'Test',
        bookmakers: [
          {
            name: 'BookA',
            markets: { h2h: { home: 2.2, draw: 3.0, away: 3.8 } },
          },
        ],
      },
    ],
    providers: [{ name: 'BookA', ok: true, events: 1 }],
  });

  service.clearCache();
  await service.getOdds();

  const movement = service.getOddsMovement();
  assert.ok(movement.movements.length >= 2, 'should detect home and away changes');
  assert.ok(movement.fetchedAt, 'should have fetchedAt');
  assert.ok(movement.previousAt, 'should have previousAt');

  const homeMovement = movement.movements.find((m) => m.outcome === 'home');
  assert.ok(homeMovement, 'should have home movement');
  assert.strictEqual(homeMovement.current, 2.2);
  assert.strictEqual(homeMovement.previous, 2.0);
  assert.strictEqual(homeMovement.direction, 'up');

  const awayMovement = movement.movements.find((m) => m.outcome === 'away');
  assert.ok(awayMovement, 'should have away movement');
  assert.strictEqual(awayMovement.current, 3.8);
  assert.strictEqual(awayMovement.previous, 4.0);
  assert.strictEqual(awayMovement.direction, 'down');
});

test('getOddsMovement ignores unchanged odds', async () => {
  const service = new OddsService({
    liveProvider: {
      name: 'test',
      async getOdds() {
        return {
          events: [
            {
              homeTeam: 'Team C',
              awayTeam: 'Team D',
              startsAt: '2026-07-15T18:00:00Z',
              competition: 'Test',
              bookmakers: [
                { name: 'BookA', markets: { h2h: { home: 2.0, draw: 3.0, away: 4.0 } } },
              ],
            },
          ],
          providers: [{ name: 'BookA', ok: true, events: 1 }],
        };
      },
    },
    demoProvider: new DemoOddsProvider(),
    cacheTtlMs: 0,
  });

  await service.getOdds();
  service.clearCache();
  await service.getOdds();

  const movement = service.getOddsMovement();
  assert.strictEqual(movement.movements.length, 0, 'no changes should produce no movements');
});

test('snapshots are capped to maxSnapshots', async () => {
  const service = new OddsService({
    liveProvider: {
      name: 'test',
      async getOdds() {
        return {
          events: [],
          providers: [],
        };
      },
    },
    demoProvider: new DemoOddsProvider(),
    cacheTtlMs: 0,
    maxSnapshots: 3,
  });

  for (let i = 0; i < 5; i++) {
    service.clearCache();
    await service.getOdds();
  }

  assert.strictEqual(service.snapshots.length, 3);
});
