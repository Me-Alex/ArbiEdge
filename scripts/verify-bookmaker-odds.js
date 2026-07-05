#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildDirectProviders, providerOptionsFromEnv } = require('../src/provider-config');
const { getMarketLabel, getOutcomeLabel } = require('../src/formula-engine');
const { launchBrowser } = require('./ui-smoke');

const DEFAULT_BOOKMAKER = 'GetsBet';
const DEFAULT_EVENT_TARGET = 40;
const DEFAULT_MAX_PRICES = 8;
const DEFAULT_MIN_HOURS = 0;
const DEFAULT_TIMEOUT_MS = 30_000;
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
  const marketFilter = stringOption(args.market, process.env.VERIFY_MARKET, '');
  const maxPrices = positiveInteger(args.prices || process.env.VERIFY_MAX_PRICES, DEFAULT_MAX_PRICES);
  const minHours = nonNegativeNumber(args.minHours || process.env.VERIFY_MIN_HOURS, DEFAULT_MIN_HOURS);
  const timeoutMs = positiveInteger(args.timeoutMs || process.env.VERIFY_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const eventTarget = positiveInteger(
    args.eventTarget || process.env.VERIFY_EVENT_TARGET || process.env.BOOKMAKER_EVENT_TARGET,
    DEFAULT_EVENT_TARGET,
  );

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

  const report = await verifyCandidateWithPlaywright(candidate, { timeoutMs });

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

Options:
  --provider <name>       Provider to fetch from. Defaults to the bookmaker name.
  --bookmaker <name>      Bookmaker brand to verify. Defaults to ${DEFAULT_BOOKMAKER}.
  --event <text>          Optional home/away/competition filter.
  --market <key/text>     Optional market key filter, such as h2h or totalGoals.
  --prices <number>       Max prices to check on the page. Defaults to ${DEFAULT_MAX_PRICES}.
  --min-hours <number>    Skip events closer than this many hours to kickoff.
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
  const normalizedMarketFilter = normalizeText(marketFilter);
  const compactMarketFilter = compactText(marketFilter);
  const checks = [];
  const marketEntries = Object.entries(bookmaker.markets || {})
    .filter(([marketKey]) => {
      if (!normalizedMarketFilter) return true;
      return normalizeText(marketKey).includes(normalizedMarketFilter)
        || normalizeText(getMarketLabel(marketKey)).includes(normalizedMarketFilter)
        || compactText(marketKey).includes(compactMarketFilter)
        || compactText(getMarketLabel(marketKey)).includes(compactMarketFilter);
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

async function verifyCandidateWithPlaywright(candidate, { timeoutMs }) {
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({
      locale: 'ro-RO',
      viewport: { width: 1440, height: 1000 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    });
    const page = await context.newPage();
    try {
      await page.goto(candidate.bookmaker.url, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs,
      });
      await acceptCookiePrompt(page);
      await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});
      await page.waitForTimeout(1_000);

      const text = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
      const html = await page.content().catch(() => '');
      const visibleText = normalizeWhitespace(text);
      const screenshotPath = path.join(
        OUTPUT_DIR,
        `${slug(candidate.bookmaker.name)}-odds-verification.png`,
      );
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});

      const teamEvidence = {
        homeTeam: candidate.event.homeTeam,
        awayTeam: candidate.event.awayTeam,
        homeFound: containsText(visibleText, candidate.event.homeTeam),
        awayFound: containsText(visibleText, candidate.event.awayTeam),
      };
      const priceChecks = candidate.prices.map((check) => ({
        ...check,
        variants: decimalPriceVariants(check.price),
        found: textContainsPrice(visibleText, check.price),
        foundInHtml: textContainsPrice(html, check.price),
      }));
      const missingPrices = priceChecks.filter((check) => !check.found);
      const ok = teamEvidence.homeFound
        && teamEvidence.awayFound
        && missingPrices.length === 0
        && priceChecks.length > 0;

      return {
        ok,
        checkedAt: new Date().toISOString(),
        bookmaker: candidate.bookmaker,
        event: {
          homeTeam: candidate.event.homeTeam,
          awayTeam: candidate.event.awayTeam,
          competition: candidate.event.competition,
          startsAt: candidate.event.startsAt,
        },
        teamEvidence,
        priceChecks,
        missingPrices,
        screenshotPath,
        pageTextSample: visibleText.slice(0, 500),
      };
    } finally {
      await context.close().catch(() => {});
    }
  } finally {
    await browser.close().catch(() => {});
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

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  collectPriceChecks,
  decimalPriceVariants,
  eventMeetsMinHours,
  providerMatches,
  selectCandidate,
  textContainsPrice,
};
