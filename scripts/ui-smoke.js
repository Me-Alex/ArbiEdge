const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { createApp } = require('../src/app');
const { OddsService } = require('../src/odds-service');
const { DemoOddsProvider } = require('../src/providers/demo-provider');

const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const BET_JOURNAL_KEY = 'arbDeskBetJournal';
const ROUTES = {
  scanner: '/scanner',
  value: '/value',
  ai: '/ai',
  calculator: '/calculator',
  journal: '/journal',
  bookmakers: '/bookmakers',
  matches: '/matches',
};

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

  try {
    const desktop = await runDesktopSmoke(browser, baseUrl);
    const mobile = await runMobileSmoke(browser, baseUrl);
    console.log(JSON.stringify({ ok: true, baseUrl, desktop, mobile }, null, 2));
  } finally {
    await browser.close().catch(() => {});
    await closeServer(server);
  }
}

async function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    const closeConnections = () => {
      server.closeAllConnections?.();
      server.closeIdleConnections?.();
    };
    const timeout = setTimeout(() => {
      closeConnections();
      resolve();
    }, 2_000);
    timeout.unref?.();
    server.close(() => {
      clearTimeout(timeout);
      resolve();
    });
    closeConnections();
  });
}

async function launchBrowser() {
  const candidates = [
    { channel: 'msedge' },
    { channel: 'chrome' },
    { executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' },
    { executablePath: 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe' },
    { executablePath: 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe' },
    { executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' },
    {},
  ];
  const failures = [];

  for (const candidate of candidates) {
    try {
      return await chromium.launch({ headless: true, ...candidate });
    } catch (error) {
      failures.push(`${JSON.stringify(candidate)} => ${error.message.split('\n')[0]}`);
    }
  }

  throw new Error(`No Chromium browser could be launched:\n${failures.join('\n')}`);
}

async function runDesktopSmoke(browser, baseUrl) {
  const context = await browser.newContext({
    viewport: DESKTOP_VIEWPORT,
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const browserErrors = collectBrowserErrors(page);

  try {
    const routes = [];
    for (const [name, routePath] of Object.entries(ROUTES)) {
      routes.push(await inspectRoute(page, baseUrl, name, routePath));
    }

    const matchFeed = await smokeCalculatorFromMatchFeed(page, baseUrl);
    const value = await smokeValueActions(page, baseUrl);
    const ai = await smokeAiActions(page, baseUrl);
    const scanner = await smokeScannerControls(page, baseUrl);
    const calculatorTools = await smokeCalculatorTools(page, baseUrl);
    const journal = await smokeJournal(page, baseUrl);

    const scannerScreenshot = path.join(OUTPUT_DIR, 'ui-smoke-scanner-desktop.png');
    await page.goto(`${baseUrl}/scanner`, { waitUntil: 'domcontentloaded' });
    await waitForBoard(page);
    await page.screenshot({ path: scannerScreenshot, fullPage: true });

    assertNoBrowserErrors(browserErrors, 'desktop');
    return {
      routes,
      matchFeed,
      value,
      ai,
      scanner,
      calculatorTools,
      journal,
      screenshots: [scannerScreenshot],
    };
  } finally {
    await context.close().catch(() => {});
  }
}

async function runMobileSmoke(browser, baseUrl) {
  const context = await browser.newContext({
    viewport: MOBILE_VIEWPORT,
    isMobile: true,
  });
  const page = await context.newPage();
  const browserErrors = collectBrowserErrors(page);

  try {
    await page.goto(`${baseUrl}/scanner`, { waitUntil: 'domcontentloaded' });
    await waitForBoard(page);
    const report = await page.evaluate(() => {
      const rect = (el) => {
        if (!el) return null;
        const box = el.getBoundingClientRect();
        return {
          width: Math.round(box.width),
          height: Math.round(box.height),
          right: Math.round(box.right),
        };
      };
      const filterBar = document.querySelector('.filter-bar');
      const filterControls = filterBar
        ? [...filterBar.querySelectorAll('button,input,select')]
          .filter((el) => {
            const box = el.getBoundingClientRect();
            return box.width > 0 && box.height > 0;
          })
          .map(rect)
        : [];
      return {
        page: document.querySelector('.page:not(.page--hidden)')?.dataset.page,
        mobileNavDisplay: getComputedStyle(document.querySelector('.mobile-nav')).display,
        sidebarDisplay: getComputedStyle(document.querySelector('.sidebar')).display,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        filterOverflowX: filterBar ? filterBar.scrollWidth - filterBar.clientWidth : 0,
        filterControlCount: filterControls.length,
        filterMaxRight: Math.max(0, ...filterControls.map((item) => item.right)),
        filterMinHeight: filterControls.length
          ? Math.min(...filterControls.map((item) => item.height))
          : 0,
        searchWidth: rect(document.querySelector('#search'))?.width || 0,
        cards: document.querySelectorAll('.arb-card').length,
      };
    });

    assert.equal(report.page, 'scanner');
    assert.equal(report.mobileNavDisplay, 'flex');
    assert.equal(report.sidebarDisplay, 'none');
    assert.ok(report.cards > 0, 'mobile scanner should render opportunity cards');
    assert.ok(report.overflowX <= 3, `mobile should not overflow horizontally (${report.overflowX}px)`);
    assert.ok(report.filterControlCount > 0, 'mobile filters should render controls');
    assert.ok(report.filterOverflowX <= 3, `mobile filters should not require side-scrolling (${report.filterOverflowX}px)`);
    assert.ok(report.filterMaxRight <= MOBILE_VIEWPORT.width + 3, `mobile filter controls should fit viewport (${report.filterMaxRight}px)`);
    assert.ok(report.filterMinHeight >= 34, `mobile filter controls should be tappable (${report.filterMinHeight}px)`);
    assert.ok(report.searchWidth >= 300, `mobile search should have usable width (${report.searchWidth}px)`);

    const screenshot = path.join(OUTPUT_DIR, 'ui-smoke-scanner-mobile.png');
    await page.screenshot({ path: screenshot, fullPage: true });

    assertNoBrowserErrors(browserErrors, 'mobile');
    return { viewport: `${MOBILE_VIEWPORT.width}x${MOBILE_VIEWPORT.height}`, ...report, screenshot };
  } finally {
    await context.close().catch(() => {});
  }
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

function assertNoBrowserErrors(errors, label) {
  assert.equal(errors.length, 0, `${label} browser emitted errors: ${errors.join('; ')}`);
}

async function waitForBoard(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(
    () => {
      const text = document.querySelector('#data-mode')?.textContent.trim();
      return text && !/^Loading/.test(text);
    },
    null,
    { timeout: 15_000 },
  );
  const hasHardError = await page.locator('#error')
    .evaluate((element) => !element.hidden)
    .catch(() => false);
  assert.equal(hasHardError, false, 'Board error panel is visible');
}

async function inspectRoute(page, baseUrl, routeName, routePath) {
  await page.goto(`${baseUrl}${routePath}`, { waitUntil: 'domcontentloaded' });
  await waitForBoard(page);
  const report = await page.evaluate(() => {
    const visiblePage = document.querySelector('.page:not(.page--hidden)');
    const pageName = visiblePage?.dataset.page;
    return {
      pageName,
      title: visiblePage?.querySelector('h1')?.textContent.trim() || null,
      activeLinks: [...document.querySelectorAll(`[data-nav="${pageName}"]`)]
        .filter((link) => link.classList.contains('is-active')).length,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      bodyTextLength: visiblePage?.innerText.trim().length || 0,
    };
  });

  assert.equal(report.pageName, routeName, `${routePath} should show page ${routeName}`);
  assert.ok(report.activeLinks >= 1, `${routeName} should mark at least one nav link active`);
  assert.ok(report.bodyTextLength > 40, `${routeName} should render real content`);
  assert.ok(report.overflowX <= 3, `${routeName} should not create horizontal overflow (${report.overflowX}px)`);
  return report;
}

async function smokeCalculatorFromMatchFeed(page, baseUrl) {
  await page.goto(`${baseUrl}/matches`, { waitUntil: 'domcontentloaded' });
  await waitForBoard(page);
  await page.waitForSelector('[data-odds]', { timeout: 10_000 });
  const firstTableHeader = await page.locator('.odds-table thead').first().innerText();
  assert.match(firstTableHeader, /Bookmaker/i, 'Match feed odds tables should render table headers');

  const firstOdds = page.locator('[data-odds]').first();
  const oddsPayload = await firstOdds.evaluate((button) => ({
    odds: button.dataset.odds,
    bookmaker: button.dataset.bookmaker,
    market: button.dataset.market,
    outcome: button.dataset.outcome,
    event: button.dataset.event,
  }));
  assert.ok(Number(oddsPayload.odds) > 1, 'First visible odds button should contain decimal odds');

  await firstOdds.click();
  await page.waitForFunction(() =>
    document.querySelector('.page:not(.page--hidden)')?.dataset.page === 'calculator',
  );
  assert.equal(await page.locator('#calc-odds').innerText(), Number(oddsPayload.odds).toFixed(2));
  assert.equal(await page.locator('#calc-save').isDisabled(), false);

  await page.locator('#calc-save').click();
  await page.goto(`${baseUrl}/journal`, { waitUntil: 'domcontentloaded' });
  await waitForBoard(page);
  assert.ok(await page.locator('.journal-card').count() >= 1, 'Journal should contain saved calculator pick');
  await clearJournal(page);

  return oddsPayload;
}

async function smokeValueActions(page, baseUrl) {
  await page.goto(`${baseUrl}/value`, { waitUntil: 'domcontentloaded' });
  await waitForBoard(page);
  const valueCards = await page.locator('.value-card').count();
  assert.ok(valueCards > 0, 'Value page should render value cards');

  const calculateButtons = page.locator('.value-card button', { hasText: 'Calculate' });
  assert.ok(await calculateButtons.count() > 0, 'Value cards should expose Calculate actions');
  await calculateButtons.first().click();
  await page.waitForFunction(() =>
    document.querySelector('.page:not(.page--hidden)')?.dataset.page === 'calculator',
  );
  assert.equal(await page.locator('#calc-save').isDisabled(), false);
  return { valueCards };
}

async function smokeAiActions(page, baseUrl) {
  await page.goto(`${baseUrl}/ai`, { waitUntil: 'domcontentloaded' });
  await waitForBoard(page);
  await page.waitForSelector('.ai-card, .empty-state', { timeout: 10_000 });
  const aiCards = await page.locator('.ai-card').count();
  assert.ok(aiCards > 0, 'AI page should render a paper pick candidate');

  const saveButtons = page.locator('.ai-card button', { hasText: 'Save to journal' });
  assert.ok(await saveButtons.count() > 0, 'AI card should expose Save to journal');
  await saveButtons.first().click();
  await page.goto(`${baseUrl}/journal`, { waitUntil: 'domcontentloaded' });
  await waitForBoard(page);
  assert.ok(await page.locator('.journal-card[data-type="ai-value"]').count() >= 1);
  await clearJournal(page);
  return { aiCards };
}

async function smokeScannerControls(page, baseUrl) {
  await page.goto(`${baseUrl}/scanner`, { waitUntil: 'domcontentloaded' });
  await waitForBoard(page);
  const initialCards = await page.locator('.arb-card').count();
  assert.ok(initialCards > 0, 'Scanner should render arbitrage cards');

  await page.locator('#filter-min-edge').fill('5');
  await page.waitForTimeout(100);
  const filteredCards = await page.locator('.arb-card').count();
  assert.ok(filteredCards <= initialCards, 'Min edge filter should not increase cards');

  const opportunityRoute = /\/api\/opportunities\?/;
  const routeCsvOpportunity = async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        opportunities: [{
          eventName: 'Dinamo "A", Bucuresti\nRapid',
          marketLabel: 'Winner, 1X2',
          edge: 0.123,
          profit: 45.67,
          legs: [
            { label: 'Home "red"', bookmaker: 'Book, One' },
            { label: 'Away', bookmaker: 'Book Two' },
          ],
        }],
      }),
    });
  };
  await page.route(opportunityRoute, routeCsvOpportunity);
  const download = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#export-csv').click(),
  ]).then(([item]) => item);
  await page.unroute(opportunityRoute, routeCsvOpportunity);
  assert.match(download.suggestedFilename(), /^surebets\.csv$/);
  const csvPath = await download.path();
  assert.ok(csvPath, 'CSV download should have a readable temporary path');
  const csvText = fs.readFileSync(csvPath, 'utf8');
  assert.match(csvText, /^Event,Market,Edge,Profit,Legs/);
  assert.match(
    csvText,
    /"Dinamo ""A"", Bucuresti\nRapid","Winner, 1X2",12\.3%,45\.67,"Home ""red""@Book, One \| Away@Book Two"/,
    'CSV export should escape quotes, commas, and embedded newlines',
  );

  await page.locator('#filter-reset').click();
  return { initialCards, filteredCards };
}

