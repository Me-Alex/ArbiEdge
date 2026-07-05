const { inferResultFromOdds, classifyMarket } = require('../src/ai-pick-settler');

const marketFamily = 'totalLine';
const closingPrices = { over: 1.02, under: 30 };

const result = inferResultFromOdds(marketFamily, closingPrices, null);
console.log('inference result:', JSON.stringify(result, null, 2));

// Also check what marketOutcomeSet returns
const { marketOutcomeSet } = require('../src/ai-pick-settler') || {};
// marketOutcomeSet is not exported, let me check internal
