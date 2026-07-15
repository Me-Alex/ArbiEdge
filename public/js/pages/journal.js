/** Journal rendering, settlement actions, and CSV import/export. */

import {
  state, renderRegistry, $, escapeHtml, formatTime, formatMoney, bookmakerDot,
  csvEscape, getAllJournalEntries, writeJournal,
} from '../state.js?v=12';
import { toast } from '../ui-common.js?v=12';

function normalizeText(value) {
  return String(value || '').toLowerCase().trim();
}

export function getFilteredJournalEntries() {
  let entries = getAllJournalEntries();
  if (state.journalSearch) {
    entries = entries.filter((entry) => normalizeText(`${entry.event} ${entry.market} ${entry.selection} ${entry.bookmaker}`).includes(normalizeText(state.journalSearch)));
  }
  if (state.journalStatusFilter) entries = entries.filter((entry) => (entry.status || 'pending') === state.journalStatusFilter);
  if (state.journalBookmakerFilter) entries = entries.filter((entry) => entry.bookmaker === state.journalBookmakerFilter);
  return entries;
}

function statusClass(status) {
  if (status === 'won') return 'pill--good';
  if (status === 'lost') return 'pill--warn';
  return '';
}

export function renderJournal() {
  const list = $('#journal-list');
  const entries = getFilteredJournalEntries();
  list.innerHTML = '';

  const bookmakerFilter = $('#journal-bookmaker-filter');
  const bookmakers = [...new Set(getAllJournalEntries().map((entry) => entry.bookmaker).filter(Boolean))].sort();
  const currentValue = bookmakerFilter.value;
  bookmakerFilter.innerHTML = '<option value="">All bookmakers</option>' + bookmakers
    .map((bookmaker) => `<option value="${escapeHtml(bookmaker)}">${escapeHtml(bookmaker)}</option>`)
    .join('');
  bookmakerFilter.value = currentValue;

  if (entries.length === 0) {
    list.innerHTML = '<div class="state-panel"><div class="state-panel__copy"><span class="state-panel__eyebrow">Ledger empty</span><strong>No bets logged yet</strong><span>Save a price from the calculator or add an AI review candidate to start the journal.</span></div></div>';
    return;
  }

  entries.forEach((entry) => {
    const article = document.createElement('article');
    article.className = 'journal-card';
    article.dataset.id = entry.id || '';
    article.dataset.type = entry.type || 'manual';
    const status = entry.status || 'pending';
    const taxOwed = Number(entry.taxOwed || 0);
    const netAfterTax = Number.isFinite(Number(entry.netProfitAfterTax)) ? Number(entry.netProfitAfterTax) : null;
    const pnl = netAfterTax ?? (status === 'won'
      ? (Number(entry.stake || 0) * Number(entry.odds || 0) - Number(entry.stake || 0))
      : status === 'lost' ? -Number(entry.stake || 0) : 0);
    const settledMetrics = status !== 'pending'
      ? `<div class="value-card__metric"><span>P/L after tax</span><strong style="color:${pnl >= 0 ? 'var(--profit)' : 'var(--danger)'}">${formatMoney(pnl)}</strong></div><div class="value-card__metric"><span>Tax</span><strong>${formatMoney(taxOwed)}</strong></div>`
      : '';
    article.innerHTML = `
      <div class="journal-card__head">
        <div><h2 class="journal-card__title">${escapeHtml(entry.event)}</h2><div class="muted-line">${escapeHtml(entry.market)} · ${escapeHtml(entry.selection)} · ${bookmakerDot(entry.bookmaker)}${escapeHtml(entry.bookmaker)}</div></div>
        <span class="pill journal-card__status ${statusClass(status)}">${escapeHtml(status)}</span>
      </div>
      <div class="value-card__metric"><span>Odds</span><strong>${Number(entry.odds || 0).toFixed(2)}</strong></div>
      <div class="value-card__metric"><span>Stake</span><strong>${formatMoney(entry.stake || 0)}</strong></div>
      <div class="value-card__metric"><span>Saved</span><strong>${formatTime(entry.loggedAt || entry.timestamp)}</strong></div>
      ${settledMetrics}
      <div class="journal-card__actions"><button class="ghost-button" data-action="won" type="button">Settle won</button><button class="ghost-button" data-action="lost" type="button">Settle lost</button><button class="danger-button" data-action="remove" type="button">Remove</button></div>`;
    article.querySelector('[data-action="won"]').addEventListener('click', () => settleJournalEntry(article, entry, 'won'));
    article.querySelector('[data-action="lost"]').addEventListener('click', () => settleJournalEntry(article, entry, 'lost'));
    article.querySelector('[data-action="remove"]').addEventListener('click', () => removeJournalEntry(article, entry));
    list.appendChild(article);
  });
}

