const test = require('node:test');
const assert = require('node:assert/strict');

const { DemoOddsProvider } = require('../src/providers/demo-provider');

test('creates clearly labeled upcoming sample events', async () => {
  const now = new Date('2026-06-21T12:00:00Z');
  const provider = new DemoOddsProvider({ now: () => now });

  const events = await provider.getOdds();

  assert.equal(events.length, 4);
  assert.ok(events.every((event) => new Date(event.startsAt) > now));
  assert.ok(
    events.every((event) =>
      event.bookmakers.every((bookmaker) => bookmaker.name.includes('(sample)')),
    ),
  );
  assert.ok(
    events.every((event) =>
      event.bookmakers.every((bookmaker) =>
        ['home', 'draw', 'away'].every((outcome) =>
          Number.isFinite(bookmaker.markets.h2h[outcome]),
        ),
      ),
    ),
  );
});
