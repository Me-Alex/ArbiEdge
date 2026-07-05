const test = require('node:test');
const assert = require('node:assert/strict');

const { DemoOddsProvider } = require('../src/providers/demo-provider');

test('creates clearly labeled upcoming sample events', async () => {
  const now = new Date('2026-06-21T12:00:00Z');
  const provider = new DemoOddsProvider({ now: () => now });

  const events = await provider.getOdds();

  assert.equal(events.length, 12);
  assert.ok(events.every((event) => new Date(event.startsAt) > now));
  assert.ok(
    events.every((event) =>
      event.bookmakers.every((bookmaker) => bookmaker.name.includes('(sample)')),
    ),
  );

  // Football events have 3-way h2h (home, draw, away)
  const footballEvents = events.filter((e) => e.sport === 'Football');
  assert.ok(footballEvents.length === 8);
  assert.ok(
    footballEvents.every((event) =>
      event.bookmakers.every((bookmaker) =>
        ['home', 'draw', 'away'].every((outcome) =>
          Number.isFinite(bookmaker.markets.h2h[outcome]),
        ),
      ),
    ),
  );
  assert.ok(
    footballEvents.every((event) =>
      event.bookmakers.every(
        (bookmaker) =>
          Number.isFinite(bookmaker.markets.drawNoBet.home) &&
          Number.isFinite(bookmaker.markets.drawNoBet.away),
      ),
    ),
  );
  assert.ok(
    footballEvents.every((event) =>
      event.bookmakers.every(
        (bookmaker) =>
          Number.isFinite(bookmaker.markets.secondHalfH2h.home) &&
          Number.isFinite(bookmaker.markets.asianHandicap_plus_0_5.home) &&
          Number.isFinite(bookmaker.markets.asianHandicap_plus_1.home) &&
          Number.isFinite(bookmaker.markets.market_marcheaza_home.yes) &&
          Number.isFinite(bookmaker.markets.market_clean_sheet_home.yes) &&
          Number.isFinite(bookmaker.markets.totalCorners_9.over) &&
          Number.isFinite(bookmaker.markets.totalCards_4.under),
      ),
    ),
  );

  // 2-way sports (basketball, tennis) have h2h with only home/away
  const twoWayEvents = events.filter((e) => e.sport === 'Basketball' || e.sport === 'Tennis');
  assert.ok(twoWayEvents.length === 4);
  assert.ok(
    twoWayEvents.every((event) =>
      event.bookmakers.every((bookmaker) =>
        Number.isFinite(bookmaker.markets.h2h.home) &&
        Number.isFinite(bookmaker.markets.h2h.away) &&
        bookmaker.markets.h2h.draw === undefined,
      ),
    ),
  );
  // 2-way sports should not have drawNoBet or doubleChance
  assert.ok(
    twoWayEvents.every((event) =>
      event.bookmakers.every((bookmaker) =>
        bookmaker.markets.drawNoBet === undefined &&
        bookmaker.markets.doubleChance === undefined,
      ),
    ),
  );
});
