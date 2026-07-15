'use strict';

const crypto = require('node:crypto');
const { getAllOpportunities } = require('../engine/formula-engine');
const {
  DEFAULT_MAX_QUOTE_AGE_MS,
  DEFAULT_MAX_QUOTE_SKEW_MS,
} = require('../core/quote-metadata');

const DEFAULT_CONFIRMATION_SNAPSHOTS = 2;
const DEFAULT_CONFIRMATION_MIN_INTERVAL_MS = 2_000;
const DEFAULT_CONFIRMATION_MAX_INTERVAL_MS = 90_000;

class OpportunityPipeline {
  constructor({
    store,
    alertOutbox = null,
    opportunityTtlMs = 120_000,
    now = () => new Date(),
    detector = getAllOpportunities,
    logger = null,
    confirmationSnapshots = DEFAULT_CONFIRMATION_SNAPSHOTS,
    confirmationMinIntervalMs = DEFAULT_CONFIRMATION_MIN_INTERVAL_MS,
    confirmationMaxIntervalMs = DEFAULT_CONFIRMATION_MAX_INTERVAL_MS,
    maxQuoteAgeMs = DEFAULT_MAX_QUOTE_AGE_MS,
    maxQuoteSkewMs = DEFAULT_MAX_QUOTE_SKEW_MS,
  } = {}) {
    if (!store) throw new Error('OpportunityPipeline requires a durable store');
    this.store = store;
    this.alertOutbox = alertOutbox;
    this.opportunityTtlMs = opportunityTtlMs;
    this.now = now;
    this.detector = detector;
    this.logger = logger;
    this.confirmationSnapshots = Math.max(2, Number(confirmationSnapshots) || DEFAULT_CONFIRMATION_SNAPSHOTS);
    this.confirmationMinIntervalMs = Math.max(0, Number(confirmationMinIntervalMs) || 0);
    this.confirmationMaxIntervalMs = Math.max(
      this.confirmationMinIntervalMs,
      Number(confirmationMaxIntervalMs) || DEFAULT_CONFIRMATION_MAX_INTERVAL_MS,
    );
    this.maxQuoteAgeMs = Math.max(1, Number(maxQuoteAgeMs) || DEFAULT_MAX_QUOTE_AGE_MS);
    this.maxQuoteSkewMs = Math.max(0, Number(maxQuoteSkewMs) || DEFAULT_MAX_QUOTE_SKEW_MS);
    this.confirmationStates = new Map();
  }

