'use strict';

const { chromium } = require('playwright-core');

const DEFAULT_BLOCKED_RESOURCE_TYPES = new Set(['font', 'image', 'media']);

class PlaywrightNetworkCollector {
  constructor({
    headless = true,
    timeoutMs = 30_000,
    settleMs = 4_000,
    locale = 'ro-RO',
    maxResponseBytes = 20 * 1024 * 1024,
    maxTotalResponseBytes = 64 * 1024 * 1024,
    maxResponses = 250,
    responseConcurrency = 4,
    channel = 'chrome',
    launchBrowser = null,
    blockedResourceTypes = DEFAULT_BLOCKED_RESOURCE_TYPES,
  } = {}) {
    this.headless = headless;
    this.timeoutMs = positiveInteger(timeoutMs, 30_000);
    this.settleMs = nonNegativeInteger(settleMs, 4_000);
    this.locale = locale;
    this.maxResponseBytes = positiveInteger(maxResponseBytes, 20 * 1024 * 1024);
    this.maxTotalResponseBytes = positiveInteger(maxTotalResponseBytes, 64 * 1024 * 1024);
    this.maxResponses = positiveInteger(maxResponses, 250);
    this.responseConcurrency = positiveInteger(responseConcurrency, 4);
    this.channel = channel;
    this.launchBrowser = launchBrowser || ((options) => launchChromium(options));
    this.blockedResourceTypes = new Set(blockedResourceTypes || []);
  }

  async captureJson({
    pageUrl,
    responsePatterns = [],
    settleMs = this.settleMs,
    afterLoad = null,
  }) {
    if (!isHttpUrl(pageUrl)) throw new TypeError('A public HTTP(S) pageUrl is required');
    const patterns = normalizePatterns(responsePatterns);
    const browser = await this.launchBrowser({
      channel: this.channel,
      headless: this.headless,
    });
    let context;
    try {
      context = await browser.newContext({
        locale: this.locale,
        viewport: { width: 1440, height: 1000 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      });
      const page = await context.newPage();
      await this.#blockHeavyResources(page);

      const records = [];
      const pending = new Set();
      const readSlots = createSemaphore(this.responseConcurrency);
      let scheduledResponses = 0;
      let capturedBytes = 0;
      const responseHandler = (response) => {
        const url = response.url();
        if (scheduledResponses >= this.maxResponses || !matchesAny(url, patterns)) return;
        scheduledResponses += 1;
        const task = readSlots.run(() => readJsonResponse(response, {
          maxResponseBytes: this.maxResponseBytes,
        })).then((record) => {
          if (!record || capturedBytes + record.byteLength > this.maxTotalResponseBytes) return;
          capturedBytes += record.byteLength;
          records.push(record);
        }).finally(() => pending.delete(task));
        pending.add(task);
      };
      page.on('response', responseHandler);

      await page.goto(pageUrl, {
        waitUntil: 'domcontentloaded',
        timeout: this.timeoutMs,
      });
      await page.waitForLoadState('networkidle', {
        timeout: Math.min(this.timeoutMs, 10_000),
      }).catch(() => {});
      if (settleMs > 0) await page.waitForTimeout(settleMs);
      await Promise.allSettled([...pending]);

      const result = typeof afterLoad === 'function'
        ? await afterLoad({ context, page, records: [...records] })
        : null;
      await Promise.allSettled([...pending]);
      page.off?.('response', responseHandler);

      return {
        pageUrl,
        capturedAt: new Date().toISOString(),
        records,
        result,
      };
    } finally {
      await context?.close?.().catch(() => {});
      await browser.close().catch(() => {});
    }
  }

  async #blockHeavyResources(page) {
    if (this.blockedResourceTypes.size === 0 || typeof page.route !== 'function') return;
    await page.route('**/*', async (route) => {
      const resourceType = route.request().resourceType();
      if (this.blockedResourceTypes.has(resourceType)) {
        await route.abort();
        return;
      }
      await route.continue();
    });
  }
}

async function launchChromium({ channel = 'chrome', headless = true } = {}) {
  const candidates = [...new Set([channel, 'chrome', 'msedge'].filter(Boolean))];
  let lastError;
  for (const candidate of candidates) {
    try {
      return await chromium.launch({
        channel: candidate,
        headless,
        args: ['--disable-dev-shm-usage'],
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('No supported Chromium browser is installed');
}

async function readJsonResponse(response, { maxResponseBytes }) {
  const status = response.status();
  if (status < 200 || status >= 300) return null;
  const headers = await Promise.resolve(response.allHeaders?.() || response.headers?.() || {});
  const contentType = String(headers['content-type'] || '');
  if (contentType && !/json|javascript|text\/plain/i.test(contentType)) return null;
  const contentLength = Number(headers['content-length']);
  if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) return null;

  try {
    let payload;
    let byteLength;
    if (typeof response.body === 'function') {
      const body = await response.body();
      if (!body || body.length > maxResponseBytes) return null;
      byteLength = body.length;
      payload = JSON.parse(body.toString('utf8'));
    } else {
      payload = await response.json();
      byteLength = Buffer.byteLength(JSON.stringify(payload), 'utf8');
      if (byteLength > maxResponseBytes) return null;
    }
    return {
      url: response.url(),
      status,
      byteLength,
      capturedAt: new Date().toISOString(),
      payload,
    };
  } catch {
    return null;
  }
}

function normalizePatterns(patterns) {
  return (Array.isArray(patterns) ? patterns : [patterns])
    .filter(Boolean)
    .map((pattern) => pattern instanceof RegExp ? pattern : String(pattern));
}

function matchesAny(url, patterns) {
  if (patterns.length === 0) return true;
  return patterns.some((pattern) => {
    if (pattern instanceof RegExp) {
      pattern.lastIndex = 0;
      return pattern.test(url);
    }
    return url.includes(pattern);
  });
}

function isHttpUrl(value) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function createSemaphore(limit) {
  let active = 0;
  const queue = [];
  const drain = () => {
    while (active < limit && queue.length > 0) {
      active += 1;
      const next = queue.shift();
      Promise.resolve()
        .then(next.task)
        .then(next.resolve, next.reject)
        .finally(() => {
          active -= 1;
          drain();
        });
    }
  };
  return {
    run(task) {
      return new Promise((resolve, reject) => {
        queue.push({ task, resolve, reject });
        drain();
      });
    },
  };
}

module.exports = {
  PlaywrightNetworkCollector,
  matchesAny,
  readJsonResponse,
};
