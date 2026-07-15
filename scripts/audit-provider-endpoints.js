#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  buildDirectProviders,
  providerOptionsFromEnv,
} = require('../src/provider-config');

const DEFAULT_EVENT_TARGET = 25;
const DEFAULT_TIMEOUT_MS = 35_000;
const DEFAULT_CONCURRENCY = 1;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const eventTarget = positiveInteger(
    args.eventTarget || process.env.AUDIT_EVENT_TARGET,
    DEFAULT_EVENT_TARGET,
  );
  const timeoutMs = positiveInteger(
    args.timeoutMs || process.env.AUDIT_PROVIDER_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
  );
  const concurrency = positiveInteger(
    args.concurrency || process.env.AUDIT_CONCURRENCY,
    DEFAULT_CONCURRENCY,
  );
  const env = buildAuditEnv(process.env, { eventTarget });
  const providers = selectProviders(
    buildDirectProviders(providerOptionsFromEnv(env)),
    args.provider || process.env.AUDIT_PROVIDERS || 'all',
  );
  const results = await auditProviders(providers, { concurrency, timeoutMs });
  const report = buildAuditReport(results);
  const output = `${JSON.stringify(report, null, args.compact ? 0 : 2)}\n`;

  if (args.output) {
    const outputPath = path.resolve(args.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, output);
  }
  process.stdout.write(output);
  if (!report.ok) {
    process.exitCode = 1;
  }
}

function buildAuditEnv(env = process.env, { eventTarget = DEFAULT_EVENT_TARGET } = {}) {
  return {
    ...env,
    BOOKMAKER_EVENT_TARGET: String(eventTarget),
    ODDS_EVENT_TARGET: String(eventTarget),
    ODDS_REQUEST_TIMEOUT_MS: env.ODDS_REQUEST_TIMEOUT_MS || '12000',
    SUPERBET_LOOKAHEAD_DAYS: env.SUPERBET_LOOKAHEAD_DAYS || '3',
    UFO_MAX_PAGES: env.UFO_MAX_PAGES || '1',
    UFO_PAGE_SIZE: env.UFO_PAGE_SIZE || '30',
    NETBET_MAX_DETAIL_EVENTS: env.NETBET_MAX_DETAIL_EVENTS || '3',
    NETBET_DETAILS_CONCURRENCY: env.NETBET_DETAILS_CONCURRENCY || '2',
    BETONE_MAX_DETAIL_EVENTS: env.BETONE_MAX_DETAIL_EVENTS || '3',
    BETONE_DETAILS_CONCURRENCY: env.BETONE_DETAILS_CONCURRENCY || '2',
    DIGITAIN_LOOKAHEAD_DAYS: env.DIGITAIN_LOOKAHEAD_DAYS || '3',
    DIGITAIN_WINDOW_DAYS: env.DIGITAIN_WINDOW_DAYS || '1',
    DIGITAIN_WINDOW_CONCURRENCY: env.DIGITAIN_WINDOW_CONCURRENCY || '1',
    EGT_PAGE_SIZE: env.EGT_PAGE_SIZE || '30',
    EGT_MARKET_COUNT: env.EGT_MARKET_COUNT || '20',
    EGT_LOOKAHEAD_DAYS: env.EGT_LOOKAHEAD_DAYS || '3',
    GETSBET_MAX_TOURNAMENTS: env.GETSBET_MAX_TOURNAMENTS || '10',
    GETSBET_MAX_DETAIL_EVENTS: env.GETSBET_MAX_DETAIL_EVENTS || '3',
    GETSBET_CONCURRENCY: env.GETSBET_CONCURRENCY || '2',
    LASVEGAS_MAX_DETAIL_EVENTS: env.LASVEGAS_MAX_DETAIL_EVENTS || '3',
    LASVEGAS_DETAILS_CONCURRENCY: env.LASVEGAS_DETAILS_CONCURRENCY || '2',
    UNIBET_CATEGORY_LIMIT: env.UNIBET_CATEGORY_LIMIT || '4',
    UNIBET_DETAIL_LIMIT: env.UNIBET_DETAIL_LIMIT || '3',
    UNIBET_REQUEST_CONCURRENCY: env.UNIBET_REQUEST_CONCURRENCY || '2',
    XSPORT_LOOKAHEAD_DAYS: env.XSPORT_LOOKAHEAD_DAYS || '3',
  };
}

