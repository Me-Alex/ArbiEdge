/**
 * Journal page: rendering, filtering, local/server actions, CSV import/export.
 */

import { state, renderRegistry, $, escapeHtml, formatTime, formatMoney, bookmakerDot, csvEscape } from '../state.js';
import { getAllJournalEntries } from '../state.js';
import { toast } from '../ui-common.js';
import { readJournal, writeJournal } from '../state.js';
import { readJournal, writeJournal } from '../state.js';

export function getFilteredJournalEntries() {
  let entries = getAllJournalEntries();
  if (state.journalSearch) entries = entries.filter((e) => normalizeText(`${e.event} ${e.market} ${e.selection} ${e.bookmaker}`).includes(normalizeText(state.journalSearch)));
  if (state.journalStatusFilter) entries = entries.filter((e) => (e.status || 'pending') === state.journalStatusFilter);
  if (state.journalBookmakerFilter) entries = entries.filter((e) => e.bookmaker === state.journalBookmakerFilter);
  return entries;
}

function normalizeText(v) { return String(v || '').toLowerCase().trim(); }

export function renderJournal() {
  const list = $('#journal-list');
  const entries = getFilteredJournalEntries();
  list.innerHTML = '';

  const bmFilter = $('#journal-bookmaker-filter');
  const allBms = [...new Set(getAllJournalEntries().map((e) => e.bookmaker).filter(Boolean))].sort();
  const currentVal = bmFilter.value;
  bmFilter.innerHTML = '<option value="">All bookmakers</option>' + allBms.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('');
  bmFilter.value = currentVal;

  if (entries.length === 0) {
    list.innerHTML = '<div class="state-panel">No bets logged yet. Save a pick from the calculator or AI review queue.</div>';
    return;
  }
  entries.forEach((entry) => {
    const article = document.createElement('article'); article.className = 'journal-card';
    article.dataset.id = entry.id || ''; article.dataset.type = entry.type || 'manual';
    const status = entry.status || 'pending';
    const taxOwed = Number(entry.taxOwed || 0);
    const netAfterTax = Number.isFinite(Number(entry.netProfitAfterTax)) ? Number(entry.netProfitAfterTax) : null;
    const pnl = netAfterTax ?? (status === 'won' ? (Number(entry.stake || 0) * Number(entry.odds || 0) - Number(entry.stake || 0)) : status === 'lost' ? -Number(entry.stake || 0) : 0);
    const settledMetrics = status !== 'pending'
      ? `<div class="value-card__metric"><span>P/L after tax</span><strong style="color:${pnl >= 0 ? 'var(--profit)' : 'var(--danger)'}">${formatMoney(pnl)}</strong></div><div class="value-card__metric"><span>Tax</span><strong>${formatMoney(taxOwed)}</strong></div>`
      : '';
    article.innerHTML = `<div class="journal-card__head"><div><h2 class="journal-card__title">${escapeHtml(entry.event)}</h2><div class="muted-line">${escapeHtml(entry.market)} · ${escapeHtml(entry.selection)} · ${bookmakerDot(entry.bookmaker)} ${escapeHtml(entry.bookmaker)}</div></div><span class="pill journal-card__status">${escapeHtml(status)}</span></div><div class="value-card__metric"><span>Odds</span><strong>${Number(entry.odds || 0).toFixed(2)}</strong></div><div class="value-card__metric"><span>Stake</span><strong>${formatMoney(entry.stake || 0)}</strong></div><div class="value-card__metric"><span>Saved</span><strong>${formatTime(entry.loggedAt || entry.timestamp)}</strong></div>${settledMetrics}<div class="journal-card__actions"><button class="ghost-button" data-action="won" type="button">Won</button><button class="ghost-button" data-action="lost" type="button">Lost</button><button class="ghost-button" data-action="remove" type="button">Remove</button></div>`;
    article.querySelector('[data-action="won"]').addEventListener('click', () => settleJournalEntry(article, entry, 'won'));
    article.querySelector('[data-action="lost"]').addEventListener('click', () => settleJournalEntry(article, entry, 'lost'));
    article.querySelector('[data-action="remove"]').addEventListener('click', () => removeJournalEntry(article, entry));
    list.appendChild(article);
  });
}

export function createLocalJournalEntry(e) {
  const r = { id: `local-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`, timestamp: new Date().toISOString(), status: 'pending', ...e };
  state.localJournal.unshift(r);
  writeJournal();
  renderRegistry.journal();
  renderRegistry.betSlip();
}

