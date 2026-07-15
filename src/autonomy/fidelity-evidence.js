'use strict';

function applyFidelityEvidence(events, records, {
  maxAgeMs = 6 * 60 * 60_000,
  priceTolerance = 0.001,
  now = new Date(),
} = {}) {
  const currentMs = new Date(now).getTime();
  const eligible = (records || []).filter((record) => {
    const checkedMs = new Date(record.checkedAt || 0).getTime();
    return Number.isFinite(checkedMs) && currentMs - checkedMs <= maxAgeMs;
  });

  let applied = 0;
  for (const event of events || []) {
    for (const bookmaker of event?.bookmakers || []) {
      const matches = eligible.filter((record) => fidelityRecordMatches(record, event, bookmaker));
      if (matches.length === 0) continue;
      bookmaker.fidelityRecords = matches.map((record) => {
        const currentPrice = bookmaker.markets?.[record.marketKey]?.[record.outcome];
        const endpointPrice = Number(record.endpointPrice);
        const priceCurrent = Number.isFinite(Number(currentPrice))
          && Number.isFinite(endpointPrice)
          && Math.abs(Number(currentPrice) - endpointPrice) <= priceTolerance;
        applied += 1;
        return {
          ...record,
          currentPrice: Number.isFinite(Number(currentPrice)) ? Number(currentPrice) : null,
          status: priceCurrent ? record.status : 'stale',
        };
      });
    }
  }
  return applied;
}

function fidelityRecordMatches(record, event, bookmaker) {
  if (normalize(record?.bookmaker) !== normalize(bookmaker?.name)) return false;
  if (record?.eventId && event?.id && String(record.eventId) === String(event.id)) return true;
  return normalize(record?.homeTeam) === normalize(event?.homeTeam)
    && normalize(record?.awayTeam) === normalize(event?.awayTeam)
    && kickoffCompatible(record?.startsAt, event?.startsAt);
}

function kickoffCompatible(left, right) {
  if (!left || !right) return true;
  const leftMs = new Date(left).getTime();
  const rightMs = new Date(right).getTime();
  return Number.isFinite(leftMs) && Number.isFinite(rightMs)
    && Math.abs(leftMs - rightMs) <= 15 * 60_000;
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

module.exports = {
  applyFidelityEvidence,
  fidelityRecordMatches,
};
