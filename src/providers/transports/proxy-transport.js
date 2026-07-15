/**
 * Resilient HTTP Transport with User-Agent rotation and Proxy options.
 */

'use strict';

const DEFAULT_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
];

class ProxyTransport {
  constructor({ userAgents = DEFAULT_USER_AGENTS, timeoutMs = 10_000 } = {}) {
    this.userAgents = userAgents;
    this.timeoutMs = timeoutMs;
    this.requestCount = 0;
  }

  getRandomUserAgent() {
    const index = Math.floor(Math.random() * this.userAgents.length);
    return this.userAgents[index];
  }

  async fetchJson(url, options = {}) {
    this.requestCount += 1;
    const headers = {
      'User-Agent': this.getRandomUserAgent(),
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'ro-RO,ro;q=0.9,en-US;q=0.8,en;q=0.7',
      ...(options.headers || {}),
    };

    const signal = options.signal || AbortSignal.timeout(options.timeoutMs || this.timeoutMs);
    const response = await fetch(url, {
      ...options,
      headers,
      signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText} from ${url}`);
    }

    return response.json();
  }
}

module.exports = { ProxyTransport, DEFAULT_USER_AGENTS };
