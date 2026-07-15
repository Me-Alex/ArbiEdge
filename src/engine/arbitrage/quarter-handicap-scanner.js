'use strict';

const {
  detectSettlementFormulaArbitrage,
} = require('./settlement-formula-scanner');

/**
 * Backward-compatible entry point. The old two-price quarter-line calculation
 * ignored half-win/push states; quarter handicaps now use the score-state solver.
 */
function detectQuarterHandicapArbitrage(event, helpers = {}) {
  return detectSettlementFormulaArbitrage(event, helpers).filter((opportunity) => (
    opportunity.legs.some((leg) => {
      const line = Math.abs(Number(leg?.formulaSelection?.line));
      return Number.isFinite(line) && Math.abs((line * 4) % 2) === 1;
    })
  ));
}

module.exports = { detectQuarterHandicapArbitrage };
