const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BetanoBrowserTransport,
  betanoDetailUrl,
  betanoEventsFromPayload,
  betanoStartDate,
  dedupeBetanoEvents,
  extractBetanoTeams,
  fetchJsonUrlsInPage,
  isBetanoPrematchCandidate,
} = require('../src/providers/betano-browser-transport');
const { BrowserJsonTransport } = require('../src/providers/browser-json-transport');

test('BetanoBrowserTransport exposes configured browser collection settings', () => {
  const transport = new BetanoBrowserTransport({
    headless: false,
    timeoutMs: 1234,
    settleMs: 2345,
    maxEvents: 42,
    detailConcurrency: 2,
    maxResponseBytes: 4096,
  });

  assert.equal(transport.headless, false);
  assert.equal(transport.timeoutMs, 1234);
  assert.equal(transport.settleMs, 2345);
  assert.equal(transport.maxEvents, 42);
  assert.equal(transport.detailConcurrency, 2);
  assert.equal(transport.maxResponseBytes, 4096);
  assert.equal(typeof transport.collect, 'function');
});

test('Betano transport helpers validate identity, kickoff, payload shape, and detail URLs', async () => {
  const payload = {
    data: {
      groups: [{ events: [{
        id: 77,
        url: '/sport/fotbal/league/home-away/77/',
        name: 'Home - Away',
        startTime: 1_800_000_000,
      }] }],
    },
  };
  assert.equal(betanoEventsFromPayload(payload).length, 1);
  assert.equal(dedupeBetanoEvents([
    { url: 'https://ro.betano.com/api/list', payload },
    { url: 'https://ro.betano.com/api/list-2', payload },
  ]).length, 1);
  assert.deepEqual(extractBetanoTeams({
    participants: [
      { role: 'home', name: 'Home' },
      { role: 'away', name: 'Away' },
    ],
  }), ['Home', 'Away']);
  assert.equal(betanoStartDate(1_800_000_000).toISOString(), '2027-01-15T08:00:00.000Z');
  assert.equal(isBetanoPrematchCandidate(payload.data.groups[0].events[0], new Date('2026-01-01')), true);
  assert.equal(isBetanoPrematchCandidate({
    ...payload.data.groups[0].events[0],
    liveNow: true,
  }, new Date('2026-01-01')), false);
  assert.equal(
    betanoDetailUrl('/sport/fotbal/league/home-away/77/'),
    'https://ro.betano.com/api/sport/fotbal/league/home-away/77/',
  );
  assert.equal(betanoDetailUrl('https://attacker.test/odds'), null);

  const records = await fetchJsonUrlsInPage({
    evaluate: async (_callback, { requestUrls }) => requestUrls.map((url) => ({
      url,
      status: 200,
      payload: { ok: true },
    })),
  }, ['https://ro.betano.com/api/a', 'https://ro.betano.com/api/a'], 2);
  assert.equal(records.length, 1);
  assert.deepEqual(records[0].payload, { ok: true });
});

test('BetanoBrowserTransport combines captured lists with bounded detail payloads', async () => {
  const listUrl = 'https://ro.betano.com/api/sports/FOOT/upcoming/events?league=1';
  const eventUrl = '/sport/fotbal/league/home-away/77/';
  const detailUrl = betanoDetailUrl(eventUrl);
  const page = {
    evaluate: async (_callback, input) => {
      if (!input) return [];
      return input.requestUrls.map((url) => ({
        url,
        status: 200,
        payload: {
          data: {
            event: {
              markets: [{ type: 'MRES', selections: [
                { name: '1', price: 2.1 },
                { name: 'X', price: 3.2 },
                { name: '2', price: 3.6 },
              ] }],
            },
          },
        },
      }));
    },
  };
  const collector = {
    captureJson: async ({ afterLoad }) => ({
      result: await afterLoad({
        page,
        records: [{
          url: listUrl,
          payload: { data: { events: [{
            id: 77,
            url: eventUrl,
            name: 'Home - Away',
            startTime: '2027-01-15T08:00:00Z',
            leagueName: 'League',
            markets: [],
          }] } },
        }],
      }),
    }),
  };
  const transport = new BetanoBrowserTransport({
    collector,
    now: () => new Date('2026-01-01T00:00:00Z'),
  });

  const [event] = await transport.collect();
  assert.equal(event.id, 77);
  assert.deepEqual([event.homeTeam, event.awayTeam], ['Home', 'Away']);
  assert.equal(event.markets[0].type, 'MRES');
  assert.deepEqual(event.sourceUrls, [listUrl, detailUrl]);
  assert.equal(event.collectionMethod, 'playwright-network');
});

test('BrowserJsonTransport exposes configured page request settings', () => {
  const transport = new BrowserJsonTransport({
    pageUrl: 'https://example.test/page',
    headless: false,
    timeoutMs: 4321,
  });

  assert.equal(transport.pageUrl, 'https://example.test/page');
  assert.equal(transport.headless, false);
  assert.equal(transport.timeoutMs, 4321);
  assert.equal(transport.requestConcurrency, 4);
  assert.equal(typeof transport.getJson, 'function');
  assert.equal(typeof transport.getJsons, 'function');
});

test('BrowserJsonTransport uses one bounded collector session and preserves response order', async () => {
  let evaluateInput;
  const collector = {
    captureJson: async ({ pageUrl, responsePatterns, settleMs, afterLoad }) => {
      assert.equal(pageUrl, 'https://api.example.test/2');
      assert.equal(responsePatterns[0].test('anything'), false);
      assert.equal(settleMs, 25);
      return {
        result: await afterLoad({
          page: {
            evaluate: async (_callback, input) => {
              evaluateInput = input;
              return input.urlsToFetch.map((url) => ({ ok: true, payload: { url } }));
            },
          },
        }),
      };
    },
  };
  const transport = new BrowserJsonTransport({
    pageUrl: 'https://example.test/page',
    settleMs: 25,
    requestConcurrency: 2,
    collector,
  });

  const payloads = await transport.getJsons([
    'https://api.example.test/2',
    'https://api.example.test/1',
  ], { accept: 'application/json' });
  assert.equal(evaluateInput.concurrency, 2);
  assert.deepEqual(payloads.map((payload) => payload.url), [
    'https://api.example.test/2',
    'https://api.example.test/1',
  ]);
});

test('BrowserJsonTransport fails closed on partial or unsuccessful browser responses', async () => {
  const transport = new BrowserJsonTransport({
    pageUrl: 'https://example.test/page',
    collector: {
      captureJson: async () => ({ result: [{ ok: false, status: 403 }] }),
    },
  });
  await assert.rejects(
    transport.getJsons(['https://example.test/api']),
    /HTTP 403/,
  );
});
