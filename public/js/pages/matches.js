/**
 * Matches page: full odds feed with clickable prices, favorites, and market toggles.
 */

import { state, renderRegistry, $, escapeHtml, formatTime, bookmakerDot, toggleFavorite, toggleHidden, sortBookmakers } from '../state.js';
import { getFilteredEvents } from '../state.js';

export function renderMatches() {
  const list = $('#matches-list');
  const events = getFilteredEvents();
  list.innerHTML = '';
  if (events.length === 0) { list.innerHTML = '<div class="state-panel">No matches matched the current filters.</div>'; return; }
  events.forEach((event) => {
    const card = document.createElement('article'); card.className = 'match-card';
    card.innerHTML = `<div class="match-card__head"><div><h2 class="match-card__title">${escapeHtml(event.homeTeam)} vs ${escapeHtml(event.awayTeam)}</h2><div class="muted-line">${escapeHtml(event.competition || '')} · ${escapeHtml(event.sport || '')} · ${formatTime(event.startsAt)}</div></div></div>`;
    const sortedBms = sortBookmakers(event.bookmakers || []);
    const visibleBms = state.favoritesOnly
      ? sortedBms.filter((b) => state.favorites.includes(b.name))
      : sortedBms;
    const table = document.createElement('table'); table.className = 'odds-table';
    table.innerHTML = '<thead><tr><th>Bookmaker</th><th>Market</th><th>Selections</th><th></th></tr></thead><tbody></tbody>';
    const body = table.querySelector('tbody');
    sortedBms.forEach((bm) => {
      const isFav = state.favorites.includes(bm.name);
      const allMarkets = Object.entries(bm.markets || {});
      const marketEntries = state.showAllMarkets ? allMarkets : allMarkets.slice(0, 3);
      marketEntries.forEach(([mk, outcomes]) => {
        const row = document.createElement('tr');
        const selHtml = Object.entries(outcomes || {}).map(([o, od]) => `<button class="odds-button" type="button" data-odds="${Number(od)}" data-bookmaker="${escapeHtml(bm.name)}" data-market="${escapeHtml(mk)}" data-outcome="${escapeHtml(o)}" data-event="${escapeHtml(`${event.homeTeam} vs ${event.awayTeam}`)}">${escapeHtml(o)} ${Number(od).toFixed(2)}</button>`).join(' ');
        row.innerHTML = `<td>${bookmakerDot(bm.name)}${escapeHtml(bm.name)}</td><td>${escapeHtml(mk)}</td><td>${selHtml}</td><td class="bm-actions"><button class="bm-action-btn" data-action="fav" data-bm="${escapeHtml(bm.name)}" type="button" title="${isFav ? 'Unpin' : 'Pin'}">${isFav ? 'Pinned' : 'Pin'}</button><button class="bm-action-btn" data-action="hide" data-bm="${escapeHtml(bm.name)}" type="button" title="Hide">Hide</button></td>`;
        body.appendChild(row);
      });
    });
    card.appendChild(table);
    card.querySelectorAll('[data-odds]').forEach((btn) => btn.addEventListener('click', () => {
      renderRegistry.loadSelectionIntoCalculator?.({
        event: btn.dataset.event, market: btn.dataset.market, outcome: btn.dataset.outcome,
        bookmaker: btn.dataset.bookmaker, odds: Number(btn.dataset.odds), type: 'manual',
      });
      renderRegistry.setPage?.('calculator');
    }));
    card.querySelectorAll('.bm-action-btn').forEach((btn) => btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const a = btn.dataset.action, bm = btn.dataset.bm;
      if (a === 'fav') toggleFavorite(bm);
      if (a === 'hide') toggleHidden(bm);
      renderRegistry.matches?.();
    }));
    list.appendChild(card);
  });
}
