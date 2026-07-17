/**
 * Entry point: orchestrates data loading, rendering, event binding, and init.
 */

import {
  state, renderRegistry, PAGE_ROUTES, MARKET_TYPE_KEYS,
  readJournal, readFavorites, resetSelectedMarketTypes, setSelectedMarketTypes,
  toggleMarketTypeSelection,
} from './state.js?v=12';
import { fetchJson } from './api.js?v=12';
import {
  initTheme, initSound, initNotifications, initServiceWorker, initDense,
  initKeyboardShortcuts,
  renderStatus, renderDeskOverview, renderBetSlip, setPage, toggleDense,
  toggleSound, cycleTheme, toggleBetSlip, closeArbModal, openArbModal, toast, logActivity,
  detectArbChanges, triggerAlerts,
} from './ui-common.js?v=18';

import { renderScanner, renderArbHistory, exportCsv } from './pages/scanner.js?v=12';
import { renderValue, renderAi } from './pages/value-bets.js?v=12';
import {
  renderCalculator, loadSelectionIntoCalculator, updateLoadedSelection,
  renderProbCalculator, renderAutoStake, addDutchLeg, renderDutchSummary,
  renderArbCheck, renderTaxCalculator, renderNoVig, renderMiddle, renderConverter,
} from './pages/calculator.js?v=12';
import {
  renderJournal, createLocalJournalEntry, saveCalculatorSelection,
  settleJournalEntry, removeJournalEntry, clearJournalEntries,
  exportJournalCsv, importJournalCsv, getFilteredJournalEntries,
} from './pages/journal.js?v=12';
import { renderAnalytics } from './pages/analytics.js?v=12';
import { renderMovement } from './pages/movement.js?v=12';
import { renderBookmakers } from './pages/bookmakers.js?v=12';
import { renderMatches } from './pages/matches.js?v=12';
import { loadAnalyticsData, loadMovementData, loadArbHistoryData, logArbHistoryData } from './api.js?v=12';

// ── Wire render registry so modules can call each other without circular imports ──
renderRegistry.allPages = renderAllPages;
renderRegistry.scanner = renderScanner;
renderRegistry.value = renderValue;
renderRegistry.ai = renderAi;
renderRegistry.calculator = renderCalculator;
renderRegistry.journal = renderJournal;
renderRegistry.bookmakers = renderBookmakers;
renderRegistry.matches = renderMatches;
renderRegistry.deskOverview = renderDeskOverview;
renderRegistry.analytics = renderAnalytics;
renderRegistry.movement = renderMovement;
renderRegistry.betSlip = renderBetSlip;
renderRegistry.status = renderStatus;
renderRegistry.setPage = setPage;
renderRegistry.loadData = loadData;
renderRegistry.loadSelectionIntoCalculator = loadSelectionIntoCalculator;
renderRegistry.createLocalJournalEntry = createLocalJournalEntry;
renderRegistry.saveCalculatorSelection = saveCalculatorSelection;
renderRegistry.loadAnalytics = loadAnalyticsPage;
renderRegistry.loadMovement = loadMovementPage;

