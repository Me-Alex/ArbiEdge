/**
 * Calculator page: probability, Kelly, dutching, arbitrage, tax, no-vig,
 * middle bets, odds converter, and auto-stake allocation.
 */

import { state, renderRegistry, $, $$, escapeHtml, formatMoney, formatPct, gcd } from '../state.js?v=12';
import { toast } from '../ui-common.js?v=12';
import { TAX_THRESHOLD_RON, TAX_RATE } from '../state.js?v=12';

export function loadSelectionIntoCalculator(s) {
  state.selectedOdds = { ...s, stake: Number($('#calc-stake').value || 100) };
  updateLoadedSelection();
}

export function updateLoadedSelection() {
  if (!state.selectedOdds) {
    $('#calc-odds').textContent = '-';
    $('#calc-context').textContent = 'No selection loaded yet.';
    $('#calc-save').disabled = true;
    $('#calc-prob-output').innerHTML = '<div><span>Implied probability</span><strong>-</strong></div>';
    $('#calc-kelly-output').innerHTML = '<div><span>Suggested fraction</span><strong>-</strong></div>';
    return;
  }
  $('#calc-odds').textContent = Number(state.selectedOdds.odds).toFixed(2);
  $('#calc-context').textContent = `${state.selectedOdds.event} · ${state.selectedOdds.market} · ${state.selectedOdds.outcome} · ${state.selectedOdds.bookmaker}`;
  $('#calc-save').disabled = false;
  renderProbCalculator();
}

export function renderProbCalculator() {
  const o = $('#calc-prob-output'), k = $('#calc-kelly-output');
  if (!state.selectedOdds) {
    o.innerHTML = '<div><span>Implied probability</span><strong>-</strong></div>';
    k.innerHTML = '<div><span>Suggested fraction</span><strong>-</strong></div>';
    return;
  }
  const odds = Number(state.selectedOdds.odds);
  const br = Number($('#calc-bankroll').value || 1000);
  if (odds <= 1) {
    o.innerHTML = '<div><span>Invalid odds</span><strong>-</strong></div>';
    k.innerHTML = '<div><span>Invalid</span><strong>-</strong></div>';
    return;
  }
  const ip = 1 / odds;
  let fp;
  if (state.selectedOdds.consensus && state.selectedOdds.consensus > 1) fp = 1 / state.selectedOdds.consensus;
  else fp = ip / (1 + 0.04);
  const fo = fp > 0 ? 1 / fp : 0;
  const e = Math.max(0, fp - ip);
  const b = odds - 1;
  const kr = b > 0 ? (b * fp - (1 - fp)) / b : 0;
  const kf = Math.max(0, Math.min(0.25, kr));
  o.innerHTML = `<div><span>Implied probability</span><strong>${formatPct(ip)}</strong></div><div><span>Fair probability</span><strong>${formatPct(fp)}</strong></div><div><span>Fair odds</span><strong>${fo.toFixed(2)}</strong></div><div><span>Edge</span><strong>${formatPct(e)}</strong></div>`;
  k.innerHTML = `<div><span>Kelly (full)</span><strong>${formatPct(kr, 2)}</strong></div><div><span>Kelly (capped)</span><strong>${formatPct(kf, 2)}</strong></div><div><span>Stake</span><strong>${formatMoney(kf * br)}</strong></div>`;
}

export function renderAutoStake() {
  const br = Number($('#autostake-bankroll').value || 0);
  const mp = Number($('#autostake-max-pct').value || 25) / 100;
  const mx = br * mp;
  const os = state.opportunities
    .filter((opportunity) => opportunity.eligibility === 'actionable' && opportunity.edge > 0)
    .slice(0, 20);
  const out = $('#autostake-results');
  if (os.length === 0 || br <= 0) { out.innerHTML = '<div><span>Enter a bankroll and ensure verified actionable opportunities are loaded.</span></div>'; return; }
  const te = os.reduce((s, o) => s + o.edge, 0);
  if (te <= 0) { out.innerHTML = '<div><span>No positive-edge opportunities.</span></div>'; return; }
  let al = 0;
  const allocs = os.map((o) => { const p = (o.edge / te) * br; const st = Math.min(p, mx); al += st; return { o, st }; });
  const sc = al > br ? br / al : 1;
  const rows = allocs.map(({ o, st }) => {
    const as = st * sc;
    const rp = o.stake ? o.profit / o.stake : 0;
    const ep = as * rp;
    return `<div class="value-card__metric"><span>${escapeHtml(o.eventName || '')} · ${formatPct(o.edge)}</span><strong>${formatMoney(as)} → +${formatMoney(ep)}</strong></div>`;
  }).join('');
  out.innerHTML = `<div class="value-card__metric"><span>Bankroll</span><strong>${formatMoney(br)}</strong></div><div class="value-card__metric"><span>Active arbs</span><strong>${os.length}</strong></div><div class="value-card__metric"><span>Allocated</span><strong>${formatMoney(al * sc)}</strong></div><div class="value-card__metric"><span>Unallocated</span><strong>${formatMoney(br - al * sc)}</strong></div><hr style="border-color:var(--line);margin:6px 0">${rows}`;
}

export function addDutchLeg(v = '') {
  const r = document.createElement('div'); r.className = 'dutch-leg';
  r.innerHTML = `<label class="field-block"><span>Odds</span><input type="number" step="0.01" value="${escapeHtml(v)}"></label><button class="ghost-button" type="button">Remove</button>`;
  r.querySelector('input').addEventListener('input', renderDutchSummary);
  r.querySelector('button').addEventListener('click', () => { r.remove(); renderDutchSummary(); });
  $('#dutch-legs').appendChild(r);
}