async function smokeCalculatorTools(page, baseUrl) {
  await page.goto(`${baseUrl}/calculator`, { waitUntil: 'domcontentloaded' });
  await waitForBoard(page);

  const odds = [3.5, 2.9, 2.05];
  const totalProb = odds.reduce((sum, price) => sum + (1 / price), 0);
  const expectedReturn = 100 / totalProb;
  const expectedProfit = expectedReturn - 100;

  await page.locator('#dutch-clear').click();
  for (let i = 0; i < odds.length; i += 1) {
    await page.locator('#dutch-add-leg').click();
  }
  await page.locator('#dutch-stake').fill('100');
  for (let i = 0; i < odds.length; i += 1) {
    await page.locator('.dutch-leg').nth(i).locator('input[type="number"]').fill(String(odds[i]));
  }

  const dutching = await readSummary(page, '#dutch-summary');
  assert.equal(dutching['Guaranteed return'], `${expectedReturn.toFixed(2)} RON`);
  assert.equal(dutching['Net profit'], `${expectedProfit.toFixed(2)} RON`);
  assert.match(dutching.Cost, /^11\.8%$/, 'negative dutching basket should show the cost, not fake profit');

  const arbOdds = [3.5, 3.4, 3.3];
  const expectedArbReturn = 100 / arbOdds.reduce((sum, price) => sum + (1 / price), 0);

  await page.locator('#arb-odds-1').fill(String(arbOdds[0]));
  await page.locator('#arb-odds-2').fill(String(arbOdds[1]));
  await page.locator('#arb-odds-3').fill(String(arbOdds[2]));
  await page.locator('#arb-check-btn').click();
  const arbText = await page.locator('#arb-check-result').innerText();
  assert.match(arbText, /Arbitrage found/);
  assert.match(arbText, /Outcome/i);
  assert.match(arbText, /Implied prob/i);
  assert.match(arbText, new RegExp(`Guaranteed return: ${expectedArbReturn.toFixed(2)} RON`));

  await page.locator('#novig-odds-1').fill('2.40');
  await page.locator('#novig-odds-x').fill('3.30');
  await page.locator('#novig-odds-2').fill('3.10');
  const noVigText = await page.locator('#novig-results').innerText();
  assert.match(noVigText, /Market total\s+104\.2%/i);
  assert.match(noVigText, /Hold\s+\+4\.2%/i);
  assert.match(noVigText, /Fair odds/i);

  return {
    dutching,
    arbText: arbText.slice(0, 120),
    noVigText: noVigText.slice(0, 120),
  };
}

