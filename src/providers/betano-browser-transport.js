const { chromium } = require('playwright-core');

class BetanoBrowserTransport {
  constructor({
    headless = true,
    timeoutMs = 30_000,
    maxEvents = 120,
  } = {}) {
    this.headless = headless;
    this.timeoutMs = timeoutMs;
    this.maxEvents = maxEvents;
  }

  async collect() {
    const browser = await chromium.launch({ channel: 'chrome', headless: this.headless });
    try {
      const page = await browser.newPage({ locale: 'ro-RO' });
      await page.goto('https://ro.betano.com/sport/fotbal/', {
        waitUntil: 'domcontentloaded',
        timeout: this.timeoutMs,
      });
      await page.waitForTimeout(8000);

      return await page.evaluate(async (maxEvents) => {
        const resourceUrls = performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
          .filter((url) =>
            /\/api\/sports\/FOOT\/.*\/events\?/.test(url),
          );
        const listUrls = [...new Set(resourceUrls)];
        const collected = [];

        for (const url of listUrls) {
          const response = await fetch(url);
          if (!response.ok) continue;
          const payload = await response.json();
          collected.push(...(payload?.data?.events || []));
        }

        const unique = [...new Map(collected.map((event) => [event.id, event])).values()]
          .slice(0, maxEvents);
        const output = [];
        for (const event of unique) {
          let markets = event.markets || [];
          if (event.url && !event.liveNow) {
            const detailResponse = await fetch(`/api${event.url}`);
            if (detailResponse.ok) {
              const detail = await detailResponse.json();
              markets = detail?.data?.event?.markets || markets;
            }
          }
          output.push({
            id: event.id,
            url: event.url,
            betRadarId: event.betRadarId,
            name: event.name,
            startTime: event.startTime,
            competition: event.leagueName,
            markets,
          });
        }
        return output;
      }, this.maxEvents);
    } finally {
      await browser.close();
    }
  }
}

module.exports = { BetanoBrowserTransport };
