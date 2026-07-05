/**
 * Movement page: odds price changes between snapshots.
 */

import { state, $, escapeHtml, bookmakerDot } from '../state.js';

export function renderMovement() {
  if (!state.movement || !state.movement.movements) {
    $('#movement-list').innerHTML = '<div class="state-panel">No movement data available yet.</div>';
    return;
  }
  const l = $('#movement-list');
  const ms = state.movement.movements;
  l.innerHTML = '';
  if (ms.length === 0) { l.innerHTML = '<div class="state-panel">No price changes detected.</div>'; return; }
  ms.forEach((m) => {
    const dc = m.direction === 'up' ? 'pill--good' : 'pill--warn';
    const s = m.direction === 'up' ? '↑' : '↓';
    const a = document.createElement('article'); a.className = 'arb-card';
    a.innerHTML = `<div class="arb-card__top"><div><h2 class="arb-card__title">${escapeHtml(m.event)}</h2><div class="muted-line">${bookmakerDot(m.bookmaker)} ${escapeHtml(m.bookmaker)} · ${escapeHtml(m.market)} · ${escapeHtml(m.outcome)}</div></div><span class="pill ${dc}">${s} ${Number(m.change).toFixed(2)}</span></div><div class="value-card__metric"><span>Previous</span><strong>${Number(m.previous).toFixed(2)}</strong></div><div class="value-card__metric"><span>Current</span><strong>${Number(m.current).toFixed(2)}</strong></div>`;
    l.appendChild(a);
  });
}
