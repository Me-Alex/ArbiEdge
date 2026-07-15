'use strict';

const crypto = require('node:crypto');
const { annotateFeedGroups, feedGroupForBookmaker } = require('../providers/feed-groups');
const { mergeEvents } = require('../providers/composite-provider');
const { stampQuoteMetadata } = require('../core/quote-metadata');

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_STALE_AFTER_MS = 180_000;
const DEFAULT_CIRCUIT_FAILURES = 3;
const DEFAULT_CIRCUIT_COOLDOWN_MS = 300_000;
const DEFAULT_MIN_INTERVAL_MS = 15_000;
const DEFAULT_MAX_INTERVAL_MS = 120_000;
const DEFAULT_DURATION_MULTIPLIER = 3;
const DEFAULT_PROVIDER_CONCURRENCY = 2;
const DEFAULT_PROGRESS_EVERY = 4;

class ProviderSupervisor {
  constructor(providers, {
    name = 'Supervised bookmaker providers',
    intervalMs = DEFAULT_INTERVAL_MS,
    adaptiveCadence = true,
    minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
    maxIntervalMs = DEFAULT_MAX_INTERVAL_MS,
    durationMultiplier = DEFAULT_DURATION_MULTIPLIER,
    concurrency = DEFAULT_PROVIDER_CONCURRENCY,
    progressEvery = DEFAULT_PROGRESS_EVERY,
    staleAfterMs = DEFAULT_STALE_AFTER_MS,
    circuitFailures = DEFAULT_CIRCUIT_FAILURES,
    circuitCooldownMs = DEFAULT_CIRCUIT_COOLDOWN_MS,
    retryDelaysMs = [500, 1500],
    now = () => new Date(),
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    random = Math.random,
    logger = null,
  } = {}) {
    this.name = name;
    this.providers = (providers || []).filter(Boolean);
    this.intervalMs = intervalMs;
    this.adaptiveCadence = adaptiveCadence;
    this.minIntervalMs = Math.max(1_000, Number(minIntervalMs) || DEFAULT_MIN_INTERVAL_MS);
    this.maxIntervalMs = Math.max(this.minIntervalMs, Number(maxIntervalMs) || DEFAULT_MAX_INTERVAL_MS);
    this.durationMultiplier = Math.max(1, Number(durationMultiplier) || DEFAULT_DURATION_MULTIPLIER);
    this.concurrency = positiveInteger(concurrency, DEFAULT_PROVIDER_CONCURRENCY);
    this.progressEvery = positiveInteger(progressEvery, DEFAULT_PROGRESS_EVERY);
    this.staleAfterMs = Math.max(intervalMs, staleAfterMs);
    this.circuitFailures = circuitFailures;
    this.circuitCooldownMs = circuitCooldownMs;
    this.retryDelaysMs = retryDelaysMs;
    this.now = now;
    this.wait = wait;
    this.random = random;
    this.logger = logger;
    this.timer = null;
    this.running = null;
    this.states = new Map(this.providers.map((provider) => [
      provider,
      initialProviderState(provider, this.intervalMs),
    ]));
  }

