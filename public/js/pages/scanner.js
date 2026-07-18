/**
 * Accuracy-first scanner: queue rendering, evidence display, market filters,
 * CSV export, and the recent scan ledger.
 */

import {
  state, renderRegistry, $, $$, escapeHtml, formatTime, formatPct, bookmakerDot, arbId,
  MARKET_TYPES, areAllMarketTypesSelected, classifyOpportunityMarketType, getScannerMarketTypeCounts,
  getScannerTabBaseOpportunities, getScannerTabOpportunities, getScannerTabCounts,
  getSelectedMarketTypes, csvEscape,
} from '../state.js?v=12';
import {
  buildScannerCsvRows,
  getOpportunityEligibility,
  getOpportunityVerificationStatuses,
  getScannerTabName,
} from '../scanner-filters.js?v=12';
import { openArbModal, toast } from '../ui-common.js?v=12';

const QUEUE_LABELS = {
  actionable: 'Actionable',
  review: 'Review',
  rejected: 'Rejected',
  analysis: 'Analysis only',
};

const EVIDENCE_LABELS = {
  verified: 'Verified',
  mismatch: 'Mismatch',
  not_found: 'Not found',
  unverifiable: 'Unverifiable',
  ambiguous: 'Ambiguous',
  stale: 'Stale',
  partial: 'Partial',
  unverified: 'Unverified',
};

function renderScannerOverview() {
  const overview = $('#scanner-overview');
  if (!overview) return;
  const counts = getScannerTabCounts();
  const candidateCount = counts.actionable + counts.review + counts.rejected;
  const typeHint = (() => {
    const summary = state.opportunitySummary;
    if (summary?.topFamilies?.length) {
      const parts = summary.topFamilies.slice(0, 4).map((item) => `${item.count} ${item.family}`);
      const multi = Number(summary.multiFeed || 0);
      if (multi > 0) parts.push(`${multi} multi-feed`);
      return parts.join(' · ');
    }
    const byType = summary?.byType;
    if (byType && typeof byType === 'object') {
      const parts = Object.entries(byType)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([k, v]) => `${v} ${k}`);
      if (parts.length) return parts.join(' · ');
    }
    const opps = state.opportunities || [];
    const types = {};
    for (const opp of opps) {
      const t = opp.type || 'classic';
      types[t] = (types[t] || 0) + 1;
    }
    const parts = Object.entries(types)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([k, v]) => `${v} ${k}`);
    return parts.length ? parts.join(' · ') : 'După validare formulă';
  })();
  const eventsN = Number(state.eventsScanned || state.events?.length || 0);
  const items = [
    { key: 'candidates', label: 'Total semnale', value: candidateCount, hint: typeHint },
    { key: 'actionable', label: 'Acționabile', value: counts.actionable, hint: 'Fidelity verified pe website' },
    { key: 'review', label: 'Candidați', value: counts.review, hint: eventsN > 0 ? `Math pe ${eventsN} evenimente · neverificat pe site` : 'Arbitraj matematic, neverificat pe site' },
    { key: 'rejected', label: 'Respinse', value: counts.rejected, hint: 'Same-book / failed evidence / invalid' },
  ];
  overview.innerHTML = items.map((item) => `
    <article class="scanner-metric scanner-metric--${item.key}">
      <span>${escapeHtml(item.label)}</span>
      <strong>${item.value}</strong>
      <small>${escapeHtml(item.hint)}</small>
    </article>`).join('')
    + (counts.actionable === 0 && counts.review > 0
      ? `<div class="context-banner scanner-fidelity-banner" style="grid-column:1/-1"><strong>${counts.review} candidați matematici.</strong><span>Niciunul nu e „acționabil” până nu există dovadă browser (fidelity) pe fiecare picior. Deschide tab-ul <em>Candidați</em> ca să le vezi.</span></div>`
      : '');
}

function renderScannerTabs() {
  const counts = getScannerTabCounts();
  $$('.scanner-tab').forEach((button) => {
    const tab = button.dataset.scannerTab;
    const active = tab === state.scannerTab;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
    const count = button.querySelector('.scanner-tab-count');
    if (count) count.textContent = String(counts[tab] || 0);
  });
}

