const { PlaywrightNetworkCollector } = require('./playwright-network-collector');

class BrowserJsonTransport {
  constructor({
    pageUrl,
    headless = true,
    timeoutMs = 30_000,
    settleMs = 4_000,
    requestConcurrency = 4,
    maxResponseBytes = 20 * 1024 * 1024,
    collector = null,
  }) {
    this.pageUrl = pageUrl;
    this.headless = headless;
    this.timeoutMs = timeoutMs;
    this.settleMs = settleMs;
    this.requestConcurrency = positiveInteger(requestConcurrency, 4);
    this.maxResponseBytes = positiveInteger(maxResponseBytes, 20 * 1024 * 1024);
    this.collector = collector || new PlaywrightNetworkCollector({
      headless,
      timeoutMs,
      settleMs,
      maxResponseBytes: this.maxResponseBytes,
    });
  }

  async getJson(url, headers = {}) {
    const [payload] = await this.getJsons([url], headers);
    return payload;
  }

  async getJsons(urls, headers = {}) {
    const requestUrls = (Array.isArray(urls) ? urls : []).filter(Boolean);
    if (requestUrls.length === 0) return [];
    if (requestUrls.some((url) => !isHttpUrl(url))) {
      throw new TypeError('Browser JSON requests require public HTTP(S) URLs');
    }
    const browserPageUrl = sameOriginBootstrapUrl(requestUrls, this.pageUrl);

    const capture = await this.collector.captureJson({
      pageUrl: browserPageUrl,
      responsePatterns: [/a^/],
      settleMs: this.settleMs,
      afterLoad: ({ page }) => page.evaluate(
        async ({ urlsToFetch, requestHeaders, concurrency }) => {
          const output = new Array(urlsToFetch.length);
          let nextIndex = 0;
          const worker = async () => {
            while (nextIndex < urlsToFetch.length) {
              const index = nextIndex;
              nextIndex += 1;
              try {
                const response = await fetch(urlsToFetch[index], {
                  credentials: 'include',
                  headers: requestHeaders,
                });
                if (!response.ok) {
                  output[index] = { ok: false, status: response.status };
                  continue;
                }
                output[index] = { ok: true, payload: await response.json() };
              } catch (error) {
                output[index] = { ok: false, error: String(error?.message || error) };
              }
            }
          };
          await Promise.all(Array.from(
            { length: Math.min(concurrency, urlsToFetch.length) },
            () => worker(),
          ));
          return output;
        },
        {
          urlsToFetch: requestUrls,
          requestHeaders: headers,
          concurrency: this.requestConcurrency,
        },
      ),
    });

    const results = Array.isArray(capture.result) ? capture.result : [];
    const failure = results.find((result) => !result?.ok);
    if (failure) {
      const suffix = failure.status ? ` HTTP ${failure.status}` : `: ${failure.error || 'unknown error'}`;
      throw new Error(`Browser request failed${suffix}`);
    }
    if (results.length !== requestUrls.length) {
      throw new Error('Browser request returned an incomplete response set');
    }
    return results.map((result) => result.payload);
  }
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sameOriginBootstrapUrl(urls, fallback) {
  const origins = new Set(urls.map((url) => new URL(url).origin));
  return origins.size === 1 ? urls[0] : fallback;
}

function isHttpUrl(value) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

module.exports = { BrowserJsonTransport };
