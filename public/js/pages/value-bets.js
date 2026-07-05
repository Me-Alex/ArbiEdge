/**
 * Value bets and AI review pages.
 */

import { state, renderRegistry, $, escapeHtml, formatPct, bookmakerDot } from '../state.js';
import { getFilteredValueBets } from '../state.js';
import { toast } from '../ui-common.js';

export function renderValue() {
  const list = $('#value-list');
  const bets = getFilteredValueBets();
  list.innerHTML = '';
  if (bets.length === 0) { list.innerHTML = '<div class="state-panel">No value bets are available right now.</div>'; return; }
  bets.forEach((bet) => {
    const card = document.createElement('article'); card.className = 'value-card';
    card.innerHTML = `<div class="value-card__top"><div><h2 class="value-card__title">${escapeHtml(bet.eventName)}</h2><div class="muted-line">${escapeHtml(bet.marketLabel)} · ${escapeHtml(bet.label)} · ${bookmakerDot(bet.bookmaker)} ${escapeHtml(bet.bookmaker)}</div></div><span class="pill pill--good">Kelly ${Math.min(25, bet.kelly * 100).toFixed(1)}%</span></div><div class="value-card__metric"><span>Price</span><strong>${Number(bet.price).toFixed(2)}</strong></div><div class="value-card__metric"><span>Consensus</span><strong>${Number(bet.consensus).toFixed(2)}</strong></div><div class="value-card__metric"><span>Gap</span><strong>${formatPct(bet.gap)}</strong></div><button class="primary-button" type="button">Calculate</button>`;
    card.querySelector('button').addEventListener('click', () => {
      renderRegistry.loadSelectionIntoCalculator?.({
        event: bet.eventName, market: bet.marketLabel, outcome: bet.label,
        bookmaker: bet.bookmaker, odds: bet.price, consensus: bet.consensus, type: 'value',
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
  if (bets.length === 0) { list.innerHTML = '<div class="state-panel empty-state">No AI review cards are available right now.</div>'; return; }
  bets.forEach((bet, i) => {
    const card = document.createElement('article'); card.className = 'ai-card';
    card.innerHTML = `<div class="value-card__top"><div><h2 class="ai-card__title">${escapeHtml(bet.eventName)}</h2><div class="muted-line">${escapeHtml(bet.marketLabel)} · ${escapeHtml(bet.label)}</div></div><span class="pill ${i === 0 ? 'pill--good' : ''}">Candidate ${i + 1}</span></div><div class="ai-card__metric"><span>Bookmaker</span><strong>${bookmakerDot(bet.bookmaker)} ${escapeHtml(bet.bookmaker)}</strong></div><div class="ai-card__metric"><span>Odds</span><strong>${Number(bet.price).toFixed(2)}</strong></div><div class="ai-card__metric"><span>Gap</span><strong>${formatPct(bet.gap)}</strong></div><button class="primary-button" type="button">Save to journal</button>`;
    card.querySelector('button').addEventListener('click', () => {
      renderRegistry.createLocalJournalEntry?.({
        type: 'ai-value', event: bet.eventName, market: bet.marketLabel,
        selection: bet.label, bookmaker: bet.bookmaker, odds: bet.price, stake: 100,
      });
      toast('Saved to journal');
      renderRegistry.setPage?.('journal');
    });
    list.appendChild(card);
  });
}