export function renderDutchSummary() {
  const st = Number($('#dutch-stake').value || 0);
  const os = $$('.dutch-leg input').map((i) => Number(i.value)).filter((v) => v > 1);
  const s = $('#dutch-summary');
  if (os.length === 0 || st <= 0) {
    s.innerHTML = '<div><span>Guaranteed return</span><strong>-</strong></div><div><span>Net profit</span><strong>-</strong></div><div><span>Cost</span><strong>-</strong></div>';
    return;
  }
  const tp = os.reduce((t, p) => t + (1 / p), 0);
  const gr = st / tp;
  const p = gr - st;
  const c = Math.max(0, (tp - 1) * 100);
  s.innerHTML = `<div><span>Guaranteed return</span><strong>${formatMoney(gr)}</strong></div><div><span>Net profit</span><strong>${formatMoney(p)}</strong></div><div><span>Cost</span><strong>${c.toFixed(1)}%</strong></div>`;
}

export function renderArbCheck() {
  const ps = ['#arb-odds-1', '#arb-odds-2', '#arb-odds-3'].map((s) => Number($(s).value)).filter((v) => v > 1);
  if (ps.length !== 3) { $('#arb-check-result').textContent = 'Enter all three prices.'; return; }
  const tp = ps.reduce((t, p) => t + (1 / p), 0);
  const ra = 100 / tp;
  const p = ra - 100;
  $('#arb-check-result').textContent = [
    p > 0 ? 'Arbitrage found' : 'No arbitrage edge', '', '',
    ...ps.map((p, i) => `Outcome ${i + 1}: ${p.toFixed(2)} · Implied prob ${(100 / p).toFixed(1)}%`),
    '', `Guaranteed return: ${ra.toFixed(2)} RON`, `Net profit: ${p.toFixed(2)} RON`,
  ].join('\n');
}

export function renderTaxCalculator() {
  const stake = Number($('#tax-stake')?.value || 0);
  const odds = Number($('#tax-odds')?.value || 0);
  const ytd = Number($('#tax-ytd')?.value || 0);
  const out = $('#tax-result');
  if (!out) return;
  if (stake < 0 || odds <= 1 || ytd < 0) { out.textContent = 'Enter valid stake, odds, and year-to-date winnings.'; return; }
  const gross = Math.max(0, stake * odds - stake);
  const remaining = Math.max(0, TAX_THRESHOLD_RON - ytd);
  const taxable = Math.max(0, gross - remaining);
  const tax = taxable * TAX_RATE;
  const net = gross - tax;
  out.textContent = [
    `Gross winnings: ${formatMoney(gross)}`,
    `Remaining threshold: ${formatMoney(remaining)}`,
    `Taxable winnings: ${formatMoney(taxable)}`,
    `Tax owed: ${formatMoney(tax)}`,
    `After-tax winnings: ${formatMoney(net)}`,
  ].join('\n');
}

export function renderNoVig() {
  const os = [Number($('#novig-odds-1').value), Number($('#novig-odds-x').value), Number($('#novig-odds-2').value)];
  if (os.some((v) => v <= 1)) { $('#novig-results').textContent = 'Enter all three prices.'; return; }
  const ps = os.map((p) => 1 / p);
  const t = ps.reduce((s, v) => s + v, 0);
  const f = ps.map((v) => v / t).map((v) => 1 / v);
  $('#novig-results').textContent = [
    `Market total ${(t * 100).toFixed(1)}%`, `Hold +${((t - 1) * 100).toFixed(1)}%`, '', 'Fair odds',
    `1 ${f[0].toFixed(2)}`, `X ${f[1].toFixed(2)}`, `2 ${f[2].toFixed(2)}`,
  ].join('\n');
}

export function renderMiddle() {
  const ol = Number($('#mid-over-line').value), oo = Number($('#mid-over-odds').value);
  const ul = Number($('#mid-under-line').value), uo = Number($('#mid-under-odds').value);
  if ([ol, oo, ul, uo].some((v) => !Number.isFinite(v) || v <= 0)) { $('#mid-result').textContent = 'Enter both lines and prices.'; return; }
  $('#mid-result').textContent = [
    `Middle window: ${ol} to ${ul}`, '', `Normal outcome (one wins): ${oo.toFixed(2)} / ${uo.toFixed(2)}`,
    `MIDDLE HIT (both win!): any result between ${ol} and ${ul}`,
  ].join('\n');
}

export function renderConverter() {
  const d = Number($('#conv-decimal').value);
  if (!Number.isFinite(d) || d <= 1) { $('#conv-results').textContent = 'Enter valid decimal > 1.00.'; return; }
  const n = Math.round((d - 1) * 2), dn = 2, g = gcd(n, dn);
  const am = d >= 2 ? `+${Math.round((d - 1) * 100)}` : `${Math.round(-100 / (d - 1))}`;
  $('#conv-results').textContent = [`Fractional ${(n / g)}/${(dn / g)}`, `American ${am}`, `Implied prob ${(100 / d).toFixed(1)}%`].join('\n');
}

export function renderCalculator() {
  updateLoadedSelection();
  renderDutchSummary();
  renderConverter();
  renderTaxCalculator();
}