function renderMarketFilter() {
  const options = $('#market-filter-options');
  const summary = $('#market-filter-summary');
  const toggle = $('#market-filter-toggle');
  const menu = $('#market-filter-menu');
  if (!options || !summary) return;

  const selected = getSelectedMarketTypes();
  const counts = getScannerMarketTypeCounts();
  summary.textContent = areAllMarketTypesSelected()
    ? 'All'
    : selected.size === 0
      ? 'None'
      : `${selected.size} selected`;
  if (toggle && menu) toggle.setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');

  options.innerHTML = MARKET_TYPES.map((type) => `
    <label class="market-filter__option">
      <input type="checkbox" data-market-type="${escapeHtml(type.key)}" ${selected.has(type.key) ? 'checked' : ''}>
      <span class="market-filter__label">${escapeHtml(type.label)}</span>
      <span class="market-filter__count">${counts[type.key] || 0}</span>
    </label>
  `).join('');
}

function renderEmptyScanner(list, baseOpps) {
  const tab = state.scannerTab;
  const filteredOut = baseOpps.length > 0 && !areAllMarketTypesSelected();
  const fidelityFilter = String(state.scannerVerificationFilter || '').trim();
  const counts = getScannerTabCounts();
  const eventsN = Number(state.eventsScanned || state.events?.length || 0);
  const copy = {
    actionable: {
      eyebrow: 'Poartă de siguranță',
      title: 'Niciun arbitraj verificat acționabil',
      body: counts.review > 0
        ? `Aici apar doar surebet-urile cu fidelity pe website. Ai ${counts.review} candidați matematici în tab-ul „Candidați” (result×totals, BTTS, DNB/AH0, qualify…).`
        : 'Aici apar doar surebet-urile cu fidelity pe website pe fiecare picior. Candidații matematici (neverificați) sunt în tab-ul „Candidați”.',
    },
    review: {
      eyebrow: 'Candidați matematici',
      title: 'Niciun candidat de arbitraj',
      body: counts.rejected > 0
        ? `Nu există candidați în review, dar ai ${counts.rejected} semnale în Respinse (same-book, edge outlier, fidelity failed). Verifică tab-ul Respinse sau coboară filtrul de edge.`
        : (eventsN > 0
          ? `Am scanat ${eventsN} evenimente, dar nicio combinație cross-book nu are edge pozitiv după filtre. Resetează edge (min. ${Number(state.minEdge || 0)}%), feed-uri (min. ${state.minFeeds || 0}), lărgește familiile (BTTS×totals, qualify×AH, DNB/AH0) sau așteaptă refresh-ul cotelor.`
          : 'Nu există încă combinații cross-book cu edge pozitiv. Apasă Scan, așteaptă colectarea live (30–90s) și verifică modul „live”. Cache-ul de pe server se încălzește la pornire — nu reîncărca pagina în timpul scanului. Sortarea multi-feed / kickoff e disponibilă în filtre.'),
    },
    rejected: {
      eyebrow: 'Audit queue clear',
      title: 'No rejected candidates match',
      body: counts.review > 0
        ? `Filtrul actual nu arată respinse, dar ai ${counts.review} candidați în tab-ul Candidați.`
        : 'Rejected signals include same-book pricing, failed evidence, unsupported settlement, and edge outliers.',
    },
    middles: {
      eyebrow: 'Analysis queue clear',
      title: 'No middle windows match',
      body: counts.review > 0
        ? `Niciun middle după filtre, dar ai ${counts.review} candidați de arbitraj în tab-ul „Candidați”. Middles sunt ferestre de scor, nu surebet-uri garantate.`
        : 'Middles are tracked separately because their upside window is not a guaranteed arbitrage. Resetează edge/feed-uri sau așteaptă refresh-ul cotelor.',
    },
  }[tab];
  let body = filteredOut
    ? 'No signals matched the selected market types. Widen the market filter to continue.'
    : copy.body;
  // Verification filter is applied before tab partition — count raw opps so we
  // can still explain an empty list when fidelity filter hid everything.
  if (!filteredOut && fidelityFilter) {
    const raw = state.opportunities || [];
    const rawN = raw.length;
    if (rawN > 0 && baseOpps.length === 0) {
      body = `Filtrul de fidelity „${fidelityFilter}” ascunde semnalele din acest tab (${rawN} semnale brute). Resetează filtrul de verificare pentru a le vedea din nou.`;
    }
  }
  list.innerHTML = `<div class="state-panel scanner-empty"><div class="state-panel__copy"><span class="state-panel__eyebrow">${escapeHtml(copy.eyebrow)}</span><strong>${escapeHtml(copy.title)}</strong><span>${escapeHtml(body)}</span></div></div>`;
}

