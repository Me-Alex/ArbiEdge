'use strict';

const formulaEngine = require('./formula-engine');
const quarterHandicap = require('./arbitrage/quarter-handicap-scanner');
const settlementFormulas = require('./arbitrage/settlement-formula-scanner');
const staking = require('./staking/stake-sizer');

module.exports = {
  ...formulaEngine,
  ...quarterHandicap,
  ...settlementFormulas,
  ...staking,
};
