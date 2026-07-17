#!/usr/bin/env node
'use strict';

/**
 * Full multi-bookmaker fidelity audit with progress logs, per-provider
 * isolation, intermediate reports, and hard timeouts so one slow adapter
 * cannot freeze the whole batch.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { buildDirectProviders, providerOptionsFromEnv } = require('../src/provider-config');
const {
  DEFAULT_MARKET_FILTERS,
  FIDELITY_STATUSES,
  summarizeFidelityRecords,
} = require('./odds-fidelity-core');

const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright', 'fidelity');
const DEFAULT_HARD_TIMEOUT_MS = 180_000;
const PROVIDER_HARD_TIMEOUT_OVERRIDES = Object.freeze({
  Unibet: 240_000,
  Superbet: 210_000,
  BetOne: 180_000,
  'Stanleybet family': 210_000,
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const markets = String(args.markets || process.env.VERIFY_MARKETS || DEFAULT_MARKET_FILTERS.join(','));
  const eventsPerBookmaker = positiveInteger(args.eventsPerBookmaker, 1);
  const prices = positiveInteger(args.prices, 5);
  const minHours = nonNegativeNumber(args.minHours, 2);
  const eventTarget = positiveInteger(args.eventTarget, 20);
  const timeoutMs = positiveInteger(args.timeoutMs, 35_000);
  const hardTimeoutMs = positiveInteger(args.hardTimeoutMs, DEFAULT_HARD_TIMEOUT_MS);
  const only = String(args.bookmaker || args.provider || 'all');

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const providers = listProviders(only, eventTarget, timeoutMs);
  console.error(`[fidelity-audit] providers=${providers.length} markets=${markets} events/book=${eventsPerBookmaker}`);

  const providerResults = [];
  const allPriceRecords = [];
  const allEventReports = [];
  const providerFailures = [];

  for (let index = 0; index < providers.length; index += 1) {
    const providerName = providers[index];
    const label = `[${index + 1}/${providers.length}] ${providerName}`;
    console.error(`[fidelity-audit] start ${label}`);
    const started = Date.now();

    try {
      const providerHardTimeoutMs = PROVIDER_HARD_TIMEOUT_OVERRIDES[providerName] || hardTimeoutMs;
      const report = await runProviderAudit(providerName, {
        markets,
        eventsPerBookmaker,
        prices,
        minHours,
        eventTarget,
        timeoutMs: providerName === 'Unibet' ? Math.max(timeoutMs, 60_000) : timeoutMs,
        hardTimeoutMs: providerHardTimeoutMs,
      });
      const durationMs = Date.now() - started;
      const summary = report.fidelitySummary || summarizeFidelityRecords(
        (report.eventReports || []).flatMap((item) => item.priceChecks || []),
      );
      const counts = summary.statusCounts || {};
      console.error(
        `[fidelity-audit] done  ${label} in ${Math.round(durationMs / 1000)}s`
        + ` verified=${counts.verified || 0}`
        + ` mismatch=${counts.mismatch || 0}`
        + ` not_found=${counts.not_found || 0}`
        + ` ambiguous=${counts.ambiguous || 0}`
        + ` unverifiable=${counts.unverifiable || 0}`
        + ` failures=${(report.providerFailures || []).length}`,
      );

      providerResults.push({
        provider: providerName,
        ok: Boolean(report.ok),
        durationMs,
        fidelitySummary: summary,
        providerFailures: report.providerFailures || [],
        eventCount: (report.eventReports || []).length,
        problemCount: report.problemSummary?.total || 0,
      });
      allEventReports.push(...(report.eventReports || []));
      allPriceRecords.push(
        ...(report.eventReports || []).flatMap((item) => item.priceChecks || []),
      );
      providerFailures.push(...(report.providerFailures || []));
    } catch (error) {
      const durationMs = Date.now() - started;
      console.error(`[fidelity-audit] FAIL  ${label} after ${Math.round(durationMs / 1000)}s: ${error.message}`);
      providerResults.push({
        provider: providerName,
        ok: false,
        durationMs,
        error: error.message,
        fidelitySummary: {
          total: 0,
          statusCounts: { [FIDELITY_STATUSES.unverifiable]: 0 },
          ok: false,
        },
        providerFailures: [{ provider: providerName, error: error.message }],
        eventCount: 0,
        problemCount: 0,
      });
      providerFailures.push({ provider: providerName, error: error.message });
    }

    writeIntermediateReport({
      providerResults,
      allPriceRecords,
      allEventReports,
      providerFailures,
      markets,
      eventsPerBookmaker,
      prices,
      minHours,
      eventTarget,
      timeoutMs,
    });
  }

  const finalReport = buildFinalReport({
    providerResults,
    allPriceRecords,
    allEventReports,
    providerFailures,
    markets,
    eventsPerBookmaker,
    prices,
    minHours,
    eventTarget,
    timeoutMs,
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(OUTPUT_DIR, `fidelity-audit-${stamp}.json`);
  const latestPath = path.join(OUTPUT_DIR, 'fidelity-audit-latest.json');
  const summaryPath = path.join(OUTPUT_DIR, 'fidelity-audit-summary.json');
  fs.writeFileSync(reportPath, `${JSON.stringify(finalReport, null, 2)}\n`);
  fs.writeFileSync(latestPath, `${JSON.stringify(finalReport, null, 2)}\n`);
  fs.writeFileSync(summaryPath, `${JSON.stringify(finalReport.summaryTable, null, 2)}\n`);

  console.log(JSON.stringify({
    ok: finalReport.ok,
    checkedAt: finalReport.checkedAt,
    totals: finalReport.fidelitySummary,
    byBookmaker: finalReport.summaryTable,
    reportPath,
    latestPath,
    summaryPath,
  }, null, 2));

  if (!finalReport.ok) {
    process.exitCode = 1;
  }
}

function listProviders(only, eventTarget, timeoutMs) {
  const env = {
    ...process.env,
    BOOKMAKER_EVENT_TARGET: String(eventTarget),
    ODDS_EVENT_TARGET: String(eventTarget),
    ODDS_REQUEST_TIMEOUT_MS: String(timeoutMs),
  };
  const providers = buildDirectProviders(providerOptionsFromEnv(env));
  const names = providers.map((provider) => provider.name);
  if (String(only).toLowerCase() === 'all') {
    return names;
  }
  // Support names with spaces: "Casa Pariurilor", "Stanleybet family".
  const wanted = String(only)
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return names.filter((name) => {
    const normalized = String(name).toLowerCase();
    return wanted.some((token) =>
      normalized === token
      || normalized.includes(token)
      || token.includes(normalized));
  });
}

function runProviderAudit(providerName, options) {
  const args = [
    path.join(__dirname, 'verify-odds-fidelity.js'),
    '--bookmaker', 'all',
    '--provider', providerName,
    '--markets', options.markets,
    '--events-per-bookmaker', String(options.eventsPerBookmaker),
    '--prices', String(options.prices),
    '--min-hours', String(options.minHours),
    '--event-target', String(options.eventTarget),
    '--timeout-ms', String(options.timeoutMs),
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const hardTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`hard timeout after ${options.hardTimeoutMs}ms`));
    }, options.hardTimeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      reject(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      try {
        const jsonStart = stdout.indexOf('{');
        if (jsonStart < 0) {
          throw new Error(stderr.trim() || `no JSON report (exit ${code})`);
        }
        const report = JSON.parse(stdout.slice(jsonStart));
        resolve(report);
      } catch (error) {
        reject(new Error(`${error.message}${stderr ? ` | ${stderr.trim().slice(0, 300)}` : ''}`));
      }
    });
  });
}

function writeIntermediateReport(state) {
  const report = buildFinalReport(state);
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'fidelity-audit-partial.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'fidelity-audit-summary.json'),
    `${JSON.stringify(report.summaryTable, null, 2)}\n`,
  );
}

function buildFinalReport(state) {
  const fidelitySummary = summarizeFidelityRecords(state.allPriceRecords);
  const byBookmaker = summarizeByBookmaker(state.allPriceRecords, state.providerResults);
  const summaryTable = Object.entries(byBookmaker)
    .map(([bookmaker, stats]) => ({ bookmaker, ...stats }))
    .sort((left, right) => left.bookmaker.localeCompare(right.bookmaker));

  const verifiedRate = fidelitySummary.total > 0
    ? Number(((fidelitySummary.statusCounts.verified || 0) / fidelitySummary.total).toFixed(3))
    : 0;

  return {
    ok: fidelitySummary.total > 0
      && (fidelitySummary.statusCounts.mismatch || 0) === 0
      && state.providerFailures.length === 0
      && verifiedRate >= 0.5,
    checkedAt: new Date().toISOString(),
    options: {
      markets: state.markets,
      eventsPerBookmaker: state.eventsPerBookmaker,
      prices: state.prices,
      minHours: state.minHours,
      eventTarget: state.eventTarget,
      timeoutMs: state.timeoutMs,
    },
    fidelitySummary: {
      ...fidelitySummary,
      verifiedRate,
    },
    providerResults: state.providerResults,
    providerFailures: state.providerFailures,
    byBookmaker,
    summaryTable,
    eventReports: state.allEventReports,
  };
}

function summarizeByBookmaker(priceRecords, providerResults) {
  const map = new Map();

  for (const result of providerResults || []) {
    ensureBook(map, result.provider, {
      providerError: result.error || null,
      durationMs: result.durationMs || 0,
      eventCount: result.eventCount || 0,
    });
  }

  for (const record of priceRecords || []) {
    const bookmaker = record.bookmaker || 'unknown';
    const entry = ensureBook(map, bookmaker);
    entry.total += 1;
    entry.statuses[record.status] = (entry.statuses[record.status] || 0) + 1;
    if (record.status === FIDELITY_STATUSES.mismatch) {
      entry.mismatchSamples.push({
        event: `${record.homeTeam || ''} vs ${record.awayTeam || ''}`.trim(),
        market: record.marketKey,
        outcome: record.outcome,
        endpointPrice: record.endpointPrice ?? record.price,
        websitePrice: record.websitePrice,
        eventUrl: record.eventUrl || null,
      });
    }
  }

  return Object.fromEntries(
    [...map.entries()].map(([bookmaker, entry]) => {
      const verified = entry.statuses.verified || 0;
      const rate = entry.total > 0 ? Number((verified / entry.total).toFixed(3)) : 0;
      let grade = 'no_data';
      if (entry.providerError && entry.total === 0) grade = 'provider_failed';
      else if (entry.total === 0) grade = 'no_candidates';
      else if ((entry.statuses.mismatch || 0) > 0) grade = 'mismatch_risk';
      else if (rate >= 0.8) grade = 'good';
      else if (rate >= 0.5) grade = 'mixed';
      else grade = 'weak';

      return [bookmaker, {
        grade,
        total: entry.total,
        verified,
        mismatch: entry.statuses.mismatch || 0,
        not_found: entry.statuses.not_found || 0,
        ambiguous: entry.statuses.ambiguous || 0,
        unverifiable: entry.statuses.unverifiable || 0,
        verifiedRate: rate,
        eventCount: entry.eventCount,
        durationMs: entry.durationMs,
        providerError: entry.providerError,
        mismatchSamples: entry.mismatchSamples.slice(0, 5),
      }];
    }),
  );
}

function ensureBook(map, bookmaker, extras = {}) {
  if (!map.has(bookmaker)) {
    map.set(bookmaker, {
      total: 0,
      statuses: {},
      mismatchSamples: [],
      eventCount: 0,
      durationMs: 0,
      providerError: null,
    });
  }
  const entry = map.get(bookmaker);
  if (extras.providerError) entry.providerError = extras.providerError;
  if (extras.durationMs) entry.durationMs = extras.durationMs;
  if (extras.eventCount) entry.eventCount = extras.eventCount;
  return entry;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (key === 'help' || key === 'h') {
      result.help = true;
      continue;
    }
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
Run an isolated multi-bookmaker fidelity audit with progress and hard timeouts.

Usage:
  node scripts/run-fidelity-audit.js
  node scripts/run-fidelity-audit.js --events-per-bookmaker 1 --markets h2h,bothTeamsToScore,totalGoals
  node scripts/run-fidelity-audit.js --bookmaker Superbet,Fortuna,Unibet

Options:
  --bookmaker / --provider   One name, comma list, or all
  --markets                  CSV market families
  --events-per-bookmaker     Default 1
  --prices                   Max prices per event (default 5)
  --min-hours                Skip near-kickoff events (default 2)
  --event-target             Provider depth (default 20)
  --timeout-ms               Per fetch/page timeout (default 35000)
  --hard-timeout-ms          Kill a stuck provider worker (default 180000)
`.trim());
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeNumber(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  buildFinalReport,
  summarizeByBookmaker,
};
