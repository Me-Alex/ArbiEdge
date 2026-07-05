const { chromium } = require('playwright-core');

class BrowserJsonTransport {
  constructor({ pageUrl, headless = true, timeoutMs = 30_000 }) {
    this.pageUrl = pageUrl;
    this.headless = headless;
    this.timeoutMs = timeoutMs;
  }

  async getJson(url, headers = {}) {
    const [payload] = await this.getJsons([url], headers);
    return payload;
  }

  async getJsons(urls, headers = {}) {
    const browser = await chromium.launch({ channel: 'chrome', headless: this.headless });
    try {
      const page = await browser.newPage({ locale: 'ro-RO' });
      await page.goto(this.pageUrl, {
        waitUntil: 'domcontentloaded',
        timeout: this.timeoutMs,
      });
      await page.waitForTimeout(4000);
      return await page.evaluate(
        async ({ requestUrls, requestHeaders }) => {
          return Promise.all(requestUrls.map(async (requestUrl) => {
            const response = await fetch(requestUrl, { headers: requestHeaders });
            if (!response.ok) {
              throw new Error(`Browser request returned HTTP ${response.status}`);
            }
            return response.json();
          }));
        },
        { requestUrls: urls, requestHeaders: headers },
      );
    } finally {
      await browser.close();
    }
  }
}

module.exports = { BrowserJsonTransport };
