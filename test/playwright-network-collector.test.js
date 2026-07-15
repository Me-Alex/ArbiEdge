'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PlaywrightNetworkCollector,
  matchesAny,
  readJsonResponse,
} = require('../src/providers/playwright-network-collector');

function jsonResponse({
  url = 'https://example.test/api/odds',
  status = 200,
  headers = { 'content-type': 'application/json' },
  payload = { events: [{ id: '1' }] },
  body,
} = {}) {
  const response = {
    url: () => url,
    status: () => status,
    allHeaders: async () => headers,
    json: async () => payload,
  };
  if (body !== undefined) response.body = async () => Buffer.from(body);
  return response;
}

test('matchesAny supports string and regular-expression response filters', () => {
  assert.equal(matchesAny('https://example.test/api/odds', ['/api/odds']), true);
  assert.equal(matchesAny('https://example.test/api/odds', [/\/api\/odds$/]), true);
  assert.equal(matchesAny('https://example.test/assets/app.js', ['/api/odds']), false);
});

test('readJsonResponse accepts bounded JSON and rejects invalid response metadata', async () => {
  const record = await readJsonResponse(jsonResponse(), { maxResponseBytes: 1024 });
  assert.equal(record.status, 200);
  assert.equal(record.byteLength > 0, true);
  assert.deepEqual(record.payload, { events: [{ id: '1' }] });

  assert.equal(await readJsonResponse(jsonResponse({ status: 500 }), { maxResponseBytes: 1024 }), null);
  assert.equal(await readJsonResponse(jsonResponse({
    headers: { 'content-type': 'application/json', 'content-length': '2048' },
  }), { maxResponseBytes: 1024 }), null);
  assert.equal(await readJsonResponse(jsonResponse({
    headers: { 'content-type': 'text/html' },
  }), { maxResponseBytes: 1024 }), null);
  assert.deepEqual((await readJsonResponse(jsonResponse({
    headers: { 'content-type': 'text/plain' },
    body: '{"events":[{"id":"2"}]}',
  }), { maxResponseBytes: 1024 })).payload, { events: [{ id: '2' }] });
  assert.equal(await readJsonResponse(jsonResponse({
    body: '{"oversized":true}',
  }), { maxResponseBytes: 4 }), null);
});

test('PlaywrightNetworkCollector bounds aggregate bytes while allowing repeated API URLs', async () => {
  let responseHandler;
  const page = {
    route: async () => {},
    on: (_event, handler) => { responseHandler = handler; },
    off: () => {},
    goto: async () => {
      responseHandler(jsonResponse({ body: '{"id":1}' }));
      responseHandler(jsonResponse({ body: '{"id":2}' }));
    },
    waitForLoadState: async () => {},
    waitForTimeout: async () => {},
  };
  const collector = new PlaywrightNetworkCollector({
    settleMs: 0,
    maxTotalResponseBytes: Buffer.byteLength('{"id":1}'),
    launchBrowser: async () => ({
      newContext: async () => ({ newPage: async () => page, close: async () => {} }),
      close: async () => {},
    }),
  });

  const capture = await collector.captureJson({
    pageUrl: 'https://example.test/sports',
    responsePatterns: ['/api/odds'],
  });
  assert.equal(capture.records.length, 1);
});

test('PlaywrightNetworkCollector captures matching JSON and closes its browser session', async () => {
  let responseHandler;
  let contextClosed = false;
  let browserClosed = false;
  let routeInstalled = false;
  const response = jsonResponse();
  const page = {
    route: async () => { routeInstalled = true; },
    on: (event, handler) => { if (event === 'response') responseHandler = handler; },
    off: () => {},
    goto: async () => { responseHandler(response); },
    waitForLoadState: async () => {},
    waitForTimeout: async () => {},
  };
  const context = {
    newPage: async () => page,
    close: async () => { contextClosed = true; },
  };
  const browser = {
    newContext: async () => context,
    close: async () => { browserClosed = true; },
  };
  const collector = new PlaywrightNetworkCollector({
    settleMs: 0,
    launchBrowser: async () => browser,
  });

  const capture = await collector.captureJson({
    pageUrl: 'https://example.test/sports',
    responsePatterns: ['/api/odds'],
    afterLoad: async ({ records }) => records[0].payload.events.length,
  });

  assert.equal(routeInstalled, true);
  assert.equal(capture.records.length, 1);
  assert.equal(capture.result, 1);
  assert.equal(contextClosed, true);
  assert.equal(browserClosed, true);
});

test('PlaywrightNetworkCollector rejects non-public page protocols before launching', async () => {
  const collector = new PlaywrightNetworkCollector({
    launchBrowser: async () => { throw new Error('should not launch'); },
  });
  await assert.rejects(
    collector.captureJson({ pageUrl: 'file:///tmp/odds.html' }),
    /HTTP\(S\)/,
  );
});
