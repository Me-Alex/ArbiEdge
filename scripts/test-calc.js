const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { createApp } = require('../src/app');
const { OddsService } = require('../src/odds-service');
const { DemoOddsProvider } = require('../src/providers/demo-provider');
const {
  closeServer,
  launchBrowser,
  listen,
  smokeCalculatorTools,
  waitForBoard,
} = require('./ui-smoke');

const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');

test('calculator tools render current odds workflows without browser errors', async () => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const app = createApp({
    oddsService: new OddsService({
      liveProvider: null,
      demoProvider: new DemoOddsProvider(),
      cacheTtlMs: 1,
    }),
    liveConfigured: false,
  });
  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchBrowser();
  const context = await browser.newContext({
    viewport: { width: 1400, height: 1000 },
  });
  const page = await context.newPage();
  const browserErrors = collectBrowserErrors(page);

  try {
    await page.goto(`${baseUrl}/matches`, { waitUntil: 'domcontentloaded' });
    await waitForBoard(page);
    const firstOdds = page.locator('[data-odds]').first();
    await firstOdds.click();
    await page.waitForFunction(() =>
      document.querySelector('.page:not(.page--hidden)')?.dataset.page === 'calculator',
    );

    const sections = await page.evaluate(() => {
      const ids = [
        'calculator',
        'calc-prob-section',
        'calc-kelly-section',
        'calc-novig-section',
        'calc-dutch-section',
        'calc-arb-section',
        'calc-novig-manual-section',
        'calc-middle-section',
        'calc-conv-section',
      ];
      return ids.map((id) => ({ id, exists: Boolean(document.getElementById(id)) }));
    });
    assert.deepEqual(
      sections.filter((section) => !section.exists),
      [],
      'all calculator sections should exist',
    );

    await smokeCalculatorTools(page, baseUrl);
    await smokeMiddleCalculator(page);
    await smokeNoVigCalculator(page);
    await smokeOddsConverter(page);

    await page.screenshot({
      path: path.join(OUTPUT_DIR, 'calculator-smoke.png'),
      fullPage: true,
    });

    assert.deepEqual(browserErrors, []);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await closeServer(server);
  }
});

async function smokeMiddleCalculator(page) {
  await page.locator('#mid-over-line').fill('2.5');
  await page.locator('#mid-over-odds').fill('1.90');
  await page.locator('#mid-under-line').fill('3.5');
  await page.locator('#mid-under-odds').fill('1.90');
  await page.locator('#mid-check-btn').click();

  const middleText = await page.locator('#mid-result').innerText();
  assert.match(middleText, /Middle window: 2\.5 to 3\.5/);
  assert.match(middleText, /Normal outcome \(one wins\)/i);
  assert.match(middleText, /MIDDLE HIT \(both win!\)/i);
}

async function smokeOddsConverter(page) {
  await page.locator('#conv-decimal').fill('2.50');
  const converterText = await page.locator('#conv-results').innerText();
  assert.match(converterText, /Fractional\s+3\/2/i);
  assert.match(converterText, /American\s+\+150/i);
  assert.match(converterText, /Implied prob\s+40\.0%/i);
}

async function smokeNoVigCalculator(page) {
  await page.locator('#novig-odds-1').fill('2.40');
  await page.locator('#novig-odds-x').fill('3.30');
  await page.locator('#novig-odds-2').fill('3.10');
  const noVigText = await page.locator('#novig-results').innerText();
  assert.match(noVigText, /Market total\s+104\.2%/i);
  assert.match(noVigText, /Hold\s+\+4\.2%/i);
  assert.match(noVigText, /Fair odds/i);
}

function collectBrowserErrors(page) {
  const errors = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (!/favicon|Failed to load resource: the server responded with a status of 404/.test(text)) {
      errors.push(`console: ${text}`);
    }
  });
  page.on('pageerror', (error) => {
    errors.push(`pageerror: ${error.message}`);
  });
  return errors;
}
