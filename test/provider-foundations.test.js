'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { BaseProvider } = require('../src/providers/base-provider');
const { ProxyTransport } = require('../src/providers/transports/proxy-transport');

test('BaseProvider normalizes events and records successful fetch metrics', async () => {
  class TestProvider extends BaseProvider {
    async fetchAndNormalizeOdds() {
      return [this.normalizeEvent({
        id: 'event-1',
        homeTeam: 'Home',
        awayTeam: 'Away',
        competition: 'League',
      })];
    }
  }

  const provider = new TestProvider({ name: 'Test Book', domain: 'example.test' });
  const events = await provider.getOdds();

  assert.equal(events[0].id, 'test_book:event-1');
  assert.equal(events[0].homeTeam, 'Home');
  assert.equal(provider.metrics.totalFetches, 1);
  assert.equal(provider.metrics.successfulFetches, 1);
  assert.equal(provider.metrics.lastEventCount, 1);
});

test('BaseProvider rejects incomplete configuration and abstract fetches', async () => {
  assert.throws(() => new BaseProvider({ name: 'Missing domain' }), /requires both/);

  const provider = new BaseProvider({ name: 'Abstract', domain: 'example.test' });
  await assert.rejects(provider.getOdds(), /must be implemented/);
  assert.equal(provider.metrics.failedFetches, 1);
});

test('ProxyTransport applies defaults and returns JSON responses', async () => {
  const previousFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      json: async () => ({ events: 2 }),
    };
  };

  try {
    const transport = new ProxyTransport({ userAgents: ['test-agent'], timeoutMs: 500 });
    const payload = await transport.fetchJson('https://example.test/odds', {
      headers: { 'X-Test': 'yes' },
    });

    assert.deepEqual(payload, { events: 2 });
    assert.equal(transport.requestCount, 1);
    assert.equal(calls[0].options.headers['User-Agent'], 'test-agent');
    assert.equal(calls[0].options.headers['X-Test'], 'yes');
  } finally {
    global.fetch = previousFetch;
  }
});
