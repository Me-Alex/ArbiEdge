/**
 * OpportunityCard UI Component
 * Renders an arbitrage opportunity with real-time price indicators,
 * status badges, leg breakdown, and calculator action button.
 */

'use strict';

function renderOpportunityCard(opp, index = 0) {
  const isTrusted = opp.confidence === 'trusted';
  const confidenceBadgeClass = isTrusted
    ? 'badge-trusted'
    : opp.confidence === 'review'
      ? 'badge-review'
      : 'badge-risky';

  const legsHtml = (opp.legs || []).map((leg) => {
    return `
      <div class="leg-row">
        <div class="leg-info">
          <span class="leg-bookmaker">${escapeHtml(leg.bookmaker)}</span>
          <span class="leg-label">${escapeHtml(leg.label)}</span>
        </div>
        <div class="leg-price-box">
          <span class="leg-price">${Number(leg.price).toFixed(2)}</span>
          ${leg.stake ? `<span class="leg-stake">${Number(leg.stake).toFixed(2)} RON</span>` : ''}
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="opportunity-card ${isTrusted ? 'trusted' : ''}" data-opp-id="${opp.marketKey}_${index}">
      <div class="card-header">
        <div class="event-title-group">
          <span class="competition-tag">${escapeHtml(opp.competition || 'Match')}</span>
          <h3 class="event-name">${escapeHtml(opp.eventName)}</h3>
        </div>
        <div class="edge-badge-group">
          <span class="edge-percentage">+${(opp.edge * 100).toFixed(2)}%</span>
          <span class="confidence-badge ${confidenceBadgeClass}">${opp.confidence}</span>
        </div>
      </div>

      <div class="card-body">
        <div class="market-meta">
          <span class="market-name">${escapeHtml(opp.marketLabel || opp.marketKey)}</span>
          <span class="profit-amount">Profit <strong>${Number(opp.profit).toFixed(2)} RON</strong> / 100 RON</span>
        </div>

        <div class="legs-container">
          ${legsHtml}
        </div>
      </div>

      <div class="card-actions">
        <button class="btn btn-primary open-calc-btn" data-opp-index="${index}">
          Calculate stakes
        </button>
        <button class="btn btn-secondary quick-log-btn" data-opp-index="${index}">
          Log position
        </button>
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderOpportunityCard };
}
