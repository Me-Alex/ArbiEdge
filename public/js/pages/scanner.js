/**
 * Scanner page: arbitrage opportunity rendering, arb change detection,
 * CSV export, and arb history display.
 */

import { state, renderRegistry, $, escapeHtml, formatTime, formatPct, formatMoney, bookmakerDot, arbId } from '../state.js';
import { openArbModal, toast, logActivity } from '../ui-common.js';
import { getFilteredOpportunities } from '../state.js';
import { csvEscape } from '../state.js';

export function renderScanner() {
  const list = $('#scanner-list');
  const opps = getFilteredOpportunities();
  list.innerHTML = '';
  if (opps.length === 0) {
    list.innerHTML = '<div class="state-panel">No arbitrage opportunities matched the current filter. Try lowering the min edge or refreshing.</div>';
    return;
  }
  opps.forEach((opp) => {
    const id = arbId(opp);
    const isPinned = state.pinnedArbs.has(id);
    const cc = opp.confidence === 'trusted' ? 'pill--good' : opp.confidence === 'risky' ? 'pill--warn' : '';
    const legs = (opp.legs || []).map((leg) => {
      const url = leg.url || '';
      const link = url
        ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="leg-link">${bookmakerDot(leg.bookmaker)} ${escapeHtml(leg.bookmaker)}</a>`
        : `${bookmakerDot(leg.bookmaker)} ${escapeHtml(leg.bookmaker)}`;
      return `<li>${escapeHtml(leg.label)} - ${link} @ ${Number(leg.price).toFixed(2)}</li>`;
    }).join('');
    const article = document.createElement('article');
    article.className = `arb-card${isPinned ? ' arb-card--pinned' : ''}`;
    article.innerHTML = `
      <div class="arb-card__top"><div><h2 class="arb-card__title">${escapeHtml(opp.eventName)}</h2><div class="muted-line">${escapeHtml(opp.marketLabel || opp.marketKey)} · ${escapeHtml(opp.competition || '')}</div></div><span class="pill ${cc}">${escapeHtml(opp.confidence || 'review')}</span></div>
      <div class="value-card__metric"><span>Edge</span><strong>${formatPct(opp.edge)}</strong></div>
      <div class="value-card__metric"><span>Profit on 100 RON</span><strong class="arb-card__profit">+${Number(opp.profit).toFixed(2)} RON</strong></div>
      <ol class="legs-list">${legs}</ol>
      <div class="arb-card__footer">
        <button class="ghost-button arb-detail-btn" type="button">Details</button>
        <button class="ghost-button arb-pin-btn" type="button">${isPinned ? 'Pinned' : 'Pin'}</button>
      </div>`;
    article.querySelector('.arb-detail-btn').addEventListener('click', () => openArbModal(opp));
    article.querySelector('.arb-pin-btn').addEventListener('click', () => {
      if (state.pinnedArbs.has(id)) { state.pinnedArbs.delete(id); toast('Arb unpinned'); }
      else { state.pinnedArbs.add(id); toast('Arb pinned'); }
      renderRegistry.scanner();
    });
    list.appendChild(article);
  });
}

export function renderArbHistory() {
  const l = $('#arb-history-list');
  if (!state.arbHistory || !state.arbHistory.records || state.arbHistory.records.length === 0) {
    l.innerHTML = '<div class="state-panel">No arb history yet. Opportunities are logged when you refresh the scanner.</div>';
    return;
  }
  l.innerHTML = '';
  state.arbHistory.records.forEach((r) => {
    const a = document.createElement('article');
    a.className = 'arb-card';
    a.innerHTML = `<div class="arb-card__top"><div><h2 class="arb-card__title">${r.count} opportunity${r.count === 1 ? '' : 'ies'}</h2><div class="muted-line">${formatTime(r.loggedAt)}</div></div></div>${(r.opportunities || []).slice(0, 5).map((o) => `<div class="muted-line">${escapeHtml(o.eventName)} · ${formatPct(o.edge)} · ${escapeHtml(o.marketLabel || o.marketKey)} · ${(o.legs || []).map((l) => `${escapeHtml(l.label)}@${escapeHtml(l.bookmaker)}`).join(', ')}</div>`).join('')}`;
    l.appendChild(a);
  });
}

export async function exportCsv() {
  const response = await fetch(`/api/opportunities?minEdge=${encodeURIComponent(state.minEdge)}&sort=edge`);
  if (!response.ok) return;
  const payload = await response.json();
  const rows = [['Event', 'Market', 'Edge', 'Profit', 'Legs']];
  (payload.opportunities || []).forEach((o) => rows.push([
    o.eventName || '', o.marketLabel || o.marketKey || '', `${(Number(o.edge) * 100).toFixed(1)}%`,
    Number(o.profit || 0).toFixed(2), (o.legs || []).map((l) => `${l.label}@${l.bookmaker}`).join(' | '),
  ]));
  const csv = rows.map((r) => r.map(csvEscape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'surebets.csv';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
