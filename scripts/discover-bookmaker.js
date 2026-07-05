#!/usr/bin/env node

const { discoverBookmakerPage } = require('../src/providers/bookmaker-discovery');

const DEFAULT_MAX_SCRIPTS = 8;

async function main() {
  const pageUrl = process.argv[2];
  if (!pageUrl) {
    console.error('Usage: node scripts/discover-bookmaker.js <bookmaker-url>');
    process.exitCode = 1;
    return;
  }

  const maxScripts = parsePositiveInteger(
    process.env.DISCOVERY_MAX_SCRIPTS,
    DEFAULT_MAX_SCRIPTS,
  );
  const report = await discoverSingleBookmakerPage(pageUrl, { maxScripts });
  console.log(JSON.stringify(report, null, 2));
}

async function discoverSingleBookmakerPage(
  pageUrl,
  { fetchTextImpl = fetchText, maxScripts = DEFAULT_MAX_SCRIPTS } = {},
) {
  const html = await fetchTextImpl(pageUrl);
  const pageOnly = discoverBookmakerPage({ pageUrl, html });
  const scriptBodies = {};
  const scriptErrors = [];

  for (const scriptUrl of pageOnly.scriptUrls.slice(0, maxScripts)) {
    try {
      scriptBodies[scriptUrl] = await fetchTextImpl(scriptUrl);
    } catch (error) {
      scriptErrors.push({ url: scriptUrl, error: error.message });
    }
  }

  const discovery = discoverBookmakerPage({ pageUrl, html, scriptBodies });
  return {
    ...discovery,
    fetchedScripts: Object.keys(scriptBodies),
    scriptErrors,
  };
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      accept: '*/*',
      'user-agent': 'Mozilla/5.0',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.text();
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
  discoverSingleBookmakerPage,
  parsePositiveInteger,
};
