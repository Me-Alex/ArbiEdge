#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildDirectProviders, providerOptionsFromEnv } = require('../src/provider-config');
const { getMarketLabel, getOutcomeLabel } = require('../src/formula-engine');
const { launchBrowser } = require('./ui-smoke');
const {
  DEFAULT_MARKET_FILTERS,
  DEFAULT_PRICE_TOLERANCE,
  FIDELITY_STATUSES,
  buildExpectedOddRecord,
  marketMatchesFilter,
  parseMarketList,
  summarizeFidelityRecords,
  verifyRecordsAgainstText,
} = require('./odds-fidelity-core');

const DEFAULT_BOOKMAKER = 'GetsBet';
const DEFAULT_EVENT_TARGET = 40;
const DEFAULT_MAX_PRICES = 8;
const DEFAULT_MIN_HOURS = 0;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_EVENTS_PER_BOOKMAKER = 3;
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const bookmakerTarget = stringOption(args.bookmaker, process.env.VERIFY_BOOKMAKER, DEFAULT_BOOKMAKER);
  const providerTarget = stringOption(args.provider, process.env.VERIFY_PROVIDER, bookmakerTarget);
  const eventFilter = stringOption(args.event, process.env.VERIFY_EVENT, '');
  const marketFilter = stringOption(args.markets, args.market, process.env.VERIFY_MARKETS, process.env.VERIFY_MARKET, '');
  const maxPrices = positiveInteger(args.prices || process.env.VERIFY_MAX_PRICES, DEFAULT_MAX_PRICES);
  const minHours = nonNegativeNumber(args.minHours || process.env.VERIFY_MIN_HOURS, DEFAULT_MIN_HOURS);
  const timeoutMs = positiveInteger(args.timeoutMs || process.env.VERIFY_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const strictContext = booleanOption(args.strictContext || process.env.VERIFY_STRICT_CONTEXT, false);
  const priceTolerance = nonNegativeNumber(
    args.priceTolerance || process.env.VERIFY_PRICE_TOLERANCE,
    DEFAULT_PRICE_TOLERANCE,
  );
  const eventTarget = positiveInteger(
    args.eventTarget || process.env.VERIFY_EVENT_TARGET || process.env.BOOKMAKER_EVENT_TARGET,
    DEFAULT_EVENT_TARGET,
  );

  if (normalizeText(bookmakerTarget) === 'all') {
    const { runFidelityVerification } = require('./verify-odds-fidelity');
    const report = await runFidelityVerification({
      bookmakerTarget,
      providerTarget: args.provider ? providerTarget : 'all',
      eventFilter,
      marketFilters: parseMarketList(marketFilter, DEFAULT_MARKET_FILTERS),
      maxPrices,
      minHours,
      timeoutMs,
      eventTarget,
      eventsPerBookmaker: positiveInteger(
        args.eventsPerBookmaker || process.env.VERIFY_EVENTS_PER_BOOKMAKER,
        DEFAULT_EVENTS_PER_BOOKMAKER,
      ),
      strictContext: true,
      priceTolerance,
    });
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) {
      process.exitCode = 1;
    }
    return;
  }

  const provider = selectProvider(providerTarget, eventTarget, timeoutMs);
  const events = await withTimeout(
    provider.getOdds(),
    timeoutMs,
    `${provider.name} getOdds`,
  );
  const candidate = selectCandidate(events, {
    bookmakerTarget,
    eventFilter,
    marketFilter,
    maxPrices,
    minHours,
  });

  if (!candidate) {
    throw new Error(
      `No verifiable ${bookmakerTarget} event was found`
      + `${eventFilter ? ` for event filter "${eventFilter}"` : ''}`
      + `${marketFilter ? ` and market filter "${marketFilter}"` : ''}`
      + `${minHours > 0 ? ` at least ${minHours}h before kickoff` : ''}.`,
    );
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const report = await verifyCandidateWithPlaywright(candidate, {
    timeoutMs,
    strictContext,
    priceTolerance,
  });

  const reportPath = path.join(
    OUTPUT_DIR,
    `${slug(report.bookmaker.name)}-odds-verification.json`,
  );
  const latestReportPath = path.join(OUTPUT_DIR, 'bookmaker-odds-verification.json');
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(latestReportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, reportPath, latestReportPath }, null, 2));

  if (!report.ok) {
    process.exitCode = 1;
  }
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) {
      continue;
    }
    const stripped = item.slice(2);
    if (stripped === 'help' || stripped === 'h') {
      result.help = true;
      continue;
    }
    const equalsIndex = stripped.indexOf('=');
    if (equalsIndex >= 0) {
      result[toCamelCase(stripped.slice(0, equalsIndex))] = stripped.slice(equalsIndex + 1);
      continue;
    }
    const key = toCamelCase(stripped);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      result[key] = true;
      continue;
    }
    result[key] = next;
    index += 1;
  }
  return result;
}

