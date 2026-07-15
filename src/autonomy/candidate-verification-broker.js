'use strict';

const { getAllOpportunities } = require('../engine/formula-engine');
const { applyFidelityEvidence } = require('./fidelity-evidence');
const { MAX_ACTIONABLE_EDGE } = require('../engine/opportunity-eligibility');
const {
  DEFAULT_MAX_QUOTE_AGE_MS,
  DEFAULT_MAX_QUOTE_SKEW_MS,
} = require('../core/quote-metadata');

const DEFAULT_MAX_CANDIDATES = 8;
const DEFAULT_MAX_LEGS = 24;
const DEFAULT_REVERIFY_COOLDOWN_MS = 10 * 60_000;
const DEFAULT_CHANGED_PRICE_COOLDOWN_MS = 15_000;

class CandidateVerificationBroker {
  constructor({
    store,
    enabled = true,
    verifier = defaultCandidateVerifier,
    detector = getAllOpportunities,
    maxCandidates = DEFAULT_MAX_CANDIDATES,
    maxLegs = DEFAULT_MAX_LEGS,
    minEdge = 0,
    maxEdge = MAX_ACTIONABLE_EDGE,
    reverifyCooldownMs = DEFAULT_REVERIFY_COOLDOWN_MS,
    changedPriceCooldownMs = DEFAULT_CHANGED_PRICE_COOLDOWN_MS,
    timeoutMs = 30_000,
    concurrency = 2,
    maxQuoteAgeMs = DEFAULT_MAX_QUOTE_AGE_MS,
    maxQuoteSkewMs = DEFAULT_MAX_QUOTE_SKEW_MS,
    now = () => new Date(),
    logger = null,
  } = {}) {
    if (!store) throw new Error('CandidateVerificationBroker requires a durable store');
    this.store = store;
    this.enabled = enabled;
    this.verifier = verifier;
    this.detector = detector;
    this.maxCandidates = Math.max(1, Number(maxCandidates) || DEFAULT_MAX_CANDIDATES);
    this.maxLegs = Math.max(2, Number(maxLegs) || DEFAULT_MAX_LEGS);
    this.minEdge = Math.max(0, Number(minEdge) || 0);
    this.maxEdge = Math.max(this.minEdge, Number(maxEdge) || MAX_ACTIONABLE_EDGE);
    this.reverifyCooldownMs = Math.max(0, Number(reverifyCooldownMs) || 0);
    this.changedPriceCooldownMs = Math.max(0, Number(changedPriceCooldownMs) || 0);
    this.timeoutMs = Math.max(1_000, Number(timeoutMs) || 30_000);
    this.concurrency = Math.max(1, Number(concurrency) || 2);
    this.maxQuoteAgeMs = Math.max(1, Number(maxQuoteAgeMs) || DEFAULT_MAX_QUOTE_AGE_MS);
    this.maxQuoteSkewMs = Math.max(0, Number(maxQuoteSkewMs) || DEFAULT_MAX_QUOTE_SKEW_MS);
    this.now = now;
    this.logger = logger;
    this.running = null;
    this.lastRun = null;
  }

  async verifySnapshot(payload) {
    if (!this.enabled) return this.#skipped('disabled');
    if (payload?.mode !== 'live' || !Array.isArray(payload?.events)) {
      return this.#skipped('non-live snapshot');
    }
    if (this.running) return this.running;
    this.running = this.#verify(payload).finally(() => { this.running = null; });
    return this.running;
  }

