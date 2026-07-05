function extractAngularTransferStateEntries(html) {
  const entries = [];
  const scripts = extractInlineJsonScripts(html);

  scripts.forEach((script) => {
    collectTransferEntries(script.value, [], script.scriptIndex, entries);
  });

  return entries;
}

function findTransferStateEntries(html, predicate) {
  return extractAngularTransferStateEntries(html).filter(predicate);
}

function extractInlineJsonScripts(html) {
  const scripts = [];
  const scriptPattern = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  let scriptIndex = 0;

  while ((match = scriptPattern.exec(String(html || ''))) !== null) {
    const body = match[1].trim();
    if (!body || !/^[{\[]/.test(body)) {
      scriptIndex += 1;
      continue;
    }

    try {
      scripts.push({ scriptIndex, value: JSON.parse(body) });
    } catch (_error) {
      // Some inline scripts start with braces but are JavaScript, not JSON.
    }
    scriptIndex += 1;
  }

  return scripts;
}

function collectTransferEntries(value, path, scriptIndex, entries) {
  if (!value || typeof value !== 'object') {
    return;
  }

  if (isTransferHttpEntry(value)) {
    entries.push({
      key: formatPath(path),
      url: value.u,
      status: value.s ?? null,
      statusText: value.st ?? null,
      headers: value.h ?? null,
      body: Object.prototype.hasOwnProperty.call(value, 'b') ? value.b : undefined,
      scriptIndex,
    });
    return;
  }

  Object.entries(value).forEach(([key, child]) => {
    collectTransferEntries(child, path.concat(key), scriptIndex, entries);
  });
}

function isTransferHttpEntry(value) {
  return Boolean(
    value
      && typeof value === 'object'
      && typeof value.u === 'string'
      && (Object.prototype.hasOwnProperty.call(value, 's')
        || Object.prototype.hasOwnProperty.call(value, 'b')),
  );
}

function formatPath(path) {
  return path.reduce((result, part) => {
    if (/^\d+$/.test(part)) {
      return `${result}[${part}]`;
    }
    return result ? `${result}.${part}` : part;
  }, '');
}

module.exports = {
  extractAngularTransferStateEntries,
  findTransferStateEntries,
};
