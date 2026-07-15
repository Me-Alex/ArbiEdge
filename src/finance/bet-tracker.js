/**
 * Bet Tracker & Analytics Engine Domain Component.
 */

const fs = require('node:fs');
const path = require('node:path');
const { calculateBetTax, TAX_RATE, TAX_THRESHOLD_RON } = require('./tax-calculator');

const DEFAULT_BET_LOG_PATH = path.join(__dirname, '..', '..', 'data', 'bets.jsonl');
const VALID_STATUSES = ['pending', 'won', 'lost', 'void', 'cashout'];

class BetTracker {
  constructor({ logPath = DEFAULT_BET_LOG_PATH } = {}) {
    this.logPath = logPath;
  }

  log(bet) {
    fs.mkdirSync(path.dirname(this.logPath), { recursive: true });
    const record = {
      ...bet,
      id: bet.id || generateBetId(),
      loggedAt: bet.loggedAt || new Date().toISOString(),
    };
    fs.appendFileSync(this.logPath, `${JSON.stringify(record)}\n`, 'utf8');
    return record;
  }

  readAll() {
    if (!fs.existsSync(this.logPath)) return [];
    const lines = fs.readFileSync(this.logPath, 'utf8').split('\n').filter(Boolean);
    const bets = [];
    for (const line of lines) {
      try {
        bets.push(JSON.parse(line));
      } catch {
        // skip malformed lines
      }
    }
    return bets;
  }

  rewrite(bets) {
    fs.mkdirSync(path.dirname(this.logPath), { recursive: true });
    const content = bets.map((b) => JSON.stringify(b)).join('\n');
    const tmpPath = this.logPath + '.tmp';
    fs.writeFileSync(tmpPath, content + (content ? '\n' : ''), 'utf8');
    fs.renameSync(tmpPath, this.logPath);
  }

  create(input) {
    const status = normalizeStatus(input.status) || 'pending';
    const loggedAt = normalizeIsoDate(input.loggedAt || input.timestamp) || new Date().toISOString();
    const settledAt = normalizeIsoDate(input.settledAt) || (status === 'pending' ? null : loggedAt);
    const record = {
      loggedAt,
      event: input.event || '',
      sport: input.sport || 'Football',
      competition: input.competition || '',
      market: input.market || '',
      selection: input.selection || '',
      bookmaker: input.bookmaker || '',
      odds: Number(input.odds) || 0,
      stake: Number(input.stake) || 0,
      eventStartsAt: input.eventStartsAt || null,
      eventUrl: input.eventUrl || '',
      type: input.type || 'manual',
      notes: input.notes || '',
      closingOdds: optionalNumber(input.closingOdds),
      status,
      settledAt,
      result: input.result || (status === 'pending' ? null : status),
    };
    if (input.id) record.id = String(input.id);
    return this.log(record);
  }

  settle(id, result, options = {}) {
    if (!VALID_STATUSES.includes(result)) {
      throw new Error(`Invalid result: ${result}`);
    }
    const bets = this.readAll();
    const bet = bets.find((b) => b.id === id);
    if (!bet) throw new Error(`Bet not found: ${id}`);

    bet.status = result;
    bet.settledAt = new Date().toISOString();
    bet.result = result;
    const closingOdds = optionalNumber(options.closingOdds);
    if (closingOdds !== null) bet.closingOdds = closingOdds;
    if (options.notes) bet.notes = options.notes;

    const annotated = annotateTaxFields(bets);
    this.rewrite(annotated);
    return annotated.find((item) => item.id === id);
  }

  update(id, updates) {
    const bets = this.readAll();
    const bet = bets.find((b) => b.id === id);
    if (!bet) throw new Error(`Bet not found: ${id}`);

    const allowed = ['stake', 'odds', 'closingOdds', 'notes', 'status', 'eventUrl'];
    for (const key of allowed) {
      if (updates[key] !== undefined) {
        bet[key] = key === 'status' ? normalizeStatus(updates[key]) || bet[key] : updates[key];
      }
    }

    const annotated = annotateTaxFields(bets);
    this.rewrite(annotated);
    return annotated.find((item) => item.id === id);
  }

