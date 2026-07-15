/** Match feed with clickable prices and per-bookmaker visibility controls. */

import {
  state, renderRegistry, $, escapeHtml, formatTime, bookmakerDot,
  toggleFavorite, toggleHidden, sortBookmakers, getFilteredEvents,
} from '../state.js?v=12';

function renderPriceButton(eventName, bookmaker, market, outcome, odds) {
  return `<button class="odds-button" type="button" data-odds="${Number(odds)}" data-bookmaker="${escapeHtml(bookmaker)}" data-market="${escapeHtml(market)}" data-outcome="${escapeHtml(outcome)}" data-event="${escapeHtml(eventName)}" aria-label="${escapeHtml(`${outcome} at ${Number(odds).toFixed(2)} with ${bookmaker}`)}"><span>${escapeHtml(outcome)}</span> <strong>${Number(odds).toFixed(2)}</strong></button>`;
}

export function renderMatches() {
  const list = $('#matches-list');
  const events = getFilteredEvents();
  list.innerHTML = '';
  if (events.length === 0) {
    list.innerHTML = '<div class="state-panel"><div class="state-panel__copy"><span class="state-panel__eyebrow">Feed clear</span><strong>No matches found</strong><span>Clear the global search or change the selected sport.</span></div></div>';
    return;
  }

  events.forEach((event) => {
    const eventName = `${event.homeTeam} vs ${event.awayTeam}`;
    const card = document.createElement('article');
    card.className = 'match-card';
    card.innerHTML = `
      <div class="match-card__head">
        <div><h2 class="match-card__title">${escapeHtml(eventName)}</h2><div class="muted-line">${escapeHtml(event.competition || '')} · ${escapeHtml(event.sport || '')} · ${formatTime(event.startsAt)}</div></div>
      </div>`;

    const sortedBookmakers = sortBookmakers(event.bookmakers || []);
    const visibleBookmakers = state.favoritesOnly
      ? sortedBookmakers.filter((bookmaker) => state.favorites.includes(bookmaker.name))
      : sortedBookmakers;
    const table = document.createElement('table');
    table.className = 'odds-table';
    table.setAttribute('aria-label', `Odds for ${eventName}`);
    table.innerHTML = '<thead><tr><th>Bookmaker</th><th>Market</th><th>Selections</th><th><span class="sr-only">Bookmaker controls</span></th></tr></thead><tbody></tbody>';
    const body = table.querySelector('tbody');

    if (visibleBookmakers.length === 0) {
      body.innerHTML = '<tr><td colspan="4">No favorite bookmakers are available for this event.</td></tr>';
    }

    visibleBookmakers.forEach((bookmaker) => {
      const isFavorite = state.favorites.includes(bookmaker.name);
      const allMarkets = Object.entries(bookmaker.markets || {});
      const marketEntries = state.showAllMarkets ? allMarkets : allMarkets.slice(0, 3);
      marketEntries.forEach(([market, outcomes]) => {
        const row = document.createElement('tr');
        const selections = Object.entries(outcomes || {})
          .map(([outcome, odds]) => renderPriceButton(eventName, bookmaker.name, market, outcome, odds))
          .join(' ');
        row.innerHTML = `
          <td>${bookmakerDot(bookmaker.name)}${escapeHtml(bookmaker.name)}</td>
          <td>${escapeHtml(market)}</td>
          <td>${selections}</td>
          <td class="bm-actions">
            <button class="bm-action-btn" data-action="fav" data-bm="${escapeHtml(bookmaker.name)}" type="button" title="${isFavorite ? 'Unpin bookmaker' : 'Pin bookmaker'}">${isFavorite ? 'Pinned' : 'Pin'}</button>
            <button class="bm-action-btn" data-action="hide" data-bm="${escapeHtml(bookmaker.name)}" type="button" title="Hide bookmaker">Hide</button>
          </td>`;
        body.appendChild(row);
      });
    });

    card.appendChild(table);
    card.querySelectorAll('[data-odds]').forEach((button) => button.addEventListener('click', () => {
      renderRegistry.loadSelectionIntoCalculator?.({
        event: button.dataset.event,
        market: button.dataset.market,
        outcome: button.dataset.outcome,
        bookmaker: button.dataset.bookmaker,
        odds: Number(button.dataset.odds),
        type: 'manual',
      });
      renderRegistry.setPage?.('calculator');
    }));
    card.querySelectorAll('.bm-action-btn').forEach((button) => button.addEventListener('click', (eventClick) => {
      eventClick.stopPropagation();
      const action = button.dataset.action;
      const bookmaker = button.dataset.bm;
      if (action === 'fav') toggleFavorite(bookmaker);
      if (action === 'hide') toggleHidden(bookmaker);
      renderRegistry.matches?.();
    }));
    list.appendChild(card);
  });
}