export async function saveCalculatorSelection() {
  if (!state.selectedOdds) return;
  try {
    const r = await fetch('/api/bets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: state.selectedOdds.type || 'manual', event: state.selectedOdds.event, market: state.selectedOdds.market,
        selection: `${state.selectedOdds.outcome} @ ${state.selectedOdds.bookmaker}`, bookmaker: state.selectedOdds.bookmaker,
        odds: state.selectedOdds.odds, stake: Number($('#calc-stake').value || 100),
      }),
    });
    const p = await r.json();
    if (r.ok && p.id) {
      state.serverJournal.unshift(p); state.analytics = null;
      renderRegistry.journal(); renderRegistry.betSlip();
      toast('Saved to journal'); renderRegistry.setPage?.('journal'); return;
    }
  } catch { /* fall through to local */ }
  createLocalJournalEntry({
    type: state.selectedOdds.type || 'manual', event: state.selectedOdds.event, market: state.selectedOdds.market,
    selection: `${state.selectedOdds.outcome} @ ${state.selectedOdds.bookmaker}`, bookmaker: state.selectedOdds.bookmaker,
    odds: state.selectedOdds.odds, stake: Number($('#calc-stake').value || 100),
  });
  toast('Saved to journal'); renderRegistry.setPage?.('journal');
}

export async function settleJournalEntry(card, entry, result) {
  if (entry.source === 'local') {
    state.localJournal = state.localJournal.map((i) => i.id === entry.id ? { ...i, status: result, result } : i);
    writeJournal(); state.analytics = null;
    renderRegistry.journal(); renderRegistry.betSlip();
    toast(`Bet settled: ${result}`); return;
  }
  try {
    const r2 = await fetch(`/api/bets/${entry.id}/settle`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ result }) });
    const p = await r2.json();
    if (!r2.ok || p.error) throw new Error(p.error || 'Failed');
    state.serverJournal = state.serverJournal.map((i) => i.id === entry.id ? p : i);
    state.analytics = null; renderRegistry.journal(); renderRegistry.betSlip();
    toast(`Bet settled: ${result}`);
  } catch (err) { showJournalError(card, err.message); }
}

export async function removeJournalEntry(card, entry) {
  if (entry.source === 'local') {
    state.localJournal = state.localJournal.filter((i) => i.id !== entry.id);
    writeJournal(); state.analytics = null;
    renderRegistry.journal(); renderRegistry.betSlip();
    toast('Bet removed'); return;
  }
  try {
    const r = await fetch(`/api/bets/${entry.id}`, { method: 'DELETE' });
    const p = await r.json();
    if (!r.ok || p.ok !== true) throw new Error(p.error || 'Failed');
    state.serverJournal = state.serverJournal.filter((i) => i.id !== entry.id);
    state.analytics = null; renderRegistry.journal(); renderRegistry.betSlip();
    toast('Bet removed');
  } catch (err) { showJournalError(card, err.message); }
}

export function showJournalError(c, m) {
  let n = c.querySelector('.journal-card__error');
  if (!n) { n = document.createElement('div'); n.className = 'journal-card__error'; c.appendChild(n); }
  n.textContent = m;
}

export async function clearJournalEntries() {
  state.localJournal = []; writeJournal(); state.analytics = null;
  renderRegistry.journal(); renderRegistry.betSlip();
  toast('Local journal cleared');
}

export function exportJournalCsv() {
  const entries = getAllJournalEntries();
  const rows = [['ID', 'Event', 'Market', 'Selection', 'Bookmaker', 'Odds', 'Stake', 'Status', 'Type', 'Saved']];
  entries.forEach((e) => rows.push([e.id || '', e.event || '', e.market || '', e.selection || '', e.bookmaker || '', e.odds || '', e.stake || '', e.status || 'pending', e.type || 'manual', e.loggedAt || e.timestamp || '']));
  const csv = rows.map((r) => r.map(csvEscape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'journal.csv';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  toast('Journal exported');
}

export async function importJournalCsv(file) {
  if (!file) return;
  try {
    const csv = await file.text();
    const response = await fetch('/api/bets/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv }) });
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error || 'Import failed');
    const journal = await (await fetch('/api/bets')).json();
    state.serverJournal = journal.bets || []; state.analytics = null;
    renderRegistry.journal(); renderRegistry.betSlip();
    toast(`Imported ${payload.imported} bets`);
  } catch (error) { toast(`Import failed: ${error.message}`); }
}