  remove(id) {
    const bets = this.readAll();
    const filtered = bets.filter((b) => b.id !== id);
    if (filtered.length === bets.length) return false;
    this.rewrite(annotateTaxFields(filtered));
    return true;
  }

  query({ status, sport, bookmaker, market, type, limit } = {}) {
    let bets = annotateTaxFields(this.readAll());
    if (status) bets = bets.filter((b) => b.status === status);
    if (sport) bets = bets.filter((b) => b.sport === sport);
    if (bookmaker) bets = bets.filter((b) => b.bookmaker === bookmaker);
    if (market) bets = bets.filter((b) => b.market === market);
    if (type) bets = bets.filter((b) => b.type === type);
    bets.sort((a, b) => new Date(b.loggedAt) - new Date(a.loggedAt));
    if (limit) bets = bets.slice(0, limit);
    return bets;
  }

  analytics({ sport } = {}) {
    let bets = annotateTaxFields(this.readAll());
    if (sport) bets = bets.filter((b) => b.sport === sport);

    const settled = bets.filter((b) => b.status === 'won' || b.status === 'lost');
    const pending = bets.filter((b) => b.status === 'pending');
    const voided = bets.filter((b) => b.status === 'void');

    let totalStake = 0;
    let totalReturn = 0;
    let wonCount = 0;
    let lostCount = 0;
    let oddsSum = 0;
    let clvSum = 0;
    let clvCount = 0;
    let taxableWinnings = 0;
    let totalTax = 0;
    let netProfitAfterTax = 0;

    const byBookmaker = {};
    const byMarket = {};
    const byCompetition = {};

    for (const bet of settled) {
      const stake = Number(bet.stake) || 0;
      const odds = Number(bet.odds) || 0;
      const won = bet.status === 'won';
      const ret = won ? stake * odds : 0;
      const profit = ret - stake;
      const taxOwed = Number(bet.taxOwed) || 0;
      const afterTaxProfit = optionalNumber(bet.netProfitAfterTax) ?? (profit - taxOwed);

      totalStake += stake;
      totalReturn += ret;
      taxableWinnings += Number(bet.taxableWinnings) || 0;
      totalTax += taxOwed;
      netProfitAfterTax += afterTaxProfit;
      oddsSum += odds;
      if (won) wonCount++;
      else lostCount++;

      if (bet.closingOdds && odds > 0) {
        const clv = (odds - bet.closingOdds) / bet.closingOdds;
        clvSum += clv;
        clvCount++;
      }

      aggregateBy(byBookmaker, bet.bookmaker, { stake, profit, won });
      aggregateBy(byMarket, bet.market, { stake, profit, won });
      aggregateBy(byCompetition, bet.competition || 'Unknown', { stake, profit, won });
    }

    const netProfit = totalReturn - totalStake;
    const settledCount = wonCount + lostCount;
    const roi = totalStake > 0 ? netProfit / totalStake : 0;
    const hitRate = settledCount > 0 ? wonCount / settledCount : 0;
    const avgOdds = settledCount > 0 ? oddsSum / settledCount : 0;
    const avgClv = clvCount > 0 ? clvSum / clvCount : 0;

    return {
      summary: {
        totalBets: bets.length,
        settledBets: settledCount,
        pendingBets: pending.length,
        voidBets: voided.length,
        wonBets: wonCount,
        lostBets: lostCount,
        totalStake: round2(totalStake),
        totalReturn: round2(totalReturn),
        netProfit: round2(netProfit),
        taxableWinnings: round2(taxableWinnings),
        taxOwed: round2(totalTax),
        netProfitAfterTax: round2(netProfitAfterTax),
        taxThreshold: TAX_THRESHOLD_RON,
        taxRate: TAX_RATE,
        remainingTaxFreeWinnings: Math.max(0, TAX_THRESHOLD_RON - totalWonProfit(bets)),
        roi: round4(roi),
        hitRate: round4(hitRate),
        avgOdds: round2(avgOdds),
        avgClv: round4(avgClv),
        clvSamples: clvCount,
      },
      byBookmaker: finalizeAggregates(byBookmaker),
      byMarket: finalizeAggregates(byMarket),
      byCompetition: finalizeAggregates(byCompetition),
    };
  }

