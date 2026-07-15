const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { BankrollManager } = require('../src/bankroll-manager');
const { loadEnvFile } = require('../src/env-loader');
const { MemoryStore, RateLimiter } = require('../src/rate-limiter');
const {
  calculateFractionalKellyStake,
  sizeStakeByConfidence,
  tierPercentages,
} = require('../src/stake-sizer');
const { WebhookManager } = require('../src/webhook-manager');

function tempPath(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  return path.join(dir, 'data.json');
}

test('RateLimiter allows requests until the limit and reports retry time', () => {
  const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 2 });

  assert.equal(limiter.check('127.0.0.1').allowed, true);
  assert.equal(limiter.check('127.0.0.1').allowed, true);

  const blocked = limiter.check('127.0.0.1');
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterMs >= 1);
});

test('RateLimiter cleanup drops expired request buckets', () => {
  const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 2 });
  limiter.requests.set('old-ip', [Date.now() - 5000]);
  limiter.requests.set('active-ip', [Date.now()]);

  limiter.cleanup();

  assert.equal(limiter.requests.has('old-ip'), false);
  assert.equal(limiter.requests.has('active-ip'), true);
});

test('MemoryStore can be injected into a rate limiter', () => {
  const store = new MemoryStore(1000);
  const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 1, store });

  assert.equal(limiter.check('shared-key').allowed, true);
  assert.equal(limiter.check('shared-key').allowed, false);
  assert.equal(limiter.requests, store.requests);
});

test('stake sizing honors confidence tiers and returns tier copies', () => {
  assert.equal(sizeStakeByConfidence(0.10, 'trusted', 1000), 20);
  assert.equal(sizeStakeByConfidence(0.10, 'risky', 1000), 5);
  assert.equal(sizeStakeByConfidence(0.001, 'trusted', 1000), 4);

  const tiers = tierPercentages();
  tiers.trusted = 0.5;
  assert.equal(tierPercentages().trusted, 0.02);
});

test('calculateFractionalKellyStake sizes positive edges and rejects invalid inputs', () => {
  assert.equal(calculateFractionalKellyStake({
    odds: 2,
    fairProbability: 0.6,
    bankroll: 1000,
    fraction: 0.25,
  }), 50);
  assert.equal(calculateFractionalKellyStake({
    odds: 1,
    fairProbability: 0.6,
    bankroll: 1000,
  }), 0);
});

test('loadEnvFile reads key values without overriding existing environment', () => {
  const filePath = tempPath('env-loader').replace(/\.json$/, '.env');
  fs.writeFileSync(filePath, [
    'EXISTING_VALUE=from-file',
    'PLAIN_VALUE=hello',
    'QUOTED_VALUE="hello world"',
    'SINGLE_QUOTED_VALUE=\'hello again\'',
    '# ignored',
    'invalid-line',
  ].join('\n'));

  const oldExisting = process.env.EXISTING_VALUE;
  const keys = ['PLAIN_VALUE', 'QUOTED_VALUE', 'SINGLE_QUOTED_VALUE'];
  process.env.EXISTING_VALUE = 'from-env';
  for (const key of keys) delete process.env[key];

  try {
    loadEnvFile(filePath);

    assert.equal(process.env.EXISTING_VALUE, 'from-env');
    assert.equal(process.env.PLAIN_VALUE, 'hello');
    assert.equal(process.env.QUOTED_VALUE, 'hello world');
    assert.equal(process.env.SINGLE_QUOTED_VALUE, 'hello again');
  } finally {
    if (oldExisting === undefined) delete process.env.EXISTING_VALUE;
    else process.env.EXISTING_VALUE = oldExisting;
    for (const key of keys) delete process.env[key];
  }
});

test('BankrollManager tracks cash movements and bookmaker balances', () => {
  const manager = new BankrollManager({ filePath: tempPath('bankroll-manager') });

  assert.equal(manager.read().currentBankroll, 1000);
  manager.deposit(250, 'top up');
  manager.withdraw(100, 'cash out');
  manager.transferToBookmaker('BookA', 300);
  manager.transferFromBookmaker('BookA', 125);
  manager.setBookmakerBalance('BookB', 50);

  const summary = manager.summary();
  assert.equal(summary.currentBankroll, 975);
  assert.equal(summary.bookmakerBalances.BookA, 175);
  assert.equal(summary.bookmakerBalances.BookB, 50);
  assert.equal(summary.totalInBooks, 225);
  assert.equal(summary.totalAssets, 1200);
  assert.equal(summary.netProfit, 200);
  assert.equal(summary.transactionCount, 4);
});

test('BankrollManager rejects withdrawals or transfers above available cash', () => {
  const manager = new BankrollManager({ filePath: tempPath('bankroll-manager') });

  assert.throws(() => manager.withdraw(1001), /Insufficient funds/);
  assert.throws(() => manager.transferToBookmaker('BookA', 1001), /Insufficient funds/);
});

test('WebhookManager manages webhook records and dispatches filtered alerts', async () => {
  const manager = new WebhookManager({ filePath: tempPath('webhook-manager') });
  const oldFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true };
  };

  try {
    manager.addWebhook('https://example.test/hook', { minEdge: 0.03, label: 'main' });
    manager.addWebhook('https://example.test/hook', { minEdge: 0, label: 'duplicate' });

    assert.equal(manager.readWebhooks().length, 1);

    await manager.dispatch([
      { eventName: 'Small Edge', marketLabel: '1X2', edge: 0.01, profit: 1, confidence: 'review', legs: [] },
      {
        eventName: 'Big Edge',
        marketLabel: 'Goals',
        edge: 0.05,
        profit: 5,
        confidence: 'trusted',
        legs: [{ label: 'Over', bookmaker: 'BookA', price: 2.1 }],
      },
    ]);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://example.test/hook');
    const payload = JSON.parse(calls[0].options.body);
    assert.equal(payload.count, 1);
    assert.equal(payload.opportunities[0].event, 'Big Edge');

    manager.removeWebhook('https://example.test/hook');
    assert.equal(manager.readWebhooks().length, 0);
  } finally {
    global.fetch = oldFetch;
  }
});