function toCamelCase(value) {
  return String(value || '').replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function printHelp() {
  console.log(`
Verify scraped bookmaker odds against the rendered bookmaker page.

Usage:
  node scripts/verify-bookmaker-odds.js --bookmaker GetsBet
  node scripts/verify-bookmaker-odds.js --bookmaker BetOne --event "Elfsborg" --market totalGoals
  node scripts/verify-bookmaker-odds.js --bookmaker all --events-per-bookmaker 3 --markets h2h,totalGoals,totalCorners,bothTeamsToScore --strict-context

Options:
  --provider <name>       Provider to fetch from. Defaults to the bookmaker name.
  --bookmaker <name|all>  Bookmaker brand to verify. Defaults to ${DEFAULT_BOOKMAKER}.
  --event <text>          Optional home/away/competition filter.
  --market <key/text>     Optional market key filter, such as h2h or totalGoals.
  --markets <csv>         Market families for batch checks. Defaults to ${DEFAULT_MARKET_FILTERS.join(',')}.
  --prices <number>       Max prices to check on the page. Defaults to ${DEFAULT_MAX_PRICES}.
  --events-per-bookmaker  Events per bookmaker when --bookmaker all is used.
  --min-hours <number>    Skip events closer than this many hours to kickoff.
  --strict-context        Require event + market + period + line + outcome + price context.
  --price-tolerance <n>   Decimal price tolerance. Defaults to ${DEFAULT_PRICE_TOLERANCE}.
  --event-target <number> Provider event target. Defaults to ${DEFAULT_EVENT_TARGET}.
  --timeout-ms <number>   Fetch and browser timeout. Defaults to ${DEFAULT_TIMEOUT_MS}.
`.trim());
}

function selectProvider(providerTarget, eventTarget, timeoutMs) {
  const env = {
    ...process.env,
    BOOKMAKER_EVENT_TARGET: String(eventTarget),
    ODDS_EVENT_TARGET: String(eventTarget),
    ODDS_REQUEST_TIMEOUT_MS: String(timeoutMs),
  };
  const providers = buildDirectProviders(providerOptionsFromEnv(env));
  const provider = providers.find((item) => providerMatches(item, providerTarget));
  if (!provider) {
    const names = providers.flatMap(providerNames).sort((a, b) => a.localeCompare(b));
    throw new Error(`Provider "${providerTarget}" not found. Available: ${names.join(', ')}`);
  }
  return provider;
}

function providerMatches(provider, target) {
  const normalizedTarget = normalizeText(target);
  return providerNames(provider).some((name) => normalizeText(name) === normalizedTarget);
}

function providerNames(provider) {
  return [
    provider?.name,
    ...(Array.isArray(provider?.brands) ? provider.brands.map((brand) => brand.name) : []),
  ].filter(Boolean);
}

function selectCandidate(events, { bookmakerTarget, eventFilter, marketFilter, maxPrices, minHours = 0, now = new Date() }) {
  const normalizedBookmaker = normalizeText(bookmakerTarget);
  const normalizedEventFilter = normalizeText(eventFilter);
  const minStartsAt = new Date(now.getTime() + (Number(minHours) || 0) * 60 * 60 * 1000);

  for (const event of Array.isArray(events) ? events : []) {
    if (!eventMeetsMinHours(event, minStartsAt)) {
      continue;
    }

    const eventText = normalizeText(`${event.homeTeam} ${event.awayTeam} ${event.competition}`);
    if (normalizedEventFilter && !eventText.includes(normalizedEventFilter)) {
      continue;
    }

    for (const bookmaker of event.bookmakers || []) {
      if (normalizeText(bookmaker.name) !== normalizedBookmaker) {
        continue;
      }

      const prices = collectPriceChecks(bookmaker, { marketFilter, maxPrices });
      const url = bookmaker.eventUrl || bookmaker.bookmakerUrl || '';
      if (url && prices.length > 0) {
        return {
          event,
          bookmaker: {
            name: bookmaker.name,
            url,
            urlSource: bookmaker.eventUrl ? 'eventUrl' : 'bookmakerUrl',
          },
          prices,
        };
      }
    }
  }

  return null;
}

function eventMeetsMinHours(event, minStartsAt) {
  if (!(minStartsAt instanceof Date) || Number.isNaN(minStartsAt.getTime())) {
    return true;
  }
  const startsAt = new Date(event?.startsAt || 0);
  return Number.isFinite(startsAt.getTime()) && startsAt >= minStartsAt;
}

function collectPriceChecks(bookmaker, { marketFilter, maxPrices }) {
  const marketFilters = parseVerifierMarketFilters(marketFilter);
  const checks = [];
  const marketEntries = Object.entries(bookmaker.markets || {})
    .filter(([marketKey]) => {
      if (marketFilters.length === 0) return true;
      return marketFilters.some((filter) =>
        marketMatchesFilter(marketKey, [filter])
        || normalizeText(marketKey).includes(normalizeText(filter))
        || normalizeText(getMarketLabel(marketKey)).includes(normalizeText(filter))
        || compactText(marketKey).includes(compactText(filter))
        || compactText(getMarketLabel(marketKey)).includes(compactText(filter)));
    })
    .sort(compareMarketPriority);

  for (const [marketKey, outcomes] of marketEntries) {
    for (const [outcome, price] of Object.entries(outcomes || {})) {
      if (!Number.isFinite(price) || price <= 1) {
        continue;
      }
      checks.push({
        marketKey,
        marketLabel: getMarketLabel(marketKey),
        outcome,
        outcomeLabel: getOutcomeLabel(outcome),
        price,
      });
      if (checks.length >= maxPrices) {
        return checks;
      }
    }
  }

  return checks;
}

function compareMarketPriority([left], [right]) {
  return marketPriority(left) - marketPriority(right) || left.localeCompare(right);
}

function marketPriority(marketKey) {
  if (marketKey === 'h2h') return 0;
  if (marketKey === 'bothTeamsToScore') return 1;
  if (/^totalGoals_/.test(marketKey)) return 2;
  if (/^totalCorners_/.test(marketKey)) return 3;
  if (/^totalCards_/.test(marketKey)) return 4;
  return 10;
}

async function verifyCandidateWithPlaywright(candidate, options = {}) {
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({
      locale: 'ro-RO',
      viewport: { width: 1440, height: 1000 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    });
    const page = await context.newPage();
    try {
      return await verifyCandidateOnPage(page, candidate, options);
    } finally {
      await context.close().catch(() => {});
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

async function verifyCandidateOnPage(page, candidate, {
  timeoutMs,
  strictContext = false,
  priceTolerance = DEFAULT_PRICE_TOLERANCE,
  outputDir = OUTPUT_DIR,
  screenshotPath = '',
} = {}) {
  const networkEvidence = createNetworkEvidenceCollector(page, candidate);
  try {
    await page.goto(candidate.bookmaker.url, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });
    await acceptCookiePrompt(page);
    await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});
    await page.waitForTimeout(1_000);
    // Expand/scroll market sections so pure BTTS/totals cards enter the DOM
    // (Superbet and similar SPAs only render above-the-fold markets first).
    await prepareBookmakerEventPage(page, candidate);
  } finally {
    networkEvidence.stop();
  }

  const pageEvidence = await extractPageEvidence(page, candidate, {
    networkRows: await networkEvidence.rows(),
  });
  const visibleText = normalizeWhitespace(pageEvidence.text);
  const html = pageEvidence.html;
  const resolvedScreenshotPath = screenshotPath || path.join(
    outputDir,
    `${slug(candidate.bookmaker.name)}-odds-verification.png`,
  );
  fs.mkdirSync(path.dirname(resolvedScreenshotPath), { recursive: true });
  await page.screenshot({ path: resolvedScreenshotPath, fullPage: true }).catch(() => {});

  const teamEvidence = {
    homeTeam: candidate.event.homeTeam,
    awayTeam: candidate.event.awayTeam,
    homeFound: containsText(visibleText, candidate.event.homeTeam),
    awayFound: containsText(visibleText, candidate.event.awayTeam),
  };
  const priceChecks = strictContext
    ? strictPriceChecks(candidate, pageEvidence, { priceTolerance })
    : loosePriceChecks(candidate, visibleText, html);
  const missingPrices = priceChecks.filter((check) => !check.found);
  const fidelitySummary = summarizeFidelityRecords(priceChecks);
  const ok = teamEvidence.homeFound
    && teamEvidence.awayFound
    && priceChecks.length > 0
    && (strictContext
      ? priceChecks.every((check) => check.status === FIDELITY_STATUSES.verified)
      : missingPrices.length === 0);

  return {
    ok,
    checkedAt: new Date().toISOString(),
    strictContext,
    priceTolerance,
    pageAdapter: pageEvidence.adapterId,
    bookmaker: candidate.bookmaker,
    event: {
      id: candidate.event.id || null,
      homeTeam: candidate.event.homeTeam,
      awayTeam: candidate.event.awayTeam,
      competition: candidate.event.competition,
      startsAt: candidate.event.startsAt,
    },
    teamEvidence,
    fidelitySummary,
    priceChecks,
    missingPrices,
    screenshotPath: resolvedScreenshotPath,
    evidenceSummary: {
      structuredRows: pageEvidence.structuredRows?.length || 0,
      networkRows: pageEvidence.networkRows?.length || 0,
    },
    pageTextSample: visibleText.slice(0, 500),
  };
}

async function extractPageEvidence(page, candidate, options = {}) {
  const adapter = selectPageAdapter(candidate?.bookmaker?.name);
  const extracted = await adapter.extract(page, options);
  const networkRows = options.networkRows || [];
  return {
    adapterId: adapter.id,
    ...extracted,
    networkRows,
    structuredRows: [
      ...(extracted.structuredRows || []),
      ...networkRows,
    ].map((row) => ({
      adapterId: row.adapterId || adapter.id,
      ...row,
    })),
  };
}

function selectPageAdapter(bookmakerName) {
  const normalized = normalizeText(bookmakerName);
  if (/unibet|superbet|getsbet/.test(normalized)) {
    return {
      id: 'spa-dom',
      extract: extractDomTextEvidence,
    };
  }
  return {
    id: 'generic-text-table',
    extract: extractDomTextEvidence,
  };
}

async function extractDomTextEvidence(page) {
  const structuredRows = await page.evaluate(() => {
    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        rect.width > 0 &&
        rect.height > 0;
    };
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const hasOddsNumber = (value) => /(^|[^0-9])([1-9][0-9]?[.,][0-9]{1,2})(?=[^0-9]|$)/.test(value);
    const selectorFor = (element) => {
      const tag = element.tagName ? element.tagName.toLowerCase() : 'node';
      const id = element.id ? `#${element.id}` : '';
      const cls = String(element.className || '')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 3)
        .map((item) => `.${item}`)
        .join('');
      return `${tag}${id}${cls}`;
    };
    const rows = [];
    const push = (element, source) => {
      if (!element || !isVisible(element)) return;
      const text = clean(element.innerText || element.textContent);
      if (!text || text.length < 6 || text.length > 1200 || !hasOddsNumber(text)) return;
      rows.push({
        source,
        selector: selectorFor(element),
        text,
      });
    };

    document.querySelectorAll('tr,[role="row"]').forEach((element) => push(element, 'table-row'));
    document
      .querySelectorAll('article,li,section,[data-testid*="market" i],[data-testid*="odd" i],[class*="market" i],[class*="odd" i],[class*="selection" i]')
      .forEach((element) => push(element, 'dom-row'));

    const seen = new Set();
    return rows.filter((row) => {
      const key = `${row.source}|${row.selector}|${row.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 500);
  }).catch(() => []);

  return {
    text: await page.locator('body').innerText({ timeout: 5_000 }).catch(() => ''),
    html: await page.content().catch(() => ''),
    structuredRows,
  };
}

function loosePriceChecks(candidate, visibleText, html) {
  return candidate.prices.map((check) => {
    const found = textContainsPrice(visibleText, check.price);
    return {
      ...check,
      variants: decimalPriceVariants(check.price),
      endpointPrice: check.price,
      websitePrice: found ? Number(Number(check.price).toFixed(2)) : null,
      status: found ? FIDELITY_STATUSES.verified : FIDELITY_STATUSES.notFound,
      found,
      foundInHtml: textContainsPrice(html, check.price),
    };
  });
}

function strictPriceChecks(candidate, pageEvidence, { priceTolerance }) {
  const records = candidate.prices.map((check) =>
    buildExpectedOddRecord({
      event: candidate.event,
      bookmaker: candidate.bookmaker,
      check,
    }));
  return verifyRecordsAgainstText(records, normalizeWhitespace(pageEvidence.text), {
    priceTolerance,
    contextRows: pageEvidence.structuredRows || [],
  })
    .map((record, index) => ({
      ...candidate.prices[index],
      ...record,
      price: candidate.prices[index].price,
      variants: decimalPriceVariants(candidate.prices[index].price),
      found: record.status === FIDELITY_STATUSES.verified,
      foundInHtml: null,
    }));
}

function createNetworkEvidenceCollector(page, candidate) {
  const rows = [];
  const pending = [];
  const targetHostname = safeHostname(candidate?.bookmaker?.url);
  const handler = (response) => {
    const task = collectNetworkRows(response, candidate, targetHostname)
      .then((items) => rows.push(...items))
      .catch(() => {});
    pending.push(task);
  };
  page.on('response', handler);
  return {
    stop() {
      page.off?.('response', handler);
    },
    async rows() {
      await Promise.allSettled(pending);
      return rows.slice(0, 200);
    },
  };
}

async function collectNetworkRows(response, candidate, targetHostname) {
  if (response.status() >= 400) return [];
  const url = response.url();
  const hostname = safeHostname(url);
  // Accept same-site responses and known sportsbook API/CDN hosts. Superbet
  // serves offer JSON from Fastly, Digitain/EGT/XSport use separate API hosts.
  if (!hostname || !isAllowedNetworkEvidenceHost(hostname, targetHostname)) return [];
  const headers = response.headers();
  const contentType = headers['content-type'] || '';
  const length = Number(headers['content-length'] || 0);
  if (length > 2_000_000 || !/json|javascript|text/.test(contentType)) return [];
  const body = await response.text().catch(() => '');
  if (!body || body.length > 2_000_000 || !networkBodyMatchesCandidate(body, candidate)) return [];
  return extractNetworkRowsFromBody(body, candidate, url);
}

function isAllowedNetworkEvidenceHost(hostname, bookmakerHostname) {
  const host = String(hostname || '').toLowerCase();
  const bookmakerHost = String(bookmakerHostname || '').toLowerCase();
  if (!host) return false;
  if (bookmakerHost && (host === bookmakerHost || host.endsWith(`.${bookmakerHost}`))) {
    return true;
  }
  // Shared Romanian sportsbook infrastructure used by multiple brands.
  return /(?:^|\.)(?:fastly\.(?:net|com)|cloudfront\.net|akamaihd\.net|edgekey\.net|edgesuite\.net|freetls\.fastly\.net|digitain|egt-digital|nsoft|xsport|exalogic|sportradar|kambi|openbet|beter|betconstruct)/i.test(host)
    || /(?:api|offer|sportsbook|datastore|distribution)/i.test(host);
}

async function prepareBookmakerEventPage(page, candidate) {
  try {
    await acceptCookiePrompt(page);
    // Click common market-group tabs / "Toate piețele" expanders when present.
    const clickLabels = [
      'Toate',
      'Toate piețele',
      'All markets',
      'Piețe',
      'Markets',
      'Goluri',
      'Goals',
      'Ambele echipe',
      'GG',
      'BTTS',
    ];
    for (const label of clickLabels) {
      const locator = page.getByRole('button', { name: new RegExp(`^${escapeRegExp(label)}$`, 'i') }).first();
      if (await locator.count().catch(() => 0)) {
        await locator.click({ timeout: 800 }).catch(() => {});
      }
      const textLocator = page.locator(`text=${label}`).first();
      if (await textLocator.count().catch(() => 0)) {
        await textLocator.click({ timeout: 800 }).catch(() => {});
      }
    }

    // Scroll through the event page so lazy-rendered market cards mount.
    for (const y of [400, 900, 1400, 2000, 2800, 0]) {
      await page.evaluate((scrollY) => window.scrollTo(0, scrollY), y).catch(() => {});
      await page.waitForTimeout(250).catch(() => {});
    }

    // Prefer scrolling a market card that mentions the first missing market family.
    const marketHints = (candidate?.prices || [])
      .map((check) => check.marketLabel || check.marketKey)
      .filter(Boolean)
      .slice(0, 6);
    for (const hint of marketHints) {
      const card = page.locator(`text=/${escapeRegExp(String(hint)).slice(0, 24)}/i`).first();
      if (await card.count().catch(() => 0)) {
        await card.scrollIntoViewIfNeeded().catch(() => {});
        await page.waitForTimeout(200).catch(() => {});
      }
    }
  } catch {
    // Page preparation is best-effort; verification still runs on whatever rendered.
  }
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function networkBodyMatchesCandidate(body, candidate) {
  const normalized = normalizeText(body);
  const homeFound = containsText(normalized, candidate?.event?.homeTeam);
  const awayFound = containsText(normalized, candidate?.event?.awayTeam);
  const eventId = String(candidate?.event?.id || '').split(':').pop();
  const idFound = Boolean(eventId) && (
    String(body).includes(eventId) || normalized.includes(normalizeText(eventId))
  );
  const priceFound = (candidate?.prices || []).some((check) => textContainsPrice(body, check.price));
  return ((homeFound && awayFound) || idFound) && priceFound;
}

function extractNetworkRowsFromBody(body, candidate, url) {
  const parsed = tryParseJson(body);
  const rows = [];
  const maybePush = (text) => {
    const normalized = normalizeWhitespace(text);
    if (!normalized || normalized.length < 12 || normalized.length > 2500) return;
    if (!(candidate.prices || []).some((check) => textContainsPrice(normalized, check.price))) return;
    rows.push({
      source: 'network-payload',
      adapterId: 'network-payload',
      networkUrl: url,
      text: normalized,
    });
  };

  if (parsed) {
    // Prefer compact market+outcome+price rows for Superbet-style offer payloads.
    visitJsonNodes(parsed, (node) => {
      if (!node || typeof node !== 'object' || Array.isArray(node)) return;
      const marketName = node.marketName || node.market || node.name || node.market_name;
      const outcomeName = node.outcomeName || node.selectionName || node.oddName || node.name;
      const price = node.price ?? node.odd ?? node.odds ?? node.decimalPrice;
      if (marketName && outcomeName && Number.isFinite(Number(price))) {
        maybePush(`${marketName} ${outcomeName} ${Number(price).toFixed(2)}`);
      }
      maybePush(JSON.stringify(node));
    });
  } else {
    maybePush(body.slice(0, 2500));
  }

  return rows.slice(0, 120);
}

function visitJsonNodes(node, visit, depth = 0) {
  if (depth > 8 || node === null || node === undefined) return;
  visit(node);
  if (Array.isArray(node)) {
    node.forEach((item) => visitJsonNodes(item, visit, depth + 1));
    return;
  }
  if (typeof node === 'object') {
    Object.values(node).forEach((item) => visitJsonNodes(item, visit, depth + 1));
  }
}

function tryParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function safeHostname(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return '';
  }
}

async function acceptCookiePrompt(page) {
  const labels = [
    /accept/i,
    /accepta/i,
    /acceptă/i,
    /de acord/i,
    /^ok$/i,
  ];
  for (const label of labels) {
    const button = page.getByRole('button', { name: label }).first();
    if (await button.count().catch(() => 0)) {
      await button.click({ timeout: 1_500 }).catch(() => {});
      return;
    }
  }
}

function decimalPriceVariants(price) {
  const number = Number(price);
  if (!Number.isFinite(number)) {
    return [];
  }
  const fixed = number.toFixed(2);
  const trimmed = fixed.replace(/\.?0+$/, '');
  return [...new Set([
    fixed,
    fixed.replace('.', ','),
    trimmed,
    trimmed.replace('.', ','),
  ])];
}

function parseVerifierMarketFilters(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function textContainsPrice(value, price) {
  const compact = normalizeWhitespace(value);
  return decimalPriceVariants(price).some((variant) => {
    const normalizedVariant = variant.replace(/[.,]/g, '[.,]');
    const pattern = new RegExp(`(^|[^0-9])${normalizedVariant}([^0-9]|$)`);
    return pattern.test(compact);
  });
}

function containsText(haystack, needle) {
  const normalizedHaystack = normalizeText(haystack);
  const normalizedNeedle = normalizeText(needle);
  if (!normalizedNeedle) {
    return false;
  }
  return normalizedHaystack.includes(normalizedNeedle);
}

function normalizeText(value) {
  return normalizeWhitespace(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function compactText(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, '');
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeNumber(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function stringOption(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function booleanOption(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function slug(value) {
  const normalized = normalizeText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'bookmaker';
}

function withTimeout(promise, timeoutMs, label) {
  let timeout;
  const timer = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timer]).finally(() => clearTimeout(timeout));
}

module.exports = {
  collectPriceChecks,
  decimalPriceVariants,
  eventMeetsMinHours,
  isAllowedNetworkEvidenceHost,
  networkBodyMatchesCandidate,
  providerMatches,
  selectCandidate,
  slug,
  textContainsPrice,
  verifyCandidateOnPage,
  verifyCandidateWithPlaywright,
  withTimeout,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
