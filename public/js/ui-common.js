/* global Notification */
/** Shared UI behavior: routing, states, modal, theme, alerts, and bet slip. */

import {
  state, renderRegistry, PAGE_ROUTES, $, $$, escapeHtml, formatTime, formatMoney, formatPct,
  getVisiblePage, arbId, bookmakerDot, getAllJournalEntries,
} from './state.js?v=12';

let modalPreviousFocus = null;
let modalKeydownHandler = null;
let modalKeyupHandler = null;

export function toast(message) {
  const container = $('#toast-container');
  if (!container) return;
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = message;
  node.tabIndex = 0;
  container.appendChild(node);
  requestAnimationFrame(() => node.classList.add('toast--show'));

  let timer;
  const dismiss = () => {
    clearTimeout(timer);
    node.classList.remove('toast--show');
    setTimeout(() => node.remove(), 180);
  };
  const schedule = () => { timer = setTimeout(dismiss, 4200); };
  node.addEventListener('mouseenter', () => clearTimeout(timer));
  node.addEventListener('mouseleave', schedule);
  node.addEventListener('focusin', () => clearTimeout(timer));
  node.addEventListener('focusout', schedule);
  schedule();
}

export function logActivity(text, page) {
  state.activityLog.unshift({ text, page, at: new Date().toISOString() });
  if (state.activityLog.length > 5) state.activityLog.pop();
  renderActivityTimeline();
}

export function renderActivityTimeline() {
  const element = $('#activity-timeline');
  if (!element) return;
  if (state.activityLog.length === 0) {
    element.innerHTML = '';
    return;
  }
  element.innerHTML = state.activityLog.map((activity) => `
    <button class="activity-item" type="button" data-nav="${escapeHtml(activity.page)}">
      <span class="activity-time">${escapeHtml(formatTime(activity.at).split(' ')[1] || '')}</span>${escapeHtml(activity.text)}
    </button>`).join('');
  element.querySelectorAll('.activity-item').forEach((item) => item.addEventListener('click', () => setPage(item.dataset.nav)));
}

export function detectArbChanges(newOpportunities) {
  const previousIds = state.prevOppIds;
  const newIds = new Set(newOpportunities.map(arbId));
  const appeared = newOpportunities.filter((opportunity) => !previousIds.has(arbId(opportunity)));
  const disappeared = [...previousIds].filter((id) => !newIds.has(id));
  state.prevOppIds = newIds;
  return { appeared, disappeared, newIds };
}

export function initServiceWorker() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

