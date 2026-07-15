const fs = require('fs');
const path = require('path');

const testCode = `
// Tests for /api/ai-picks and /api/ai-picks/settle endpoints
// These get appended to app.test.js

test('GET /api/ai-picks returns pick list with status counts', async () => {
  const app = createApp({
    oddsService: { getOdds: () => Promise.resolve({ events: [] }), cache: {} },
    liveConfigured: false,
    logger: { error: () => {}, info: () => {} },
  });

  await withServer(app, async (baseUrl) => {
    const r = await fetch(baseUrl + '/api/ai-picks');
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.ok('total' in body);
    assert.ok('pending' in body);
    assert.ok('settled' in body);
    assert.ok(Array.isArray(body.picks));
  });
});

test('POST /api/ai-picks/settle runs settlement and returns results', async () => {
  const app = createApp({
    oddsService: {
      getOdds: () => Promise.resolve({ events: [] }),
      cache: { value: { events: [] } },
      snapshots: [],
    },
    liveConfigured: false,
    logger: { error: () => {}, info: () => {} },
  });

  await withServer(app, async (baseUrl) => {
    const r = await fetch(baseUrl + '/api/ai-picks/settle', { method: 'POST' });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.ok('settled' in body);
    assert.ok('reviewed' in body);
    assert.ok('unchanged' in body);
    assert.ok('total' in body);
  });
});
`;

// Read existing app.test.js
const testPath = path.join(__dirname, '..', 'test', 'app.test.js');
const existing = fs.readFileSync(testPath, 'utf8');

// Check if already added
if (existing.includes('GET /api/ai-picks returns pick list')) {
  console.log('Already present — skipping');
  process.exit(0);
}

// Append before the final closing
const updated = existing + '\n' + testCode;
fs.writeFileSync(testPath, updated, 'utf8');
console.log('Appended AI pick endpoint tests to ' + testPath);
