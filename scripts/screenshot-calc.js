const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('../src/app');
const { OddsService } = require('../src/odds-service');
const { DemoOddsProvider } = require('../src/providers/demo-provider');
const {
  launchBrowser,
  listen,
  smokeCalculatorTools,
  waitForBoard,
} = require('./ui-smoke');

const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const SCREENSHOT_PATH = path.join(OUTPUT_DIR, 'calculator-full.png');

async function main() {
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

  try {
    await page.goto(`${baseUrl}/matches`, { waitUntil: 'domcontentloaded' });
    await waitForBoard(page);
    await page.locator('[data-odds]').first().click();
    await page.waitForFunction(() =>
      document.querySelector('.page:not(.page--hidden)')?.dataset.page === 'calculator',
    );

    const calculatorTools = await smokeCalculatorTools(page, baseUrl);
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
    console.log(JSON.stringify({
      ok: true,
      baseUrl,
      screenshot: SCREENSHOT_PATH,
      calculatorTools,
    }, null, 2));
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await closeServer(server);
  }
}

function closeServer(server) {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, 2_000);
    timeout.unref?.();
    server.close(() => {
      clearTimeout(timeout);
      resolve();
    });
    server.closeAllConnections?.();
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
