/**
 * FilterBar UI Component
 * Provides sports filter, minimum edge selector, confidence filter, and bookmaker toggles.
 */

'use strict';

function renderFilterBar({ sports = [], selectedSport = 'football', minEdge = 0, profitOnly = false } = {}) {
  const sportOptions = sports.map((s) => `
    <option value="${s.key}" ${s.key === selectedSport ? 'selected' : ''}>${escapeHtml(s.label)}</option>
  `).join('');

  return `
    <div class="filter-bar-container">
      <div class="filter-group">
        <label for="filter-sport-select">Sport</label>
        <select id="filter-sport-select" class="form-control">
          <option value="">All sports</option>
          ${sportOptions}
        </select>
      </div>

      <div class="filter-group">
        <label for="filter-min-edge">Minimum edge (%)</label>
        <select id="filter-min-edge" class="form-control">
          <option value="0" ${minEdge === 0 ? 'selected' : ''}>All (&gt; 0%)</option>
          <option value="0.5" ${minEdge === 0.5 ? 'selected' : ''}>Above 0.5%</option>
          <option value="1" ${minEdge === 1 ? 'selected' : ''}>Above 1.0%</option>
          <option value="2" ${minEdge === 2 ? 'selected' : ''}>Above 2.0%</option>
          <option value="3" ${minEdge === 3 ? 'selected' : ''}>Above 3.0%</option>
        </select>
      </div>

      <div class="filter-group checkbox-group">
        <label>
          <input type="checkbox" id="filter-profit-only" ${profitOnly ? 'checked' : ''}>
          Positive profit only
        </label>
      </div>

      <div class="filter-group">
        <input type="search" id="filter-search-input" class="form-control" placeholder="Search match, team, or league">
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderFilterBar };
}
