/**
 * SparklineChart UI Component
 * Renders lightweight inline SVG trend sparklines for odds movement visualization.
 */

'use strict';

function renderSparklineSVG(history = [], { width = 120, height = 28, strokeColor = '#10B981' } = {}) {
  if (!Array.isArray(history) || history.length < 2) {
    return `<svg width="${width}" height="${height}" class="sparkline-placeholder"><line x1="0" y1="${height/2}" x2="${width}" y2="${height/2}" stroke="#4B5563" stroke-dasharray="2,2"/></svg>`;
  }

  const min = Math.min(...history);
  const max = Math.max(...history);
  const range = max - min || 1;

  const points = history.map((val, idx) => {
    const x = (idx / (history.length - 1)) * width;
    const y = height - ((val - min) / range) * (height - 8) - 4;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const lastValue = history[history.length - 1];
  const firstValue = history[0];
  const color = lastValue > firstValue ? '#EF4444' : lastValue < firstValue ? '#10B981' : strokeColor;

  return `
    <svg width="${width}" height="${height}" class="sparkline-svg">
      <polyline fill="none" stroke="${color}" stroke-width="2" points="${points}" />
    </svg>
  `;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderSparklineSVG };
}
