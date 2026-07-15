/* global AudioContext, webkitAudioContext */
/**
 * Global state, constants, and pure helpers.
 * This is the single source of truth for all page modules.
 */

import {
  MARKET_TYPES,
  MARKET_TYPE_KEYS,
  classifyOpportunityMarketType,
  marketTypeLabel,
} from './market-types.js?v=12';
import {
  areAllMarketTypesSelected as scannerAreAllMarketTypesSelected,
  getFilteredScannerOpportunities,
  getScannerMarketTypeCounts as scannerMarketTypeCounts,
  getScannerTabBaseOpportunities as scannerTabBaseOpportunities,
  getScannerTabCounts as scannerTabCounts,
  getScannerTabOpportunities as scannerTabOpportunities,
  getSelectedMarketTypes as scannerSelectedMarketTypes,
  isMarketTypeSelected as scannerIsMarketTypeSelected,
  isMiddleOpportunity,
  resetSelectedMarketTypes as scannerResetSelectedMarketTypes,
  setSelectedMarketTypes as scannerSetSelectedMarketTypes,
  toggleMarketTypeSelection as scannerToggleMarketTypeSelection,
} from './scanner-filters.js?v=12';

export { MARKET_TYPES, MARKET_TYPE_KEYS, classifyOpportunityMarketType, marketTypeLabel };
export { isMiddleOpportunity };

export const BET_JOURNAL_KEY = 'arbDeskBetJournal';
export const THEME_KEY = 'arbDeskTheme';
export const FAVORITES_KEY = 'arbDeskBookmakerFavorites';
export const HIDDEN_KEY = 'arbDeskBookmakerHidden';
export const SOUND_KEY = 'arbDeskSound';
export const DENSE_KEY = 'arbDeskDense';
export const PAGE_ROUTES = ['scanner', 'value', 'ai', 'calculator', 'journal', 'analytics', 'movement', 'bookmakers', 'matches'];
export const TAX_THRESHOLD_RON = 10000;
export const TAX_RATE = 0.03;

export const BOOKMAKER_COLORS = {
  Fortuna: '#e30613', 'Casa Pariurilor': '#0066b3', Superbet: '#ffcc00', BetOne: '#1cb564',
  Betfair: '#ffb80e', Betmen: '#0099cc', GetsBet: '#e31837', Winner: '#f47b20',
  '888': '#0073cf', MrPlay: '#1abc9c', Bet7: '#ff6b35', HotSpins: '#ff4757',
  EliteSlots: '#9b59b6', LasVegas: '#e74c3c', MaxBet: '#2ecc71', NetBet: '#3498db',
  Winbet: '#e67e22', VivaBet: '#1abc9c', LuckySeven: '#f39c12', Unibet: '#0a9e01',
  Betano: '#003e7e', Prowin: '#c0392b', CherryBet: '#e91e63', VipBet: '#8e44ad',
};

export const state = {
  page: 'scanner', mode: 'loading', fetchedAt: null, warnings: [], search: '', sport: '',
  minEdge: 0, alertThreshold: 1, scannerVerificationFilter: '', scannerTab: 'actionable', denseView: false,
  scannerVisibleLimit: 50,
  selectedMarketTypes: new Set(MARKET_TYPE_KEYS),
  events: [], opportunities: [], prevOppIds: new Set(), valueBets: [], bookmakerCoverage: null,
  localJournal: [], serverJournal: [], analytics: null, movement: null, arbHistory: null,
  selectedOdds: null, refreshIntervalMs: 60000, refreshTimer: null, stream: null, lastLoadOk: false,
  favorites: [], hiddenBookmakers: [], favoritesOnly: false, showAllMarkets: false,
  soundEnabled: true, audioCtx: null, lastSoundMs: 0,
  pinnedArbs: new Set(), activityLog: [],
  journalSearch: '', journalStatusFilter: '', journalBookmakerFilter: '',
};

/** Registry for cross-module render callbacks. Populated by app.js after imports. */
export const renderRegistry = {
  allPages: () => {},
  scanner: () => {},
  value: () => {},
  ai: () => {},
  calculator: () => {},
  journal: () => {},
  bookmakers: () => {},
  matches: () => {},
  deskOverview: () => {},
  analytics: () => {},
  movement: () => {},
  betSlip: () => {},
  status: () => {},
};

export const $ = (s) => document.querySelector(s);
export const $$ = (s) => [...document.querySelectorAll(s)];

