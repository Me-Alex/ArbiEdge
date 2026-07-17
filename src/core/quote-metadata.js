'use strict';

const DEFAULT_MAX_QUOTE_AGE_MS = 45_000;
const DEFAULT_MAX_QUOTE_SKEW_MS = 20_000;
const DEFAULT_MAX_KICKOFF_SKEW_MS = 5 * 60_000;

/**
 * Attach a collection timestamp to every normalized bookmaker row.
 * The timestamp describes when this process observed the quote, while a
 * bookmaker-provided update time is retained separately as sourceUpdatedAt.
 */
function stampQuoteMetadata(events, {
  observedAt = new Date(),
  provider = null,
  clone = true,
} = {}) {
  const fallback = validIsoDate(observedAt) || new Date().toISOString();
  return (Array.isArray(events) ? events : []).map((event) => {
    // Preserve events that have no bookmakers array (unit fixtures / partial rows).
    if (!Array.isArray(event?.bookmakers)) {
      return clone === true ? structuredClone(event) : clone === 'shallow' ? { ...event } : event;
    }

    const copy = clone === true
      ? structuredClone(event)
      : clone === 'shallow'
        ? { ...event, bookmakers: [...event.bookmakers] }
        : event;
    copy.bookmakers = copy.bookmakers.map((bookmaker) => {
      const sourceUpdatedAt = firstValidIsoDate([
        bookmaker.sourceUpdatedAt,
        bookmaker.lastUpdate,
        bookmaker.last_update,
        bookmaker.updatedAt,
        bookmaker.updateTime,
      ]);
      const target = clone ? { ...bookmaker } : bookmaker;
      target.observedAt = fallback;
      if (sourceUpdatedAt) target.sourceUpdatedAt = sourceUpdatedAt;
      const sourceStartsAt = firstValidIsoDate([
        bookmaker.sourceStartsAt,
        bookmaker.startsAt,
        event.startsAt,
      ]);
      if (sourceStartsAt) target.sourceStartsAt = sourceStartsAt;
      if (provider && !target.provider) target.provider = provider;
      return target;
    });
    return copy;
  });
}

function evaluateKickoffTiming(legs, {
  expectedKickoff = null,
  maxSkewMs = DEFAULT_MAX_KICKOFF_SKEW_MS,
} = {}) {
  const list = Array.isArray(legs) ? legs : [];
  const kickoffs = list
    .map((leg) => firstValidIsoDate([
      leg?.kickoff,
      leg?.sourceStartsAt,
      leg?.startsAt,
    ]))
    .filter(Boolean);
  const times = kickoffs.map(dateMs).filter(Number.isFinite);
  const missingCount = Math.max(0, list.length - times.length);
  const expectedMs = dateMs(expectedKickoff);

  if (list.length === 0 || times.length === 0) {
    return {
      status: 'missing',
      actionable: false,
      legCount: list.length,
      timestampCount: 0,
      missingCount: list.length,
      skewMs: null,
      maxDistanceFromExpectedMs: null,
      earliestKickoff: null,
      latestKickoff: null,
      expectedKickoff: Number.isFinite(expectedMs) ? new Date(expectedMs).toISOString() : null,
    };
  }

  const earliestMs = Math.min(...times);
  const latestMs = Math.max(...times);
  const skewMs = latestMs - earliestMs;
  const maxDistanceFromExpectedMs = Number.isFinite(expectedMs)
    ? Math.max(...times.map((time) => Math.abs(time - expectedMs)))
    : null;
  let status = 'matched';
  if (missingCount > 0) status = 'missing';
  else if (
    skewMs > maxSkewMs
    || (Number.isFinite(maxDistanceFromExpectedMs) && maxDistanceFromExpectedMs > maxSkewMs)
  ) status = 'mismatched';

  return {
    status,
    actionable: status === 'matched',
    legCount: list.length,
    timestampCount: times.length,
    missingCount,
    skewMs,
    maxDistanceFromExpectedMs,
    earliestKickoff: new Date(earliestMs).toISOString(),
    latestKickoff: new Date(latestMs).toISOString(),
    expectedKickoff: Number.isFinite(expectedMs) ? new Date(expectedMs).toISOString() : null,
  };
}

function bookmakerQuoteObservedAt(bookmaker, marketKey = '') {
  const marketTimestamp = bookmaker?.marketObservedAt?.[marketKey]
    || bookmaker?.marketTimestamps?.[marketKey];
  return firstValidIsoDate([
    marketTimestamp,
    bookmaker?.observedAt,
    bookmaker?.quoteObservedAt,
  ]);
}

function evaluateQuoteTiming(legs, {
  now = new Date(),
  maxAgeMs = DEFAULT_MAX_QUOTE_AGE_MS,
  maxSkewMs = DEFAULT_MAX_QUOTE_SKEW_MS,
} = {}) {
  const list = Array.isArray(legs) ? legs : [];
  const referenceMs = dateMs(now);
  const timestamps = list
    .map((leg) => firstValidIsoDate([
      leg?.observedAt,
      leg?.quoteObservedAt,
    ]))
    .filter(Boolean);
  const times = timestamps.map(dateMs).filter(Number.isFinite);
  const missingCount = Math.max(0, list.length - times.length);

  if (list.length === 0 || times.length === 0) {
    return {
      status: 'missing',
      actionable: false,
      legCount: list.length,
      timestampCount: 0,
      missingCount: list.length,
      maxAgeMs: null,
      skewMs: null,
      oldestObservedAt: null,
      newestObservedAt: null,
    };
  }

  const oldestMs = Math.min(...times);
  const newestMs = Math.max(...times);
  const ageMs = Number.isFinite(referenceMs)
    ? Math.max(0, referenceMs - oldestMs)
    : null;
  const skewMs = newestMs - oldestMs;
  let status = 'fresh';
  if (missingCount > 0) status = 'missing';
  else if (Number.isFinite(ageMs) && ageMs > maxAgeMs) status = 'stale';
  else if (skewMs > maxSkewMs) status = 'skewed';

  return {
    status,
    actionable: status === 'fresh',
    legCount: list.length,
    timestampCount: times.length,
    missingCount,
    maxAgeMs: ageMs,
    skewMs,
    oldestObservedAt: new Date(oldestMs).toISOString(),
    newestObservedAt: new Date(newestMs).toISOString(),
  };
}

function firstValidIsoDate(values) {
  for (const value of values || []) {
    const normalized = validIsoDate(value);
    if (normalized) return normalized;
  }
  return null;
}

function validIsoDate(value) {
  const milliseconds = dateMs(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

function dateMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (!value) return NaN;
  return new Date(value).getTime();
}

module.exports = {
  DEFAULT_MAX_KICKOFF_SKEW_MS,
  DEFAULT_MAX_QUOTE_AGE_MS,
  DEFAULT_MAX_QUOTE_SKEW_MS,
  bookmakerQuoteObservedAt,
  evaluateKickoffTiming,
  evaluateQuoteTiming,
  firstValidIsoDate,
  stampQuoteMetadata,
  validIsoDate,
};