  async #verify(payload) {
    const startedAt = this.now();
    try {
      const opportunities = prioritizeVerificationOpportunities(
        this.detector(payload.events, {
          now: startedAt,
          maxQuoteAgeMs: this.maxQuoteAgeMs,
          maxQuoteSkewMs: this.maxQuoteSkewMs,
        }),
        { minEdge: this.minEdge, maxEdge: this.maxEdge },
      );
      const selection = buildVerificationCandidates(payload.events, opportunities, {
        maxCandidates: this.maxCandidates,
        maxLegs: this.maxLegs,
        now: startedAt,
        reverifyCooldownMs: this.reverifyCooldownMs,
        changedPriceCooldownMs: this.changedPriceCooldownMs,
      });
      if (selection.candidates.length === 0) {
        this.lastRun = {
          ok: true,
          checkedAt: startedAt.toISOString(),
          durationMs: this.now().getTime() - startedAt.getTime(),
          opportunities: opportunities.length,
          candidates: 0,
          legs: 0,
          records: 0,
          skipped: 'no eligible unverified legs',
        };
        return this.lastRun;
      }

      const report = await this.verifier(selection.candidates, {
        timeoutMs: this.timeoutMs,
        maxCandidates: this.maxCandidates,
        strictContext: true,
        concurrency: this.concurrency,
      });
      const records = Array.isArray(report)
        ? report
        : Array.isArray(report?.verificationRecords) ? report.verificationRecords : [];
      if (records.length > 0) {
        await this.store.saveFidelityRecords(records, report?.checkedAt || this.now().toISOString());
        applyFidelityEvidence(payload.events, records, { now: this.now() });
      }
      const statusCounts = countStatuses(records);
      this.lastRun = {
        ok: report?.ok !== false,
        checkedAt: report?.checkedAt || this.now().toISOString(),
        durationMs: this.now().getTime() - startedAt.getTime(),
        opportunities: opportunities.length,
        candidates: selection.candidates.length,
        legs: selection.legCount,
        records: records.length,
        statusCounts,
      };
      this.logger?.info?.('Candidate fidelity verification completed', this.lastRun);
      return { ...this.lastRun, verificationRecords: records };
    } catch (error) {
      this.lastRun = {
        ok: false,
        checkedAt: this.now().toISOString(),
        durationMs: this.now().getTime() - startedAt.getTime(),
        error: error.message,
      };
      this.logger?.warn?.('Candidate fidelity verification failed closed', { error: error.message });
      return this.lastRun;
    }
  }

  #skipped(reason) {
    return { ok: true, skipped: reason, candidates: 0, legs: 0, records: 0 };
  }

  diagnostics() {
    return {
      enabled: this.enabled,
      running: Boolean(this.running),
      maxCandidates: this.maxCandidates,
      maxLegs: this.maxLegs,
      concurrency: this.concurrency,
      lastRun: this.lastRun,
    };
  }
}

function prioritizeVerificationOpportunities(opportunities, {
  minEdge = 0,
  maxEdge = MAX_ACTIONABLE_EDGE,
} = {}) {
  return (Array.isArray(opportunities) ? opportunities : [])
    .filter((opportunity) => opportunity?.eligibility === 'review')
    .filter((opportunity) => opportunity?.structuralStatus === 'approved')
    .filter((opportunity) => {
      const edge = Number(opportunity?.edge);
      return Number.isFinite(edge) && edge > minEdge && edge <= maxEdge;
    })
    .filter((opportunity) => !opportunity?.quoteTiming || opportunity.quoteTiming.actionable)
    .filter((opportunity) => !(opportunity?.eligibilityReasonCodes || []).includes('verification_failed'))
    .sort((left, right) => verificationPriority(right) - verificationPriority(left));
}

function verificationPriority(opportunity) {
  const key = String(opportunity?.marketKey || '');
  let marketScore = 40;
  if (key === 'h2h') marketScore = 100;
  else if (key === 'bothTeamsToScore') marketScore = 95;
  else if (/total(?:Goals|Points|Games|Sets)_\d+_5$/.test(key)) marketScore = 90;
  else if (/firstHalfH2h|secondHalfH2h/.test(key)) marketScore = 85;
  else if (String(opportunity?.type) === 'cross-market') marketScore = 80;
  else if (String(opportunity?.type) === 'settlement-formula') marketScore = 75;
  else if (/Corners|Cards/.test(key)) marketScore = 55;
  return marketScore + Math.min(8, Math.max(0, Number(opportunity?.edge || 0) * 100));
}

