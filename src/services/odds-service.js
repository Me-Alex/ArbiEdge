/**
 * Core Odds Aggregation & Snapshot Cache Service Component.
 */

const { auditOdds } = require('../audit/odds-audit');

class OddsService {
  constructor({
    liveProvider = null,
    demoProvider,
    cacheTtlMs = 60_000,
    now = () => new Date(),
    oddsAudit = auditOdds,
    maxSnapshots = 2,
    snapshotStore = null,
    failClosed = false,
  }) {
    this.liveProvider = liveProvider;
    this.demoProvider = demoProvider;
    this.cacheTtlMs = cacheTtlMs;
    this.now = now;
    this.oddsAudit = oddsAudit;
    this.cache = null;
    this.inFlight = null;
    this.lastRefresh = null;
    this.snapshots = [];
    this.maxSnapshots = maxSnapshots;
    this.snapshotStore = snapshotStore;
    this.failClosed = failClosed;
  }

  async restoreFromStore() {
    if (typeof this.snapshotStore?.loadLatestSnapshot !== 'function') return null;
    const value = await this.snapshotStore.loadLatestSnapshot();
    if (!value || !Array.isArray(value.events)) return null;
    this.cache = { createdAtMs: this.now().getTime(), value };
    this.#pushSnapshot(value);
    this.lastRefresh = refreshState({ status: 'restored', value, now: this.now });
    return value;
  }

  async forceRefresh() {
    this.clearCache();
    return this.getOdds();
  }

