/**
 * Romanian Fiscal Gambling Tax Calculator Domain Component.
 */

const TAX_THRESHOLD_RON = 10000;
const TAX_RATE = 0.03;

function calculateBetTax(stake, odds, cumulativeWinnings = 0) {
  const grossWinnings = stake * odds - stake;
  if (grossWinnings <= 0) {
    return { taxableAmount: 0, tax: 0, netProfit: grossWinnings, remainingThreshold: Math.max(0, TAX_THRESHOLD_RON - cumulativeWinnings) };
  }

  const remainingThreshold = Math.max(0, TAX_THRESHOLD_RON - cumulativeWinnings);
  const taxableAmount = Math.max(0, grossWinnings - remainingThreshold);
  const tax = taxableAmount * TAX_RATE;
  const netProfit = grossWinnings - tax;

  return { taxableAmount, tax, netProfit, remainingThreshold, grossWinnings };
}

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

function generateAnafReport(settledBets, targetYear = new Date().getFullYear()) {
  const yearBets = (settledBets || []).filter((b) => {
    const d = new Date(b.settledAt || b.loggedAt || 0);
    return d.getFullYear() === Number(targetYear);
  });

  const taxSummary = calculateAnnualTax(yearBets);
  return {
    year: Number(targetYear),
    country: 'Romania',
    currency: 'RON',
    declarationType: 'Declaratia 212 - Venituri din jocuri de noroc online',
    totalSettledBets: yearBets.length,
    grossWinnings: Math.round(taxSummary.totalWinnings * 100) / 100,
    taxableAmount: Math.round(taxSummary.taxableWinnings * 100) / 100,
    taxOwed: Math.round(taxSummary.taxOwed * 100) / 100,
    netProfit: Math.round(taxSummary.netProfit * 100) / 100,
    exemptThreshold: TAX_THRESHOLD_RON,
    applicableRatePct: TAX_RATE * 100,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  calculateBetTax,
  calculateAnnualTax,
  generateAnafReport,
  TAX_THRESHOLD_RON,
  TAX_RATE,
};
