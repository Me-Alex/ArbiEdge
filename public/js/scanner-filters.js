import {
  MARKET_TYPE_KEYS,
  classifyOpportunityMarketType,
} from './market-types.js?v=12';

export function normalizeScannerText(value) {
  return String(value || '').toLowerCase().trim();
}

export function activeOpportunitySearchMatch(search, ...parts) {
  const term = normalizeScannerText(search);
  return !term || normalizeScannerText(parts.join(' ')).includes(term);
}

export function isMiddleOpportunity(opp) {
  return opp?.type === 'middle';
}

export function getOpportunityEligibility(opp) {
  if (isMiddleOpportunity(opp)) return 'analysis';
  if (['actionable', 'review', 'rejected'].includes(opp?.eligibility)) return opp.eligibility;
  return 'review';
}

export function getOpportunityVerificationStatuses(opp) {
  const statuses = Array.isArray(opp?.verificationStatuses) && opp.verificationStatuses.length > 0
    ? opp.verificationStatuses
    : (opp?.legs || []).map((leg) => leg?.verificationStatus || 'unverified');
  return [...new Set(statuses.map((status) => String(status || 'unverified').toLowerCase()))];
}

export function normalizeSelectedMarketTypes(value) {
  const selected = value instanceof Set
    ? value
    : new Set(Array.isArray(value) ? value : MARKET_TYPE_KEYS);
  const valid = new Set(MARKET_TYPE_KEYS);
  return new Set([...selected].filter((key) => valid.has(key)));
}

export function getSelectedMarketTypes(scannerState) {
  scannerState.selectedMarketTypes = normalizeSelectedMarketTypes(scannerState.selectedMarketTypes);
  return scannerState.selectedMarketTypes;
}

export function setSelectedMarketTypes(scannerState, keys) {
  scannerState.selectedMarketTypes = normalizeSelectedMarketTypes(keys || []);
}

export function resetSelectedMarketTypes(scannerState) {
  scannerState.selectedMarketTypes = new Set(MARKET_TYPE_KEYS);
}

export function toggleMarketTypeSelection(scannerState, key, selected) {
  const current = getSelectedMarketTypes(scannerState);
  if (!MARKET_TYPE_KEYS.includes(key)) return;
  if (selected) current.add(key);
  else current.delete(key);
}

export function areAllMarketTypesSelected(scannerState) {
  return getSelectedMarketTypes(scannerState).size === MARKET_TYPE_KEYS.length;
}

export function isMarketTypeSelected(scannerState, key) {
  return getSelectedMarketTypes(scannerState).has(key);
}

export function opportunityId(opp) {
  return `${opp?.eventName || ''}|${opp?.marketKey || ''}`;
}

export function getFilteredScannerOpportunities(scannerState) {
  let opps = (scannerState.opportunities || []).filter((opp) =>
    Number(opp.edge || 0) * 100 >= Number(scannerState.minEdge || 0)
    && activeOpportunitySearchMatch(
      scannerState.search,
      opp.eventName,
      opp.marketLabel,
      opp.marketKey,
      opp.competition,
    ));

  if (scannerState.scannerVerificationFilter === 'verified') {
    opps = opps.filter((opp) => {
      const statuses = getOpportunityVerificationStatuses(opp);
      return statuses.length > 0 && statuses.every((status) => status === 'verified');
    });
  } else if (scannerState.scannerVerificationFilter === 'review') {
    opps = opps.filter((opp) => getOpportunityEligibility(opp) === 'review');
  } else if (scannerState.scannerVerificationFilter === 'failed') {
    opps = opps.filter((opp) => getOpportunityEligibility(opp) === 'rejected');
  }

  const pinned = scannerState.pinnedArbs instanceof Set ? scannerState.pinnedArbs : new Set();
  return [...opps].sort((left, right) => {
    const leftPinned = pinned.has(opportunityId(left)) ? 1 : 0;
    const rightPinned = pinned.has(opportunityId(right)) ? 1 : 0;
    if (leftPinned !== rightPinned) return rightPinned - leftPinned;
    return Number(right.edge || 0) - Number(left.edge || 0);
  });
}

export function getScannerTabBaseOpportunities(scannerState, tab = scannerState.scannerTab) {
  const opps = getFilteredScannerOpportunities(scannerState);
  if (tab === 'middles') return opps.filter(isMiddleOpportunity);
  return opps.filter((opp) => !isMiddleOpportunity(opp) && getOpportunityEligibility(opp) === tab);
}

export function getScannerTabOpportunities(scannerState, tab = scannerState.scannerTab, { includeMarketTypeFilter = true } = {}) {
  const opps = getScannerTabBaseOpportunities(scannerState, tab);
  if (!includeMarketTypeFilter || areAllMarketTypesSelected(scannerState)) return opps;
  const selected = getSelectedMarketTypes(scannerState);
  if (selected.size === 0) return [];
  return opps.filter((opp) => selected.has(classifyOpportunityMarketType(opp)));
}

export function getScannerTabCounts(scannerState) {
  return {
    actionable: getScannerTabOpportunities(scannerState, 'actionable').length,
    review: getScannerTabOpportunities(scannerState, 'review').length,
    rejected: getScannerTabOpportunities(scannerState, 'rejected').length,
    middles: getScannerTabOpportunities(scannerState, 'middles').length,
  };
}

export function getScannerMarketTypeCounts(scannerState, tab = scannerState.scannerTab) {
  const counts = Object.fromEntries(MARKET_TYPE_KEYS.map((key) => [key, 0]));
  getScannerTabBaseOpportunities(scannerState, tab).forEach((opp) => {
    const key = classifyOpportunityMarketType(opp);
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

export function getScannerTabName(tab = 'actionable') {
  if (tab === 'middles') return 'middle';
  if (tab === 'review') return 'review-queue';
  if (tab === 'rejected') return 'rejected';
  return 'actionable';
}

export function buildScannerCsvRows(opportunities) {
  const rows = [['Event', 'Market', 'Queue', 'Edge', 'Model Profit', 'Evidence', 'Reasons', 'Legs']];
  for (const opp of opportunities || []) {
    rows.push([
      opp.eventName || '',
      opp.marketLabel || opp.marketKey || '',
      getOpportunityEligibility(opp),
      `${(Number(opp.edge || 0) * 100).toFixed(1)}%`,
      Number(opp.profit || 0).toFixed(2),
      getOpportunityVerificationStatuses(opp).join(' | '),
      (opp.eligibilityReasons || []).join(' | '),
      (opp.legs || []).map((leg) => `${leg.label}@${leg.bookmaker}:${leg.verificationStatus || 'unverified'}`).join(' | '),
    ]);
  }
  return rows;
}