  async *forceRefreshStream() {
    this.clearCache();
    yield* this.streamOdds();
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
      this.#pushSnapshot(value);
      await this.#persistSnapshot(value);
      this.lastRefresh = refreshState({
        status: value.mode === 'live' ? 'live' : 'fallback',
        value,
        now: this.now,
      });
      return value;
    } catch (error) {
      this.lastRefresh = refreshState({
        status: 'error',
        error,
        now: this.now,
      });
      throw error;
    } finally {
      this.inFlight = null;
    }
  }

  async *streamOdds() {
    const nowMs = this.now().getTime();
    if (this.cache && nowMs - this.cache.createdAtMs < this.cacheTtlMs) {
      yield {
        ...this.cache.value,
        progress: { done: 1, total: 1, complete: true },
      };
      return;
    }

    if (this.inFlight) {
      yield {
        ...(await this.inFlight),
        progress: { done: 1, total: 1, complete: true },
      };
      return;
    }

    const fetchedAt = this.now().toISOString();
    if (!this.liveProvider) {
      if (this.failClosed) throw new Error('No live provider is configured in fail-closed mode');
      const demo = await this.#demoPayload(fetchedAt, {
        warning:
          'Sample prices only; they are not live bookmaker quotes. Set ODDS_API_KEY to load live odds.',
      });
      this.cache = {
        createdAtMs: this.now().getTime(),
        value: demo,
      };
      this.lastRefresh = refreshState({
        status: 'fallback',
        value: demo,
        now: this.now,
      });
      await this.#persistSnapshot(demo);
      yield { ...demo, progress: { done: 1, total: 1, complete: true } };
      return;
    }

    if (typeof this.liveProvider.getOddsProgress !== 'function') {
      const value = await this.getOdds();
      yield { ...value, progress: { done: 1, total: 1, complete: true } };
      return;
    }

    let lastPayload = null;
    try {
      yield this.#initialLiveProgressPayload(fetchedAt);
      for await (const liveResult of this.liveProvider.getOddsProgress()) {
        const progress = liveResult.progress || { done: 0, total: 0, complete: false };
        const payload = this.#livePayload(liveResult, fetchedAt, {
          allowEmpty: !progress.complete,
        });
        lastPayload = payload;
        yield { ...payload, progress };
      }

      if (!lastPayload) {
        throw new Error('No live bookmaker events were returned');
      }

      this.cache = {
        createdAtMs: this.now().getTime(),
        value: lastPayload,
      };
      this.#pushSnapshot(lastPayload);
      await this.#persistSnapshot(lastPayload);
      this.lastRefresh = refreshState({
        status: lastPayload.mode === 'live' ? 'live' : 'fallback',
        value: lastPayload,
        now: this.now,
      });
    } catch (error) {
      if (this.failClosed) throw error;
      const demo = await this.#demoPayload(fetchedAt, {
        warning: `Live data is unavailable: ${error.message}`,
      });
      this.lastRefresh = refreshState({
        status: 'fallback',
        value: demo,
        error,
        now: this.now,
      });
      yield { ...demo, progress: { done: 1, total: 1, complete: true } };
    }
  }

  #initialLiveProgressPayload(fetchedAt) {
    const total = providerCount(this.liveProvider);
    return {
      mode: 'live',
      source: this.liveProvider.name || 'Live provider',
      fetchedAt,
      warning: null,
      events: [],
      providers: [],
      progress: { done: 0, total, complete: false },
    };
  }

  clearCache() {
    this.cache = null;
  }

  #pushSnapshot(value) {
    if (!value || !Array.isArray(value.events)) return;
    this.snapshots.push({
      fetchedAt: value.fetchedAt || this.now().toISOString(),
      events: value.events,
    });
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }
  }

  async #persistSnapshot(value) {
    if (typeof this.snapshotStore?.saveSnapshot !== 'function') return;
    await this.snapshotStore.saveSnapshot(value);
  }

  getOddsMovement() {
    if (this.snapshots.length < 2) return { movements: [], fetchedAt: null, previousAt: null };

    const latest = this.snapshots[this.snapshots.length - 1];
    const previous = this.snapshots[this.snapshots.length - 2];

    const prevLookup = buildEventLookup(previous.events);
    const movements = [];

    for (const event of latest.events) {
      const key = eventKey(event);
      const prevEvent = prevLookup.get(key);
      if (!prevEvent) continue;

      const prevBookLookup = new Map(
        (prevEvent.bookmakers || []).map((bm) => [bm.name, bm]),
      );

      for (const bm of event.bookmakers || []) {
        const prevBm = prevBookLookup.get(bm.name);
        if (!prevBm || !prevBm.markets || !bm.markets) continue;

        for (const [marketKey, prices] of Object.entries(bm.markets)) {
          const prevPrices = prevBm.markets[marketKey];
          if (!prevPrices) continue;

          for (const [outcome, odds] of Object.entries(prices)) {
            const prevOdds = prevPrices[outcome];
            if (typeof odds !== 'number' || typeof prevOdds !== 'number') continue;
            if (odds === prevOdds) continue;

            movements.push({
              event: `${event.homeTeam} vs ${event.awayTeam}`,
              competition: event.competition || null,
              kickoff: event.startsAt,
              bookmaker: bm.name,
              market: marketKey,
              outcome,
              current: odds,
              previous: prevOdds,
              direction: odds > prevOdds ? 'up' : 'down',
              change: Number((odds - prevOdds).toFixed(2)),
            });
          }
        }
      }
    }

    return {
      movements,
      fetchedAt: latest.fetchedAt,
      previousAt: previous.fetchedAt,
    };
  }

  diagnostics() {
    const nowMs = this.now().getTime();
    const cachedAtMs = this.cache?.createdAtMs || null;
    const cacheAgeMs = cachedAtMs ? Math.max(0, nowMs - cachedAtMs) : null;
    const cacheFresh = cacheAgeMs !== null && cacheAgeMs < this.cacheTtlMs;
    return {
      mode: this.liveProvider ? 'live' : 'demo',
      provider: this.liveProvider?.name || 'Built-in demo data',
      cache: {
        fresh: cacheFresh,
        ageMs: cacheAgeMs,
        ttlMs: this.cacheTtlMs,
        expiresInMs: cacheFresh ? Math.max(0, this.cacheTtlMs - cacheAgeMs) : 0,
        events: Array.isArray(this.cache?.value?.events) ? this.cache.value.events.length : 0,
        mode: this.cache?.value?.mode || null,
      },
      inFlight: Boolean(this.inFlight),
      lastRefresh: this.lastRefresh,
    };
  }

  async #refresh() {
    const fetchedAt = this.now().toISOString();

    if (!this.liveProvider) {
      if (this.failClosed) throw new Error('No live provider is configured in fail-closed mode');
      return this.#demoPayload(fetchedAt, {
        warning:
          'Sample prices only; they are not live bookmaker quotes. Set ODDS_API_KEY to load live odds.',
      });
    }

    try {
      const liveResult = await this.liveProvider.getOdds();
      return this.#livePayload(liveResult, fetchedAt);
    } catch (error) {
      if (this.failClosed) throw error;
      return this.#demoPayload(fetchedAt, {
        warning: `Live data is unavailable: ${error.message}`,
      });
    }
  }

  #livePayload(liveResult, fetchedAt, { allowEmpty = false } = {}) {
    const events = Array.isArray(liveResult)
      ? liveResult
      : liveResult.events;
    const providers = Array.isArray(liveResult?.providers)
      ? liveResult.providers
      : undefined;
    const failures = providers?.filter((provider) => !provider.ok) || [];

    if (!Array.isArray(events) || (!allowEmpty && events.length === 0)) {
      throw new Error('No live bookmaker events were returned');
    }

    const audit = events.length > 0 ? this.oddsAudit(events) : null;
    const warnings = [
      failures.length
        ? `Some bookmakers are unavailable: ${failures
            .map((provider) => `${provider.name}: ${provider.error}`)
            .join('; ')}`
        : null,
      audit?.warning,
    ].filter(Boolean);

    return {
      mode: 'live',
      source: this.liveProvider.name || 'Live provider',
      fetchedAt,
      warning: warnings.length ? warnings.join(' ') : null,
      ...(audit ? { audit } : {}),
      ...(providers ? { providers } : {}),
      events,
    };
  }

  async #demoPayload(fetchedAt, { warning }) {
    const { stampQuoteMetadata } = require('../core/quote-metadata');
    const events = stampQuoteMetadata(await this.demoProvider.getOdds(), {
      observedAt: fetchedAt,
      provider: 'Demo',
      clone: 'shallow',
    });
    return {
      mode: 'demo',
      source: 'Built-in demo data',
      fetchedAt,
      warning,
      events,
    };
  }
}

