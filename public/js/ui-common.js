/* global AudioContext, webkitAudioContext, Notification */
/**
 * Shared UI utilities: theme, sound, notifications, toasts, modal, bet slip,
 * favorites, keyboard shortcuts, activity timeline, status bar, desk overview,
 * page routing, and arb-change detection.
 */

import {
  state, renderRegistry, $, $$, escapeHtml, formatTime, formatMoney, formatPct,
  normalizeText, getVisiblePage, arbId, bookmakerColor, bookmakerDot,
  readJournal, writeJournal, getAllJournalEntries,
  readFavorites, saveFavorites, toggleFavorite, toggleHidden, sortBookmakers,
} from './state.js';

// ── Toast ──
export function toast(msg) {
  const c = $('#toast-container'); if (!c) return;
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  c.appendChild(t);
  requestAnimationFrame(() => t.classList.add('toast--show'));
  setTimeout(() => { t.classList.remove('toast--show'); setTimeout(() => t.remove(), 300); }, 2500);
}

// ── Activity timeline ──
export function logActivity(text, page) {
  state.activityLog.unshift({ text, page, at: new Date().toISOString() });
  if (state.activityLog.length > 5) state.activityLog.pop();
  renderActivityTimeline();
}

export function renderActivityTimeline() {
  const el = $('#activity-timeline'); if (!el) return;
  if (state.activityLog.length === 0) { el.innerHTML = ''; return; }
  el.innerHTML = state.activityLog.map((a) => `<div class="activity-item" data-nav="${a.page}"><span class="activity-time">${formatTime(a.at).split(' ')[1]}</span> ${escapeHtml(a.text)}</div>`).join('');
  el.querySelectorAll('.activity-item').forEach((item) => item.addEventListener('click', () => setPage(item.dataset.nav)));
}

// ── Arb change detection ──
export function detectArbChanges(newOpps) {
  const newIds = new Set(newOpps.map(arbId));
  const appeared = newOpps.filter((o) => !state.prevOppIds.has(arbId(o)));
  state.prevOppIds = newIds;
  return { appeared, disappeared: [...state.prevOppIds].filter((id) => !newIds.has(id)), newIds };
}

// ── Service worker ──
export function initServiceWorker() { if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {}); }

