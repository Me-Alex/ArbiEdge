'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

function importFrontendModule(relativePath) {
  const url = pathToFileURL(path.join(__dirname, '..', relativePath));
  url.searchParams.set('test', String(Math.random()));
  return import(url.href);
}

test('ApiClient builds requests and SseStreamClient publishes events', async () => {
  const { ApiClient, SseStreamClient } = await importFrontendModule('public/js/core/api-client.js');
  const previousFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    };
  };

  try {
    const api = new ApiClient({ baseUrl: 'https://example.test' });
    assert.deepEqual(await api.get('/items', { sport: 'football' }), { ok: true });
    assert.equal(calls[0].url, 'https://example.test/items?sport=football');
    assert.equal(calls[0].options.method, 'GET');

    const stream = new SseStreamClient();
    let payload = null;
    const unsubscribe = stream.on('message', (value) => {
      payload = value;
    });
    stream.emit('message', { id: 1 });
    unsubscribe();
    stream.destroy();
    assert.deepEqual(payload, { id: 1 });
  } finally {
    global.fetch = previousFetch;
  }
});

test('EventEmitter and StateStore publish focused state changes', async () => {
  const { EventEmitter, StateStore } = await importFrontendModule('public/js/core/state-store.js');
  const emitter = new EventEmitter();
  let onceValue = null;
  emitter.once('ready', (value) => {
    onceValue = value;
  });
  emitter.emit('ready', 42);
  emitter.emit('ready', 99);
  assert.equal(onceValue, 42);

  const store = new StateStore({ count: 0 });
  const changes = [];
  const unsubscribe = store.subscribe('count', (value, oldValue) => {
    changes.push([oldValue, value]);
  });
  store.setState({ count: 1 });
  unsubscribe();
  store.setState({ count: 2 });

  assert.deepEqual(changes, [[0, 1]]);
  assert.equal(store.get('count'), 2);
});

test('AudioAlertManager manages sound preference without browser audio', async () => {
  const { AudioAlertManager } = await importFrontendModule('public/js/core/audio-alerts.js');
  const manager = new AudioAlertManager({ volume: 2, minIntervalMs: 0 });

  manager.setVolume(2);
  assert.equal(manager.volume, 1);
  assert.equal(manager.toggleSound(false), false);
  assert.equal(manager.isEnabled(), false);
  assert.equal(manager.playChime(), false);
});
