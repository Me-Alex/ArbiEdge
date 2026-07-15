#!/usr/bin/env node

const {
  COVERAGE_STATUSES,
  ROMANIAN_BOOKMAKER_COVERAGE,
} = require('../src/bookmaker-coverage');
const { discoverBookmakerPage } = require('../src/providers/bookmaker-discovery');

const DEFAULT_MAX_SCRIPTS = 8;
const DEFAULT_TIMEOUT_MS = 15_000;

async function main() {
  const maxScripts = parsePositiveInteger(
    process.env.DISCOVERY_MAX_SCRIPTS,
    DEFAULT_MAX_SCRIPTS,
  );
  const targets = remainingProviderTargets({
    targetFilter: process.env.DISCOVERY_TARGETS,
  });

  const report = process.argv.includes('--list')
    ? buildTargetListReport(targets)
    : await buildDiscoveryReport(targets, { maxScripts });

  console.log(JSON.stringify(report, null, 2));
}

async function buildDiscoveryReport(
  targets,
  { fetchTextImpl = fetchText, maxScripts = DEFAULT_MAX_SCRIPTS } = {},
) {
  const results = [];
  for (const target of Array.isArray(targets) ? targets : []) {
    results.push(await discoverTarget(target, { fetchTextImpl, maxScripts }));
  }

  return {
    generatedAt: new Date().toISOString(),
    count: results.length,
    results,
  };
}

function buildTargetListReport(targets) {
  const entries = (Array.isArray(targets) ? targets : []).map((target) => ({
    name: target.name,
    domain: target.domain,
    discoveryUrl: target.discoveryUrl,
    note: target.note,
  }));

  return {
    generatedAt: new Date().toISOString(),
    count: entries.length,
    targets: entries,
  };
}

function remainingProviderTargets({
  entries = ROMANIAN_BOOKMAKER_COVERAGE,
  targetFilter = '',
} = {}) {
  const selectedTargets = parseTargetFilter(targetFilter);
  return entries
    .filter((entry) => entry.status === COVERAGE_STATUSES.remainingProvider)
    .filter((entry) => targetMatchesFilter(entry, selectedTargets));
}

async function discoverTarget(target, { fetchTextImpl = fetchText, maxScripts }) {
  try {
    const html = await fetchTextImpl(target.discoveryUrl);
    const pageOnly = discoverBookmakerPage({
      pageUrl: target.discoveryUrl,
      html,
    });
    const scriptBodies = {};
    const scriptErrors = [];

    for (const scriptUrl of pageOnly.scriptUrls.slice(0, maxScripts)) {
      try {
        scriptBodies[scriptUrl] = await fetchTextImpl(scriptUrl);
      } catch (error) {
        scriptErrors.push({ url: scriptUrl, error: error.message });
      }
    }

    const discovery = discoverBookmakerPage({
      pageUrl: target.discoveryUrl,
      html,
      scriptBodies,
    });

    return {
      ok: true,
      name: target.name,
      domain: target.domain,
      discoveryUrl: target.discoveryUrl,
      note: target.note,
      scriptErrors,
      ...discovery,
    };
  } catch (error) {
    return {
      ok: false,
      name: target.name,
      domain: target.domain,
      discoveryUrl: target.discoveryUrl,
      note: target.note,
      error: error.message,
    };
  }
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      accept: '*/*',
      'user-agent': 'Mozilla/5.0',
    },
    signal: AbortSignal.timeout(parsePositiveInteger(
      process.env.DISCOVERY_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
    )),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.text();
}

function parseTargetFilter(value) {
  const targets = String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return targets.length ? new Set(targets) : null;
}

function targetMatchesFilter(entry, selectedTargets) {
  if (!selectedTargets) {
    return true;
  }
  return selectedTargets.has(entry.name.toLowerCase()) ||
    selectedTargets.has(entry.domain.toLowerCase());
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  buildDiscoveryReport,
  buildTargetListReport,
  discoverTarget,
  parsePositiveInteger,
  parseTargetFilter,
  remainingProviderTargets,
  targetMatchesFilter,
};