// ── Arb modal ──
export function openArbModal(opp) {
  const overlay = $('#arb-modal-overlay');
  $('#arb-modal-title').textContent = opp.eventName || 'Unknown';
  $('#arb-modal-subtitle').textContent = `${opp.marketLabel || opp.marketKey || ''} · ${opp.competition || ''} · Edge ${formatPct(opp.edge)}`;
  const legs = opp.legs || [];
  const stake = opp.stake || 100;
  const totalProb = legs.reduce((s, l) => s + (1 / l.price), 0);
  $('#arb-modal-body').innerHTML = `
    <div class="modal-summary">
      <div class="value-card__metric"><span>Total stake</span><strong>${formatMoney(stake)}</strong></div>
      <div class="value-card__metric"><span>Return</span><strong>${formatMoney(stake / totalProb)}</strong></div>
      <div class="value-card__metric"><span>Profit</span><strong style="color:var(--profit)">+${formatMoney(opp.profit)}</strong></div>
      <div class="value-card__metric"><span>Edge</span><strong>${formatPct(opp.edge)}</strong></div>
    </div><hr style="border-color:var(--line);margin:12px 0">
    ${legs.map((leg) => {
      const ls = (stake * (1 / leg.price)) / totalProb;
      const lr = ls * leg.price;
      const url = leg.url || '';
      return `<div class="modal-leg"><div class="modal-leg__head"><div>${bookmakerDot(leg.bookmaker)} <strong>${escapeHtml(leg.label || leg.outcome)}</strong><span class="muted-line">${escapeHtml(leg.bookmaker)} @ ${Number(leg.price).toFixed(2)}</span></div><div class="modal-leg__stake"><span>Stake</span><strong>${formatMoney(ls)}</strong><span>Return</span><strong>${formatMoney(lr)}</strong></div></div><div class="modal-leg__actions">${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="modal__deep-link">Open →</a>` : '<span class="muted-line">No link</span>'}<button class="ghost-button modal-copy-btn" data-stake="${ls.toFixed(2)}" type="button">Copy</button><button class="ghost-button modal-journal-btn" data-event="${escapeHtml(opp.eventName || '')}" data-market="${escapeHtml(leg.label || leg.outcome || '')}" data-selection="${escapeHtml(leg.label || leg.outcome || '')} @ ${escapeHtml(leg.bookmaker)}" data-bookmaker="${escapeHtml(leg.bookmaker)}" data-odds="${leg.price}" type="button">Save</button></div></div>`;
    }).join('')}`;
  $('#arb-modal-body').querySelectorAll('.modal-copy-btn').forEach((b) => b.addEventListener('click', () => {
    navigator.clipboard.writeText(b.dataset.stake).then(() => { toast('Stake copied'); b.textContent = 'Copied!'; setTimeout(() => b.textContent = 'Copy', 1500); }).catch(() => {});
  }));
  $('#arb-modal-body').querySelectorAll('.modal-journal-btn').forEach((b) => b.addEventListener('click', () => {
    // createLocalJournalEntry is injected via registry to avoid circular import
    renderRegistry.createLocalJournalEntry?.({
      type: 'arb-leg', event: b.dataset.event, market: b.dataset.market,
      selection: b.dataset.selection, bookmaker: b.dataset.bookmaker, odds: Number(b.dataset.odds), stake: 100,
    });
    toast('Saved to journal'); b.textContent = 'Saved!'; b.disabled = true;
  }));
  overlay.hidden = false;
}

export function closeArbModal() { $('#arb-modal-overlay').hidden = true; }

// ── Theme ──
export function initTheme() { applyTheme(localStorage.getItem('arbDeskTheme') || 'system'); }
export function resolveTheme(t) { return t === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : t; }
export function applyTheme(t) {
  document.documentElement.dataset.theme = resolveTheme(t);
  document.documentElement.dataset.themeChoice = t;
  localStorage.setItem('arbDeskTheme', t);
  document.querySelectorAll('.theme-toggle svg').forEach((s) => s.style.display = 'none');
  const ai = document.querySelector(`.theme-toggle .icon-${t}`);
  if (ai) ai.style.display = 'block';
  if (t === 'system') {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.onchange = () => { document.documentElement.dataset.theme = resolveTheme('system'); };
  }
}
export function cycleTheme() {
  const c = localStorage.getItem('arbDeskTheme') || 'dark';
  const o = ['dark', 'light', 'system'];
  applyTheme(o[(o.indexOf(c) + 1) % o.length]);
}

// ── Sound ──
export function initSound() {
  const s = localStorage.getItem('arbDeskSound');
  state.soundEnabled = s === null ? true : s === 'true';
  const t = $('#sound-alert-toggle');
  if (t) t.checked = state.soundEnabled;
}
export function toggleSound() { state.soundEnabled = !state.soundEnabled; localStorage.setItem('arbDeskSound', String(state.soundEnabled)); }
export function playAlertSound() {
  if (!state.soundEnabled) return;
  const n = Date.now(); if (n - state.lastSoundMs < 3000) return; state.lastSoundMs = n;
  try {
    if (!state.audioCtx) state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const c = state.audioCtx;
    const o = c.createOscillator(); const g = c.createGain();
    o.connect(g); g.connect(c.destination);
    o.frequency.setValueAtTime(880, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(1320, c.currentTime + 0.15);
    g.gain.setValueAtTime(0.15, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.01, c.currentTime + 0.3);
    o.start(c.currentTime); o.stop(c.currentTime + 0.3);
  } catch { /* silent */ }
}

// ── Notifications ──
export function initNotifications() { if (!('Notification' in window)) return; if (Notification.permission === 'default') Notification.requestPermission(); }
export function notifyHighEdge(o) { if (!('Notification' in window) || Notification.permission !== 'granted') return; new Notification(`Arb alert: ${(o.edge * 100).toFixed(1)}% edge`, { body: `${o.eventName} — ${o.marketLabel || o.marketKey}` }); }
export function triggerAlerts(opps) {
  const th = state.alertThreshold / 100; let a = false;
  opps.forEach((o) => { if (o.edge >= th) { notifyHighEdge(o); a = true; } });
  if (a) playAlertSound();
}

// ── Dense view ──
export function initDense() { const d = localStorage.getItem('arbDeskDense') === 'true'; state.denseView = d; const t = $('#dense-view-toggle'); if (t) t.checked = d; }
export function toggleDense() {
  state.denseView = !state.denseView;
  localStorage.setItem('arbDeskDense', String(state.denseView));
  document.body.classList.toggle('dense-view', state.denseView);
  renderRegistry.scanner();
}

// ── Status & overview ──
export function renderStatus() {
  $('#data-mode').textContent = state.mode === 'live' ? 'Live data' : state.mode === 'demo' ? 'Demo data' : 'Offline';
  $('#live-dot').dataset.mode = state.mode;
  $('#last-updated').textContent = `Updated ${formatTime(state.fetchedAt)}`;
  const warning = $('#warning');
  if (state.warnings.length > 0) { warning.hidden = false; $('#warning-title').textContent = 'Warning:'; $('#warning-text').textContent = state.warnings.join(' · '); }
  else { warning.hidden = true; }
  renderDeskOverview();
}

export function renderDeskOverview() {
  const el = $('#desk-overview'); if (!el) return;
  const opps = state.opportunities || [];
  const events = state.events || [];
  const best = opps.reduce((top, opp) => Number(opp.edge || 0) > Number(top?.edge || 0) ? opp : top, null);
  const trusted = opps.filter((opp) => opp.confidence === 'trusted').length;
  const pending = getAllJournalEntries().filter((entry) => (entry.status || 'pending') === 'pending');
  const pendingStake = pending.reduce((total, entry) => total + (Number(entry.stake) || 0), 0);
  el.innerHTML = [
    { label: 'Best edge', value: best ? formatPct(best.edge, 2) : '0.00%', hint: best?.eventName || 'No open edge' },
    { label: 'Open arbs', value: String(opps.length), hint: `${trusted} trusted` },
    { label: 'Events covered', value: String(events.length), hint: state.mode === 'live' ? 'Live feed' : 'Demo feed' },
    { label: 'Pending stake', value: formatMoney(pendingStake), hint: `${pending.length} active positions` },
  ].map((item) => `
    <article class="overview-cell">
      <span class="overview-cell__label">${escapeHtml(item.label)}</span>
      <strong class="overview-cell__value">${escapeHtml(item.value)}</strong>
      <span class="overview-cell__hint">${escapeHtml(item.hint)}</span>
    </article>
  `).join('');
}

// ── Page routing ──
export function setPage(page, push = true) {
  state.page = PAGE_ROUTES.includes(page) ? page : 'scanner';
  const vp = getVisiblePage();
  $$('.page').forEach((n) => n.classList.toggle('page--hidden', n.dataset.page !== vp));
  $$('[data-nav]').forEach((b) => b.classList.toggle('is-active', b.dataset.nav === vp));
  if (push) { const t = vp === 'scanner' ? '' : `/${vp}`; history.replaceState({}, '', t); }
  if (vp === 'analytics' && !state.analytics) renderRegistry.loadAnalytics?.();
  if (vp === 'movement' && !state.movement) renderRegistry.loadMovement?.();
  renderRegistry.betSlip();
}

// ── Bet slip ──
export function toggleBetSlip() {
  const drawer = $('#bet-slip-drawer');
  drawer.dataset.open = String(drawer.dataset.open !== 'true');
}

export function renderBetSlip() {
  const list = $('#bet-slip-list'); if (!list) return;
  const pending = getAllJournalEntries().filter((e) => (e.status || 'pending') === 'pending');
  $('#bet-slip-count').textContent = pending.length;
  if (pending.length === 0) { list.innerHTML = '<div class="state-panel" style="padding:12px">No active positions.</div>'; return; }
  list.innerHTML = pending.map((e) => {
    const event = state.events.find((ev) => `${ev.homeTeam} vs ${ev.awayTeam}` === e.event);
    let liveOdds = null;
    if (event) {
      for (const bm of event.bookmakers || []) {
        if (bm.name === e.bookmaker) {
          for (const [mk, outcomes] of Object.entries(bm.markets || {})) {
            for (const [o, od] of Object.entries(outcomes || {})) {
              if (o === e.selection?.split(' @ ')[0] || e.selection?.includes(o)) { liveOdds = od; }
            }
          }
        }
      }
    }
    const moved = liveOdds && Number(liveOdds) !== Number(e.odds);
    const movedClass = moved ? (Number(liveOdds) > Number(e.odds) ? 'bet-slip-up' : 'bet-slip-down') : '';
    return `<div class="bet-slip-item ${movedClass}"><div><strong>${escapeHtml(e.event)}</strong></div><div class="muted-line">${bookmakerDot(e.bookmaker)} ${escapeHtml(e.bookmaker)} · ${escapeHtml(e.selection || '')} @ ${Number(e.odds).toFixed(2)}${moved ? ` → ${Number(liveOdds).toFixed(2)}` : ''}</div><div class="muted-line">Stake: ${formatMoney(e.stake || 0)}</div></div>`;
  }).join('');
}

// ── Keyboard shortcuts ──
export function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') {
      if (e.key === 'Escape') { e.target.blur(); }
      return;
    }
    const key = e.key.toLowerCase();
    if (key === 'r') { e.preventDefault(); renderRegistry.loadData?.(true); }
    else if (key === '/') { e.preventDefault(); $('#search').focus(); }
    else if (key === 's') { if (state.selectedOdds) renderRegistry.saveCalculatorSelection?.(); }
    else if (key === 'f') { const cb = $('#show-favorites-only'); if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); } }
    else if (key === 'd') { toggleDense(); }
    else if (key === 'escape') { state.search = ''; $('#search').value = ''; renderRegistry.allPages(); closeArbModal(); }
    else if (key >= '1' && key <= '9') {
      const idx = Number(key) - 1;
      if (PAGE_ROUTES[idx]) setPage(PAGE_ROUTES[idx]);
    }
  });
}
