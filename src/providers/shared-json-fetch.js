'use strict';

function createSharedJsonFetch({
  fetchImpl = globalThis.fetch,
  ttlMs = 5_000,
  now = () => Date.now(),
} = {}) {
  const cache = new Map();
  return async function sharedJsonFetch(url, options = {}) {
    const key = requestKey(url, options);
    const current = cache.get(key);
    if (current && now() - current.createdAt < ttlMs) {
      return responseFrom(current.promise);
    }
    const promise = Promise.resolve(fetchImpl(url, options)).then(async (response) => ({
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      payload: response.ok ? await response.json() : null,
    })).catch((error) => {
      cache.delete(key);
      throw error;
    });
    cache.set(key, { createdAt: now(), promise });
    prune(cache, now(), ttlMs);
    return responseFrom(promise);
  };
}

async function responseFrom(promise) {
  const result = await promise;
  return {
    ok: result.ok,
    status: result.status,
    statusText: result.statusText,
    json: async () => structuredClone(result.payload),
  };
}

function requestKey(url, options = {}) {
  return [
    String(options.method || 'GET').toUpperCase(),
    String(url),
    String(options.body || ''),
  ].join('|');
}

function prune(cache, currentMs, ttlMs) {
  for (const [key, entry] of cache) {
    if (currentMs - entry.createdAt >= ttlMs) cache.delete(key);
  }
}

module.exports = { createSharedJsonFetch, requestKey };