// ── Data orchestration ──
async function loadData(refresh = false) {
  const loading = document.querySelector('#loading');
  const error = document.querySelector('#error');
  const emptyState = document.querySelector('#empty-state');
  const mainContent = document.querySelector('#main-content');
  const refreshBtn = document.querySelector('#refresh-btn');
  const dataMode = document.querySelector('#data-mode');
  const errorMsg = document.querySelector('#error-msg');
  let slowLoadTimer = null;

  if (loading) loading.hidden = false;
  if (error) error.hidden = true;
  if (emptyState) emptyState.hidden = true;
  if (mainContent) mainContent.setAttribute('aria-busy', 'true');
  if (refreshBtn) refreshBtn.disabled = true;
  if (dataMode) dataMode.textContent = 'Loading';
  slowLoadTimer = setTimeout(() => {
    const detail = loading?.querySelector('.state-panel__copy > span:last-child');
    if (detail) detail.textContent = 'This is taking longer than expected. The desk is still waiting for the local odds source.';
  }, 15_000);

  try {
    const p = new URLSearchParams();
    if (refresh) p.set('refresh', '1');
    if (state.sport) p.set('sport', state.sport);
    const oddsUrl = `/api/odds${p.toString() ? `?${p}` : ''}`;
    const [odds, opps, vb, bm, jr] = await Promise.all([
      fetchJson(oddsUrl),
      fetchJson('/api/opportunities?sort=edge'),
      fetchJson('/api/value-bets?limit=24'),
      fetchJson('/api/bookmakers'),
      fetchJson('/api/bets'),
    ]);
    state.mode = odds.mode || 'demo';
    state.fetchedAt = odds.fetchedAt || new Date().toISOString();
    state.warnings = odds.warnings || [];
    state.events = odds.events || [];
    state.opportunities = opps.opportunities || [];
    state.valueBets = vb.valueBets || [];
    state.bookmakerCoverage = bm;
    state.serverJournal = jr.bets || [];
    state.lastLoadOk = true;
    const hasData = state.events.length > 0 || state.opportunities.length > 0 || state.valueBets.length > 0;
    if (emptyState) emptyState.hidden = hasData;

    const actionable = state.opportunities.filter((opportunity) => opportunity.eligibility === 'actionable');
    const changes = detectArbChanges(actionable);
    if (changes.appeared.length > 0) logActivity(`${changes.appeared.length} new actionable arb${changes.appeared.length === 1 ? '' : 's'}`, 'scanner');

    renderStatus();
    renderAllPages();
    if (loading) loading.hidden = true;
    triggerAlerts(state.opportunities);
  } catch (e) {
    console.error('ArbiEdge load failed', e);
    state.lastLoadOk = false;
    if (loading) loading.hidden = true;
    if (error) error.hidden = false;
    if (errorMsg) errorMsg.textContent = e.message || 'Unknown error';
    error?.setAttribute('tabindex', '-1');
    error?.focus();
  } finally {
    clearTimeout(slowLoadTimer);
    if (mainContent) mainContent.setAttribute('aria-busy', 'false');
    if (refreshBtn) refreshBtn.disabled = false;
  }
}

async function refreshOpportunities() {
  try {
    const [o, v] = await Promise.all([
      fetchJson('/api/opportunities?sort=edge'),
      fetchJson('/api/value-bets?limit=24'),
    ]);
    state.opportunities = o.opportunities || [];
    state.valueBets = v.valueBets || [];
    const actionable = state.opportunities.filter((opportunity) => opportunity.eligibility === 'actionable');
    const ch = detectArbChanges(actionable);
    if (ch.appeared.length > 0) logActivity(`${ch.appeared.length} new actionable arb${ch.appeared.length === 1 ? '' : 's'}`, 'scanner');
    renderScanner();
    renderValue();
    renderAi();
    triggerAlerts(state.opportunities);
  } catch { /* silent */ }
}

function connectStream() {
  if (state.stream) { state.stream.abort(); state.stream = null; }
  try {
    const c = new AbortController();
    state.stream = c;
    const p = new URLSearchParams();
    if (state.sport) p.set('sport', state.sport);
    fetch(`/api/odds/stream${p.toString() ? `?${p}` : ''}`, { signal: c.signal })
      .then(async (r) => {
        if (!r.ok) return;
        const rd = r.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        while (true) {
          const { done, value } = await rd.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const ls = buf.split('\n');
          buf = ls.pop() || '';
          for (const l of ls) {
            if (!l.trim()) continue;
            try { handleStreamSnapshot(JSON.parse(l)); } catch { /* skip bad line */ }
          }
        }
      }).catch(() => {});
  } catch { /* silent */ }
}

function handleStreamSnapshot(s) {
  if (!s || !s.events) return;
  state.mode = s.mode || state.mode;
  state.fetchedAt = s.fetchedAt || state.fetchedAt;
  state.warnings = s.warnings || [];
  state.events = s.events;
  refreshOpportunities();
  renderStatus();
  renderAllPages();
}

async function loadAnalyticsPage() {
  try { state.analytics = await loadAnalyticsData(); renderAnalytics(); } catch {
    document.querySelector('#analytics-summary').innerHTML = '<div class="state-panel">Unable to load analytics.</div>';
  }
}

async function loadMovementPage() {
  try { state.movement = await loadMovementData(); renderMovement(); } catch {
    document.querySelector('#movement-list').innerHTML = '<div class="state-panel">Odds movement tracking not available yet.</div>';
  }
}

