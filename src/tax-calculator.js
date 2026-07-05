/**
 * Romanian gambling tax calculator.
 * As of 2024: 3% tax on winnings above 10,000 RON/year.
 * Tax is applied to the winning amount, not the stake.
 */

const TAX_THRESHOLD_RON = 10000;
const TAX_RATE = 0.03;

/**
 * Calculate tax for a single winning bet.
 * @param {number} stake - The stake amount
 * @param {number} odds - Decimal odds
 * @param {number} cumulativeWinnings - Total winnings so far this year
 * @returns {{ taxableAmount: number, tax: number, netProfit: number, remainingThreshold: number }}
 */
function calculateBetTax(stake, odds, cumulativeWinnings = 0) {
  const grossWinnings = stake * odds - stake; // profit, not return
  if (grossWinnings <= 0) {
    return { taxableAmount: 0, tax: 0, netProfit: grossWinnings, remainingThreshold: Math.max(0, TAX_THRESHOLD_RON - cumulativeWinnings) };
  }

  const remainingThreshold = Math.max(0, TAX_THRESHOLD_RON - cumulativeWinnings);
  const taxableAmount = Math.max(0, grossWinnings - remainingThreshold);
  const tax = taxableAmount * TAX_RATE;
  const netProfit = grossWinnings - tax;

  return { taxableAmount, tax, netProfit, remainingThreshold, grossWinnings };
}

/**
 * Calculate annual tax summary.
 * @param {Array} settledBets - Array of settled bet objects with stake, odds, status
 * @returns {{ totalWinnings: number, taxableWinnings: number, taxOwed: number, netProfit: number }}
 */
function calculateAnnualTax(settledBets) {
  let cumulativeWinnings = 0;
  let totalTax = 0;
  let totalGross = 0;

  for (const bet of settledBets) {
    if (bet.status !== 'won') continue;
    const stake = Number(bet.stake) || 0;
    const odds = Number(bet.odds) || 0;
    const result = calculateBetTax(stake, odds, cumulativeWinnings);
    cumulativeWinnings += result.grossWinnings;
    totalTax += result.tax;
    totalGross += result.grossWinnings;
  }

  return {
    totalWinnings: totalGross,
    taxableWinnings: Math.max(0, totalGross - TAX_THRESHOLD_RON),
    taxOwed: totalTax,
    netProfit: totalGross - totalTax,
    threshold: TAX_THRESHOLD_RON,
    rate: TAX_RATE,
    cumulativeWinnings,
    remainingThreshold: Math.max(0, TAX_THRESHOLD_RON - cumulativeWinnings),
  };
}

module.exports = { calculateBetTax, calculateAnnualTax, TAX_THRESHOLD_RON, TAX_RATE };
