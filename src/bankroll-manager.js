/**
 * Bankroll management module.
 * Tracks deposits, withdrawals, and per-bookmaker balances.
 * Stores data in data/bankroll.json.
 */

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_BANKROLL_PATH = path.join(__dirname, '..', 'data', 'bankroll.json');

class BankrollManager {
  constructor({ filePath = DEFAULT_BANKROLL_PATH } = {}) {
    this.filePath = filePath;
  }

  read() {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch {
      return { startingBankroll: 1000, currentBankroll: 1000, transactions: [], bookmakerBalances: {} };
    }
  }

  write(data) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = this.filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
  }

  deposit(amount, note = '') {
    const data = this.read();
    data.currentBankroll += amount;
    data.transactions.push({ type: 'deposit', amount, note, at: new Date().toISOString() });
    this.write(data);
    return data;
  }

  withdraw(amount, note = '') {
    const data = this.read();
    if (amount > data.currentBankroll) {
      throw new Error('Insufficient funds: cannot withdraw more than current balance');
    }
    data.currentBankroll -= amount;
    data.transactions.push({ type: 'withdraw', amount, note, at: new Date().toISOString() });
    this.write(data);
    return data;
  }

  transferToBookmaker(bookmaker, amount) {
    const data = this.read();
    if (amount > data.currentBankroll) {
      throw new Error('Insufficient funds: cannot transfer more than current balance');
    }
    data.currentBankroll -= amount;
    if (!data.bookmakerBalances[bookmaker]) data.bookmakerBalances[bookmaker] = 0;
    data.bookmakerBalances[bookmaker] += amount;
    data.transactions.push({ type: 'transfer', bookmaker, amount, at: new Date().toISOString() });
    this.write(data);
    return data;
  }

  transferFromBookmaker(bookmaker, amount) {
    const data = this.read();
    if (!data.bookmakerBalances[bookmaker]) data.bookmakerBalances[bookmaker] = 0;
    const actual = Math.min(amount, data.bookmakerBalances[bookmaker]);
    data.bookmakerBalances[bookmaker] -= actual;
    data.currentBankroll += actual;
    data.transactions.push({ type: 'withdraw_from_bookmaker', bookmaker, amount: actual, at: new Date().toISOString() });
    this.write(data);
    return data;
  }

  setBookmakerBalance(bookmaker, balance) {
    const data = this.read();
    data.bookmakerBalances[bookmaker] = balance;
    this.write(data);
    return data;
  }

  summary() {
    const data = this.read();
    const totalInBooks = Object.values(data.bookmakerBalances || {}).reduce((s, v) => s + v, 0);
    return {
      startingBankroll: data.startingBankroll,
      currentBankroll: data.currentBankroll,
      totalInBooks,
      totalAssets: data.currentBankroll + totalInBooks,
      netProfit: (data.currentBankroll + totalInBooks) - data.startingBankroll,
      bookmakerBalances: data.bookmakerBalances,
      transactionCount: (data.transactions || []).length,
    };
  }
}

module.exports = { BankrollManager, DEFAULT_BANKROLL_PATH };
