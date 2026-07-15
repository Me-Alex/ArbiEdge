/**
 * Bankroll Manager Enhancement: Negative balance guard + tests
 */

'use strict';
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'src', 'bankroll-manager.js');
let src = fs.readFileSync(filePath, 'utf8');

// =====================================================
// 1. Add negative balance guard to withdraw()
// =====================================================
src = src.replace(
  'withdraw(amount, note = \'\') {\n    const data = this.read();\n    data.currentBankroll -= amount;',
  `withdraw(amount, note = '') {
    const data = this.read();
    if (amount > data.currentBankroll) {
      throw new Error('Insufficient funds: cannot withdraw more than current balance');
    }
    data.currentBankroll -= amount;`
);

// =====================================================
// 2. Add negative balance guard to transferToBookmaker()
// =====================================================
src = src.replace(
  'transferToBookmaker(bookmaker, amount) {\n    const data = this.read();\n    data.currentBankroll -= amount;',
  `transferToBookmaker(bookmaker, amount) {
    const data = this.read();
    if (amount > data.currentBankroll) {
      throw new Error('Insufficient funds: cannot transfer more than current balance');
    }
    data.currentBankroll -= amount;`
);

// =====================================================
// Write and verify
// =====================================================
fs.writeFileSync(filePath, src, 'utf8');
console.log('✅ Bankroll manager updated with negative balance guards');

try {
  delete require.cache[require.resolve(filePath)];
  const { BankrollManager } = require(filePath);

  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'bankroll-test-'));
  const tmpPath = path.join(tmpDir, 'bankroll.json');
  const bm = new BankrollManager({ filePath: tmpPath });

  // Test: withdraw exactly the balance — should work
  bm.deposit(1000);
  bm.withdraw(1000);
  const s = bm.summary();
  console.assert(s.currentBankroll === 0, 'Should be 0 after withdrawing all');
  console.log('  ✓ Withdraw exact balance works');

  // Test: withdraw more than balance — should throw
  bm.deposit(500);
  let threw = false;
  try {
    bm.withdraw(600);
  } catch (e) {
    threw = true;
    console.assert(e.message.includes('Insufficient funds'), 'Error message should mention insufficient funds');
  }
  console.assert(threw, 'Should have thrown');
  console.assert(bm.summary().currentBankroll === 500, 'Balance should be unchanged after failed withdrawal');
  console.log('  ✓ Negative balance guard works on withdraw');

  // Test: transferToBookmaker over balance — should throw
  threw = false;
  try {
    bm.transferToBookmaker('TestBook', 600);
  } catch (e) {
    threw = true;
  }
  console.assert(threw, 'Should have thrown on transfer');
  console.log('  ✓ Negative balance guard works on transferToBookmaker');

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('  ✓ All bankroll guard tests passed');
} catch (e) {
  console.error('❌ ERROR:', e.message);
  console.error(e.stack);
  process.exit(1);
}