function buildVerificationCandidates(events, opportunities, {
  maxCandidates = DEFAULT_MAX_CANDIDATES,
  maxLegs = DEFAULT_MAX_LEGS,
  now = new Date(),
  reverifyCooldownMs = DEFAULT_REVERIFY_COOLDOWN_MS,
  changedPriceCooldownMs = DEFAULT_CHANGED_PRICE_COOLDOWN_MS,
} = {}) {
  const groups = new Map();
  const selectedLegs = new Set();
  let legCount = 0;

  for (const opportunity of opportunities || []) {
    const additions = [];
    for (const leg of opportunity.legs || []) {
      if (String(leg.verificationStatus || 'unverified') === 'verified') continue;
      const event = findOpportunityEvent(events, opportunity);
      const bookmaker = findBookmaker(event, leg.bookmaker);
      if (!event || !bookmaker) continue;
      const url = bookmaker.eventUrl || bookmaker.bookmakerUrl || '';
      const marketKey = leg.marketKey || opportunity.marketKey || '';
      const outcome = String(leg.outcome || '');
      const endpointPrice = Number(leg.price);
      if (!url || !marketKey || !outcome || !Number.isFinite(endpointPrice)) continue;
      if (!shouldVerifyLeg(bookmaker, { marketKey, outcome, endpointPrice }, {
        now,
        reverifyCooldownMs,
        changedPriceCooldownMs,
      })) continue;
      const legKey = [event.id || opportunity.eventName, bookmaker.name, marketKey, outcome, endpointPrice].join('|');
      if (selectedLegs.has(legKey)) continue;
      const groupKey = [event.id || opportunity.eventName, bookmaker.name, url].join('|');
      additions.push({ event, bookmaker, url, marketKey, outcome, endpointPrice, legKey, groupKey });
    }

    const newGroupCount = new Set(additions.map((item) => item.groupKey).filter((key) => !groups.has(key))).size;
    if (groups.size + newGroupCount > maxCandidates || legCount + additions.length > maxLegs) continue;

    for (const item of additions) {
      selectedLegs.add(item.legKey);
      legCount += 1;
      if (!groups.has(item.groupKey)) {
        groups.set(item.groupKey, {
          provider: item.bookmaker.provider || null,
          event: item.event,
          bookmaker: {
            name: item.bookmaker.name,
            url: item.url,
            urlSource: item.bookmaker.eventUrl ? 'eventUrl' : 'bookmakerUrl',
          },
          prices: [],
        });
      }
      groups.get(item.groupKey).prices.push({
        marketKey: item.marketKey,
        outcome: item.outcome,
        price: item.endpointPrice,
        endpointPrice: item.endpointPrice,
      });
    }
  }

  return { candidates: [...groups.values()], legCount };
}

function shouldVerifyLeg(bookmaker, leg, {
  now = new Date(),
  reverifyCooldownMs = DEFAULT_REVERIFY_COOLDOWN_MS,
  changedPriceCooldownMs = DEFAULT_CHANGED_PRICE_COOLDOWN_MS,
} = {}) {
  const record = [...(bookmaker?.fidelityRecords || [])]
    .filter((item) => item?.marketKey === leg.marketKey && String(item?.outcome) === String(leg.outcome))
    .sort((left, right) => new Date(right.checkedAt || 0) - new Date(left.checkedAt || 0))[0];
  if (!record) return true;
  const samePrice = Math.abs(Number(record.endpointPrice) - Number(leg.endpointPrice)) <= 0.001;
  if (samePrice && record.status === 'verified') return false;
  const ageMs = new Date(now).getTime() - new Date(record.checkedAt || 0).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return false;
  return ageMs >= (samePrice ? reverifyCooldownMs : changedPriceCooldownMs);
}

function findOpportunityEvent(events, opportunity) {
  const byId = opportunity?.eventId
    ? (events || []).find((event) => String(event?.id) === String(opportunity.eventId))
    : null;
  if (byId) return byId;
  const targetName = normalize(`${opportunity?.eventName || ''}`);
  return (events || []).find((event) =>
    normalize(`${event?.homeTeam || ''} vs ${event?.awayTeam || ''}`) === targetName
    && kickoffCompatible(event?.startsAt, opportunity?.kickoff));
}

function findBookmaker(event, name) {
  const target = normalize(name);
  return (event?.bookmakers || []).find((bookmaker) => normalize(bookmaker?.name) === target) || null;
}

function kickoffCompatible(left, right) {
  if (!left || !right) return true;
  const distance = Math.abs(new Date(left).getTime() - new Date(right).getTime());
  return Number.isFinite(distance) && distance <= 15 * 60_000;
}

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function countStatuses(records) {
  const counts = {};
  for (const record of records || []) {
    const status = record?.status || 'unknown';
    counts[status] = (counts[status] || 0) + 1;
  }
  return counts;
}

async function defaultCandidateVerifier(candidates, options) {
  const { runCandidateFidelityVerification } = require('../../scripts/verify-odds-fidelity');
  return runCandidateFidelityVerification(candidates, options);
}

module.exports = {
  CandidateVerificationBroker,
  buildVerificationCandidates,
  countStatuses,
  defaultCandidateVerifier,
  prioritizeVerificationOpportunities,
  shouldVerifyLeg,
  verificationPriority,
};
