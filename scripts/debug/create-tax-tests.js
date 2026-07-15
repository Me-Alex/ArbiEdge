/**
 * Tax Calculator Tests
 *
 * Comprehensive tests for Romanian gambling tax calculation.
 */

'use strict';
const fs = require('fs');
const path = require('path');

const testContent = `'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateBetTax, calculateAnnualTax, TAX_THRESHOLD_RON, TAX_RATE } = require('../src/tax-calculator');

test('no tax when cumulative winnings below threshold', () => {
  const result = calculateBetTax(100, 5.0, 0);
  // Profit = 100 * 5.0 - 100 = 400
  assert.equal(result.grossWinnings, 400);
  assert.equal(result.taxableAmount, 0);
  assert.equal(result.tax, 0);
  assert.equal(result.netProfit, 400);
  assert.equal(result.remainingThreshold, TAX_THRESHOLD_RON);
});

test('no tax on losing bet', () => {
  const result = calculateBetTax(100, 2.0, 0);
  // Profit = 100 * 2.0 - 100 = 100 (above 0 but below threshold)
  assert.equal(result.grossWinnings, 100);
  assert.equal(result.tax, 0);
  assert.equal(result.netProfit, 100);
});

test('no tax on zero-profit bet', () => {
  const result = calculateBetTax(100, 1.0, 0);
  // Profit = 100 * 1.0 - 100 = 0
  assert.equal(result.grossWinnings, 0);
  assert.equal(result.taxableAmount, 0);
  assert.equal(result.tax, 0);
  assert.equal(result.netProfit, 0);
});

test('3% tax applied only to winnings above 10,000 RON threshold', () => {
  const result = calculateBetTax(5000, 4.0, 8000);
  // Profit = 5000 * 4.0 - 5000 = 15000
  // Remaining threshold = 10000 - 8000 = 2000
  // Taxable = 15000 - 2000 = 13000
  // Tax = 13000 * 0.03 = 390
  // Net = 15000 - 390 = 14610
  assert.equal(result.grossWinnings, 15000);
  assert.equal(result.remainingThreshold, 2000);
  assert.equal(result.taxableAmount, 13000);
  assert.equal(result.tax, 390);
  assert.equal(result.netProfit, 14610);
});

test('3% tax when cumulative winnings already exceed threshold', () => {
  const result = calculateBetTax(1000, 3.0, 12000);
  // Profit = 1000 * 3.0 - 1000 = 2000
  // Remaining threshold = max(0, 10000 - 12000) = 0
  // Taxable = 2000 - 0 = 2000
  // Tax = 2000 * 0.03 = 60
  assert.equal(result.grossWinnings, 2000);
  assert.equal(result.taxableAmount, 2000);
  assert.equal(result.tax, 60);
  assert.equal(result.remainingThreshold, 0);
});

test('cumulative winnings accumulate correctly across multiple bets', () => {
  // Bet 1: profit 6000
  const r1 = calculateBetTax(2000, 4.0, 0);
  assert.equal(r1.grossWinnings, 6000);
  assert.equal(r1.tax, 0);

  // Bet 2: profit 6000, cumulative = 6000
  const r2 = calculateBetTax(2000, 4.0, 6000);
  assert.equal(r2.grossWinnings, 6000);
  assert.equal(r2.tax, 0);

  // Bet 3: profit 6000, cumulative = 12000, taxable portion = 6000 - 0 = 6000
  const r3 = calculateBetTax(2000, 4.0, 12000);
  assert.equal(r3.grossWinnings, 6000);
  assert.equal(r3.tax, 180);

  // Bet 4: profit 500, cumulative = 18000
  const r4 = calculateBetTax(500, 2.0, 18000);
  assert.equal(r4.grossWinnings, 500);
  assert.equal(r4.tax, 15);
});

test('calculateAnnualTax with multiple bets', () => {
  const bets = [
    { status: 'won', stake: 5000, odds: 3.0 },   // profit 10000
    { status: 'won', stake: 3000, odds: 2.0 },   // profit 3000
    { status: 'lost', stake: 2000, odds: 5.0 },   // lost
    { status: 'won', stake: 1000, odds: 4.0 },    // profit 3000
    { status: 'pending', stake: 500, odds: 2.5 },  // pending, skipped
  ];

  const result = calculateAnnualTax(bets);
  // Total won profit = 10000 + 3000 + 3000 = 16000
  // Taxable = 16000 - 10000 = 6000
  // Tax = 6000 * 0.03 = 180
  assert.equal(result.totalWinnings, 16000);
  assert.equal(result.taxOwed, 180);
  assert.equal(result.netProfit, 15820);
  assert.equal(result.cumulativeWinnings, 16000);
  assert.equal(result.remainingThreshold, 0);
});

test('calculateAnnualTax with all losing bets', () => {
  const bets = [
    { status: 'lost', stake: 100, odds: 5.0 },
    { status: 'lost', stake: 200, odds: 3.0 },
  ];

  const result = calculateAnnualTax(bets);
  assert.equal(result.totalWinnings, 0);
  assert.equal(result.taxOwed, 0);
  assert.equal(result.netProfit, 0);
});

test('calculateAnnualTax with empty bet array', () => {
  const result = calculateAnnualTax([]);
  assert.equal(result.totalWinnings, 0);
  assert.equal(result.taxOwed, 0);
});

test('zero stake produces zero result', () => {
  const result = calculateBetTax(0, 5.0, 0);
  assert.equal(result.grossWinnings, 0);
  assert.equal(result.tax, 0);
});

test('TAX_THRESHOLD_RON and TAX_RATE constants are correct for Romania 2024', () => {
  assert.equal(TAX_THRESHOLD_RON, 10000);
  assert.equal(TAX_RATE, 0.03);
});
`;

const testPath = path.join(__dirname, '..', 'test', 'tax-calculator.test.js');
fs.writeFileSync(testPath, testContent, 'utf8');
console.log('✅ Tax calculator test file written');