  async processSnapshot(payload) {
    if (payload?.mode !== 'live' || !Array.isArray(payload?.events)) {
      return { total: 0, actionable: 0, queuedAlerts: 0, skipped: 'non-live snapshot' };
    }

    const checkedAt = this.now();
    const opportunities = this.detector(payload.events, {
      now: checkedAt,
      maxQuoteAgeMs: this.maxQuoteAgeMs,
      maxQuoteSkewMs: this.maxQuoteSkewMs,
    });
    const snapshotId = snapshotIdentity(payload, checkedAt);
    const nextConfirmationStates = new Map();
    const activeFingerprints = [];
    let actionable = 0;
    let queuedAlerts = 0;
    let awaitingRecheck = 0;
    let awaitingFidelity = 0;
    let awaitingFreshness = 0;
    let rejected = 0;
    let analysis = 0;
    const quoteTiming = { fresh: 0, stale: 0, skewed: 0, missing: 0, unknown: 0 };

    for (const opportunity of opportunities) {
      const fingerprint = opportunityFingerprint(opportunity);
      const pricesHash = opportunityPriceFingerprint(opportunity);
      const quoteHash = opportunityQuoteFingerprint(opportunity);
      const confirmation = updateConfirmationState(
        this.confirmationStates.get(fingerprint),
        { pricesHash, quoteHash, snapshotId, checkedAt },
        {
          requiredSnapshots: this.confirmationSnapshots,
          minIntervalMs: this.confirmationMinIntervalMs,
          maxIntervalMs: this.confirmationMaxIntervalMs,
        },
      );
      const priceConfirmed = confirmation.count >= this.confirmationSnapshots;
      const lifecycle = lifecycleStatus(opportunity, {
        priceConfirmed,
        confirmationCount: confirmation.count,
        confirmationSnapshots: this.confirmationSnapshots,
      });
      const expiresAt = opportunityExpiry(opportunity, checkedAt, this.opportunityTtlMs);
      const record = {
        fingerprint,
        status: lifecycle.status,
        reason: lifecycle.reason,
        eventKey: opportunityEventKey(opportunity),
        marketKey: opportunity.marketKey || '',
        edge: Number(opportunity.edge || 0),
        expiresAt: expiresAt.toISOString(),
        firstSeenAt: checkedAt.toISOString(),
        lastSeenAt: checkedAt.toISOString(),
        priceConfirmed,
        payload: {
          ...opportunity,
          autonomy: {
            fingerprint,
            pricesHash,
            quoteHash,
            status: lifecycle.status,
            priceConfirmed,
            confirmationCount: confirmation.count,
            confirmationSnapshots: this.confirmationSnapshots,
            confirmationFirstSeenAt: confirmation.firstSeenAt,
            confirmationLastSeenAt: confirmation.lastSeenAt,
            expiresAt: expiresAt.toISOString(),
          },
        },
      };
      const upsert = await this.store.upsertOpportunity(record);
      activeFingerprints.push(fingerprint);
      nextConfirmationStates.set(fingerprint, confirmation);

      if (lifecycle.status === 'actionable') {
        actionable += 1;
        if (upsert.statusChanged || upsert.created) {
          queuedAlerts += await this.alertOutbox?.queueOpportunity?.(record.payload) || 0;
        }
      }
      if (lifecycle.status === 'awaiting_recheck') awaitingRecheck += 1;
      if (lifecycle.status === 'awaiting_fidelity') awaitingFidelity += 1;
      if (lifecycle.status === 'awaiting_freshness') awaitingFreshness += 1;
      if (lifecycle.status === 'rejected') rejected += 1;
      if (lifecycle.status === 'analysis') analysis += 1;
      const quoteStatus = opportunity?.quoteTiming?.status || 'unknown';
      quoteTiming[quoteStatus] = (quoteTiming[quoteStatus] || 0) + 1;
    }

    await this.store.expireOpportunities(activeFingerprints, checkedAt.toISOString());
    this.confirmationStates = nextConfirmationStates;
    const summary = {
      total: opportunities.length,
      actionable,
      awaitingRecheck,
      awaitingFidelity,
      awaitingFreshness,
      rejected,
      analysis,
      quoteTiming,
      queuedAlerts,
      checkedAt: checkedAt.toISOString(),
    };
    this.logger?.info?.('Opportunity lifecycle processed', summary);
    return summary;
  }
}

function lifecycleStatus(opportunity, {
  priceConfirmed = false,
  confirmationCount = 0,
  confirmationSnapshots = DEFAULT_CONFIRMATION_SNAPSHOTS,
} = {}) {
  if (opportunity?.eligibility === 'rejected') {
    return { status: 'rejected', reason: (opportunity.eligibilityReasons || []).join(' ') };
  }
  if (opportunity?.eligibility === 'analysis') {
    return { status: 'analysis', reason: 'Analysis-only opportunity; no guaranteed return.' };
  }
  if (opportunity?.eligibility !== 'actionable') {
    if (opportunity?.quoteTiming && opportunity.quoteTiming.actionable === false) {
      return { status: 'awaiting_freshness', reason: 'Waiting for fresh, synchronized quote observations.' };
    }
    return { status: 'awaiting_fidelity', reason: 'Every selected leg must have current fidelity evidence.' };
  }
  if (!priceConfirmed) {
    return {
      status: 'awaiting_recheck',
      reason: `Waiting for identical prices in ${confirmationSnapshots} distinct live snapshots (${confirmationCount}/${confirmationSnapshots}).`,
    };
  }
  return { status: 'actionable', reason: 'Structure, fidelity, source independence, and price recheck passed.' };
}

