/**
 * Analytics page: performance overview, financials, and breakdown tables.
 */

import { state, $, escapeHtml, formatMoney, formatPct } from '../state.js';

export function renderAnalytics() {
  if (!state.analytics) return;
  const s = state.analytics.summary;
  const afterTax = Number.isFinite(Number(s.netProfitAfterTax)) ? Number(s.netProfitAfterTax) : Number(s.netProfit || 0);
  $('#analytics-summary').innerHTML = `
    <article class="value-card">
      <div class="value-card__top"><div><h2 class="value-card__title">Overview</h2></div></div>
      <div class="value-card__metric"><span>Total bets</span><strong>${s.totalBets}</strong></div>
      <div class="value-card__metric"><span>Settled</span><strong>${s.settledBets}</strong></div>
      <div class="value-card__metric"><span>Pending</span><strong>${s.pendingBets}</strong></div>
      <div class="value-card__metric"><span>Won / Lost</span><strong>${s.wonBets} / ${s.lostBets}</strong></div>
    </article>
    <article class="value-card">
      <div class="value-card__top"><div><h2 class="value-card__title">Financials</h2></div></div>
      <div class="value-card__metric"><span>Total stake</span><strong>${formatMoney(s.totalStake)}</strong></div>
      <div class="value-card__metric"><span>Return</span><strong>${formatMoney(s.totalReturn)}</strong></div>
      <div class="value-card__metric"><span>Net profit</span><strong style="color:${s.netProfit >= 0 ? 'var(--profit)' : 'var(--danger)'}">${formatMoney(s.netProfit)}</strong></div>
      <div class="value-card__metric"><span>Tax owed</span><strong>${formatMoney(s.taxOwed || 0)}</strong></div>
      <div class="value-card__metric"><span>After-tax net</span><strong style="color:${afterTax >= 0 ? 'var(--profit)' : 'var(--danger)'}">${formatMoney(afterTax)}</strong></div>
      <div class="value-card__metric"><span>ROI</span><strong>${formatPct(s.roi, 2)}</strong></div>
    </article>
    <article class="value-card">
      <div class="value-card__top"><div><h2 class="value-card__title">Quality</h2></div></div>
      <div class="value-card__metric"><span>Hit rate</span><strong>${formatPct(s.hitRate, 1)}</strong></div>
      <div class="value-card__metric"><span>Avg odds</span><strong>${Number(s.avgOdds).toFixed(2)}</strong></div>
      <div class="value-card__metric"><span>Avg CLV</span><strong>${formatPct(s.avgClv, 2)}</strong></div>
      <div class="value-card__metric"><span>CLV samples</span><strong>${s.clvSamples}</strong></div>
    </article>`;

  const bds = [
    { t: 'By Bookmaker', d: state.analytics.byBookmaker },
    { t: 'By Market', d: state.analytics.byMarket },
    { t: 'By Competition', d: state.analytics.byCompetition },
  ];
  $('#analytics-breakdown').innerHTML = bds.map((s) => `<article class="value-card"><div class="value-card__top"><div><h2 class="value-card__title">${s.t}</h2></div></div><table class="odds-table"><thead><tr><th>Name</th><th>Bets</th><th>Stake</th><th>Profit</th><th>ROI</th><th>Hit%</th></tr></thead><tbody>${Object.entries(s.d || {}).map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${v.bets}</td><td>${formatMoney(v.stake)}</td><td>${formatMoney(v.profit)}</td><td>${formatPct(v.roi, 2)}</td><td>${formatPct(v.hitRate, 1)}</td></tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--text-tertiary)">No data</td></tr>'}</tbody></table></article>`).join('');
}