async function loadArbHistoryPage() {
  try { state.arbHistory = await loadArbHistoryData(); renderArbHistory(); } catch {
    document.querySelector('#arb-history-list').innerHTML = '<div class="state-panel">Unable to load arb history.</div>';
  }
}

// ── Rendering orchestration ──
function renderAllPages() {
  renderScanner();
  renderValue();
  renderAi();
  renderCalculator();
  renderJournal();
  renderBookmakers();
  renderMatches();
  renderDeskOverview();
  setPage(state.page, false);
}

// ── Auto refresh ──
function setupAutoRefresh() {
  if (state.refreshTimer) { clearInterval(state.refreshTimer); state.refreshTimer = null; }
  const s = document.querySelector('#refresh-interval');
  if (!s) return;
  const sec = Number(s.value || 0);
  state.refreshIntervalMs = sec * 1000;
  if (sec > 0) state.refreshTimer = setInterval(() => loadData(false), state.refreshIntervalMs);
}

// ── Event binding ──
function bindEvents() {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  $$('[data-nav]').forEach((b) => b.addEventListener('click', () => setPage(b.dataset.nav)));
  $('#search').addEventListener('input', (e) => { state.search = e.target.value.toLowerCase().trim(); renderAllPages(); });
  $('#sport-selector').addEventListener('change', async (e) => { state.sport = e.target.value; await loadData(true); });
  $('#refresh-btn').addEventListener('click', () => loadData(true));
  $('#retry-btn').addEventListener('click', () => loadData(false));
  $('#empty-refresh').addEventListener('click', () => loadData(true));
  $('#refresh-interval').addEventListener('change', setupAutoRefresh);
  $('#filter-min-edge').addEventListener('input', (e) => { state.minEdge = Number(e.target.value || 0); state.scannerVisibleLimit = 50; renderScanner(); });
  $('#alert-threshold').addEventListener('input', (e) => { state.alertThreshold = Number(e.target.value || 1); });
  $('#verification-filter').addEventListener('change', (e) => { state.scannerVerificationFilter = e.target.value; state.scannerVisibleLimit = 50; renderScanner(); });
  $$('[data-scanner-tab]').forEach((b) => b.addEventListener('click', () => {
    const requestedTab = b.dataset.scannerTab;
    state.scannerTab = ['actionable', 'review', 'rejected', 'middles'].includes(requestedTab)
      ? requestedTab
      : 'actionable';
    state.scannerVisibleLimit = 50;
    renderScanner();
  }));
  const marketFilter = $('#scanner-market-filter');
  const marketToggle = $('#market-filter-toggle');
  const marketMenu = $('#market-filter-menu');
  marketToggle?.addEventListener('click', (e) => {
    if (!marketMenu) return;
    e.stopPropagation();
    marketMenu.hidden = !marketMenu.hidden;
    marketToggle.setAttribute('aria-expanded', marketMenu.hidden ? 'false' : 'true');
    renderScanner();
  });
  marketMenu?.addEventListener('click', (e) => {
    const action = e.target.closest('[data-market-filter-action]')?.dataset.marketFilterAction;
    if (!action) return;
    e.preventDefault();
    if (action === 'none') setSelectedMarketTypes([]);
    else setSelectedMarketTypes(MARKET_TYPE_KEYS);
    state.scannerVisibleLimit = 50;
    renderScanner();
  });
  marketMenu?.addEventListener('change', (e) => {
    if (!e.target.matches('[data-market-type]')) return;
    toggleMarketTypeSelection(e.target.dataset.marketType, e.target.checked);
    state.scannerVisibleLimit = 50;
    renderScanner();
  });
  document.addEventListener('click', (e) => {
    if (!marketFilter || !marketMenu || marketMenu.hidden || marketFilter.contains(e.target)) return;
    marketMenu.hidden = true;
    marketToggle?.setAttribute('aria-expanded', 'false');
  });
  $('#dense-view-toggle').addEventListener('change', toggleDense);
  $('#filter-reset').addEventListener('click', () => {
    state.minEdge = 0; $('#filter-min-edge').value = '0'; $('#search').value = '';
    state.search = ''; state.scannerVerificationFilter = ''; $('#verification-filter').value = '';
    state.scannerVisibleLimit = 50;
    resetSelectedMarketTypes();
    renderAllPages();
  });
  $('#export-csv').addEventListener('click', exportCsv);
  // Arb history
  $('#arb-history-refresh').addEventListener('click', loadArbHistoryPage);
  $('#arb-history-clear').addEventListener('click', () => { state.arbHistory = { records: [], total: 0 }; renderArbHistory(); });
  // Favorites & markets
  $('#show-favorites-only').addEventListener('change', (e) => { state.favoritesOnly = e.target.checked; renderMatches(); });
  $('#show-all-markets').addEventListener('change', (e) => { state.showAllMarkets = e.target.checked; renderMatches(); });
  // Sound & theme
  $('#sound-alert-toggle').addEventListener('change', toggleSound);
  $('#theme-toggle').addEventListener('click', cycleTheme);
  // Calculator
  $('#dutch-add-leg').addEventListener('click', () => { addDutchLeg(); renderDutchSummary(); });
  $('#dutch-clear').addEventListener('click', () => { $('#dutch-legs').innerHTML = ''; renderDutchSummary(); });
  $('#dutch-stake').addEventListener('input', renderDutchSummary);
  $('#arb-check-btn').addEventListener('click', renderArbCheck);
  ['#tax-stake', '#tax-odds', '#tax-ytd'].forEach((s) => $(s).addEventListener('input', renderTaxCalculator));
  ['#novig-odds-1', '#novig-odds-x', '#novig-odds-2'].forEach((s) => $(s).addEventListener('input', renderNoVig));
  $('#mid-check-btn').addEventListener('click', renderMiddle);
  $('#conv-decimal').addEventListener('input', renderConverter);
  $('#calc-stake').addEventListener('input', () => { if (state.selectedOdds) state.selectedOdds.stake = Number($('#calc-stake').value || 100); });
  $('#calc-bankroll').addEventListener('input', renderProbCalculator);
  $('#calc-save').addEventListener('click', saveCalculatorSelection);
  $('#journal-clear').addEventListener('click', clearJournalEntries);
  $('#autostake-compute').addEventListener('click', renderAutoStake);
  $('#autostake-bankroll').addEventListener('input', renderAutoStake);
  $('#autostake-max-pct').addEventListener('input', renderAutoStake);
  // Quick stakes
  $$('.qs-btn').forEach((b) => b.addEventListener('click', () => {
    $('#calc-stake').value = b.dataset.stake;
    if (state.selectedOdds) state.selectedOdds.stake = Number(b.dataset.stake);
    renderProbCalculator();
  }));
  // Modal
  $('#arb-modal-close').addEventListener('click', closeArbModal);
  $('#arb-modal-overlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeArbModal(); });
  // Journal filters
  $('#journal-search').addEventListener('input', (e) => { state.journalSearch = e.target.value; renderJournal(); });
  $('#journal-status-filter').addEventListener('change', (e) => { state.journalStatusFilter = e.target.value; renderJournal(); });
  $('#journal-bookmaker-filter').addEventListener('change', (e) => { state.journalBookmakerFilter = e.target.value; renderJournal(); });
  $('#journal-export').addEventListener('click', exportJournalCsv);
  $('#journal-import').addEventListener('click', () => $('#journal-import-file').click());
  $('#journal-import-file').addEventListener('change', async (e) => { await importJournalCsv(e.target.files?.[0]); e.target.value = ''; });
  // Bet slip drawer
  $('#bet-slip-toggle').addEventListener('click', toggleBetSlip);
}

function routeFromLocation() {
  const s = location.pathname.replace(/^\/+/, '');
  return PAGE_ROUTES.includes(s) ? s : 'scanner';
}

async function init() {
  initTheme(); initSound(); initNotifications(); initServiceWorker(); initDense(); initKeyboardShortcuts();
  readJournal(); readFavorites(); bindEvents();
  if (state.denseView) document.body.classList.add('dense-view');
  state.page = routeFromLocation();
  renderNoVig(); renderTaxCalculator(); renderMiddle();
  await loadData(false);
  connectStream();
  setupAutoRefresh();
  const actionable = state.opportunities.filter((opportunity) => opportunity.eligibility === 'actionable');
  if (actionable.length > 0) logArbHistoryData(actionable);
  loadArbHistoryPage();
}

document.addEventListener('DOMContentLoaded', init);