export function createLocalJournalEntry(entry) {
  const record = {
    id: `local-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    status: 'pending',
    ...entry,
  };
  state.localJournal.unshift(record);
  writeJournal();
  renderRegistry.journal();
  renderRegistry.betSlip();
}

export async function saveCalculatorSelection() {
  if (!state.selectedOdds) return;
  try {
    const response = await fetch('/api/bets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: state.selectedOdds.type || 'manual',
        event: state.selectedOdds.event,
        market: state.selectedOdds.market,
        selection: `${state.selectedOdds.outcome} @ ${state.selectedOdds.bookmaker}`,
        bookmaker: state.selectedOdds.bookmaker,
        odds: state.selectedOdds.odds,
        stake: Number($('#calc-stake').value || 100),
      }),
    });
    const payload = await response.json();
    if (response.ok && payload.id) {
      state.serverJournal.unshift(payload);
      state.analytics = null;
      renderRegistry.journal();
      renderRegistry.betSlip();
      toast('Saved to journal');
      renderRegistry.setPage?.('journal');
      return;
    }
  } catch {
    // Local fallback below preserves the position when the API is unavailable.
  }
  createLocalJournalEntry({
    type: state.selectedOdds.type || 'manual',
    event: state.selectedOdds.event,
    market: state.selectedOdds.market,
    selection: `${state.selectedOdds.outcome} @ ${state.selectedOdds.bookmaker}`,
    bookmaker: state.selectedOdds.bookmaker,
    odds: state.selectedOdds.odds,
    stake: Number($('#calc-stake').value || 100),
  });
  toast('Saved locally to journal');
  renderRegistry.setPage?.('journal');
}

export async function settleJournalEntry(card, entry, result) {
  if (entry.source === 'local') {
    state.localJournal = state.localJournal.map((item) => item.id === entry.id ? { ...item, status: result, result } : item);
    writeJournal();
    state.analytics = null;
    renderRegistry.journal();
    renderRegistry.betSlip();
    toast(`Bet settled: ${result}`);
    return;
  }
  try {
    const response = await fetch(`/api/bets/${entry.id}/settle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result }),
    });
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error || 'Failed');
    state.serverJournal = state.serverJournal.map((item) => item.id === entry.id ? payload : item);
    state.analytics = null;
    renderRegistry.journal();
    renderRegistry.betSlip();
    toast(`Bet settled: ${result}`);
  } catch (error) {
    showJournalError(card, `Settlement failed: ${error.message}`);
  }
}

export async function removeJournalEntry(card, entry) {
  if (entry.source === 'local') {
    state.localJournal = state.localJournal.filter((item) => item.id !== entry.id);
    writeJournal();
    state.analytics = null;
    renderRegistry.journal();
    renderRegistry.betSlip();
    toast('Bet removed');
    return;
  }
  try {
    const response = await fetch(`/api/bets/${entry.id}`, { method: 'DELETE' });
    const payload = await response.json();
    if (!response.ok || payload.ok !== true) throw new Error(payload.error || 'Failed');
    state.serverJournal = state.serverJournal.filter((item) => item.id !== entry.id);
    state.analytics = null;
    renderRegistry.journal();
    renderRegistry.betSlip();
    toast('Bet removed');
  } catch (error) {
    showJournalError(card, `Remove failed: ${error.message}`);
  }
}

export function showJournalError(card, message) {
  let node = card.querySelector('.journal-card__error');
  if (!node) {
    node = document.createElement('div');
    node.className = 'journal-card__error';
    node.setAttribute('role', 'alert');
    card.appendChild(node);
  }
  node.textContent = message;
}

export async function clearJournalEntries() {
  state.localJournal = [];
  writeJournal();
  state.analytics = null;
  renderRegistry.journal();
  renderRegistry.betSlip();
  toast('Local journal cleared');
}

export function exportJournalCsv() {
  const entries = getAllJournalEntries();
  const rows = [['ID', 'Event', 'Market', 'Selection', 'Bookmaker', 'Odds', 'Stake', 'Status', 'Type', 'Saved']];
  entries.forEach((entry) => rows.push([
    entry.id || '', entry.event || '', entry.market || '', entry.selection || '', entry.bookmaker || '',
    entry.odds || '', entry.stake || '', entry.status || 'pending', entry.type || 'manual', entry.loggedAt || entry.timestamp || '',
  ]));
  const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'journal.csv';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  toast('Journal exported');
}

export async function importJournalCsv(file) {
  if (!file) return;
  try {
    const csv = await file.text();
    const response = await fetch('/api/bets/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv }),
    });
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error || 'Import failed');
    const journal = await (await fetch('/api/bets')).json();
    state.serverJournal = journal.bets || [];
    state.analytics = null;
    renderRegistry.journal();
    renderRegistry.betSlip();
    toast(`Imported ${payload.imported} bets`);
  } catch (error) {
    toast(`Import failed: ${error.message}`);
  }
}
