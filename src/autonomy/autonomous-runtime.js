'use strict';

const { applyFidelityEvidence } = require('./fidelity-evidence');

class AutonomousRuntime {
  constructor({
    oddsService,
    store,
    opportunityPipeline,
    candidateVerificationBroker = null,
    alertOutbox,
    monitor = null,
    settlementService = null,
    collectionIntervalMs = 60_000,
    alertIntervalMs = 5_000,
    now = () => new Date(),
    logger = null,
    fidelityMaxAgeMs = 6 * 60 * 60_000,
    retentionIntervalMs = 24 * 60 * 60_000,
    progressiveBatches = 2,
  } = {}) {
    if (!oddsService || !store || !opportunityPipeline || !alertOutbox) {
      throw new Error('AutonomousRuntime requires oddsService, store, opportunityPipeline, and alertOutbox');
    }
    this.oddsService = oddsService;
    this.store = store;
    this.opportunityPipeline = opportunityPipeline;
    this.candidateVerificationBroker = candidateVerificationBroker;
    this.alertOutbox = alertOutbox;
    this.monitor = monitor;
    this.settlementService = settlementService;
    this.collectionIntervalMs = collectionIntervalMs;
    this.alertIntervalMs = alertIntervalMs;
    this.now = now;
    this.logger = logger;
    this.fidelityMaxAgeMs = fidelityMaxAgeMs;
    this.retentionIntervalMs = retentionIntervalMs;
    this.progressiveBatches = Math.max(1, Number(progressiveBatches) || 2);
    this.lastRetentionAt = null;
    this.collectionTimer = null;
    this.alertTimer = null;
    this.cyclePromise = null;
    this.started = false;
    this.lastCycle = null;
    this.lastAlertDispatch = null;
  }

  async start() {
    if (this.started) return;
    await this.store.init();
    await this.oddsService.restoreFromStore?.();
    this.started = true;
    this.monitor?.start?.();
    await this.runCycle();
    this.collectionTimer = setInterval(() => void this.runCycle(), this.collectionIntervalMs);
    this.collectionTimer.unref?.();
    this.alertTimer = setInterval(() => void this.dispatchAlerts(), this.alertIntervalMs);
    this.alertTimer.unref?.();
  }

  async stop() {
    if (this.collectionTimer) clearInterval(this.collectionTimer);
    if (this.alertTimer) clearInterval(this.alertTimer);
    this.collectionTimer = null;
    this.alertTimer = null;
    this.monitor?.stop?.();
    await this.cyclePromise?.catch?.(() => {});
    await this.store.close?.();
    this.started = false;
  }

  async runCycle() {
    if (this.cyclePromise) return this.cyclePromise;
    this.cyclePromise = this.#runCycle().finally(() => { this.cyclePromise = null; });
    return this.cyclePromise;
  }