function updateConfirmationState(previous, current, {
  requiredSnapshots = DEFAULT_CONFIRMATION_SNAPSHOTS,
  minIntervalMs = DEFAULT_CONFIRMATION_MIN_INTERVAL_MS,
  maxIntervalMs = DEFAULT_CONFIRMATION_MAX_INTERVAL_MS,
} = {}) {
  const checkedAt = validDate(current?.checkedAt) || new Date();
  const checkedAtIso = checkedAt.toISOString();
  const base = {
    pricesHash: current?.pricesHash || '',
    quoteHash: current?.quoteHash || '',
    snapshotId: current?.snapshotId || checkedAtIso,
    count: 1,
    firstSeenAt: checkedAtIso,
    lastSeenAt: checkedAtIso,
    requiredSnapshots: Math.max(2, Number(requiredSnapshots) || DEFAULT_CONFIRMATION_SNAPSHOTS),
  };
  if (!previous || previous.pricesHash !== base.pricesHash) return base;
  if (base.quoteHash && previous.quoteHash === base.quoteHash) return { ...previous };
  if (previous.snapshotId === base.snapshotId) return { ...previous };

  const previousMs = new Date(previous.lastSeenAt).getTime();
  const intervalMs = checkedAt.getTime() - previousMs;
  if (!Number.isFinite(intervalMs) || intervalMs < 0 || intervalMs > maxIntervalMs) return base;
  if (intervalMs < minIntervalMs) return { ...previous };

  return {
    ...previous,
    snapshotId: base.snapshotId,
    quoteHash: base.quoteHash,
    count: Math.min(base.requiredSnapshots, Number(previous.count || 1) + 1),
    lastSeenAt: checkedAtIso,
    requiredSnapshots: base.requiredSnapshots,
  };
}

function snapshotIdentity(payload, checkedAt) {
  return String(
    payload?.collectionId
    || payload?.snapshotId
    || payload?.fetchedAt
    || validDate(checkedAt)?.toISOString()
    || '',
  );
}

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function opportunityFingerprint(opportunity) {
  const legs = normalizedLegs(opportunity).map((leg) =>
    [leg.marketKey, leg.outcome, leg.bookmaker, leg.feedGroup].join('|'),
  );
  return hash([
    opportunityEventKey(opportunity),
    opportunity.marketKey || '',
    opportunity.type || 'classic',
    ...legs,
  ].join('::'));
}

function opportunityPriceFingerprint(opportunity) {
  return hash(normalizedLegs(opportunity).map((leg) =>
    [leg.marketKey, leg.outcome, leg.bookmaker, Number(leg.price).toFixed(6)].join('|'),
  ).join('::'));
}

function opportunityQuoteFingerprint(opportunity) {
  const timestamps = normalizedLegs(opportunity)
    .map((leg) => leg.observedAt)
    .filter(Boolean);
  return timestamps.length > 0 ? hash(timestamps.join('::')) : '';
}

function normalizedLegs(opportunity) {
  return [...(opportunity?.legs || [])]
    .map((leg) => ({
      marketKey: leg.marketKey || opportunity.marketKey || '',
      outcome: leg.outcome || leg.label || '',
      bookmaker: leg.bookmaker || '',
      feedGroup: leg.feedGroup || leg.bookmaker || '',
      price: Number(leg.price || 0),
      observedAt: leg.observedAt || leg.quoteObservedAt || '',
    }))
    .sort((left, right) =>
      `${left.marketKey}|${left.outcome}|${left.bookmaker}`
        .localeCompare(`${right.marketKey}|${right.outcome}|${right.bookmaker}`),
    );
}

function opportunityEventKey(opportunity) {
  return [opportunity?.eventId || opportunity?.eventName || '', opportunity?.kickoff || ''].join('|');
}

function opportunityExpiry(opportunity, now, ttlMs) {
  const ttlExpiry = new Date(now.getTime() + ttlMs);
  const kickoff = new Date(opportunity?.kickoff);
  if (Number.isFinite(kickoff.getTime()) && kickoff < ttlExpiry) return kickoff;
  return ttlExpiry;
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

module.exports = {
  DEFAULT_CONFIRMATION_MAX_INTERVAL_MS,
  DEFAULT_CONFIRMATION_MIN_INTERVAL_MS,
  DEFAULT_CONFIRMATION_SNAPSHOTS,
  OpportunityPipeline,
  lifecycleStatus,
  opportunityFingerprint,
  opportunityPriceFingerprint,
  opportunityQuoteFingerprint,
  snapshotIdentity,
  updateConfirmationState,
};
