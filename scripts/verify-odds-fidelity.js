#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildDirectProviders, providerOptionsFromEnv } = require('../src/provider-config');
const { launchBrowser } = require('./ui-smoke');
const {
  collectPriceChecks,
  eventMeetsMinHours,
  providerMatches,
  slug,
  verifyCandidateOnPage,
  withTimeout,
} = require('./verify-bookmaker-odds');
const {
  DEFAULT_MARKET_FILTERS,
  DEFAULT_PRICE_TOLERANCE,
  FIDELITY_STATUSES,
  parseMarketList,
  summarizeFidelityRecords,
} = require('./odds-fidelity-core');

const DEFAULT_BOOKMAKER_TARGET = 'all';
const DEFAULT_PROVIDER_TARGET = 'all';
const DEFAULT_EVENTS_PER_BOOKMAKER = 3;
const DEFAULT_MAX_PRICES = 5;
const DEFAULT_MIN_HOURS = 1;
const DEFAULT_EVENT_TARGET = 40;
const DEFAULT_TIMEOUT_MS = 30_000;
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright', 'fidelity');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const report = await runFidelityVerification({
    bookmakerTarget: stringOption(args.bookmaker, process.env.VERIFY_BOOKMAKER, DEFAULT_BOOKMAKER_TARGET),
    providerTarget: stringOption(args.provider, process.env.VERIFY_PROVIDER, DEFAULT_PROVIDER_TARGET),
    eventFilter: stringOption(args.event, process.env.VERIFY_EVENT, ''),
    marketFilters: parseMarketList(
      stringOption(args.markets, args.market, process.env.VERIFY_MARKETS, process.env.VERIFY_MARKET, ''),
      DEFAULT_MARKET_FILTERS,
    ),
    eventsPerBookmaker: positiveInteger(
      args.eventsPerBookmaker || process.env.VERIFY_EVENTS_PER_BOOKMAKER,
      DEFAULT_EVENTS_PER_BOOKMAKER,
    ),
    maxPrices: positiveInteger(args.prices || process.env.VERIFY_MAX_PRICES, DEFAULT_MAX_PRICES),
    minHours: nonNegativeNumber(args.minHours || process.env.VERIFY_MIN_HOURS, DEFAULT_MIN_HOURS),
    eventTarget: positiveInteger(
      args.eventTarget || process.env.VERIFY_EVENT_TARGET || process.env.BOOKMAKER_EVENT_TARGET,
      DEFAULT_EVENT_TARGET,
    ),
    timeoutMs: positiveInteger(args.timeoutMs || process.env.VERIFY_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    strictContext: booleanOption(args.strictContext || process.env.VERIFY_STRICT_CONTEXT, true),
    priceTolerance: nonNegativeNumber(
      args.priceTolerance || process.env.VERIFY_PRICE_TOLERANCE,
      DEFAULT_PRICE_TOLERANCE,
    ),
    outputDir: stringOption(args.outputDir, process.env.VERIFY_OUTPUT_DIR, OUTPUT_DIR),
  });

  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) {
    process.exitCode = 1;
  }
}