async function readSummary(page, selector) {
  return page.locator(selector).evaluate((root) => Object.fromEntries(
    [...root.querySelectorAll(':scope > div')]
      .map((row) => [
        row.querySelector('span')?.textContent.trim(),
        row.querySelector('strong')?.textContent.trim(),
      ])
      .filter(([label, value]) => label && value),
  ));
}

async function smokeJournal(page, baseUrl) {
  await page.goto(`${baseUrl}/journal`, { waitUntil: 'domcontentloaded' });
  await waitForBoard(page);
  const emptyText = await page.locator('#journal-list').innerText();
  assert.match(emptyText, /No bets logged yet|No saved entries yet/i);

  const localEntry = {
    id: 'local-smoke-entry',
    type: 'manual',
    event: 'Local fallback vs Browser smoke',
    market: 'Match Winner',
    selection: 'Home @ Demo',
    bookmaker: 'Local fallback',
    odds: 2.1,
    stake: 25,
    status: 'pending',
    timestamp: new Date().toISOString(),
  };
  await page.evaluate(
    ({ key, entry }) => localStorage.setItem(key, JSON.stringify([entry])),
    { key: BET_JOURNAL_KEY, entry: localEntry },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForBoard(page);
  await page.waitForSelector('.journal-card', { timeout: 10_000 });
  assert.match(await page.locator('#journal-list').innerText(), /Local fallback vs Browser smoke/);

  await clearJournal(page);
  assert.match(await page.locator('#journal-list').innerText(), /No bets logged yet|No saved entries yet/i);
  const saved = await page.evaluate((key) => localStorage.getItem(key), BET_JOURNAL_KEY);
  assert.equal(saved, '[]');

  const failedDelete = await smokeJournalDeleteFailure(page);
  await clearJournal(page);
  assert.match(await page.locator('#journal-list').innerText(), /No bets logged yet|No saved entries yet/i);

  const failedSettle = await smokeJournalSettleFailure(page);
  await clearJournal(page);
  assert.match(await page.locator('#journal-list').innerText(), /No bets logged yet|No saved entries yet/i);

  return { empty: true, localFallback: true, failedDelete, failedSettle };
}

async function clearJournal(page) {
  const clear = page.locator('#journal-clear');
  if (await clear.count()) {
    await clear.click();
    await page.waitForFunction(() => !document.querySelector('#journal-clear')?.disabled, null, {
      timeout: 10_000,
    }).catch(() => {});
  }
}

async function smokeJournalDeleteFailure(page) {
  const serverBet = await createSmokeServerBet(page, 'Server delete failure vs Browser smoke');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForBoard(page);
  const card = page.locator(`.journal-card[data-id="${serverBet.id}"]`);
  await card.waitFor({ timeout: 10_000 });
  await assertCleanJournalCardText(card);

  await page.route('**/api/bets/**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'DELETE' && url.pathname.endsWith(`/api/bets/${serverBet.id}`)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'forced smoke failure' }),
      });
      return;
    }
    await route.continue();
  });

  await card.locator('button', { hasText: 'Remove' }).click();
  await page.waitForSelector(`.journal-card[data-id="${serverBet.id}"] .journal-card__error`, {
    timeout: 10_000,
  });
  const errorText = await card.locator('.journal-card__error').innerText();
  assert.match(errorText, /Remove failed/);
  assert.equal(await card.count(), 1, 'failed server delete should keep the card visible');
  await assertCleanJournalCardText(card);

  await page.unroute('**/api/bets/**');
  return true;
}

