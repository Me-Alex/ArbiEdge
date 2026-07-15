'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { renderFilterBar } = require('../public/js/components/FilterBar');
const { renderOpportunityCard } = require('../public/js/components/OpportunityCard');
const { renderSparklineSVG } = require('../public/js/components/SparklineChart');

function createDomStub() {
  const elements = new Map();

  function createElement(tagName = 'div') {
    return {
      tagName: tagName.toUpperCase(),
      id: '',
      className: '',
      innerHTML: '',
      children: [],
      parentNode: null,
      appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        if (child.id) elements.set(child.id, child);
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
      remove() {
        this.parentNode = null;
      },
    };
  }

  return {
    body: createElement('body'),
    createElement,
    getElementById(id) {
      return elements.get(id) || null;
    },
  };
}

test('renderFilterBar renders selected values and escapes labels', () => {
  const html = renderFilterBar({
    sports: [{ key: 'football', label: '<Football>' }],
    selectedSport: 'football',
    minEdge: 1,
    profitOnly: true,
  });

  assert.match(html, /value="football" selected/);
  assert.match(html, /&lt;Football&gt;/);
  assert.match(html, /filter-profit-only" checked/);
});

test('renderOpportunityCard renders safe opportunity details', () => {
  const html = renderOpportunityCard({
    eventName: 'Home < Away',
    marketKey: 'h2h',
    marketLabel: 'Match result',
    competition: 'League',
    confidence: 'trusted',
    edge: 0.025,
    profit: 2.5,
    legs: [{ bookmaker: 'Book A', label: 'Home', price: 2.1, stake: 48 }],
  }, 3);

  assert.match(html, /Home &lt; Away/);
  assert.match(html, /\+2\.50%/);
  assert.match(html, /data-opp-index="3"/);
});

test('renderSparklineSVG renders placeholders and trend polylines', () => {
  assert.match(renderSparklineSVG([]), /sparkline-placeholder/);

  const chart = renderSparklineSVG([2.1, 2, 1.9], { width: 90, height: 24 });
  assert.match(chart, /polyline/);
  assert.match(chart, /width="90"/);
  assert.match(chart, /#10B981/);
});

test('StakeCalculatorModal and ToastManager create isolated containers', () => {
  const previousDocument = global.document;
  global.document = createDomStub();

  try {
    const modalPath = require.resolve('../public/js/components/StakeCalculatorModal');
    const toastPath = require.resolve('../public/js/components/ToastAlerts');
    delete require.cache[modalPath];
    delete require.cache[toastPath];

    const { StakeCalculatorModal } = require(modalPath);
    const { ToastManager } = require(toastPath);
    const modal = new StakeCalculatorModal({ containerId: 'test-modal' });
    const toasts = new ToastManager({ containerId: 'test-toasts' });

    modal.open({
      eventName: 'Home vs Away',
      marketKey: 'h2h',
      marketLabel: 'Match result',
      edge: 0.02,
      legs: [
        { bookmaker: 'A', label: 'Home', price: 2.1 },
        { bookmaker: 'B', label: 'Away', price: 2.1 },
      ],
    });

    assert.match(modal.container.innerHTML, /Home vs Away/);
    assert.equal(toasts.container.className, 'toast-container');
    modal.close();
    assert.equal(modal.container.innerHTML, '');
  } finally {
    global.document = previousDocument;
  }
});