function selectProviders(providers, target = 'all') {
  const filters = String(target || 'all')
    .split(',')
    .map(normalizeText)
    .filter(Boolean);
  if (filters.length === 0 || filters.includes('all')) {
    return providers;
  }

  const selected = providers.filter((provider) => {
    const names = providerNames(provider).map(normalizeText);
    return filters.some((filter) => names.some((name) => name === filter));
  });
  if (selected.length === 0) {
    const available = providers.flatMap(providerNames).join(', ');
    throw new Error(`No providers matched "${target}". Available: ${available}`);
  }
  return selected;
}

async function auditProviders(providers, { concurrency = DEFAULT_CONCURRENCY, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const results = new Array(providers.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, providers.length));

  async function worker() {
    while (nextIndex < providers.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await auditProvider(providers[index], { timeoutMs });
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function auditProvider(provider, { timeoutMs = DEFAULT_TIMEOUT_MS, now = new Date() } = {}) {
  const startedAt = Date.now();
  try {
    const events = await withTimeout(
      provider.getOdds(),
      timeoutMs,
      `${provider.name} endpoint audit`,
    );
    return summarizeProviderEvents(provider, events, {
      checkedAt: now.toISOString(),
      durationMs: Date.now() - startedAt,
      now,
    });
  } catch (error) {
    return {
      provider: provider.name,
      configuredNames: providerNames(provider),
      endpoints: publicEndpoints(provider),
      status: 'failed',
      ok: false,
      durationMs: Date.now() - startedAt,
      checkedAt: now.toISOString(),
      error: error.message,
    };
  }
}

function summarizeProviderEvents(provider, events, { checkedAt, durationMs, now = new Date() } = {}) {
  const rows = Array.isArray(events) ? events : [];
  const bookmakerRows = rows.flatMap((event) =>
    (Array.isArray(event?.bookmakers) ? event.bookmakers : [])
      .map((bookmaker) => ({ event, bookmaker })));
  const configuredNames = providerNames(provider).filter((name) => name !== provider.name || !provider.brands);
  const brandStats = {};
  let marketCount = 0;
  let validPriceCount = 0;
  let invalidPriceCount = 0;
  let bookmakerRowsWithCompleteMarket = 0;

  for (const { bookmaker } of bookmakerRows) {
    const name = String(bookmaker?.name || 'Unknown').trim() || 'Unknown';
    brandStats[name] ||= { events: 0, markets: 0, prices: 0 };
    brandStats[name].events += 1;
    let hasCompleteMarket = false;
    for (const outcomes of Object.values(bookmaker?.markets || {})) {
      if (!outcomes || typeof outcomes !== 'object' || Array.isArray(outcomes)) {
        continue;
      }
      marketCount += 1;
      brandStats[name].markets += 1;
      const prices = Object.values(outcomes);
      const valid = prices.filter(isValidPrice).length;
      validPriceCount += valid;
      invalidPriceCount += prices.length - valid;
      brandStats[name].prices += valid;
      if (valid >= 2) {
        hasCompleteMarket = true;
      }
    }
    if (hasCompleteMarket) {
      bookmakerRowsWithCompleteMarket += 1;
    }
  }

  const startTimes = rows
    .map((event) => Date.parse(event?.startsAt))
    .filter(Number.isFinite);
  const malformedEventCount = rows.filter((event) =>
    !String(event?.homeTeam || '').trim()
      || !String(event?.awayTeam || '').trim()
      || !Number.isFinite(Date.parse(event?.startsAt))).length;
  const staleBefore = now.getTime() - 6 * 60 * 60 * 1000;
  const staleEventCount = startTimes.filter((timestamp) => timestamp < staleBefore).length;
  const observedBrands = Object.keys(brandStats);
  const missingBrands = configuredNames.filter((name) => !observedBrands.includes(name));
  const hasCoreData = rows.length > 0
    && bookmakerRows.length > 0
    && marketCount > 0
    && validPriceCount > 0;
  const hasQualityIssues = malformedEventCount > 0
    || invalidPriceCount > 0
    || missingBrands.length > 0;
  const status = !hasCoreData ? 'failed' : hasQualityIssues ? 'degraded' : 'healthy';

  return {
    provider: provider.name,
    configuredNames,
    endpoints: publicEndpoints(provider),
    status,
    ok: status === 'healthy',
    checkedAt,
    durationMs,
    events: rows.length,
    bookmakerRows: bookmakerRows.length,
    bookmakerRowsWithCompleteMarket,
    marketCount,
    validPriceCount,
    invalidPriceCount,
    malformedEventCount,
    staleEventCount,
    missingBrands,
    earliestStart: isoForTimestamp(startTimes.length ? Math.min(...startTimes) : NaN),
    latestStart: isoForTimestamp(startTimes.length ? Math.max(...startTimes) : NaN),
    brands: brandStats,
    sample: rows[0] ? {
      homeTeam: rows[0].homeTeam,
      awayTeam: rows[0].awayTeam,
      competition: rows[0].competition,
      startsAt: rows[0].startsAt,
    } : null,
  };
}

function buildAuditReport(results, checkedAt = new Date().toISOString()) {
  const rows = Array.isArray(results) ? results : [];
  const counts = {
    healthy: rows.filter((result) => result.status === 'healthy').length,
    degraded: rows.filter((result) => result.status === 'degraded').length,
    failed: rows.filter((result) => result.status === 'failed').length,
  };
  return {
    ok: counts.degraded === 0 && counts.failed === 0,
    checkedAt,
    summary: {
      providers: rows.length,
      ...counts,
      events: rows.reduce((total, result) => total + (result.events || 0), 0),
      markets: rows.reduce((total, result) => total + (result.marketCount || 0), 0),
      validPrices: rows.reduce((total, result) => total + (result.validPriceCount || 0), 0),
    },
    results: rows,
  };
}

function publicEndpoints(provider) {
  const values = [];
  for (const [key, value] of Object.entries(provider || {})) {
    if (!/(?:url|origin|domain)$/i.test(key) || /(?:key|token|secret|password)/i.test(key)) {
      continue;
    }
    if (typeof value === 'string' && /^(?:https?|wss):\/\//i.test(value)) {
      values.push(value);
    }
  }
  return [...new Set(values)];
}

function providerNames(provider) {
  return [
    provider?.name,
    ...(Array.isArray(provider?.brands) ? provider.brands.map((brand) => brand.name) : []),
  ].filter(Boolean);
}

function isValidPrice(value) {
  const price = Number(value);
  return Number.isFinite(price) && price > 1 && price <= 1000;
}

function isoForTimestamp(timestamp) {
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    const stripped = item.slice(2);
    if (stripped === 'help' || stripped === 'h') {
      result.help = true;
      continue;
    }
    if (stripped === 'compact') {
      result.compact = true;
      continue;
    }
    const equalsIndex = stripped.indexOf('=');
    if (equalsIndex >= 0) {
      result[toCamelCase(stripped.slice(0, equalsIndex))] = stripped.slice(equalsIndex + 1);
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      result[toCamelCase(stripped)] = true;
      continue;
    }
    result[toCamelCase(stripped)] = next;
    index += 1;
  }
  return result;
}

function toCamelCase(value) {
  return String(value || '').replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function printHelp() {
  process.stdout.write(`
Audit every configured direct bookmaker endpoint with bounded requests.

Usage:
  node scripts/audit-provider-endpoints.js
  node scripts/audit-provider-endpoints.js --provider Favbet,Unibet
  node scripts/audit-provider-endpoints.js --concurrency 2 --output output/endpoint-audit.json

Options:
  --provider <csv|all>  Provider or bookmaker names. Defaults to all.
  --event-target <n>    Requested event target. Defaults to ${DEFAULT_EVENT_TARGET}.
  --timeout-ms <n>      Overall timeout per provider. Defaults to ${DEFAULT_TIMEOUT_MS}.
  --concurrency <n>     Simultaneous providers. Defaults to ${DEFAULT_CONCURRENCY}.
  --output <path>       Also persist the JSON report.
  --compact             Print compact JSON.
`.trimStart());
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  auditProvider,
  auditProviders,
  buildAuditEnv,
  buildAuditReport,
  isValidPrice,
  parseArgs,
  providerNames,
  publicEndpoints,
  selectProviders,
  summarizeProviderEvents,
};