async function smokeJournalSettleFailure(page) {
  const serverBet = await createSmokeServerBet(page, 'Server settle failure vs Browser smoke');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForBoard(page);
  const card = page.locator(`.journal-card[data-id="${serverBet.id}"]`);
  await card.waitFor({ timeout: 10_000 });
  await assertCleanJournalCardText(card);

  await page.route('**/api/bets/**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'POST' && url.pathname.endsWith(`/api/bets/${serverBet.id}/settle`)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'forced smoke failure' }),
      });
      return;
    }
    await route.continue();
  });

  await card.locator('button', { hasText: /won/i }).click();
  await page.waitForSelector(`.journal-card[data-id="${serverBet.id}"] .journal-card__error`, {
    timeout: 10_000,
  });
  const cardText = await card.innerText();
  assert.match(cardText, /Settlement failed/);
  assert.match(cardText, /pending/i);
  await assertCleanJournalCardText(card);

  await page.unroute('**/api/bets/**');
  return true;
}

async function createSmokeServerBet(page, event) {
  return page.evaluate(async (eventName) => {
    const response = await fetch('/api/bets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: eventName,
        sport: 'Football',
        market: 'Match Winner',
        selection: 'Home',
        bookmaker: 'Smoke Book',
        odds: 2.2,
        stake: 10,
        type: 'manual',
      }),
    });
    return response.json();
  }, event);
}

async function assertCleanJournalCardText(card) {
  const text = await card.innerText();
  assert.doesNotMatch(text, /nullnull|\[object HTMLButtonElement\]/);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  inspectRoute,
  closeServer,
  listen,
  launchBrowser,
  runDesktopSmoke,
  runMobileSmoke,
  smokeCalculatorTools,
  waitForBoard,
};