function evidenceClass(status) {
  if (status === 'verified') return 'evidence-badge--verified';
  if (['mismatch', 'not_found', 'unverifiable'].includes(status)) return 'evidence-badge--failed';
  return 'evidence-badge--review';
}

function renderLeg(leg) {
  const status = String(leg.verificationStatus || 'unverified').toLowerCase();
  const bookmaker = leg.url
    ? `<a href="${escapeHtml(leg.url)}" target="_blank" rel="noopener" class="leg-link">${bookmakerDot(leg.bookmaker)}${escapeHtml(leg.bookmaker)}</a>`
    : `<span class="leg-bookmaker">${bookmakerDot(leg.bookmaker)}${escapeHtml(leg.bookmaker)}</span>`;
  return `
    <li>
      <span class="leg-label">${escapeHtml(leg.label)}</span>
      ${bookmaker}
      <strong class="leg-price">${Number(leg.price).toFixed(2)}</strong>
      <span class="evidence-badge ${evidenceClass(status)}">${escapeHtml(EVIDENCE_LABELS[status] || status)}</span>
    </li>`;
}

function renderReasons(opportunity, eligibility) {
  if (eligibility === 'actionable') {
    const verified = Number(opportunity.verifiedLegCount || opportunity.legs?.length || 0);
    return `<div class="scanner-verdict scanner-verdict--actionable"><strong>Passed safety gate</strong><span>${verified} verified legs · cross-book · approved market structure</span></div>`;
  }
  const reasons = opportunity.eligibilityReasons?.length
    ? opportunity.eligibilityReasons
    : ['Evidence is incomplete. This candidate cannot be treated as actionable.'];
  return `
    <div class="scanner-verdict scanner-verdict--${eligibility}">
      <strong>${eligibility === 'rejected' ? 'Blocked by scanner' : eligibility === 'analysis' ? 'Analysis only' : 'Action blocked'}</strong>
      <ul>${reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>
    </div>`;
}

function renderOpportunityCard(opportunity) {
  const id = arbId(opportunity);
  const marketType = classifyOpportunityMarketType(opportunity);
  const eligibility = getOpportunityEligibility(opportunity);
  const isPinned = state.pinnedArbs.has(id);
  const article = document.createElement('article');
  article.className = `arb-card arb-card--${eligibility}${isPinned ? ' arb-card--pinned' : ''}`;
  article.dataset.opportunityType = opportunity.type || '';
  article.dataset.marketType = marketType;
  article.dataset.eligibility = eligibility;

  const isMiddle = eligibility === 'analysis';
  const profitLabel = eligibility === 'actionable'
    ? 'Guaranteed profit / 100 RON'
    : isMiddle ? 'Model result / 100 RON' : 'Unverified model profit / 100 RON';
  const primaryLabel = eligibility === 'actionable'
    ? 'Review stakes'
    : isMiddle ? 'Inspect middle' : 'Inspect evidence';

  article.innerHTML = `
    <div class="arb-card__top">
      <div>
        <div class="arb-card__heading-line">
          <h2 class="arb-card__title">${escapeHtml(opportunity.eventName)}</h2>
          <span class="queue-pill queue-pill--${eligibility}">${escapeHtml(QUEUE_LABELS[eligibility])}</span>
        </div>
        <div class="muted-line">${escapeHtml(opportunity.marketLabel || opportunity.marketKey)} · ${escapeHtml(opportunity.competition || '')}${opportunity.sport ? ` · ${escapeHtml(opportunity.sport)}` : ''}${opportunity.kickoff ? ` · ${escapeHtml(formatTime(opportunity.kickoff))}` : ''}</div>
        <div class="muted-line scanner-formula-meta">${escapeHtml(opportunity.type || 'classic')}${opportunity.formulaFamily ? ` · ${escapeHtml(opportunity.formulaFamily)}` : ''}${opportunity.middleWindow ? ` · window ${escapeHtml(opportunity.middleWindow)}` : ''} · ${escapeHtml(marketType)}</div>
      </div>
      <div class="verification-summary" aria-label="Verification summary">
        <strong>${Number(opportunity.verifiedLegCount || 0)}/${Number(opportunity.legCount || opportunity.legs?.length || 0)}</strong>
        <span>legs verified</span>
      </div>
    </div>
    <ol class="legs-list">${(opportunity.legs || []).map(renderLeg).join('')}</ol>
    <div class="arb-card__signal">
      <div class="value-card__metric"><span>Model edge</span><strong>${formatPct(opportunity.edge)}</strong></div>
      <div class="value-card__metric"><span>${escapeHtml(profitLabel)}</span><strong class="${eligibility === 'actionable' ? 'arb-card__profit' : ''}">${Number(opportunity.profit) >= 0 ? '+' : ''}${Number(opportunity.profit).toFixed(2)} RON</strong></div>
      <div class="value-card__metric"><span>Bookmakers</span><strong>${opportunity.sameBook ? '1 · blocked' : new Set((opportunity.legs || []).map((leg) => leg.bookmaker)).size}${Number(opportunity.independentFeedCount) >= 2 ? ` · ${opportunity.independentFeedCount} feed` : Number(opportunity.independentFeedCount) === 1 ? ' · 1 feed' : ''}</strong></div>
    </div>
    ${Number(opportunity.independentFeedCount) >= 2 ? '<div class="muted-line scanner-feed-badge">Independent feeds · better execution diversity</div>' : ''}
    ${renderReasons(opportunity, eligibility)}
    <div class="arb-card__footer">
      <button class="${eligibility === 'actionable' ? 'primary-button' : 'ghost-button'} arb-detail-btn" type="button">${primaryLabel}</button>
      <button class="ghost-button arb-pin-btn" type="button">${isPinned ? 'Pinned' : 'Pin for review'}</button>
    </div>`;

  article.querySelector('.arb-detail-btn').addEventListener('click', (event) => openArbModal(opportunity, event.currentTarget));
  article.querySelector('.arb-pin-btn').addEventListener('click', () => {
    if (state.pinnedArbs.has(id)) {
      state.pinnedArbs.delete(id);
      toast('Signal unpinned');
    } else {
      state.pinnedArbs.add(id);
      toast('Signal pinned for review');
    }
    renderRegistry.scanner();
  });
  return article;
}