function providerCount(provider) {
  if (Array.isArray(provider?.providers)) {
    return provider.providers.length;
  }
  const explicitCount = Number(provider?.totalProviders ?? provider?.providerCount);
  return Number.isInteger(explicitCount) && explicitCount >= 0 ? explicitCount : 0;
}

function refreshState({ status, value = null, error = null, now }) {
  const events = Array.isArray(value?.events) ? value.events : [];
  const providers = Array.isArray(value?.providers) ? value.providers : [];
  const providerDurations = providers
    .map((provider) => ({
      name: provider.name,
      ok: Boolean(provider.ok),
      events: Number(provider.events || 0),
      durationMs: Number(provider.durationMs),
    }))
    .filter((provider) => Number.isFinite(provider.durationMs) && provider.durationMs >= 0);
  return {
    status,
    at: now().toISOString(),
    events: events.length,
    providers: providers.length,
    failedProviders: providers.filter((provider) => !provider.ok).length,
    durationMs: providerDurations.length
      ? providerDurations.reduce((total, provider) => total + provider.durationMs, 0)
      : null,
    slowProviders: providerDurations
      .sort((left, right) => right.durationMs - left.durationMs)
      .slice(0, 5),
    audit: refreshAuditSummary(value?.audit),
    warning: value?.warning || null,
    error: error?.message || null,
  };
}

function refreshAuditSummary(audit) {
  if (!audit) {
    return null;
  }
  return {
    status: audit.status || null,
    warning: audit.warning || null,
    issueCounts: audit.issueCounts || {},
  };
}

function eventKey(event) {
  return `${event.homeTeam}|${event.awayTeam}|${event.startsAt}`;
}

function buildEventLookup(events) {
  const map = new Map();
  for (const event of events || []) {
    map.set(eventKey(event), event);
  }
  return map;
}

module.exports = { OddsService };