function getFocusableElements(root) {
  return [...root.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')]
    .filter((element) => !element.hidden && element.getClientRects().length > 0);
}

export function openArbModal(opportunity, trigger = document.activeElement) {
  const overlay = $('#arb-modal-overlay');
  const title = $('#arb-modal-title');
  const subtitle = $('#arb-modal-subtitle');
  const body = $('#arb-modal-body');
  const legs = opportunity.legs || [];
  const stake = opportunity.stake || 100;
  const totalProbability = legs.reduce((sum, leg) => sum + (1 / leg.price), 0);
  const eligibility = opportunity.eligibility || (opportunity.type === 'middle' ? 'analysis' : 'review');
  const isActionable = eligibility === 'actionable';
  const isMiddle = eligibility === 'analysis';
  const reasons = opportunity.eligibilityReasons?.length
    ? opportunity.eligibilityReasons
    : isActionable ? ['Every leg passed the scanner actionability gate.'] : ['Evidence is incomplete.'];
  const eligibilityLabel = isActionable ? 'Actionable' : isMiddle ? 'Analysis only' : eligibility === 'rejected' ? 'Rejected' : 'Review required';

  title.textContent = opportunity.eventName || 'Unknown event';
  subtitle.textContent = `${opportunity.marketLabel || opportunity.marketKey || ''} · ${opportunity.competition || ''} · Edge ${formatPct(opportunity.edge)}`;
  body.innerHTML = `
    <div class="modal-eligibility modal-eligibility--${escapeHtml(eligibility)}">
      <strong>${escapeHtml(eligibilityLabel)}</strong>
      <ul>${reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>
    </div>
    <div class="modal-summary">
      <div class="value-card__metric"><span>${isActionable ? 'Total stake' : 'Model stake'}</span><strong>${formatMoney(stake)}</strong></div>
      <div class="value-card__metric"><span>${isActionable ? 'Guaranteed return' : 'Model return'}</span><strong>${formatMoney(stake / totalProbability)}</strong></div>
      <div class="value-card__metric"><span>${isActionable ? 'Guaranteed profit' : 'Model profit'}</span><strong${isActionable ? ' style="color:var(--profit)"' : ''}>${Number(opportunity.profit) >= 0 ? '+' : ''}${formatMoney(opportunity.profit)}</strong></div>
      <div class="value-card__metric"><span>Model edge</span><strong>${formatPct(opportunity.edge)}</strong></div>
    </div>
    ${legs.map((leg) => {
      const legStake = (stake * (1 / leg.price)) / totalProbability;
      const legReturn = legStake * leg.price;
      const deepLink = leg.url
        ? `<a href="${escapeHtml(leg.url)}" target="_blank" rel="noopener" class="modal__deep-link">Open bookmaker</a>`
        : '<span class="muted-line">No direct link</span>';
      return `
        <section class="modal-leg">
          <div class="modal-leg__head">
            <div>${bookmakerDot(leg.bookmaker)}<strong>${escapeHtml(leg.label || leg.outcome)}</strong><div class="muted-line">${escapeHtml(leg.bookmaker)} @ ${Number(leg.price).toFixed(2)} · ${escapeHtml(leg.verificationStatus || 'unverified')}</div></div>
            <div class="modal-leg__stake"><span>${isActionable ? 'Stake' : 'Model stake'}</span><strong>${formatMoney(legStake)}</strong><span>${isActionable ? 'Return' : 'Model return'}</span><strong>${formatMoney(legReturn)}</strong></div>
          </div>
          <div class="modal-leg__actions">
            ${deepLink}
            ${isActionable ? `<button class="ghost-button modal-copy-btn" data-stake="${legStake.toFixed(2)}" type="button">Copy stake</button>
            <button class="ghost-button modal-journal-btn" data-event="${escapeHtml(opportunity.eventName || '')}" data-market="${escapeHtml(leg.label || leg.outcome || '')}" data-selection="${escapeHtml(leg.label || leg.outcome || '')} @ ${escapeHtml(leg.bookmaker)}" data-bookmaker="${escapeHtml(leg.bookmaker)}" data-odds="${leg.price}" type="button">Save leg</button>` : '<span class="muted-line">Position actions locked until actionable.</span>'}
          </div>
        </section>`;
    }).join('')}`;

  body.querySelectorAll('.modal-copy-btn').forEach((button) => button.addEventListener('click', () => {
    navigator.clipboard.writeText(button.dataset.stake)
      .then(() => {
        toast('Stake copied');
        button.textContent = 'Copied';
        setTimeout(() => { button.textContent = 'Copy stake'; }, 1500);
      })
      .catch(() => toast('Clipboard access is unavailable'));
  }));
  body.querySelectorAll('.modal-journal-btn').forEach((button) => button.addEventListener('click', () => {
    renderRegistry.createLocalJournalEntry?.({
      type: 'arb-leg',
      event: button.dataset.event,
      market: button.dataset.market,
      selection: button.dataset.selection,
      bookmaker: button.dataset.bookmaker,
      odds: Number(button.dataset.odds),
      stake: 100,
    });
    toast('Leg saved to journal');
    button.textContent = 'Saved';
    button.disabled = true;
  }));

  modalPreviousFocus = trigger;
  overlay.hidden = false;
  document.body.classList.add('modal-open');
  $('#arb-modal-close').focus();
  modalKeydownHandler = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = getFocusableElements(overlay);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', modalKeydownHandler);
  modalKeyupHandler = (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeArbModal();
  };
  document.addEventListener('keyup', modalKeyupHandler);
}

export function closeArbModal() {
  const overlay = $('#arb-modal-overlay');
  if (!overlay || overlay.hidden) return;
  overlay.hidden = true;
  document.body.classList.remove('modal-open');
  if (modalKeydownHandler) document.removeEventListener('keydown', modalKeydownHandler);
  if (modalKeyupHandler) document.removeEventListener('keyup', modalKeyupHandler);
  modalKeydownHandler = null;
  modalKeyupHandler = null;
  const restoreTarget = modalPreviousFocus;
  modalPreviousFocus = null;
  if (restoreTarget?.isConnected && restoreTarget.focus) {
    setTimeout(() => restoreTarget.focus({ preventScroll: true }), 50);
  }
}

export function resolveTheme(theme) {
  return theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = resolveTheme(theme);
  document.documentElement.dataset.themeChoice = theme;
  localStorage.setItem('arbDeskTheme', theme);
  const button = $('#theme-toggle');
  if (button) button.setAttribute('aria-label', `Color theme: ${theme}. Activate to change.`);
  if (theme === 'system') {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.onchange = () => { document.documentElement.dataset.theme = resolveTheme('system'); };
  }
}

export function initTheme() {
  applyTheme(localStorage.getItem('arbDeskTheme') || 'light');
}

export function cycleTheme() {
  const current = localStorage.getItem('arbDeskTheme') || 'light';
  const choices = ['light', 'dark', 'system'];
  const next = choices[(choices.indexOf(current) + 1) % choices.length];
  applyTheme(next);
  toast(`Theme set to ${next}`);
}

export function initSound() {
  const stored = localStorage.getItem('arbDeskSound');
  state.soundEnabled = stored === null ? true : stored === 'true';
  const toggle = $('#sound-alert-toggle');
  if (toggle) toggle.checked = state.soundEnabled;
}

export function toggleSound() {
  state.soundEnabled = !state.soundEnabled;
  localStorage.setItem('arbDeskSound', String(state.soundEnabled));
  toast(`Opportunity sound ${state.soundEnabled ? 'on' : 'off'}`);
}

export function playAlertSound() {
  if (!state.soundEnabled) return;
  const now = Date.now();
  if (now - state.lastSoundMs < 3000) return;
  state.lastSoundMs = now;
  try {
    if (!state.audioCtx) state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const context = state.audioCtx;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.frequency.setValueAtTime(740, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(980, context.currentTime + 0.12);
    gain.gain.setValueAtTime(0.1, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, context.currentTime + 0.24);
    oscillator.start(context.currentTime);
    oscillator.stop(context.currentTime + 0.24);
  } catch {
    // Audio is a non-critical enhancement.
  }
}

export function initNotifications() {
  // Browser permission prompts are user-driven; never interrupt first load.
}

export function notifyHighEdge(opportunity) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  new Notification(`Arb alert: ${(opportunity.edge * 100).toFixed(1)}% edge`, {
    body: `${opportunity.eventName} — ${opportunity.marketLabel || opportunity.marketKey}`,
  });
}

export function triggerAlerts(opportunities) {
  const threshold = state.alertThreshold / 100;
  let shouldPlaySound = false;
  opportunities.filter((opportunity) => opportunity.eligibility === 'actionable').forEach((opportunity) => {
    if (opportunity.edge >= threshold) {
      notifyHighEdge(opportunity);
      shouldPlaySound = true;
    }
  });
  if (shouldPlaySound) playAlertSound();
}

export function initDense() {
  const dense = localStorage.getItem('arbDeskDense') === 'true';
  state.denseView = dense;
  const toggle = $('#dense-view-toggle');
  if (toggle) toggle.checked = dense;
}

export function toggleDense() {
  state.denseView = !state.denseView;
  localStorage.setItem('arbDeskDense', String(state.denseView));
  document.body.classList.toggle('dense-view', state.denseView);
  renderRegistry.scanner();
}

export function renderStatus() {
  $('#data-mode').textContent = state.mode === 'live' ? 'Live data' : state.mode === 'demo' ? 'Demo data' : 'Offline';
  $('#live-dot').dataset.mode = state.mode;
  $('#last-updated').textContent = `Updated ${formatTime(state.fetchedAt)}`;
  const warning = $('#warning');
  if (state.warnings.length > 0) {
    warning.hidden = false;
    $('#warning-title').textContent = 'Feed warning';
    $('#warning-text').textContent = state.warnings.join(' · ');
  } else {
    warning.hidden = true;
  }
  renderDeskOverview();
}

export function renderDeskOverview() {
  const element = $('#desk-overview');
  if (!element) return;
  const opportunities = state.opportunities || [];
  const events = state.events || [];
  const actionable = opportunities.filter((opportunity) => opportunity.eligibility === 'actionable');
  const review = opportunities.filter((opportunity) => opportunity.eligibility === 'review').length;
  const best = actionable.reduce((top, opportunity) => Number(opportunity.edge || 0) > Number(top?.edge || 0) ? opportunity : top, null);
  const pending = getAllJournalEntries().filter((entry) => (entry.status || 'pending') === 'pending');
  const pendingStake = pending.reduce((total, entry) => total + (Number(entry.stake) || 0), 0);
  const items = [
    { label: 'Verified edge', value: best ? formatPct(best.edge, 2) : '0.00%', hint: best?.eventName || 'No actionable edge' },
    { label: 'Actionable arbs', value: String(actionable.length), hint: `${review} need evidence` },
    { label: 'Events covered', value: String(events.length), hint: state.mode === 'live' ? 'Live feed' : 'Demo feed' },
    { label: 'Pending stake', value: formatMoney(pendingStake), hint: `${pending.length} active position${pending.length === 1 ? '' : 's'}` },
  ];
  element.innerHTML = items.map((item) => `
    <article class="overview-cell">
      <span class="overview-cell__label">${escapeHtml(item.label)}</span>
      <strong class="overview-cell__value">${escapeHtml(item.value)}</strong>
      <span class="overview-cell__hint">${escapeHtml(item.hint)}</span>
    </article>`).join('');
}

export function setPage(page, push = true) {
  state.page = PAGE_ROUTES.includes(page) ? page : 'scanner';
  const visiblePage = getVisiblePage();
  $$('.page').forEach((section) => {
    const visible = section.dataset.page === visiblePage;
    section.classList.toggle('page--hidden', !visible);
    section.setAttribute('aria-hidden', visible ? 'false' : 'true');
  });
  $$('[data-nav]').forEach((button) => {
    const active = button.dataset.nav === visiblePage;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  if (push) {
    history.replaceState({}, '', visiblePage === 'scanner' ? '/' : `/${visiblePage}`);
    $('#main-content')?.focus({ preventScroll: true });
  }
  if (visiblePage === 'analytics' && !state.analytics) renderRegistry.loadAnalytics?.();
  if (visiblePage === 'movement' && !state.movement) renderRegistry.loadMovement?.();
  document.title = `${document.querySelector(`.page[data-page="${visiblePage}"] h1`)?.textContent || 'ArbiEdge'} · ArbiEdge`;
  renderRegistry.betSlip();
}

export function toggleBetSlip() {
  const drawer = $('#bet-slip-drawer');
  const open = drawer.dataset.open !== 'true';
  drawer.dataset.open = String(open);
  $('#bet-slip-toggle')?.setAttribute('aria-expanded', String(open));
}

export function renderBetSlip() {
  const list = $('#bet-slip-list');
  if (!list) return;
  const pending = getAllJournalEntries().filter((entry) => (entry.status || 'pending') === 'pending');
  $('#bet-slip-count').textContent = pending.length;
  if (pending.length === 0) {
    list.innerHTML = '<div class="state-panel"><div class="state-panel__copy"><strong>No active positions</strong><span>Saved pending bets will appear here.</span></div></div>';
    return;
  }
  list.innerHTML = pending.map((entry) => {
    const event = state.events.find((candidate) => `${candidate.homeTeam} vs ${candidate.awayTeam}` === entry.event);
    let liveOdds = null;
    if (event) {
      for (const bookmaker of event.bookmakers || []) {
        if (bookmaker.name !== entry.bookmaker) continue;
        for (const outcomes of Object.values(bookmaker.markets || {})) {
          for (const [outcome, odds] of Object.entries(outcomes || {})) {
            if (outcome === entry.selection?.split(' @ ')[0] || entry.selection?.includes(outcome)) liveOdds = odds;
          }
        }
      }
    }
    const moved = liveOdds && Number(liveOdds) !== Number(entry.odds);
    const movedClass = moved ? (Number(liveOdds) > Number(entry.odds) ? 'bet-slip-up' : 'bet-slip-down') : '';
    return `<article class="bet-slip-item ${movedClass}"><strong>${escapeHtml(entry.event)}</strong><div class="muted-line">${bookmakerDot(entry.bookmaker)}${escapeHtml(entry.bookmaker)} · ${escapeHtml(entry.selection || '')} @ ${Number(entry.odds).toFixed(2)}${moved ? ` → ${Number(liveOdds).toFixed(2)}` : ''}</div><div class="muted-line">Stake ${formatMoney(entry.stake || 0)}</div></article>`;
  }).join('');
}

export function initKeyboardShortcuts() {
  document.addEventListener('keydown', (event) => {
    const targetTag = event.target.tagName;
    if (targetTag === 'INPUT' || targetTag === 'SELECT' || targetTag === 'TEXTAREA') {
      if (event.key === 'Escape') event.target.blur();
      return;
    }
    const key = event.key.toLowerCase();
    if (key === 'r') {
      event.preventDefault();
      renderRegistry.loadData?.(true);
    } else if (key === '/') {
      event.preventDefault();
      $('#search').focus();
    } else if (key === 's' && state.selectedOdds) {
      renderRegistry.saveCalculatorSelection?.();
    } else if (key === 'f') {
      const toggle = $('#show-favorites-only');
      if (toggle) {
        toggle.checked = !toggle.checked;
        toggle.dispatchEvent(new Event('change'));
      }
    } else if (key === 'd') {
      toggleDense();
    } else if (key === 'escape') {
      state.search = '';
      $('#search').value = '';
      renderRegistry.allPages();
      closeArbModal();
    } else if (key >= '1' && key <= '9') {
      const index = Number(key) - 1;
      if (PAGE_ROUTES[index]) setPage(PAGE_ROUTES[index]);
    }
  });
}
