/**
 * Bookmakers page: coverage registry display.
 */

import { state, $, escapeHtml, bookmakerDot } from '../state.js?v=12';

export function renderBookmakers() {
  const list = $('#bookmakers-list');
  list.innerHTML = '';
  const entries = state.bookmakerCoverage?.entries || [];
  if (entries.length === 0) { list.innerHTML = '<div class="state-panel">No bookmaker coverage data is available.</div>'; return; }
  entries.forEach((entry) => {
    const card = document.createElement('article'); card.className = 'bookmaker-card';
    card.innerHTML = `<div class="value-card__top"><div><h2 class="ai-card__title">${bookmakerDot(entry.name)} ${escapeHtml(entry.name)}</h2><div class="muted-line">${escapeHtml(entry.domain || '')}</div></div><span class="pill">${escapeHtml(entry.status || 'unknown')}</span></div><div class="muted-line">${escapeHtml(entry.adapter || entry.note || 'Coverage tracked in the local registry.')}</div>`;
    list.appendChild(card);
  });
}
