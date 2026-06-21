const test = require('node:test');
const assert = require('node:assert/strict');

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
    oddsService: { getOdds: async () => ({ events: [] }) },
    liveConfigured: false,
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: 'ok',
      provider: 'demo',
    });
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
    assert.match(html, /Odds dashboard/i);
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
