const { extractAngularTransferStateEntries } = require('./angular-transfer-state');

const API_HINT_PATTERN =
  /(?:api|sport|sports|event|events|market|markets|odd|odds|comtrade|navatar|betco|alf)/i;

function discoverBookmakerPage({ pageUrl, html, scriptBodies = {} } = {}) {
  const scriptUrls = extractScriptUrls(html, pageUrl);
  const transferStateEntries = extractAngularTransferStateEntries(html);
  const textBlocks = [
    { source: pageUrl || 'page', text: html },
    ...Object.entries(scriptBodies).map(([source, text]) => ({ source, text })),
  ];

  return {
    pageUrl: pageUrl || null,
    scriptUrls,
    transferStateEntries,
    transferStateUrls: uniqueStrings(transferStateEntries.map((entry) => entry.url)),
    apiCandidates: extractApiCandidates(textBlocks, pageUrl),
  };
}

function extractScriptUrls(html, baseUrl) {
  const urls = [];
  const scriptPattern = /<script\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/gi;
  let match;

  while ((match = scriptPattern.exec(String(html || ''))) !== null) {
    const url = absoluteUrl(match[2], baseUrl);
    if (url) {
      urls.push(url);
    }
  }

  return uniqueStrings(urls);
}

function extractApiCandidates(blocks, baseUrl) {
  const candidates = [];
  for (const block of Array.isArray(blocks) ? blocks : []) {
    const source = block?.source || 'inline';
    const text = String(block?.text || '');
    for (const rawUrl of extractUrlsFromText(text)) {
      const url = absoluteUrl(rawUrl, baseUrl);
      if (url && API_HINT_PATTERN.test(url)) {
        candidates.push({ source, url });
      }
    }
  }

  return uniqueCandidateUrls(candidates);
}

function extractUrlsFromText(text) {
  const urls = [];
  const value = String(text || '');
  const absolutePattern = /https?:\\?\/\\?\/[^"'`)<>\s]+/gi;
  const relativePattern = /(?<![\w.-])\/(?:api|sports?|events?|prematch|betting|alfFrontStatic)\/[^"'`)<>\s]*/gi;
  let match;

  while ((match = absolutePattern.exec(value)) !== null) {
    urls.push(cleanExtractedUrl(match[0]));
  }
  while ((match = relativePattern.exec(value)) !== null) {
    urls.push(cleanExtractedUrl(match[0]));
  }

  return urls.filter(Boolean);
}

function cleanExtractedUrl(value) {
  return String(value || '')
    .replace(/\\\//g, '/')
    .replace(/[\\,.;:]+$/g, '')
    .replace(/&quot;.*$/g, '')
    .trim();
}

function absoluteUrl(value, baseUrl) {
  const raw = String(value || '').trim();
  if (!raw) {
    return null;
  }

  try {
    return new URL(raw, baseUrl || undefined).toString();
  } catch {
    return null;
  }
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function uniqueCandidateUrls(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = candidate.url;
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

module.exports = {
  discoverBookmakerPage,
  extractApiCandidates,
  extractScriptUrls,
  extractUrlsFromText,
};
