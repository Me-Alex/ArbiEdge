/** Value-bet comparison and AI-assisted paper review. */

import { state, renderRegistry, $, escapeHtml, formatPct, bookmakerDot, getFilteredValueBets } from '../state.js?v=12';
import { toast } from '../ui-common.js?v=12';

function emptyState(title, detail) {
  return `<div class="state-panel"><div class="state-panel__copy"><span class="state-panel__eyebrow">Queue clear</span><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></div></div>`;
}

export function renderValue() {
  const list = $('#value-list');
  const bets = getFilteredValueBets();
  list.innerHTML = '';
  if (bets.length === 0) {
    list.innerHTML = emptyState('No value gaps available', 'Refresh the feed or clear the global search to check a wider market set.');
    return;
  }

  bets.forEach((bet) => {
    const card = document.createElement('article');
    card.className = 'value-card';
    card.innerHTML = `
      <div class="value-card__top">
        <div><h2 class="value-card__title">${escapeHtml(bet.eventName)}</h2><div class="muted-line">${escapeHtml(bet.marketLabel)} · ${escapeHtml(bet.label)}</div></div>
        <span class="pill pill--good">Kelly ${Math.min(25, bet.kelly * 100).toFixed(1)}%</span>
      </div>
      <div class="value-card__metric"><span>Bookmaker</span><strong>${bookmakerDot(bet.bookmaker)}${escapeHtml(bet.bookmaker)}</strong></div>
      <div class="value-card__metric"><span>Available price</span><strong>${Number(bet.price).toFixed(2)}</strong></div>
      <div class="value-card__metric"><span>Consensus price</span><strong>${Number(bet.consensus).toFixed(2)}</strong></div>
      <div class="value-card__metric"><span>Value gap</span><strong>${formatPct(bet.gap)}</strong></div>
      <button class="primary-button" type="button">Calculate position</button>`;
    card.querySelector('button').addEventListener('click', () => {
      renderRegistry.loadSelectionIntoCalculator?.({
        event: bet.eventName,
        market: bet.marketLabel,
        outcome: bet.label,
        bookmaker: bet.bookmaker,
        odds: bet.price,
        consensus: bet.consensus,
        type: 'value',
      });
      renderRegistry.setPage?.('calculator');
    });
    list.appendChild(card);
  });
}

export function renderAi() {
  const list = $('#ai-list');
  const bets = getFilteredValueBets().slice(0, 8);
  list.innerHTML = '';
  if (bets.length === 0) {
    list.innerHTML = emptyState('No review candidates', 'The shortlist will repopulate when qualifying value signals are available.');
    return;
  }

  bets.forEach((bet, index) => {
    const card = document.createElement('article');
    card.className = 'ai-card';
    card.innerHTML = `
      <div class="value-card__top">
        <div><h2 class="ai-card__title">${escapeHtml(bet.eventName)}</h2><div class="muted-line">${escapeHtml(bet.marketLabel)} · ${escapeHtml(bet.label)}</div></div>
        <span class="pill ${index === 0 ? 'pill--good' : ''}">Review ${index + 1}</span>
      </div>
      <div class="ai-card__metric"><span>Bookmaker</span><strong>${bookmakerDot(bet.bookmaker)}${escapeHtml(bet.bookmaker)}</strong></div>
      <div class="ai-card__metric"><span>Available price</span><strong>${Number(bet.price).toFixed(2)}</strong></div>
      <div class="ai-card__metric"><span>Value gap</span><strong>${formatPct(bet.gap)}</strong></div>
      <button class="primary-button" type="button">Save to journal</button>`;
    card.querySelector('button').addEventListener('click', () => {
      renderRegistry.createLocalJournalEntry?.({
        type: 'ai-value',
        event: bet.eventName,
        market: bet.marketLabel,
        selection: bet.label,
        bookmaker: bet.bookmaker,
        odds: bet.price,
        stake: 100,
      });
      toast('Saved to journal');
      renderRegistry.setPage?.('journal');
    });
    list.appendChild(card);
  });
}