export function renderScanner() {
  const list = $('#scanner-list');
  if (!list) return;
  renderScannerOverview();
  renderScannerTabs();
  renderMarketFilter();
  const baseOpps = getScannerTabBaseOpportunities();
  const opportunities = getScannerTabOpportunities();
  list.innerHTML = '';
  if (opportunities.length === 0) {
    renderEmptyScanner(list, baseOpps);
    return;
  }

  opportunities.slice(0, state.scannerVisibleLimit).forEach((opportunity) => {
    list.appendChild(renderOpportunityCard(opportunity));
  });

  if (opportunities.length > state.scannerVisibleLimit) {
    const remaining = opportunities.length - state.scannerVisibleLimit;
    const button = document.createElement('button');
    button.className = 'ghost-button scanner-load-more';
    button.type = 'button';
    button.textContent = `Show next ${Math.min(50, remaining)} · ${remaining} remaining`;
    button.addEventListener('click', () => {
      state.scannerVisibleLimit += 50;
      renderRegistry.scanner();
    });
    list.appendChild(button);
  }
}

export function renderArbHistory() {
  const list = $('#arb-history-list');
  if (!list) return;
  if (!state.arbHistory?.records?.length) {
    list.innerHTML = '<div class="state-panel"><div class="state-panel__copy"><strong>No scans logged yet</strong><span>Refresh the scanner to start the session ledger.</span></div></div>';
    return;
  }
  list.innerHTML = '';
  state.arbHistory.records.forEach((record) => {
    const article = document.createElement('article');
    article.className = 'arb-card';
    article.innerHTML = `
      <div class="arb-card__top"><div><h2 class="arb-card__title">${record.count} ${record.count === 1 ? 'signal' : 'signals'}</h2><div class="muted-line">${formatTime(record.loggedAt)}</div></div></div>
      ${(record.opportunities || []).slice(0, 5).map((opportunity) => `<div class="muted-line">${escapeHtml(opportunity.eventName)} · ${formatPct(opportunity.edge)} · ${escapeHtml(opportunity.marketLabel || opportunity.marketKey)} · ${(opportunity.legs || []).map((leg) => `${escapeHtml(leg.label)} @ ${escapeHtml(leg.bookmaker)}`).join(', ')}</div>`).join('')}`;
    list.appendChild(article);
  });
}

export async function exportCsv() {
  const rows = buildScannerCsvRows(getScannerTabOpportunities());
  const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `scanner-${getScannerTabName(state.scannerTab)}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
