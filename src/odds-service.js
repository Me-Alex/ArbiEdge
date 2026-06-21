class OddsService {
  constructor({
    liveProvider = null,
    demoProvider,
    cacheTtlMs = 60_000,
    now = () => new Date(),
  }) {
    this.liveProvider = liveProvider;
    this.demoProvider = demoProvider;
    this.cacheTtlMs = cacheTtlMs;
    this.now = now;
    this.cache = null;
    this.inFlight = null;
  }

  async getOdds() {
    const nowMs = this.now().getTime();
    if (this.cache && nowMs - this.cache.createdAtMs < this.cacheTtlMs) {
      return this.cache.value;
    }

    if (this.inFlight) {
      return this.inFlight;
    }

    this.inFlight = this.#refresh();
    try {
      const value = await this.inFlight;
      this.cache = {
        createdAtMs: this.now().getTime(),
        value,
      };
      return value;
    } finally {
      this.inFlight = null;
    }
  }

  clearCache() {
    this.cache = null;
  }

  async #refresh() {
    const fetchedAt = this.now().toISOString();

    if (!this.liveProvider) {
      return {
        mode: 'demo',
        source: 'Built-in demo data',
        fetchedAt,
        warning:
          'Sample prices only; they are not live bookmaker quotes. Set ODDS_API_KEY to load live odds.',
        events: await this.demoProvider.getOdds(),
      };
    }

    try {
      return {
        mode: 'live',
        source: this.liveProvider.name || 'Live provider',
        fetchedAt,
        warning: null,
        events: await this.liveProvider.getOdds(),
      };
    } catch (error) {
      return {
        mode: 'demo',
        source: 'Built-in demo data',
        fetchedAt,
        warning: `Live data is unavailable: ${error.message}`,
        events: await this.demoProvider.getOdds(),
      };
    }
  }
}

module.exports = { OddsService };
