/**
 * Abstract Base Provider Class
 *
 * Provides standardized error isolation, timing metrics, timeout signaling,
 * and event normalization for all sportsbook scrapers.
 */

'use strict';

class BaseProvider {
  constructor({ name, domain, timeoutMs = 12_000 } = {}) {
    if (!name || !domain) {
      throw new Error('BaseProvider requires both name and domain parameters');
    }
    this.name = name;
    this.domain = domain;
    this.timeoutMs = timeoutMs;
    this.metrics = {
      totalFetches: 0,
      successfulFetches: 0,
      failedFetches: 0,
      lastDurationMs: 0,
      lastEventCount: 0,
    };
  }

  async getOdds() {
    const startTime = Date.now();
    this.metrics.totalFetches += 1;
    try {
      const events = await this.fetchAndNormalizeOdds();
      const durationMs = Date.now() - startTime;
      this.metrics.successfulFetches += 1;
      this.metrics.lastDurationMs = durationMs;
      this.metrics.lastEventCount = Array.isArray(events) ? events.length : 0;
      return events;
    } catch (error) {
      this.metrics.failedFetches += 1;
      this.metrics.lastDurationMs = Date.now() - startTime;
      throw new Error(`[${this.name}] Scraper execution failed: ${error.message}`);
    }
  }

  async fetchAndNormalizeOdds() {
    throw new Error('fetchAndNormalizeOdds() must be implemented by derived provider class');
  }

  createTimeoutSignal(overrideMs) {
    const timeout = overrideMs || this.timeoutMs;
    return AbortSignal.timeout(timeout);
  }

  normalizeEvent({ id, homeTeam, awayTeam, startsAt, competition, sport = 'Football', bookmakers = [] }) {
    return {
      id: `${this.name.toLowerCase().replace(/\s+/g, '_')}:${id}`,
      sport,
      competition: competition || 'Unknown Competition',
      startsAt: startsAt || new Date().toISOString(),
      homeTeam: String(homeTeam || '').trim(),
      awayTeam: String(awayTeam || '').trim(),
      bookmakers,
    };
  }
}

module.exports = { BaseProvider };
