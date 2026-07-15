/**
 * StakeCalculatorModal UI Component
 * Provides interactive bankroll adjustment, stake rounding,
 * tax guidance, and instant bet logging.
 */

'use strict';

class StakeCalculatorModal {
  constructor({ containerId = 'modal-container' } = {}) {
    this.container = document.getElementById(containerId) || this.createContainer(containerId);
    this.opportunity = null;
    this.totalBankroll = 100;
  }

  createContainer(id) {
    const el = document.createElement('div');
    el.id = id;
    document.body.appendChild(el);
    return el;
  }

  open(opportunity) {
    this.opportunity = opportunity;
    this.totalBankroll = 100;
    this.render();
    this.bindEvents();
  }

  close() {
    this.container.innerHTML = '';
  }

  render() {
    if (!this.opportunity) return;
    const opp = this.opportunity;
    const legs = opp.legs || [];
    const implied = legs.reduce((sum, leg) => sum + (1 / leg.price), 0);

    const legRows = legs.map((leg, index) => {
      const exactStake = (this.totalBankroll * (1 / leg.price)) / implied;
      const roundedStake = Math.round(exactStake);
      const returnAmount = roundedStake * leg.price;
      const profit = returnAmount - this.totalBankroll;

      return `
        <div class="modal-leg-row" data-leg-index="${index}">
          <div class="modal-leg-info">
            <span class="modal-leg-bookie">${escapeHtml(leg.bookmaker)}</span>
            <span class="modal-leg-outcome">${escapeHtml(leg.label)}</span>
            <span class="modal-leg-price">@ ${Number(leg.price).toFixed(2)}</span>
          </div>
          <div class="modal-leg-inputs">
            <label>Stake (RON)</label>
            <input type="number" class="stake-input" value="${roundedStake}" min="1" step="1">
            <span class="leg-return">Return <strong>${returnAmount.toFixed(2)} RON</strong> (Profit ${profit >= 0 ? '+' : ''}${profit.toFixed(2)} RON)</span>
          </div>
        </div>
      `;
    }).join('');

    this.container.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal-card">
          <div class="modal-header">
            <h3>Live stake calculator</h3>
            <button class="modal-close-btn" type="button" aria-label="Close calculator">&times;</button>
          </div>
          <div class="modal-body">
            <div class="modal-event-summary">
              <strong>${escapeHtml(opp.eventName)}</strong> - ${escapeHtml(opp.marketLabel || opp.marketKey)}
              <span class="edge-highlight">+${(opp.edge * 100).toFixed(2)}% edge</span>
            </div>

            <div class="bankroll-controls">
              <label>Total allocated bankroll (RON)</label>
              <input type="number" id="modal-total-bankroll" value="${this.totalBankroll}" step="10" min="10">
              <div class="quick-bankroll-btns">
                <button class="btn btn-sm btn-chip" data-val="100">100 RON</button>
                <button class="btn btn-sm btn-chip" data-val="250">250 RON</button>
                <button class="btn btn-sm btn-chip" data-val="500">500 RON</button>
                <button class="btn btn-sm btn-chip" data-val="1000">1000 RON</button>
              </div>
            </div>

            <div class="modal-legs-list">
              ${legRows}
            </div>

            <div class="tax-info-banner">
              Tax rules can change. Confirm the current treatment before placing or settling a position.
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary modal-close-btn" type="button">Close</button>
            <button class="btn btn-primary modal-save-bets-btn" type="button">Save to journal</button>
          </div>
        </div>
      </div>
    `;
  }

  bindEvents() {
    const backdrop = this.container.querySelector('.modal-backdrop');
    if (!backdrop) return;

    backdrop.querySelectorAll('.modal-close-btn').forEach((btn) => {
      btn.addEventListener('click', () => this.close());
    });

    const bankrollInput = this.container.querySelector('#modal-total-bankroll');
    if (bankrollInput) {
      bankrollInput.addEventListener('input', (e) => {
        this.totalBankroll = Number(e.target.value) || 100;
        this.render();
        this.bindEvents();
      });
    }

    this.container.querySelectorAll('.btn-chip').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        this.totalBankroll = Number(e.target.getAttribute('data-val')) || 100;
        this.render();
        this.bindEvents();
      });
    });
  }
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { StakeCalculatorModal };
}
