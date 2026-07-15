const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
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
  const smokeDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'odds-ui-smoke-'));

  const app = createApp({
    oddsService: new OddsService({
      liveProvider: null,
      demoProvider: new DemoOddsProvider(),
      cacheTtlMs: 1,
    }),
    liveConfigured: false,
    aiPickLogPath: path.join(smokeDataDir, 'ai-picks.jsonl'),
    betLogPath: path.join(smokeDataDir, 'bets.jsonl'),
    arbLogPath: path.join(smokeDataDir, 'arbs.jsonl'),
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
    fs.rmSync(smokeDataDir, { recursive: true, force: true });
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
    ...(process.env.CHROME_PATH ? [{ executablePath: process.env.CHROME_PATH }] : []),
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
        scannerEmptyStates: document.querySelectorAll('#scanner-list .scanner-empty').length,
        actionableCount: Number(document.querySelector('#scanner-actionable-count')?.textContent || 0),
      };
    });

    assert.equal(report.page, 'scanner');
    assert.equal(report.mobileNavDisplay, 'flex');
    assert.equal(report.sidebarDisplay, 'none');
    assert.ok(report.cards > 0 || report.scannerEmptyStates > 0, 'mobile scanner should render a queue result or its safety-gate empty state');
    assert.equal(report.actionableCount, 0, 'unverified demo opportunities must not enter the mobile Actionable queue');
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
  const opportunities = [
    {
      eventName: 'Fixture Arb vs Team',
      marketLabel: 'Winner, 1X2',
      marketKey: 'h2h',
      competition: 'Smoke League',
      type: 'classic',
      confidence: 'trusted',
      eligibility: 'actionable',
      verifiedLegCount: 2,
      legCount: 2,
      allLegsVerified: true,
      sameBook: false,
      edge: 0.073,
      profit: 12.34,
      legs: [
        { label: 'Home', bookmaker: 'Book One', price: 2.2, verificationStatus: 'verified' },
        { label: 'Away', bookmaker: 'Book Two', price: 2.1, verificationStatus: 'verified' },
      ],
    },
    {
      eventName: 'Fixture Goals vs Team',
      marketLabel: 'O/U 2.5 Goals',
      marketKey: 'totalGoals_2_5',
      competition: 'Smoke League',
      type: 'classic',
      confidence: 'trusted',
      eligibility: 'actionable',
      verifiedLegCount: 2,
      legCount: 2,
      allLegsVerified: true,
      sameBook: false,
      edge: 0.064,
      profit: 6.4,
      legs: [
        { label: 'Over 2.5', bookmaker: 'Book Goals A', price: 2.1, marketKey: 'totalGoals_2_5', verificationStatus: 'verified' },
        { label: 'Under 2.5', bookmaker: 'Book Goals B', price: 2.05, marketKey: 'totalGoals_2_5', verificationStatus: 'verified' },
      ],
    },
    {
      eventName: 'Fixture Cross vs Team',
      marketLabel: 'Cross-market total',
      marketKey: 'cross_total',
      competition: 'Smoke League',
      type: 'cross-market',
      confidence: 'review',
      eligibility: 'review',
      verifiedLegCount: 0,
      legCount: 2,
      sameBook: false,
      eligibilityReasons: ['Every leg must be verified; current evidence: unverified.'],
      edge: 0.02,
      profit: 2,
      legs: [
        { label: 'Over', bookmaker: 'Book Three', price: 2.02, verificationStatus: 'unverified' },
        { label: 'Under', bookmaker: 'Book Four', price: 2.02, verificationStatus: 'unverified' },
      ],
    },
    {
      eventName: 'Fixture Rejected vs Team',
      marketLabel: 'Winner, 1X2',
      marketKey: 'h2h',
      competition: 'Smoke League',
      type: 'classic',
      confidence: 'risky',
      eligibility: 'rejected',
      verifiedLegCount: 0,
      legCount: 2,
      sameBook: true,
      eligibilityReasons: ['All best prices come from one bookmaker; the scanner requires cross-book execution.'],
      edge: 0.04,
      profit: 4,
      legs: [
        { label: 'Home', bookmaker: 'Book Same', price: 2.1, verificationStatus: 'unverified' },
        { label: 'Away', bookmaker: 'Book Same', price: 2.1, verificationStatus: 'unverified' },
      ],
    },
    {
      eventName: 'Dinamo "A", Bucuresti\nRapid',
      marketLabel: 'Goals Middle, 2.5/3.5',
      marketKey: 'middle_total_goals',
      competition: 'Smoke League',
      type: 'middle',
      confidence: 'review',
      eligibility: 'analysis',
      verifiedLegCount: 0,
      legCount: 2,
      sameBook: false,
      eligibilityReasons: ['A middle has an upside window but is not a guaranteed arbitrage.'],
      edge: 0.063,
      profit: 6.78,
      legs: [
        { label: 'Over "red"', bookmaker: 'Book, One', price: 1.95, marketKey: 'totalGoals_2_5', verificationStatus: 'unverified' },
        { label: 'Under', bookmaker: 'Book Two', price: 1.95, marketKey: 'totalGoals_3_5', verificationStatus: 'unverified' },
      ],
    },
  ];
  await page.goto(`${baseUrl}/scanner`, { waitUntil: 'domcontentloaded' });
  await waitForBoard(page);
  await page.evaluate(async (fixture) => {
    const [{ state, resetSelectedMarketTypes }, { renderScanner }] = await Promise.all([
      import('/js/state.js?v=12'),
      import('/js/pages/scanner.js?v=12'),
    ]);
    state.stream?.abort?.();
    state.stream = null;
    state.opportunities = fixture;
    state.minEdge = 0;
    state.search = '';
    state.scannerVerificationFilter = '';
    state.scannerTab = 'actionable';
    resetSelectedMarketTypes();
    document.querySelector('#filter-min-edge').value = '0';
    document.querySelector('#verification-filter').value = '';
    document.querySelector('#search').value = '';
    renderScanner();
  }, opportunities);

  const initialCards = await page.locator('#scanner-list .arb-card').count();
  assert.equal(initialCards, 2, 'Actionable tab should render only verified opportunities');
  const initialTypes = await page.locator('#scanner-list .arb-card').evaluateAll((cards) => cards.map((card) => card.dataset.opportunityType));
  assert.ok(initialTypes.every((type) => type !== 'middle'), 'Actionable tab should exclude middle opportunities');
  assert.equal(await page.locator('#scanner-actionable-count').innerText(), '2');
  assert.equal(await page.locator('#scanner-review-count').innerText(), '1');
  assert.equal(await page.locator('#scanner-rejected-count').innerText(), '1');
  assert.equal(await page.locator('#scanner-middles-count').innerText(), '1');

  await page.locator('#scanner-list .arb-card[data-eligibility="actionable"] .arb-detail-btn').first().click();
  assert.equal(await page.locator('#arb-modal-body .modal-copy-btn').count(), 2, 'Actionable details should expose stake actions');
  assert.equal(await page.locator('#arb-modal-body .modal-journal-btn').count(), 2, 'Actionable details should expose journal actions');
  await page.locator('#arb-modal-close').click();

  await page.locator('[data-scanner-tab="review"]').click();
  assert.equal(await page.locator('#scanner-list .arb-card[data-eligibility="review"]').count(), 1, 'Review queue should isolate evidence-blocked candidates');
  assert.equal(await page.locator('#scanner-list .evidence-badge--review').count(), 2, 'Review legs should show evidence badges');
  await page.locator('#scanner-list .arb-card[data-eligibility="review"] .arb-detail-btn').click();
  assert.equal(await page.locator('#arb-modal-body .modal-copy-btn').count(), 0, 'Review details must lock stake actions');
  assert.equal(await page.locator('#arb-modal-body .modal-journal-btn').count(), 0, 'Review details must lock journal actions');
  assert.equal(await page.locator('#arb-modal-body').getByText('Position actions locked until actionable.').count(), 2);
  await page.locator('#arb-modal-close').click();
  await page.locator('[data-scanner-tab="rejected"]').click();
  assert.equal(await page.locator('#scanner-list .arb-card[data-eligibility="rejected"]').count(), 1, 'Rejected queue should isolate blocked candidates');
  assert.match(await page.locator('#scanner-list .scanner-verdict').innerText(), /cross-book execution/i);
  await page.locator('[data-scanner-tab="actionable"]').click();

  await page.locator('#market-filter-toggle').click();
  await page.locator('[data-market-filter-action="none"]').click();
  await page.locator('#market-filter-options input[data-market-type="goalsTotals"]').check();
  const marketFilteredCards = await page.locator('#scanner-list .arb-card').count();
  assert.equal(marketFilteredCards, 1, 'Market filter should isolate Goals Totals in Actionable');
  assert.deepEqual(
    await page.locator('#scanner-list .arb-card').evaluateAll((cards) => cards.map((card) => card.dataset.marketType)),
    ['goalsTotals'],
    'Visible Actionable cards should expose the selected market type',
  );
  assert.equal(await page.locator('#scanner-actionable-count').innerText(), '1');
  assert.equal(await page.locator('#scanner-middles-count').innerText(), '1');

  await page.locator('[data-scanner-tab="middles"]').click();
  const middleCards = await page.locator('#scanner-list .arb-card').count();
  assert.equal(middleCards, 1, 'Middles tab should render middle opportunity cards matching the selected market type');
  assert.deepEqual(
    await page.locator('#scanner-list .arb-card').evaluateAll((cards) => cards.map((card) => card.dataset.opportunityType)),
    ['middle'],
    'Middles tab should contain only middle opportunities',
  );
  assert.deepEqual(
    await page.locator('#scanner-list .arb-card').evaluateAll((cards) => cards.map((card) => card.dataset.marketType)),
    ['goalsTotals'],
    'Market filter should persist when switching to Middles',
  );

  const download = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#export-csv').click(),
  ]).then(([item]) => item);
  assert.match(download.suggestedFilename(), /^scanner-middle\.csv$/);
  const csvPath = await download.path();
  assert.ok(csvPath, 'CSV download should have a readable temporary path');
  const csvText = fs.readFileSync(csvPath, 'utf8');
  assert.match(csvText, /^Event,Market,Queue,Edge,Model Profit,Evidence,Reasons,Legs/);
  assert.match(
    csvText,
    /"Dinamo ""A"", Bucuresti\nRapid","Goals Middle, 2\.5\/3\.5",analysis,6\.3%,6\.78,unverified,A middle has an upside window but is not a guaranteed arbitrage\.,"Over ""red""@Book, One:unverified \| Under@Book Two:unverified"/,
    'CSV export should escape quotes, commas, and embedded newlines',
  );
  assert.doesNotMatch(csvText, /Fixture Arb vs Team/, 'CSV export should follow the active scanner tab');
  assert.doesNotMatch(csvText, /Fixture Goals vs Team/, 'CSV export should not leak Actionable cards into Middles');

  await page.locator('#filter-reset').click();
  await page.locator('[data-scanner-tab="actionable"]').click();
  await page.locator('#filter-min-edge').fill('5');
  await page.waitForTimeout(100);
  const filteredCards = await page.locator('#scanner-list .arb-card').count();
  assert.ok(filteredCards <= initialCards, 'Min edge filter should not increase cards');
  assert.equal(filteredCards, 2, 'Min edge filter should apply inside the active Actionable tab');
  assert.equal(await page.locator('#scanner-actionable-count').innerText(), '2');
  assert.equal(await page.locator('#scanner-middles-count').innerText(), '1');

  await page.locator('#filter-reset').click();
  return { initialCards, marketFilteredCards, filteredCards, middleCards };
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
  await clearJournal(page);
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
  await page.evaluate(async (key) => {
    localStorage.setItem(key, '[]');
    const [{ state, renderRegistry }] = await Promise.all([
      import('/js/state.js?v=12'),
    ]);
    const response = await fetch('/api/bets');
    const payload = response.ok ? await response.json() : { bets: [] };
    for (const bet of payload.bets || []) {
      if (bet.id) await fetch(`/api/bets/${encodeURIComponent(bet.id)}`, { method: 'DELETE' });
    }
    state.localJournal = [];
    state.serverJournal = [];
    state.analytics = null;
    renderRegistry.journal?.();
    renderRegistry.betSlip?.();
  }, BET_JOURNAL_KEY);
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
