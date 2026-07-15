'use strict';

class AutonomyMonitor {
  constructor({
    store,
    endpointIntervalMs = 6 * 60 * 60_000,
    discoveryIntervalMs = 24 * 60 * 60_000,
    fidelityIntervalMs = 60 * 60_000,
    fidelityEnabled = false,
    endpointRunner = defaultEndpointRunner,
    discoveryRunner = defaultDiscoveryRunner,
    fidelityRunner = defaultFidelityRunner,
    providerNames = [],
    now = () => new Date(),
    logger = null,
  } = {}) {
    if (!store) throw new Error('AutonomyMonitor requires a store');
    this.store = store;
    this.endpointIntervalMs = endpointIntervalMs;
    this.discoveryIntervalMs = discoveryIntervalMs;
    this.fidelityIntervalMs = fidelityIntervalMs;
    this.fidelityEnabled = fidelityEnabled;
    this.endpointRunner = endpointRunner;
    this.discoveryRunner = discoveryRunner;
    this.fidelityRunner = fidelityRunner;
    this.providerNames = providerNames;
    this.now = now;
    this.logger = logger;
    this.endpointTimer = null;
    this.discoveryTimer = null;
    this.fidelityTimer = null;
    this.endpointRunning = null;
    this.discoveryRunning = null;
    this.fidelityRunning = null;
    this.fidelityIndex = 0;
    this.lastEndpoint = null;
    this.lastDiscovery = null;
    this.lastFidelity = null;
  }

  start() {
    if (!this.endpointTimer) {
      this.endpointTimer = setInterval(() => void this.runEndpointAudit(), this.endpointIntervalMs);
      this.endpointTimer.unref?.();
    }
    if (!this.discoveryTimer) {
      this.discoveryTimer = setInterval(() => void this.runDiscoveryAudit(), this.discoveryIntervalMs);
      this.discoveryTimer.unref?.();
    }
    if (this.fidelityEnabled && !this.fidelityTimer) {
      this.fidelityTimer = setInterval(() => void this.runFidelityAudit(), this.fidelityIntervalMs);
      this.fidelityTimer.unref?.();
    }
  }

  stop() {
    if (this.endpointTimer) clearInterval(this.endpointTimer);
    if (this.discoveryTimer) clearInterval(this.discoveryTimer);
    if (this.fidelityTimer) clearInterval(this.fidelityTimer);
    this.endpointTimer = null;
    this.discoveryTimer = null;
    this.fidelityTimer = null;
  }

  async runEndpointAudit() {
    if (this.endpointRunning) return this.endpointRunning;
    this.endpointRunning = this.#runMonitor('endpoint', async () => {
      const report = await this.endpointRunner();
      this.lastEndpoint = compactReport(report);
      return { ok: Boolean(report.ok), summary: report.summary || {}, report };
    }).finally(() => { this.endpointRunning = null; });
    return this.endpointRunning;
  }

  async runFidelityAudit() {
    if (!this.fidelityEnabled) return { ok: true, skipped: 'disabled' };
    if (this.fidelityRunning) return this.fidelityRunning;
    const provider = this.#nextProvider();
    this.fidelityRunning = this.#runMonitor('fidelity', async () => {
      const report = await this.fidelityRunner(provider);
      await this.store.saveFidelityRecords(report.verificationRecords || [], report.checkedAt);
      this.lastFidelity = { provider, ...compactReport(report) };
      return {
        ok: Boolean(report.ok),
        summary: { provider, ...(report.fidelitySummary || {}), problems: report.problemSummary || {} },
        report,
      };
    }).finally(() => { this.fidelityRunning = null; });
    return this.fidelityRunning;
  }

  async runDiscoveryAudit() {
    if (this.discoveryRunning) return this.discoveryRunning;
    this.discoveryRunning = this.#runMonitor('discovery', async () => {
      const report = await this.discoveryRunner();
      const candidates = (report.results || []).reduce(
        (total, result) => total + (result.apiUrls?.length || 0),
        0,
      );
      const failures = (report.results || []).filter((result) => !result.ok).length;
      this.lastDiscovery = {
        ok: failures === 0,
        checkedAt: report.generatedAt || this.now().toISOString(),
        summary: { targets: report.count || 0, candidates, failures },
      };
      return { ok: failures === 0, summary: this.lastDiscovery.summary, report };
    }).finally(() => { this.discoveryRunning = null; });
    return this.discoveryRunning;
  }

  diagnostics() {
    return {
      endpointEnabled: true,
      fidelityEnabled: this.fidelityEnabled,
      endpointRunning: Boolean(this.endpointRunning),
      discoveryRunning: Boolean(this.discoveryRunning),
      fidelityRunning: Boolean(this.fidelityRunning),
      lastEndpoint: this.lastEndpoint,
      lastDiscovery: this.lastDiscovery,
      lastFidelity: this.lastFidelity,
    };
  }

  async #runMonitor(kind, operation) {
    const checkedAt = this.now().toISOString();
    try {
      const result = await operation();
      await this.store.recordMonitorRun({
        kind,
        ok: result.ok,
        summary: result.summary,
        checkedAt,
      });
      if (!result.ok) this.logger?.warn?.(`${kind} monitor reported problems`, result.summary);
      return result;
    } catch (error) {
      await this.store.recordMonitorRun({ kind, ok: false, summary: {}, error: error.message, checkedAt });
      this.logger?.error?.(`${kind} monitor failed`, { error: error.message });
      return { ok: false, error: error.message };
    }
  }

  #nextProvider() {
    if (this.providerNames.length === 0) return 'all';
    const provider = this.providerNames[this.fidelityIndex % this.providerNames.length];
    this.fidelityIndex += 1;
    return provider;
  }
}

async function defaultEndpointRunner() {
  const { buildDirectProviders, providerOptionsFromEnv } = require('../services/provider-config');
  const {
    auditProviders,
    buildAuditEnv,
    buildAuditReport,
  } = require('../../scripts/audit-provider-endpoints');
  const env = buildAuditEnv(process.env, { eventTarget: 25 });
  const providers = buildDirectProviders(providerOptionsFromEnv(env));
  const results = await auditProviders(providers, {
    concurrency: Number(process.env.AUTONOMY_AUDIT_CONCURRENCY || 1),
    timeoutMs: Number(process.env.AUTONOMY_AUDIT_TIMEOUT_MS || 35_000),
  });
  return buildAuditReport(results);
}

async function defaultFidelityRunner(provider) {
  const { runFidelityVerification } = require('../../scripts/verify-odds-fidelity');
  return runFidelityVerification({
    providerTarget: provider,
    bookmakerTarget: 'all',
    eventsPerBookmaker: 1,
    maxPrices: 3,
    eventTarget: 25,
    timeoutMs: Number(process.env.AUTONOMY_FIDELITY_TIMEOUT_MS || 30_000),
  });
}

async function defaultDiscoveryRunner() {
  const {
    buildDiscoveryReport,
    remainingProviderTargets,
  } = require('../../scripts/discover-remaining-bookmakers');
  return buildDiscoveryReport(remainingProviderTargets(), {
    maxScripts: Number(process.env.DISCOVERY_MAX_SCRIPTS || 8),
  });
}

function compactReport(report) {
  return {
    ok: Boolean(report?.ok),
    checkedAt: report?.checkedAt || null,
    summary: report?.summary || report?.fidelitySummary || {},
  };
}

module.exports = {
  AutonomyMonitor,
  compactReport,
  defaultDiscoveryRunner,
  defaultEndpointRunner,
  defaultFidelityRunner,
};