export function escapeHtml(v) {
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function formatTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleDateString('ro-RO', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
}
export function formatMoney(v) { return `${Number(v || 0).toFixed(2)} RON`; }
export function formatPct(v, d = 1) { return `${(Number(v || 0) * 100).toFixed(d)}%`; }
export function normalizeText(v) { return String(v || '').toLowerCase().trim(); }
export function getVisiblePage() { return PAGE_ROUTES.includes(state.page) ? state.page : 'scanner'; }
export function arbId(opp) { return `${opp.eventName}|${opp.marketKey}`; }
export function bookmakerColor(name) { return BOOKMAKER_COLORS[name] || `hsl(${[...name].reduce((h, c) => h + c.charCodeAt(0), 0) % 360},65%,55%)`; }
export function bookmakerDot(name) { return `<span class="bm-dot" style="background:${bookmakerColor(name)}"></span>`; }
export function csvEscape(v) {
  const t = String(v ?? '');
  if (/[",\n]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}
export function gcd(a, b) { return b ? gcd(b, a % b) : a; }

export function activeSearchMatch(...p) { return !state.search || normalizeText(p.join(' ')).includes(state.search); }

export function getFilteredEvents() { return state.events.filter((e) => activeSearchMatch(e.homeTeam, e.awayTeam, e.competition, e.sport)); }

export function getFilteredOpportunities() {
  return getFilteredScannerOpportunities(state);
}

export function getSelectedMarketTypes() {
  return scannerSelectedMarketTypes(state);
}

export function setSelectedMarketTypes(keys) {
  scannerSetSelectedMarketTypes(state, keys);
}

export function resetSelectedMarketTypes() {
  scannerResetSelectedMarketTypes(state);
}

export function toggleMarketTypeSelection(key, selected) {
  scannerToggleMarketTypeSelection(state, key, selected);
}

export function areAllMarketTypesSelected() {
  return scannerAreAllMarketTypesSelected(state);
}

export function isMarketTypeSelected(key) {
  return scannerIsMarketTypeSelected(state, key);
}

export function getScannerTabBaseOpportunities(tab = state.scannerTab) {
  return scannerTabBaseOpportunities(state, tab);
}

export function getScannerTabOpportunities(tab = state.scannerTab, { includeMarketTypeFilter = true } = {}) {
  return scannerTabOpportunities(state, tab, { includeMarketTypeFilter });
}

export function getScannerTabCounts() {
  return scannerTabCounts(state);
}

export function getScannerMarketTypeCounts(tab = state.scannerTab) {
  return scannerMarketTypeCounts(state, tab);
}

export function getFilteredValueBets() { return state.valueBets.filter((b) => activeSearchMatch(b.eventName, b.marketLabel, b.bookmaker)); }

export function getAllJournalEntries() {
  const l = state.localJournal.map((e) => ({ ...e, source: 'local' }));
  const s = state.serverJournal.map((e) => ({ ...e, source: 'server' }));
  return [...s, ...l].sort((a, b) => new Date(b.loggedAt || b.timestamp || 0) - new Date(a.loggedAt || a.timestamp || 0));
}

export function readJournal() {
  try {
    state.localJournal = JSON.parse(localStorage.getItem(BET_JOURNAL_KEY) || '[]');
    if (!Array.isArray(state.localJournal)) state.localJournal = [];
  } catch { state.localJournal = []; }
}
export function writeJournal() { localStorage.setItem(BET_JOURNAL_KEY, JSON.stringify(state.localJournal)); }

export function readFavorites() {
  try {
    state.favorites = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
    state.hiddenBookmakers = JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]');
  } catch { state.favorites = []; state.hiddenBookmakers = []; }
}
export function saveFavorites() {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(state.favorites));
  localStorage.setItem(HIDDEN_KEY, JSON.stringify(state.hiddenBookmakers));
}
export function toggleFavorite(n) { const i = state.favorites.indexOf(n); if (i >= 0) state.favorites.splice(i, 1); else state.favorites.push(n); saveFavorites(); }
export function toggleHidden(n) { const i = state.hiddenBookmakers.indexOf(n); if (i >= 0) state.hiddenBookmakers.splice(i, 1); else state.hiddenBookmakers.push(n); saveFavorites(); }
export function sortBookmakers(bms) {
  return bms.filter((b) => !state.hiddenBookmakers.includes(b.name)).sort((a, b) => {
    const af = state.favorites.includes(a.name), bf = state.favorites.includes(b.name);
    if (af && !bf) return -1;
    if (!af && bf) return 1;
    return a.name.localeCompare(b.name);
  });
}
