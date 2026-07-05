/**
 * Low-level data fetching helpers.
 * Orchestration (loadData, refreshOpportunities, connectStream) lives in app.js
 * to avoid circular imports between api ↔ ui-common.
 */

export async function fetchJson(u) {
  const r = await fetch(u);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function loadAnalyticsData() {
  return fetchJson('/api/bets/analytics');
}

export async function loadMovementData() {
  return fetchJson('/api/odds/movement');
}

export async function loadArbHistoryData() {
  return fetchJson('/api/arbs?limit=50');
}

export async function logArbHistoryData(opportunities) {
  if (!opportunities || opportunities.length === 0) return;
  try {
    await fetch('/api/arbs/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ opportunities }) });
  } catch { /* silent */ }
}