async function runFidelityVerification(options = {}) {
  const bookmakerTarget = options.bookmakerTarget || DEFAULT_BOOKMAKER_TARGET;
  const providerTarget = options.providerTarget || DEFAULT_PROVIDER_TARGET;
  const eventFilter = options.eventFilter || '';
  const marketFilters = parseMarketList(options.marketFilters, DEFAULT_MARKET_FILTERS);
  const eventsPerBookmaker = positiveInteger(options.eventsPerBookmaker, DEFAULT_EVENTS_PER_BOOKMAKER);
  const maxPrices = positiveInteger(options.maxPrices, DEFAULT_MAX_PRICES);
  const minHours = nonNegativeNumber(options.minHours, DEFAULT_MIN_HOURS);
  const eventTarget = positiveInteger(options.eventTarget, DEFAULT_EVENT_TARGET);
  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const strictContext = options.strictContext !== false;
  const priceTolerance = nonNegativeNumber(options.priceTolerance, DEFAULT_PRICE_TOLERANCE);
  const concurrency = positiveInteger(options.concurrency, 2);
  const outputDir = options.outputDir || OUTPUT_DIR;
  const checkedAt = new Date().toISOString();
  const providers = selectProviders(providerTarget, eventTarget, timeoutMs);
  const providerFailures = [];
  const reports = [];

  fs.mkdirSync(outputDir, { recursive: true });

  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({
      locale: 'ro-RO',
      viewport: { width: 1440, height: 1000 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    });
    const page = await context.newPage();
    try {
      for (const provider of providers) {
        let events;
        try {
          events = await withTimeout(
            provider.getOdds(),
            timeoutMs,
            `${provider.name} getOdds`,
          );
        } catch (error) {
          providerFailures.push({
            provider: provider.name,
            error: error.message,
          });
          continue;
        }

        const candidates = selectFidelityCandidates(events, {
          bookmakerTarget,
          eventFilter,
          marketFilters,
          eventsPerBookmaker,
          maxPrices,
          minHours,
          now: options.now || new Date(),
        });

        for (let index = 0; index < candidates.length; index += 1) {
          const candidate = {
            ...candidates[index],
            provider: provider.name,
          };
          const screenshotPath = path.join(
            outputDir,
            `${slug(candidate.bookmaker.name)}-${slug(candidate.event.homeTeam)}-${slug(candidate.event.awayTeam)}-${index + 1}.png`,
          );
          try {
            const report = await verifyCandidateOnPage(page, candidate, {
              timeoutMs,
              strictContext,
              priceTolerance,
              outputDir,
              screenshotPath,
            });
            reports.push({
              provider: provider.name,
              ...report,
            });
          } catch (error) {
            reports.push({
              ok: false,
              provider: provider.name,
              checkedAt: new Date().toISOString(),
              strictContext,
              priceTolerance,
              bookmaker: candidate.bookmaker,
              event: {
                id: candidate.event.id || null,
                homeTeam: candidate.event.homeTeam,
                awayTeam: candidate.event.awayTeam,
                competition: candidate.event.competition,
                startsAt: candidate.event.startsAt,
              },
              fidelitySummary: {
                total: candidate.prices.length,
                statusCounts: { [FIDELITY_STATUSES.unverifiable]: candidate.prices.length },
                ok: false,
              },
              priceChecks: candidate.prices.map((check) => ({
                ...check,
                bookmaker: candidate.bookmaker.name,
                eventUrl: candidate.bookmaker.url,
                endpointPrice: check.price,
                websitePrice: null,
                status: FIDELITY_STATUSES.unverifiable,
                evidence: { reason: error.message },
                found: false,
              })),
              missingPrices: candidate.prices,
              screenshotPath,
              error: error.message,
            });
          }
        }
      }
    } finally {
      await context.close().catch(() => {});
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const priceRecords = reports.flatMap((report) => report.priceChecks || []);
  const fidelitySummary = summarizeFidelityRecords(priceRecords);
  const verificationRecords = normalizeVerificationRecords(reports);
  const verificationIndex = buildVerificationIndex(verificationRecords);
  const problemSummary = summarizeVerificationProblems(verificationRecords);
  const report = {
    ok: priceRecords.length > 0
      && providerFailures.length === 0
      && priceRecords.every((record) => record.status === FIDELITY_STATUSES.verified),
    checkedAt,
    options: {
      bookmakerTarget,
      providerTarget,
      eventFilter,
      marketFilters,
      eventsPerBookmaker,
      maxPrices,
      minHours,
      eventTarget,
      timeoutMs,
      strictContext,
      priceTolerance,
    },
    providerCount: providers.length,
    providerFailures,
    eventReports: reports,
    fidelitySummary,
    verificationRecords,
    verificationIndex,
    problemSummary,
  };

  const timestamp = checkedAt.replace(/[:.]/g, '-');
  const reportPath = path.join(outputDir, `fidelity-report-${timestamp}.json`);
  const latestReportPath = path.join(outputDir, 'fidelity-report.json');
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(latestReportPath, `${JSON.stringify(report, null, 2)}\n`);

  return {
    ...report,
    reportPath,
    latestReportPath,
  };
}

/**
 * Verify an already-prioritized list of event/bookmaker candidates. This is
 * used by the autonomous scanner so browser work follows real arbitrage legs
 * instead of sampling unrelated markets.
 */
async function runCandidateFidelityVerification(candidates, options = {}) {
  const selected = (Array.isArray(candidates) ? candidates : [])
    .filter((candidate) => candidate?.event && candidate?.bookmaker?.url && candidate?.prices?.length)
    .slice(0, positiveInteger(options.maxCandidates, candidates?.length || 1));
  const checkedAt = (options.now instanceof Date ? options.now : new Date()).toISOString();
  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const strictContext = options.strictContext !== false;
  const priceTolerance = nonNegativeNumber(options.priceTolerance, DEFAULT_PRICE_TOLERANCE);
  const outputDir = options.outputDir || OUTPUT_DIR;
  const reports = [];

  if (selected.length === 0) {
    return emptyCandidateVerificationReport(checkedAt);
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await (options.launchBrowser || launchBrowser)();
  try {
    const context = await browser.newContext({
      locale: 'ro-RO',
      viewport: { width: 1440, height: 1000 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    });
    try {
      let nextIndex = 0;
      const indexedReports = new Array(selected.length);
      await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, async () => {
        const page = await context.newPage();
        try {
          while (nextIndex < selected.length) {
            const index = nextIndex;
            nextIndex += 1;
            const candidate = selected[index];
            const screenshotPath = path.join(
              outputDir,
              `candidate-${slug(candidate.bookmaker.name)}-${slug(candidate.event.homeTeam)}-${slug(candidate.event.awayTeam)}-${index + 1}.png`,
            );
            try {
              const report = await verifyCandidateOnPage(page, candidate, {
                timeoutMs,
                strictContext,
                priceTolerance,
                outputDir,
                screenshotPath,
              });
              indexedReports[index] = { provider: candidate.provider || null, ...report };
            } catch (error) {
              indexedReports[index] = candidateFailureReport(candidate, error, {
                checkedAt: new Date().toISOString(),
                strictContext,
                priceTolerance,
                screenshotPath,
              });
            }
          }
        } finally {
          await page.close().catch(() => {});
        }
      }));
      reports.push(...indexedReports.filter(Boolean));
    } finally {
      await context.close().catch(() => {});
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const verificationRecords = normalizeVerificationRecords(reports);
  const fidelitySummary = summarizeFidelityRecords(verificationRecords);
  return {
    ok: verificationRecords.length > 0
      && verificationRecords.every((record) => record.status === FIDELITY_STATUSES.verified),
    checkedAt,
    candidateCount: selected.length,
    eventReports: reports,
    verificationRecords,
    verificationIndex: buildVerificationIndex(verificationRecords),
    fidelitySummary,
    problemSummary: summarizeVerificationProblems(verificationRecords),
  };
}

function candidateFailureReport(candidate, error, {
  checkedAt,
  strictContext,
  priceTolerance,
  screenshotPath,
}) {
  return {
    ok: false,
    provider: candidate.provider || null,
    checkedAt,
    strictContext,
    priceTolerance,
    bookmaker: candidate.bookmaker,
    event: {
      id: candidate.event.id || null,
      homeTeam: candidate.event.homeTeam,
      awayTeam: candidate.event.awayTeam,
      competition: candidate.event.competition,
      startsAt: candidate.event.startsAt,
    },
    priceChecks: candidate.prices.map((check) => ({
      ...check,
      bookmaker: candidate.bookmaker.name,
      eventUrl: candidate.bookmaker.url,
      endpointPrice: check.endpointPrice ?? check.price,
      websitePrice: null,
      status: FIDELITY_STATUSES.unverifiable,
      evidence: { reason: error.message },
      found: false,
    })),
    screenshotPath,
    error: error.message,
  };
}

function emptyCandidateVerificationReport(checkedAt) {
  return {
    ok: true,
    checkedAt,
    candidateCount: 0,
    eventReports: [],
    verificationRecords: [],
    verificationIndex: {},
    fidelitySummary: summarizeFidelityRecords([]),
    problemSummary: { total: 0, byBookmaker: {} },
  };
}

function normalizeVerificationRecords(reports) {
  return (Array.isArray(reports) ? reports : []).flatMap((report) =>
    (report.priceChecks || []).map((check) => ({
      provider: report.provider || null,
      bookmaker: check.bookmaker || report.bookmaker?.name || '',
      eventId: check.eventId || report.event?.id || null,
      eventUrl: check.eventUrl || report.bookmaker?.url || '',
      homeTeam: check.homeTeam || report.event?.homeTeam || '',
      awayTeam: check.awayTeam || report.event?.awayTeam || '',
      competition: check.competition || report.event?.competition || '',
      startsAt: check.startsAt || report.event?.startsAt || null,
      marketKey: check.marketKey,
      marketLabel: check.marketLabel || '',
      marketFamily: check.marketFamily || null,
      period: check.period || null,
      line: check.line ?? null,
      teamScope: check.teamScope || null,
      outcome: check.outcome,
      outcomeLabel: check.outcomeLabel || '',
      endpointPrice: check.endpointPrice ?? check.price,
      websitePrice: check.websitePrice ?? null,
      status: check.status || FIDELITY_STATUSES.notFound,
      evidence: check.evidence || {},
      screenshotPath: report.screenshotPath || null,
      checkedAt: report.checkedAt || null,
    })));
}

function buildVerificationIndex(records) {
  const index = {};
  for (const record of records || []) {
    const bookmakerKey = record.bookmaker || 'Unknown';
    const eventKey = record.eventId || record.eventUrl || `${record.homeTeam} vs ${record.awayTeam}`;
    index[bookmakerKey] ||= {};
    index[bookmakerKey][eventKey] ||= {
      eventUrl: record.eventUrl,
      homeTeam: record.homeTeam,
      awayTeam: record.awayTeam,
      competition: record.competition,
      startsAt: record.startsAt,
      markets: {},
    };
    const eventNode = index[bookmakerKey][eventKey];
    eventNode.markets[record.marketKey] ||= {};
    eventNode.markets[record.marketKey][record.outcome] = {
      status: record.status,
      endpointPrice: record.endpointPrice,
      websitePrice: record.websitePrice,
      marketFamily: record.marketFamily,
      period: record.period,
      line: record.line,
      teamScope: record.teamScope,
    };
  }
  return index;
}

function summarizeVerificationProblems(records) {
  const problems = (records || []).filter((record) => record.status !== FIDELITY_STATUSES.verified);
  const byBookmaker = {};
  for (const record of problems) {
    const key = record.bookmaker || 'Unknown';
    byBookmaker[key] ||= {
      total: 0,
      statuses: {},
      markets: {},
    };
    byBookmaker[key].total += 1;
    byBookmaker[key].statuses[record.status] = (byBookmaker[key].statuses[record.status] || 0) + 1;
    const marketKey = `${record.marketKey}:${record.outcome}`;
    byBookmaker[key].markets[marketKey] ||= {
      marketKey: record.marketKey,
      outcome: record.outcome,
      statuses: {},
      samples: [],
    };
    const market = byBookmaker[key].markets[marketKey];
    market.statuses[record.status] = (market.statuses[record.status] || 0) + 1;
    if (market.samples.length < 3) {
      market.samples.push({
        event: `${record.homeTeam} vs ${record.awayTeam}`,
        eventUrl: record.eventUrl,
        endpointPrice: record.endpointPrice,
        websitePrice: record.websitePrice,
        status: record.status,
      });
    }
  }
  return {
    total: problems.length,
    byBookmaker,
  };
}

function selectProviders(providerTarget, eventTarget, timeoutMs) {
  const env = {
    ...process.env,
    BOOKMAKER_EVENT_TARGET: String(eventTarget),
    ODDS_EVENT_TARGET: String(eventTarget),
    ODDS_REQUEST_TIMEOUT_MS: String(timeoutMs),
  };
  const providers = buildDirectProviders(providerOptionsFromEnv(env));
  if (normalizeText(providerTarget) === 'all') {
    return providers;
  }
  const selected = providers.filter((provider) => providerMatches(provider, providerTarget));
  if (selected.length === 0) {
    throw new Error(`Provider "${providerTarget}" not found.`);
  }
  return selected;
}

function selectFidelityCandidates(events, {
  bookmakerTarget = DEFAULT_BOOKMAKER_TARGET,
  eventFilter = '',
  marketFilters = DEFAULT_MARKET_FILTERS,
  eventsPerBookmaker = DEFAULT_EVENTS_PER_BOOKMAKER,
  maxPrices = DEFAULT_MAX_PRICES,
  minHours = DEFAULT_MIN_HOURS,
  now = new Date(),
} = {}) {
  const candidates = [];
  const countsByBookmaker = new Map();
  const normalizedEventFilter = normalizeText(eventFilter);
  const minStartsAt = new Date(now.getTime() + (Number(minHours) || 0) * 60 * 60 * 1000);
  const allBookmakers = normalizeText(bookmakerTarget) === 'all';

  for (const event of Array.isArray(events) ? events : []) {
    if (isLiveEvent(event) || !eventMeetsMinHours(event, minStartsAt)) {
      continue;
    }
    const eventText = normalizeText(`${event.homeTeam} ${event.awayTeam} ${event.competition}`);
    if (normalizedEventFilter && !eventText.includes(normalizedEventFilter)) {
      continue;
    }

    for (const bookmaker of event.bookmakers || []) {
      if (!allBookmakers && !providerMatches({ name: bookmaker.name }, bookmakerTarget)) {
        continue;
      }
      const bookmakerName = bookmaker.name || 'Unknown';
      const currentCount = countsByBookmaker.get(bookmakerName) || 0;
      if (currentCount >= eventsPerBookmaker) {
        continue;
      }
      const url = bookmaker.eventUrl || bookmaker.bookmakerUrl || '';
      if (!url) {
        continue;
      }
      const prices = collectPriceChecks(bookmaker, {
        marketFilter: marketFilters,
        maxPrices,
      });
      if (prices.length === 0) {
        continue;
      }

      countsByBookmaker.set(bookmakerName, currentCount + 1);
      candidates.push({
        event,
        bookmaker: {
          name: bookmakerName,
          url,
          urlSource: bookmaker.eventUrl ? 'eventUrl' : 'bookmakerUrl',
        },
        prices,
      });
    }
  }

  return candidates;
}

function isLiveEvent(event) {
  return Boolean(
    event?.live ||
    event?.isLive ||
    event?.inPlay ||
    event?.status === 'live' ||
    event?.status === 'in_play',
  );
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

function printHelp() {
  console.log(`
Verify endpoint odds against bookmaker websites with strict event/market/line/outcome context.

Usage:
  node scripts/verify-odds-fidelity.js --bookmaker all --events-per-bookmaker 3 --markets h2h,totalGoals,totalCorners,bothTeamsToScore
  node scripts/verify-odds-fidelity.js --bookmaker Unibet --provider Unibet --markets totalGoals

Options:
  --provider <name|all>       Provider to fetch from. Defaults to all direct providers.
  --bookmaker <name|all>      Bookmaker brand to verify. Defaults to all.
  --event <text>              Optional home/away/competition filter.
  --markets <csv>             Defaults to ${DEFAULT_MARKET_FILTERS.join(',')}.
  --prices <number>           Max prices per event. Defaults to ${DEFAULT_MAX_PRICES}.
  --events-per-bookmaker <n>  Future events per bookmaker. Defaults to ${DEFAULT_EVENTS_PER_BOOKMAKER}.
  --min-hours <number>        Skip events closer than this many hours to kickoff.
  --strict-context            Enabled by default for this script.
  --price-tolerance <n>       Decimal price tolerance. Defaults to ${DEFAULT_PRICE_TOLERANCE}.
  --event-target <number>     Provider event target. Defaults to ${DEFAULT_EVENT_TARGET}.
  --timeout-ms <number>       Fetch and browser timeout. Defaults to ${DEFAULT_TIMEOUT_MS}.
  --output-dir <path>         Defaults to ${OUTPUT_DIR}.
`.trim());
}

function toCamelCase(value) {
  return String(value || '').replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
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

module.exports = {
  buildVerificationIndex,
  isLiveEvent,
  runFidelityVerification,
  selectFidelityCandidates,
  normalizeVerificationRecords,
  runCandidateFidelityVerification,
  summarizeVerificationProblems,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