  refreshTaxFields() {
    const annotated = annotateTaxFields(this.readAll());
    this.rewrite(annotated);
    return annotated;
  }
}

function aggregateBy(bucket, key, { stake, profit, won }) {
  if (!key) key = 'Unknown';
  if (!bucket[key]) {
    bucket[key] = { bets: 0, stake: 0, profit: 0, won: 0, lost: 0 };
  }
  bucket[key].bets++;
  bucket[key].stake += stake;
  bucket[key].profit += profit;
  if (won) bucket[key].won++;
  else bucket[key].lost++;
}

function finalizeAggregates(bucket) {
  const result = {};
  for (const [key, val] of Object.entries(bucket)) {
    result[key] = {
      bets: val.bets,
      stake: round2(val.stake),
      profit: round2(val.profit),
      roi: val.stake > 0 ? round4(val.profit / val.stake) : 0,
      hitRate: val.bets > 0 ? round4(val.won / val.bets) : 0,
    };
  }
  return result;
}

function round2(v) { return Math.round(v * 100) / 100; }
function round4(v) { return Math.round(v * 10000) / 10000; }

function optionalNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  return VALID_STATUSES.includes(status) ? status : null;
}

function normalizeIsoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function annotateTaxFields(bets) {
  const annotated = bets.map((bet) => ({ ...bet }));
  const cumulativeByYear = new Map();
  const wonIndexes = annotated
    .map((bet, index) => ({ bet, index }))
    .filter(({ bet }) => bet.status === 'won')
    .sort((left, right) => taxDate(left.bet) - taxDate(right.bet));

  for (const { bet, index } of wonIndexes) {
    const year = taxYear(bet);
    const cumulative = cumulativeByYear.get(year) || 0;
    const result = calculateBetTax(Number(bet.stake) || 0, Number(bet.odds) || 0, cumulative);
    cumulativeByYear.set(year, cumulative + (Number(result.grossWinnings) || 0));
    annotated[index] = {
      ...bet,
      grossProfit: round2(result.grossWinnings || 0),
      taxableWinnings: round2(result.taxableAmount || 0),
      taxOwed: round2(result.tax || 0),
      netProfitAfterTax: round2(result.netProfit || 0),
      taxYear: year,
    };
  }

  return annotated.map((bet) => {
    if (bet.status === 'won') return bet;
    const stake = Number(bet.stake) || 0;
    const grossProfit = bet.status === 'lost' ? -stake : 0;
    return {
      ...bet,
      grossProfit: round2(grossProfit),
      taxableWinnings: 0,
      taxOwed: 0,
      netProfitAfterTax: round2(grossProfit),
      taxYear: bet.settledAt ? taxYear(bet) : null,
    };
  });
}

function taxDate(bet) {
  const date = new Date(bet.settledAt || bet.loggedAt || bet.timestamp || 0);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function taxYear(bet) {
  return taxDate(bet).getFullYear();
}

function totalWonProfit(bets) {
  return bets
    .filter((bet) => bet.status === 'won')
    .reduce((total, bet) => total + Math.max(0, Number(bet.grossProfit) || 0), 0);
}

function generateBetId() {
  return 'bet_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

module.exports = { BetTracker, DEFAULT_BET_LOG_PATH, VALID_STATUSES };