  async #runCycle() {
    const startedAt = this.now();
    try {
      const {
        payload,
        opportunities,
        candidateVerifications,
        snapshotsProcessed,
      } = await this.#collectAndProcessSnapshots();
      await this.store.recordProviderRuns(payload.providers || [], payload.fetchedAt);
      const settlements = await this.settlementService?.settlePending?.() || null;
      const retention = await this.#maybePrune();
      const alerts = await this.dispatchAlerts();
      this.lastCycle = {
        ok: true,
        at: this.now().toISOString(),
        durationMs: this.now().getTime() - startedAt.getTime(),
        events: payload.events?.length || 0,
        providers: payload.providers?.length || 0,
        snapshotsProcessed,
        candidateVerification: candidateVerifications.at(-1) || null,
        candidateVerifications,
        opportunities,
        settlements,
        retention,
        alerts,
      };
      this.logger?.info?.('Autonomous collection cycle completed', this.lastCycle);
      return this.lastCycle;
    } catch (error) {
      this.lastCycle = {
        ok: false,
        at: this.now().toISOString(),
        durationMs: this.now().getTime() - startedAt.getTime(),
        error: error.message,
      };
      await this.store.recordMonitorRun({
        kind: 'collection',
        ok: false,
        summary: {},
        error: error.message,
        checkedAt: this.lastCycle.at,
      }).catch(() => {});
      this.logger?.error?.('Autonomous collection cycle failed', { error: error.message });
      return this.lastCycle;
    }
  }

  async #collectAndProcessSnapshots() {
    let fidelityRecords = await this.store.loadLatestFidelityRecords?.(
      this.fidelityMaxAgeMs,
      this.now(),
    ) || [];
    let payload = null;
    let opportunities = { total: 0, actionable: 0, queuedAlerts: 0 };
    const candidateVerifications = [];
    let snapshotsProcessed = 0;

    if (typeof this.oddsService.forceRefreshStream === 'function') {
      for await (const snapshot of this.oddsService.forceRefreshStream()) {
        payload = snapshot;
        if (!Array.isArray(snapshot?.events) || snapshot.events.length === 0) continue;
        if (!shouldProcessProgress(snapshot.progress, this.progressiveBatches)) continue;
        applyFidelityEvidence(snapshot.events, fidelityRecords, {
          maxAgeMs: this.fidelityMaxAgeMs,
          now: this.now(),
        });
        const verification = await this.candidateVerificationBroker?.verifySnapshot?.(snapshot) || null;
        if (verification) {
          candidateVerifications.push(compactCandidateVerification(verification));
          if (Array.isArray(verification.verificationRecords) && verification.verificationRecords.length > 0) {
            fidelityRecords = mergeFidelityRecords(fidelityRecords, verification.verificationRecords);
          }
        }
        opportunities = await this.opportunityPipeline.processSnapshot(snapshot);
        snapshotsProcessed += 1;
      }
    } else {
      payload = await this.oddsService.forceRefresh();
      applyFidelityEvidence(payload.events, fidelityRecords, {
        maxAgeMs: this.fidelityMaxAgeMs,
        now: this.now(),
      });
      const verification = await this.candidateVerificationBroker?.verifySnapshot?.(payload) || null;
      if (verification) candidateVerifications.push(compactCandidateVerification(verification));
      opportunities = await this.opportunityPipeline.processSnapshot(payload);
      snapshotsProcessed = 1;
    }

    if (!payload) throw new Error('The odds collection produced no snapshot');
    if (snapshotsProcessed === 0) {
      applyFidelityEvidence(payload.events, fidelityRecords, {
        maxAgeMs: this.fidelityMaxAgeMs,
        now: this.now(),
      });
      opportunities = await this.opportunityPipeline.processSnapshot(payload);
      snapshotsProcessed = 1;
    }
    return { payload, opportunities, candidateVerifications, snapshotsProcessed };
  }

  async #maybePrune() {
    const now = this.now();
    if (this.lastRetentionAt && now.getTime() - new Date(this.lastRetentionAt).getTime() < this.retentionIntervalMs) {
      return null;
    }
    this.lastRetentionAt = now.toISOString();
    return this.store.prune?.({}, now) || null;
  }

  async dispatchAlerts() {
    const result = await this.alertOutbox.dispatchPending();
    this.lastAlertDispatch = { ...result, at: this.now().toISOString() };
    return result;
  }

  diagnostics() {
    return {
      enabled: true,
      started: this.started,
      cycleRunning: Boolean(this.cyclePromise),
      collectionIntervalMs: this.collectionIntervalMs,
      progressiveBatches: this.progressiveBatches,
      alertIntervalMs: this.alertIntervalMs,
      lastCycle: this.lastCycle,
      lastAlertDispatch: this.lastAlertDispatch,
      storage: this.store.diagnostics?.() || null,
      supervisor: this.oddsService.liveProvider?.diagnostics?.() || null,
      monitoring: this.monitor?.diagnostics?.() || null,
      candidateVerification: this.candidateVerificationBroker?.diagnostics?.() || null,
    };
  }
}

function shouldProcessProgress(progress, batches = 2) {
  if (!progress) return true;
  if (progress.complete) return true;
  const done = Number(progress.done || 0);
  const total = Number(progress.total || 0);
  if (!(done > 0) || !(total > 0)) return false;
  const interval = Math.max(1, Math.ceil(total / Math.max(1, Number(batches) || 1)));
  return done % interval === 0;
}

function compactCandidateVerification(result) {
  if (!result) return null;
  const { verificationRecords: _records, ...summary } = result;
  return summary;
}

function mergeFidelityRecords(existing, additions) {
  const records = new Map();
  for (const record of [...(existing || []), ...(additions || [])]) {
    const key = [record.bookmaker, record.eventId, record.marketKey, record.outcome].join('|');
    const current = records.get(key);
    if (!current || new Date(record.checkedAt || 0) >= new Date(current.checkedAt || 0)) {
      records.set(key, record);
    }
  }
  return [...records.values()];
}

module.exports = {
  AutonomousRuntime,
  compactCandidateVerification,
  mergeFidelityRecords,
  shouldProcessProgress,
};
