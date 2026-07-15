const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

let modulePromise;

function loadScannerFilters() {
  if (!modulePromise) {
    modulePromise = import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'scanner-filters.js')).href);
  }
  return modulePromise;
}

function makeState(overrides = {}) {
  return {
    search: '',
    minEdge: 0,
    scannerVerificationFilter: '',
    scannerTab: 'actionable',
    selectedMarketTypes: undefined,
    opportunities: [],
    pinnedArbs: new Set(),
    ...overrides,
  };
}

test('scanner tab helpers partition actionable, review, rejected, and middle queues', async () => {
  const { getScannerTabOpportunities } = await loadScannerFilters();
  const scannerState = makeState({
    opportunities: [
      { eventName: 'Classic Game', marketKey: 'h2h', type: 'classic', eligibility: 'actionable', edge: 0.03 },
      { eventName: 'Middle Game', marketKey: 'middle_totalGoals', type: 'middle', eligibility: 'analysis', edge: 0.04 },
      { eventName: 'Cross Game', marketKey: 'cross_btts_team_score', type: 'cross-market', eligibility: 'review', edge: 0.02 },
      { eventName: 'Bad Game', marketKey: 'h2h', type: 'classic', eligibility: 'rejected', edge: 0.05 },
    ],
  });

  assert.deepEqual(
    getScannerTabOpportunities(scannerState, 'actionable').map((opp) => opp.eventName),
    ['Classic Game'],
  );
  assert.deepEqual(
    getScannerTabOpportunities(scannerState, 'review').map((opp) => opp.eventName),
    ['Cross Game'],
  );
  assert.deepEqual(
    getScannerTabOpportunities(scannerState, 'rejected').map((opp) => opp.eventName),
    ['Bad Game'],
  );
  assert.deepEqual(
    getScannerTabOpportunities(scannerState, 'middles').map((opp) => opp.eventName),
    ['Middle Game'],
  );
});

test('scanner base filters preserve min edge, search, verification, and pinned sorting', async () => {
  const { getFilteredScannerOpportunities } = await loadScannerFilters();
  const scannerState = makeState({
    search: 'derby',
    minEdge: 2,
    scannerVerificationFilter: 'review',
    pinnedArbs: new Set(['Lower Edge Derby|h2h']),
    opportunities: [
      { eventName: 'Higher Edge Derby', marketKey: 'h2h', marketLabel: '1X2', edge: 0.05, eligibility: 'review' },
      { eventName: 'Lower Edge Derby', marketKey: 'h2h', marketLabel: '1X2', edge: 0.03, eligibility: 'review' },
      { eventName: 'Tiny Derby', marketKey: 'h2h', marketLabel: '1X2', edge: 0.01, eligibility: 'review' },
      { eventName: 'Other Fixture', marketKey: 'h2h', marketLabel: '1X2', edge: 0.06, eligibility: 'review' },
      { eventName: 'Risky Derby', marketKey: 'h2h', marketLabel: '1X2', edge: 0.06, eligibility: 'rejected' },
    ],
  });

  assert.deepEqual(
    getFilteredScannerOpportunities(scannerState).map((opp) => opp.eventName),
    ['Lower Edge Derby', 'Higher Edge Derby'],
  );
});

test('scanner market counts are calculated after base filters and active tab', async () => {
  const { getScannerMarketTypeCounts } = await loadScannerFilters();
  const scannerState = makeState({
    search: 'arsenal',
    opportunities: [
      { eventName: 'Arsenal vs A', marketKey: 'h2h', marketLabel: '1X2', eligibility: 'actionable', edge: 0.03 },
      { eventName: 'Arsenal vs B', marketKey: 'totalGoals_2_5', marketLabel: 'Total Goals', eligibility: 'actionable', edge: 0.04 },
      { eventName: 'Arsenal vs C', marketKey: 'totalGoals_3_5', type: 'middle', legs: [{ marketKey: 'totalGoals_2_5' }], edge: 0.02 },
      { eventName: 'Chelsea vs D', marketKey: 'totalCorners_8_5', marketLabel: 'Corners', eligibility: 'actionable', edge: 0.05 },
    ],
  });

  assert.equal(getScannerMarketTypeCounts(scannerState, 'actionable').result, 1);
  assert.equal(getScannerMarketTypeCounts(scannerState, 'actionable').goalsTotals, 1);
  assert.equal(getScannerMarketTypeCounts(scannerState, 'actionable').cornersTotals, 0);
  assert.equal(getScannerMarketTypeCounts(scannerState, 'middles').goalsTotals, 1);
});

test('scanner market type selection controls visible opportunities and CSV rows', async () => {
  const {
    buildScannerCsvRows,
    getScannerTabOpportunities,
    setSelectedMarketTypes,
  } = await loadScannerFilters();
  const scannerState = makeState({
    opportunities: [
      { eventName: 'Result Game', marketKey: 'h2h', marketLabel: '1X2', eligibility: 'actionable', edge: 0.03, profit: 3, legs: [{ label: '1', bookmaker: 'BookA', verificationStatus: 'verified' }] },
      { eventName: 'Goals Game', marketKey: 'totalGoals_2_5', marketLabel: 'Goals', eligibility: 'actionable', edge: 0.04, profit: 4, legs: [{ label: 'Over', bookmaker: 'BookB', verificationStatus: 'verified' }], eligibilityReasons: [] },
    ],
  });

  setSelectedMarketTypes(scannerState, ['goalsTotals']);
  const visible = getScannerTabOpportunities(scannerState);

  assert.deepEqual(visible.map((opp) => opp.eventName), ['Goals Game']);
  assert.deepEqual(buildScannerCsvRows(visible), [
    ['Event', 'Market', 'Queue', 'Edge', 'Model Profit', 'Evidence', 'Reasons', 'Legs'],
    ['Goals Game', 'Goals', 'actionable', '4.0%', '4.00', 'verified', '', 'Over@BookB:verified'],
  ]);
});

test('scanner selection helpers normalize bad values and support reset', async () => {
  const {
    areAllMarketTypesSelected,
    getSelectedMarketTypes,
    isMarketTypeSelected,
    resetSelectedMarketTypes,
    setSelectedMarketTypes,
    toggleMarketTypeSelection,
  } = await loadScannerFilters();
  const scannerState = makeState({ selectedMarketTypes: ['goalsTotals', 'notReal'] });

  assert.deepEqual([...getSelectedMarketTypes(scannerState)], ['goalsTotals']);
  assert.equal(areAllMarketTypesSelected(scannerState), false);

  toggleMarketTypeSelection(scannerState, 'cornersTotals', true);
  assert.equal(isMarketTypeSelected(scannerState, 'cornersTotals'), true);

  setSelectedMarketTypes(scannerState, []);
  assert.equal(getSelectedMarketTypes(scannerState).size, 0);

  resetSelectedMarketTypes(scannerState);
  assert.equal(areAllMarketTypesSelected(scannerState), true);
});