  async getOdds() {
    const due = this.providers.filter((provider) => this.#isDue(provider));
    if (due.length > 0) {
      await runWithConcurrency(due, this.concurrency, (provider) => this.#runProvider(provider));
    }
    return this.currentResult();
  }

  async refreshAll() {
    await runWithConcurrency(
      this.providers,
      this.concurrency,
      (provider) => this.#runProvider(provider, { force: true }),
    );
    return this.currentResult();
  }

  async *getOddsProgress() {
    const due = this.providers.filter((provider) => this.#isDue(provider));
    if (due.length === 0) {
      yield { ...this.currentResult(), progress: { done: this.providers.length, total: this.providers.length, complete: true } };
      return;
    }

    const pending = new Map();
    let nextIndex = 0;
    const startNext = () => {
      if (nextIndex >= due.length) return;
      const provider = due[nextIndex];
      nextIndex += 1;
      let promise;
      promise = this.#runProvider(provider).then(() => ({ provider, promise }));
      pending.set(promise, promise);
    };
    while (pending.size < this.concurrency && nextIndex < due.length) startNext();

    let done = this.providers.length - due.length;
    while (pending.size > 0) {
      const completed = await Promise.race(pending.values());
      pending.delete(completed.promise);
      done += 1;
      startNext();
      if (
        done !== 1
        && done < this.providers.length
        && done % this.progressEvery !== 0
      ) {
        continue;
      }
      yield {
        ...this.currentResult(),
        progress: { done, total: this.providers.length, complete: done >= this.providers.length },
      };
    }
  }

  start({ onSnapshot = null, onError = null, immediate = true } = {}) {
    if (this.timer) return;
    const tick = async () => {
      if (this.running) return this.running;
      this.running = this.getOdds()
        .then((result) => onSnapshot?.(result))
        .catch((error) => {
          this.logger?.error?.('Provider supervisor tick failed', { error: error.message });
          onError?.(error);
        })
        .finally(() => { this.running = null; });
      return this.running;
    };
    if (immediate) void tick();
    this.timer = setInterval(tick, jitter(this.intervalMs, this.random));
    this.timer.unref?.();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running?.catch?.(() => {});
  }

  currentResult() {
    const nowMs = this.now().getTime();
    const states = this.providers.map((provider) => this.states.get(provider));
    const freshStates = states.filter((state) =>
      Array.isArray(state.events)
      && state.lastSuccessAt
      && nowMs - new Date(state.lastSuccessAt).getTime() <= stateStaleAfterMs(state, this.staleAfterMs),
    );
    return {
      events: annotateFeedGroups(mergeEvents(freshStates.flatMap((state) => state.events))),
      providers: states.map((state) => publicProviderState(
        state,
        nowMs,
        stateStaleAfterMs(state, this.staleAfterMs),
      )),
    };
  }

  diagnostics() {
    return {
      providerCount: this.providers.length,
      intervalMs: this.intervalMs,
      adaptiveCadence: this.adaptiveCadence,
      minIntervalMs: this.minIntervalMs,
      maxIntervalMs: this.maxIntervalMs,
      concurrency: this.concurrency,
      progressEvery: this.progressEvery,
      staleAfterMs: this.staleAfterMs,
      running: Boolean(this.running),
      providers: this.currentResult().providers,
    };
  }

  #isDue(provider) {
    const state = this.states.get(provider);
    const nowMs = this.now().getTime();
    if (state.inFlight) return false;
    if (!state.lastAttemptAt) return true;
    if (state.circuitOpenUntil && nowMs < new Date(state.circuitOpenUntil).getTime()) return false;
    return nowMs - new Date(state.lastAttemptAt).getTime() >= state.refreshIntervalMs;
  }

  async #runProvider(provider, { force = false } = {}) {
    const state = this.states.get(provider);
    if (state.inFlight) return state.inFlight;
    const nowMs = this.now().getTime();
    if (!force && state.circuitOpenUntil && nowMs < new Date(state.circuitOpenUntil).getTime()) return null;

    state.inFlight = this.#attemptProvider(provider, state)
      .finally(() => { state.inFlight = null; });
    return state.inFlight;
  }

  async #attemptProvider(provider, state) {
    const startedAt = this.now();
    state.lastAttemptAt = startedAt.toISOString();
    let lastError;
    for (let attempt = 0; attempt <= this.retryDelaysMs.length; attempt += 1) {
      try {
        const events = await provider.getOdds();
        const validation = validateProviderEvents(events);
        if (!validation.ok) throw new Error(`normalized schema rejected: ${validation.errors.join('; ')}`);
        const observedAt = this.now().toISOString();
        state.events = annotateFeedGroups(stampQuoteMetadata(events, {
          observedAt,
          provider: provider.name,
          clone: 'shallow',
        }));
        state.ok = true;
        state.lastSuccessAt = observedAt;
        state.lastDurationMs = this.now().getTime() - startedAt.getTime();
        if (this.adaptiveCadence && !state.fixedRefreshInterval) {
          state.refreshIntervalMs = adaptiveRefreshInterval(state.lastDurationMs, {
            minIntervalMs: this.minIntervalMs,
            maxIntervalMs: this.maxIntervalMs,
            durationMultiplier: this.durationMultiplier,
          });
        }
        state.lastEventCount = events.length;
        state.lastError = null;
        state.consecutiveFailures = 0;
        state.circuitOpenUntil = null;
        state.schemaHash = normalizedSchemaFingerprint(events);
        return events;
      } catch (error) {
        lastError = error;
        if (attempt < this.retryDelaysMs.length && isRetryableError(error)) {
          await this.wait(jitter(this.retryDelaysMs[attempt], this.random));
          continue;
        }
        break;
      }
    }

    state.ok = false;
    state.lastDurationMs = this.now().getTime() - startedAt.getTime();
    state.lastError = lastError?.message || 'Unknown provider error';
    state.consecutiveFailures += 1;
    if (state.consecutiveFailures >= this.circuitFailures) {
      state.circuitOpenUntil = new Date(this.now().getTime() + this.circuitCooldownMs).toISOString();
    }
    return null;
  }
}

function initialProviderState(provider, defaultIntervalMs = DEFAULT_INTERVAL_MS) {
  const configuredInterval = Number(provider?.refreshIntervalMs);
  const fixedRefreshInterval = Number.isFinite(configuredInterval) && configuredInterval > 0;
  return {
    name: provider.name,
    feedGroup: provider.feedGroup || feedGroupForBookmaker(provider.name),
    events: [],
    ok: false,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastDurationMs: null,
    lastEventCount: 0,
    lastError: null,
    consecutiveFailures: 0,
    circuitOpenUntil: null,
    schemaHash: null,
    inFlight: null,
    fixedRefreshInterval,
    refreshIntervalMs: fixedRefreshInterval ? configuredInterval : defaultIntervalMs,
  };
}

function publicProviderState(state, nowMs, staleAfterMs) {
  const fresh = Boolean(state.lastSuccessAt)
    && nowMs - new Date(state.lastSuccessAt).getTime() <= staleAfterMs;
  const circuitOpen = Boolean(state.circuitOpenUntil)
    && nowMs < new Date(state.circuitOpenUntil).getTime();
  return {
    name: state.name,
    feedGroup: state.feedGroup,
    ok: state.ok && fresh,
    events: fresh ? state.lastEventCount : 0,
    durationMs: state.lastDurationMs,
    checkedAt: state.lastAttemptAt,
    lastSuccessAt: state.lastSuccessAt,
    stale: !fresh,
    consecutiveFailures: state.consecutiveFailures,
    circuitState: circuitOpen ? 'open' : state.consecutiveFailures > 0 ? 'half-open' : 'closed',
    circuitOpenUntil: circuitOpen ? state.circuitOpenUntil : null,
    schemaHash: state.schemaHash,
    refreshIntervalMs: state.refreshIntervalMs,
    ...(state.lastError ? { error: state.lastError } : {}),
  };
}

function stateStaleAfterMs(state, defaultStaleAfterMs) {
  return Math.max(defaultStaleAfterMs, Math.ceil(Number(state?.refreshIntervalMs || 0) * 1.5));
}

function adaptiveRefreshInterval(durationMs, {
  minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
  maxIntervalMs = DEFAULT_MAX_INTERVAL_MS,
  durationMultiplier = DEFAULT_DURATION_MULTIPLIER,
} = {}) {
  const target = Math.max(minIntervalMs, Math.ceil(Math.max(0, Number(durationMs) || 0) * durationMultiplier));
  return Math.min(maxIntervalMs, target);
}

function validateProviderEvents(events) {
  const errors = [];
  if (!Array.isArray(events)) return { ok: false, errors: ['response is not an event array'] };
  if (events.length === 0) return { ok: false, errors: ['response contains no events'] };
  const sample = events.slice(0, 50);
  for (const [index, event] of sample.entries()) {
    if (!event?.id || !event?.homeTeam || !event?.awayTeam) errors.push(`event ${index} is missing identity`);
    if (!Number.isFinite(new Date(event?.startsAt).getTime())) errors.push(`event ${index} has invalid kickoff`);
    if (!Array.isArray(event?.bookmakers) || event.bookmakers.length === 0) errors.push(`event ${index} has no bookmaker rows`);
  }
  return { ok: errors.length === 0, errors: [...new Set(errors)].slice(0, 10) };
}

function normalizedSchemaFingerprint(events) {
  const sample = (events || []).slice(0, 20).map((event) => ({
    eventKeys: Object.keys(event || {}).sort(),
    bookmakerKeys: Object.keys(event?.bookmakers?.[0] || {}).sort(),
    marketValueTypes: Object.values(event?.bookmakers?.[0]?.markets || {}).slice(0, 10).map((market) =>
      Object.fromEntries(Object.keys(market || {}).sort().map((key) => [keyType(key), typeof market[key]]))),
  }));
  return crypto.createHash('sha256').update(JSON.stringify(sample)).digest('hex').slice(0, 20);
}

function keyType(key) {
  return String(key).replace(/[0-9]+(?:[_.][0-9]+)*/g, '#').toLowerCase();
}

function isRetryableError(error) {
  const message = String(error?.message || '');
  return /timeout|timed out|429|502|503|504|econnreset|econnrefused|socket|network/i.test(message);
}

function jitter(value, random = Math.random) {
  const numeric = Math.max(1, Number(value) || 1);
  return Math.round(numeric * (0.9 + random() * 0.2));
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function runWithConcurrency(items, concurrency, worker) {
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(items.length, positiveInteger(concurrency, DEFAULT_PROVIDER_CONCURRENCY)) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        await worker(items[index], index);
      }
    },
  );
  await Promise.all(workers);
}

module.exports = {
  ProviderSupervisor,
  adaptiveRefreshInterval,
  jitter,
  normalizedSchemaFingerprint,
  validateProviderEvents,
};
