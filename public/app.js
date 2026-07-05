'use strict';

const BET_JOURNAL_KEY = 'arbDeskBetJournal';
const THEME_KEY = 'arbDeskTheme';
const FAVORITES_KEY = 'arbDeskBookmakerFavorites';
const HIDDEN_KEY = 'arbDeskBookmakerHidden';
const SOUND_KEY = 'arbDeskSound';
const DENSE_KEY = 'arbDeskDense';
const PAGE_ROUTES = ['scanner', 'value', 'ai', 'calculator', 'journal', 'analytics', 'movement', 'bookmakers', 'matches'];
const TAX_THRESHOLD_RON = 10000;
const TAX_RATE = 0.03;

// #5 — Bookmaker color coding
const BOOKMAKER_COLORS = {
  Fortuna: '#e30613', 'Casa Pariurilor': '#0066b3', Superbet: '#ffcc00', BetOne: '#1cb564',
  Betfair: '#ffb80e', Betmen: '#0099cc', GetsBet: '#e31837', Winner: '#f47b20',
  '888': '#0073cf', MrPlay: '#1abc9c', Bet7: '#ff6b35', HotSpins: '#ff4757',
  EliteSlots: '#9b59b6', LasVegas: '#e74c3c', MaxBet: '#2ecc71', NetBet: '#3498db',
  Winbet: '#e67e22', VivaBet: '#1abc9c', LuckySeven: '#f39c12', Unibet: '#0a9e01',
  Betano: '#003e7e', Prowin: '#c0392b', CherryBet: '#e91e63', VipBet: '#8e44ad',
};
function bookmakerColor(name) { return BOOKMAKER_COLORS[name] || `hsl(${[...name].reduce((h,c)=>h+c.charCodeAt(0),0)%360},65%,55%)`; }
function bookmakerDot(name) { return `<span class="bm-dot" style="background:${bookmakerColor(name)}"></span>`; }

const state = {
  page: 'scanner', mode: 'loading', fetchedAt: null, warnings: [], search: '', sport: '',
  minEdge: 0, alertThreshold: 5, confidenceFilter: '', denseView: false,
  events: [], opportunities: [], prevOppIds: new Set(), valueBets: [], bookmakerCoverage: null,
  localJournal: [], serverJournal: [], analytics: null, movement: null, arbHistory: null,
  selectedOdds: null, refreshIntervalMs: 60000, refreshTimer: null, stream: null, lastLoadOk: false,
  favorites: [], hiddenBookmakers: [], favoritesOnly: false, showAllMarkets: false,
  soundEnabled: true, audioCtx: null, lastSoundMs: 0,
  pinnedArbs: new Set(), activityLog: [],
  journalSearch: '', journalStatusFilter: '', journalBookmakerFilter: '',
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

function escapeHtml(v) { return String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function formatTime(iso) { if (!iso) return '-'; const d = new Date(iso); return d.toLocaleDateString('ro-RO',{day:'2-digit',month:'short'}) + ' ' + d.toLocaleTimeString('ro-RO',{hour:'2-digit',minute:'2-digit'}); }
function formatMoney(v) { return `${Number(v||0).toFixed(2)} RON`; }
function formatPct(v,d=1) { return `${(Number(v||0)*100).toFixed(d)}%`; }
function normalizeText(v) { return String(v||'').toLowerCase().trim(); }
function getVisiblePage() { return PAGE_ROUTES.includes(state.page) ? state.page : 'scanner'; }
function arbId(opp) { return `${opp.eventName}|${opp.marketKey}`; }

function readJournal() { try { state.localJournal = JSON.parse(localStorage.getItem(BET_JOURNAL_KEY)||'[]'); if (!Array.isArray(state.localJournal)) state.localJournal = []; } catch { state.localJournal = []; } }
function writeJournal() { localStorage.setItem(BET_JOURNAL_KEY, JSON.stringify(state.localJournal)); }

// #9 — Toast notifications
function toast(msg) {
  const c = $('#toast-container'); if (!c) return;
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  c.appendChild(t);
  requestAnimationFrame(() => t.classList.add('toast--show'));
  setTimeout(() => { t.classList.remove('toast--show'); setTimeout(() => t.remove(), 300); }, 2500);
}

// #11 — Recent activity timeline
function logActivity(text, page) {
  state.activityLog.unshift({ text, page, at: new Date().toISOString() });
  if (state.activityLog.length > 5) state.activityLog.pop();
  renderActivityTimeline();
}
function renderActivityTimeline() {
  const el = $('#activity-timeline'); if (!el) return;
  if (state.activityLog.length === 0) { el.innerHTML = ''; return; }
  el.innerHTML = state.activityLog.map(a => `<div class="activity-item" data-nav="${a.page}"><span class="activity-time">${formatTime(a.at).split(' ')[1]}</span> ${escapeHtml(a.text)}</div>`).join('');
  el.querySelectorAll('.activity-item').forEach(item => item.addEventListener('click', () => setPage(item.dataset.nav)));
}

// #1 — Live update without page jump (highlight new/faded arbs)
function detectArbChanges(newOpps) {
  const newIds = new Set(newOpps.map(arbId));
  const appeared = newOpps.filter(o => !state.prevOppIds.has(arbId(o)));
  const disappeared = [...state.prevOppIds].filter(id => !newIds.has(id));
  state.prevOppIds = newIds;
  return { appeared, disappeared, newIds };
}

// PWA SW
function initServiceWorker() { if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{}); }

// #12 — Arb Detail Modal
function openArbModal(opp) {
  const overlay = $('#arb-modal-overlay');
  $('#arb-modal-title').textContent = opp.eventName || 'Unknown';
  $('#arb-modal-subtitle').textContent = `${opp.marketLabel||opp.marketKey||''} · ${opp.competition||''} · Edge ${formatPct(opp.edge)}`;
  const legs = (opp.legs||[]); const stake = opp.stake||100;
  const totalProb = legs.reduce((s,l)=>s+(1/l.price),0);
  $('#arb-modal-body').innerHTML = `
    <div class="modal-summary">
      <div class="value-card__metric"><span>Total stake</span><strong>${formatMoney(stake)}</strong></div>
      <div class="value-card__metric"><span>Return</span><strong>${formatMoney(stake/totalProb)}</strong></div>
      <div class="value-card__metric"><span>Profit</span><strong style="color:var(--profit)">+${formatMoney(opp.profit)}</strong></div>
      <div class="value-card__metric"><span>Edge</span><strong>${formatPct(opp.edge)}</strong></div>
    </div><hr style="border-color:var(--line);margin:12px 0">
    ${legs.map(leg => {
      const ls = (stake*(1/leg.price))/totalProb; const lr = ls*leg.price;
      const url = leg.url||'';
      return `<div class="modal-leg"><div class="modal-leg__head"><div>${bookmakerDot(leg.bookmaker)} <strong>${escapeHtml(leg.label||leg.outcome)}</strong><span class="muted-line">${escapeHtml(leg.bookmaker)} @ ${Number(leg.price).toFixed(2)}</span></div><div class="modal-leg__stake"><span>Stake</span><strong>${formatMoney(ls)}</strong><span>Return</span><strong>${formatMoney(lr)}</strong></div></div><div class="modal-leg__actions">${url?`<a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="modal__deep-link">Open →</a>`:'<span class="muted-line">No link</span>'}<button class="ghost-button modal-copy-btn" data-stake="${ls.toFixed(2)}" type="button">Copy</button><button class="ghost-button modal-journal-btn" data-event="${escapeHtml(opp.eventName||'')}" data-market="${escapeHtml(opp.marketLabel||opp.marketKey||'')}" data-selection="${escapeHtml(leg.label||leg.outcome||'')} @ ${escapeHtml(leg.bookmaker)}" data-bookmaker="${escapeHtml(leg.bookmaker)}" data-odds="${leg.price}" type="button">Save</button></div></div>`;
    }).join('')}`;
  $('#arb-modal-body').querySelectorAll('.modal-copy-btn').forEach(b => b.addEventListener('click', () => { navigator.clipboard.writeText(b.dataset.stake).then(()=>{toast('Stake copied'); b.textContent='Copied!'; setTimeout(()=>b.textContent='Copy',1500);}).catch(()=>{}); }));
  $('#arb-modal-body').querySelectorAll('.modal-journal-btn').forEach(b => b.addEventListener('click', () => { createLocalJournalEntry({type:'arb-leg',event:b.dataset.event,market:b.dataset.market,selection:b.dataset.selection,bookmaker:b.dataset.bookmaker,odds:Number(b.dataset.odds),stake:100}); toast('Saved to journal'); b.textContent='Saved!'; b.disabled=true; }));
  overlay.hidden = false;
}
function closeArbModal() { $('#arb-modal-overlay').hidden = true; }

// Favorites
function readFavorites() { try { state.favorites = JSON.parse(localStorage.getItem(FAVORITES_KEY)||'[]'); state.hiddenBookmakers = JSON.parse(localStorage.getItem(HIDDEN_KEY)||'[]'); } catch { state.favorites=[]; state.hiddenBookmakers=[]; } }
function saveFavorites() { localStorage.setItem(FAVORITES_KEY, JSON.stringify(state.favorites)); localStorage.setItem(HIDDEN_KEY, JSON.stringify(state.hiddenBookmakers)); }
function toggleFavorite(n) { const i=state.favorites.indexOf(n); if(i>=0) state.favorites.splice(i,1); else state.favorites.push(n); saveFavorites(); }
function toggleHidden(n) { const i=state.hiddenBookmakers.indexOf(n); if(i>=0) state.hiddenBookmakers.splice(i,1); else state.hiddenBookmakers.push(n); saveFavorites(); }
function sortBookmakers(bms) { return bms.filter(b=>!state.hiddenBookmakers.includes(b.name)).sort((a,b)=>{const af=state.favorites.includes(a.name),bf=state.favorites.includes(b.name);if(af&&!bf)return-1;if(!af&&bf)return 1;return a.name.localeCompare(b.name);}); }

// Theme
function initTheme() { applyTheme(localStorage.getItem(THEME_KEY)||'system'); }
function resolveTheme(t) { return t==='system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light') : t; }
function applyTheme(t) { document.documentElement.dataset.theme=resolveTheme(t); document.documentElement.dataset.themeChoice=t; localStorage.setItem(THEME_KEY,t); document.querySelectorAll('.theme-toggle svg').forEach(s=>s.style.display='none'); const ai=document.querySelector(`.theme-toggle .icon-${t}`); if(ai) ai.style.display='block'; if(t==='system'){const mq=window.matchMedia('(prefers-color-scheme: dark)');mq.onchange=()=>{document.documentElement.dataset.theme=resolveTheme('system');};} }
function cycleTheme() { const c=localStorage.getItem(THEME_KEY)||'dark'; const o=['dark','light','system']; applyTheme(o[(o.indexOf(c)+1)%o.length]); }

// Sound
function initSound() { const s=localStorage.getItem(SOUND_KEY); state.soundEnabled=s===null?true:s==='true'; const t=$('#sound-alert-toggle'); if(t) t.checked=state.soundEnabled; }
function toggleSound() { state.soundEnabled=!state.soundEnabled; localStorage.setItem(SOUND_KEY,String(state.soundEnabled)); }
function playAlertSound() { if(!state.soundEnabled)return; const n=Date.now(); if(n-state.lastSoundMs<3000)return; state.lastSoundMs=n; try{ if(!state.audioCtx) state.audioCtx=new(window.AudioContext||window.webkitAudioContext)(); const c=state.audioCtx; const o=c.createOscillator(); const g=c.createGain(); o.connect(g); g.connect(c.destination); o.frequency.setValueAtTime(880,c.currentTime); o.frequency.exponentialRampToValueAtTime(1320,c.currentTime+0.15); g.gain.setValueAtTime(0.15,c.currentTime); g.gain.exponentialRampToValueAtTime(0.01,c.currentTime+0.3); o.start(c.currentTime); o.stop(c.currentTime+0.3);}catch{} }

// Notifications
function initNotifications() { if(!('Notification' in window))return; if(Notification.permission==='default') Notification.requestPermission(); }
function notifyHighEdge(o) { if(!('Notification' in window)||Notification.permission!=='granted')return; new Notification(`Arb alert: ${(o.edge*100).toFixed(1)}% edge`,{body:`${o.eventName} — ${o.marketLabel||o.marketKey}`}); }
function triggerAlerts(opps) { const th=state.alertThreshold/100; let a=false; opps.forEach(o=>{if(o.edge>=th){notifyHighEdge(o);a=true;}}); if(a) playAlertSound(); }

// Dense view
function initDense() { const d=localStorage.getItem(DENSE_KEY)==='true'; state.denseView=d; const t=$('#dense-view-toggle'); if(t) t.checked=d; }
function toggleDense() { state.denseView=!state.denseView; localStorage.setItem(DENSE_KEY,String(state.denseView)); document.body.classList.toggle('dense-view',state.denseView); renderScanner(); }

// Data loading
async function fetchJson(u) { const r=await fetch(u); if(!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }
async function loadData(refresh=false) {
  $('#loading').hidden=false; $('#error').hidden=true; $('#refresh-btn').disabled=true; $('#data-mode').textContent='Loading';
  try {
    const p=new URLSearchParams(); if(refresh)p.set('refresh','1'); if(state.sport)p.set('sport',state.sport);
    const oddsUrl=`/api/odds${p.toString()?`?${p}`:''}`;
    const [odds,opps,vb,bm,jr] = await Promise.all([fetchJson(oddsUrl),fetchJson('/api/opportunities?sort=edge'),fetchJson('/api/value-bets?limit=24'),fetchJson('/api/bookmakers'),fetchJson('/api/bets')]);
    state.mode=odds.mode||'demo'; state.fetchedAt=odds.fetchedAt||new Date().toISOString(); state.warnings=odds.warnings||[];
    state.events=odds.events||[]; state.opportunities=opps.opportunities||[]; state.valueBets=vb.valueBets||[];
    state.bookmakerCoverage=bm; state.serverJournal=jr.bets||[]; state.lastLoadOk=true;
    const changes = detectArbChanges(state.opportunities);
    if (changes.appeared.length > 0) logActivity(`${changes.appeared.length} new arb${changes.appeared.length===1?'':'s'}`, 'scanner');
    renderStatus(); renderAllPages(); $('#loading').hidden=true;
    triggerAlerts(state.opportunities);
  } catch(e) { console.error('Arb Desk load failed',e); state.lastLoadOk=false; $('#loading').hidden=true; $('#error').hidden=false; $('#error-msg').textContent=e.message||'Unknown error'; }
  finally { $('#refresh-btn').disabled=false; }
}

// SSE
function connectStream() { if(state.stream){state.stream.abort();state.stream=null;} try{const c=new AbortController(); state.stream=c; const p=new URLSearchParams(); if(state.sport)p.set('sport',state.sport); fetch(`/api/odds/stream${p.toString()?`?${p}`:''}`,{signal:c.signal}).then(async r=>{if(!r.ok)return;const rd=r.body.getReader();const dec=new TextDecoder();let buf='';while(true){const{done,value}=await rd.read();if(done)break;buf+=dec.decode(value,{stream:true});const ls=buf.split('\n');buf=ls.pop()||'';for(const l of ls){if(!l.trim())continue;try{handleStreamSnapshot(JSON.parse(l));}catch{}}}}).catch(()=>{});}catch{} }
function handleStreamSnapshot(s) { if(!s||!s.events)return; state.mode=s.mode||state.mode; state.fetchedAt=s.fetchedAt||state.fetchedAt; state.warnings=s.warnings||[]; state.events=s.events; refreshOpportunities(); renderStatus(); renderAllPages(); }
async function refreshOpportunities() { try{const[o,v]=await Promise.all([fetchJson('/api/opportunities?sort=edge'),fetchJson('/api/value-bets?limit=24')]); state.opportunities=o.opportunities||[]; state.valueBets=v.valueBets||[]; const ch=detectArbChanges(state.opportunities); if(ch.appeared.length>0) logActivity(`${ch.appeared.length} new arb${ch.appeared.length===1?'':'s'}`,'scanner'); renderScanner(); renderValue(); renderAi(); triggerAlerts(state.opportunities);}catch{} }

// Auto-refresh
function setupAutoRefresh() { if(state.refreshTimer){clearInterval(state.refreshTimer);state.refreshTimer=null;} const s=$('#refresh-interval'); if(!s)return; const sec=Number(s.value||0); state.refreshIntervalMs=sec*1000; if(sec>0) state.refreshTimer=setInterval(()=>loadData(false),state.refreshIntervalMs); }

// Rendering
function renderStatus() {
  $('#data-mode').textContent=state.mode==='live'?'Live data':state.mode==='demo'?'Demo data':'Offline';
  $('#live-dot').dataset.mode=state.mode;
  $('#last-updated').textContent=`Updated ${formatTime(state.fetchedAt)}`;
  if(state.warnings.length>0){$('#warning').hidden=false;$('#warning-title').textContent='Warning:';$('#warning-text').textContent=state.warnings.join(' · ');}else{$('#warning').hidden=true;}
  renderDeskOverview();
}

function renderDeskOverview() {
  const el = $('#desk-overview');
  if (!el) return;
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

function setPage(page,push=true) {
  state.page=PAGE_ROUTES.includes(page)?page:'scanner'; const vp=getVisiblePage();
  $$('.page').forEach(n=>n.classList.toggle('page--hidden',n.dataset.page!==vp));
  $$('[data-nav]').forEach(b=>b.classList.toggle('is-active',b.dataset.nav===vp));
  if(push){const t=vp==='scanner'?'':`/${vp}`; history.replaceState({},'',t);}
  if(vp==='analytics'&&!state.analytics) loadAnalytics();
  if(vp==='movement'&&!state.movement) loadMovement();
  renderBetSlip();
}

function activeSearchMatch(...p) { return !state.search || normalizeText(p.join(' ')).includes(state.search); }
function getFilteredEvents() { return state.events.filter(e=>activeSearchMatch(e.homeTeam,e.awayTeam,e.competition,e.sport)); }
function getFilteredOpportunities() {
  let opps = state.opportunities.filter(o=>o.edge*100>=state.minEdge && activeSearchMatch(o.eventName,o.marketLabel,o.competition));
  if (state.confidenceFilter === 'trusted') opps = opps.filter(o=>o.confidence==='trusted');
  else if (state.confidenceFilter === 'review') opps = opps.filter(o=>['trusted','review'].includes(o.confidence));
  // #2 — Sticky arb cards: filter out nothing, but sort pinned to top
  return opps.sort((a,b) => {
    const ap = state.pinnedArbs.has(arbId(a)) ? 1 : 0;
    const bp = state.pinnedArbs.has(arbId(b)) ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return b.edge - a.edge;
  });
}
function getFilteredValueBets() { return state.valueBets.filter(b=>activeSearchMatch(b.eventName,b.marketLabel,b.bookmaker)); }

function renderAllPages() { renderScanner(); renderValue(); renderAi(); renderCalculator(); renderJournal(); renderBookmakers(); renderMatches(); renderDeskOverview(); setPage(state.page,false); }

// #1, #2, #5, #10, #12, #13, #15 — Scanner with highlights, pinning, color dots, dense view, modal, deep links, confidence filter
function renderScanner() {
  const list=$('#scanner-list'); const opps=getFilteredOpportunities(); list.innerHTML='';
  if(opps.length===0){list.innerHTML='<div class="state-panel">No arbitrage opportunities matched the current filter. Try lowering the min edge or refreshing.</div>';return;}
  opps.forEach(opp => {
    const id = arbId(opp);
    const isNew = !state.prevOppIds.has(id) || false; // not tracking precisely here, but highlight via CSS class
    const isPinned = state.pinnedArbs.has(id);
    const cc = opp.confidence==='trusted'?'pill--good':opp.confidence==='risky'?'pill--warn':'';
    const legs = (opp.legs||[]).map(leg => {
      const url = leg.url||'';
      const link = url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="leg-link">${bookmakerDot(leg.bookmaker)} ${escapeHtml(leg.bookmaker)}</a>` : `${bookmakerDot(leg.bookmaker)} ${escapeHtml(leg.bookmaker)}`;
      return `<li>${escapeHtml(leg.label)} - ${link} @ ${Number(leg.price).toFixed(2)}</li>`;
    }).join('');
    const article = document.createElement('article');
    article.className = `arb-card${isPinned?' arb-card--pinned':''}`;
    article.innerHTML = `
      <div class="arb-card__top"><div><h2 class="arb-card__title">${escapeHtml(opp.eventName)}</h2><div class="muted-line">${escapeHtml(opp.marketLabel||opp.marketKey)} · ${escapeHtml(opp.competition||'')}</div></div><span class="pill ${cc}">${escapeHtml(opp.confidence||'review')}</span></div>
      <div class="value-card__metric"><span>Edge</span><strong>${formatPct(opp.edge)}</strong></div>
      <div class="value-card__metric"><span>Profit on 100 RON</span><strong class="arb-card__profit">+${Number(opp.profit).toFixed(2)} RON</strong></div>
      <ol class="legs-list">${legs}</ol>
      <div class="arb-card__footer">
        <button class="ghost-button arb-detail-btn" type="button">Details</button>
        <button class="ghost-button arb-pin-btn" type="button">${isPinned?'Pinned':'Pin'}</button>
      </div>`;
    article.querySelector('.arb-detail-btn').addEventListener('click', () => openArbModal(opp));
    article.querySelector('.arb-pin-btn').addEventListener('click', () => {
      if (state.pinnedArbs.has(id)) { state.pinnedArbs.delete(id); toast('Arb unpinned'); }
      else { state.pinnedArbs.add(id); toast('Arb pinned'); }
      renderScanner();
    });
    list.appendChild(article);
  });
}

function renderValue() {
  const list=$('#value-list'); const bets=getFilteredValueBets(); list.innerHTML='';
  if(bets.length===0){list.innerHTML='<div class="state-panel">No value bets are available right now.</div>';return;}
  bets.forEach(bet => {
    const card=document.createElement('article'); card.className='value-card';
    card.innerHTML=`<div class="value-card__top"><div><h2 class="value-card__title">${escapeHtml(bet.eventName)}</h2><div class="muted-line">${escapeHtml(bet.marketLabel)} · ${escapeHtml(bet.label)} · ${bookmakerDot(bet.bookmaker)} ${escapeHtml(bet.bookmaker)}</div></div><span class="pill pill--good">Kelly ${Math.min(25,bet.kelly*100).toFixed(1)}%</span></div><div class="value-card__metric"><span>Price</span><strong>${Number(bet.price).toFixed(2)}</strong></div><div class="value-card__metric"><span>Consensus</span><strong>${Number(bet.consensus).toFixed(2)}</strong></div><div class="value-card__metric"><span>Gap</span><strong>${formatPct(bet.gap)}</strong></div><button class="primary-button" type="button">Calculate</button>`;
    card.querySelector('button').addEventListener('click',()=>{loadSelectionIntoCalculator({event:bet.eventName,market:bet.marketLabel,outcome:bet.label,bookmaker:bet.bookmaker,odds:bet.price,consensus:bet.consensus,type:'value'});setPage('calculator');});
    list.appendChild(card);
  });
}

function renderAi() {
  const list=$('#ai-list'); const bets=getFilteredValueBets().slice(0,8); list.innerHTML='';
  if(bets.length===0){list.innerHTML='<div class="state-panel empty-state">No AI review cards are available right now.</div>';return;}
  bets.forEach((bet,i)=>{
    const card=document.createElement('article'); card.className='ai-card';
    card.innerHTML=`<div class="value-card__top"><div><h2 class="ai-card__title">${escapeHtml(bet.eventName)}</h2><div class="muted-line">${escapeHtml(bet.marketLabel)} · ${escapeHtml(bet.label)}</div></div><span class="pill ${i===0?'pill--good':''}">Candidate ${i+1}</span></div><div class="ai-card__metric"><span>Bookmaker</span><strong>${bookmakerDot(bet.bookmaker)} ${escapeHtml(bet.bookmaker)}</strong></div><div class="ai-card__metric"><span>Odds</span><strong>${Number(bet.price).toFixed(2)}</strong></div><div class="ai-card__metric"><span>Gap</span><strong>${formatPct(bet.gap)}</strong></div><button class="primary-button" type="button">Save to journal</button>`;
    card.querySelector('button').addEventListener('click',()=>{createLocalJournalEntry({type:'ai-value',event:bet.eventName,market:bet.marketLabel,selection:bet.label,bookmaker:bet.bookmaker,odds:bet.price,stake:100});toast('Saved to journal');setPage('journal');});
    list.appendChild(card);
  });
}

function renderCalculator() { updateLoadedSelection(); renderDutchSummary(); renderConverter(); renderTaxCalculator(); }
function getAllJournalEntries() { const l=state.localJournal.map(e=>({...e,source:'local'})); const s=state.serverJournal.map(e=>({...e,source:'server'})); return [...s,...l].sort((a,b)=>new Date(b.loggedAt||b.timestamp||0)-new Date(a.loggedAt||a.timestamp||0)); }

// #16 — Journal with search and filter
function getFilteredJournalEntries() {
  let entries = getAllJournalEntries();
  if (state.journalSearch) entries = entries.filter(e => normalizeText(`${e.event} ${e.market} ${e.selection} ${e.bookmaker}`).includes(normalizeText(state.journalSearch)));
  if (state.journalStatusFilter) entries = entries.filter(e => (e.status||'pending') === state.journalStatusFilter);
  if (state.journalBookmakerFilter) entries = entries.filter(e => e.bookmaker === state.journalBookmakerFilter);
  return entries;
}

function renderJournal() {
  const list=$('#journal-list'); const entries=getFilteredJournalEntries(); list.innerHTML='';
  // Update bookmaker filter dropdown
  const bmFilter = $('#journal-bookmaker-filter');
  const allBms = [...new Set(getAllJournalEntries().map(e=>e.bookmaker).filter(Boolean))].sort();
  const currentVal = bmFilter.value;
  bmFilter.innerHTML = '<option value="">All bookmakers</option>' + allBms.map(b=>`<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('');
  bmFilter.value = currentVal;

  if(entries.length===0){list.innerHTML='<div class="state-panel">No bets logged yet. Save a pick from the calculator or AI review queue.</div>';return;}
  entries.forEach(entry => {
    const article=document.createElement('article'); article.className='journal-card'; article.dataset.id=entry.id||''; article.dataset.type=entry.type||'manual';
    const status=entry.status||'pending';
    const taxOwed = Number(entry.taxOwed || 0);
    const netAfterTax = Number.isFinite(Number(entry.netProfitAfterTax)) ? Number(entry.netProfitAfterTax) : null;
    const pnl = netAfterTax ?? (status === 'won' ? (Number(entry.stake||0) * Number(entry.odds||0) - Number(entry.stake||0)) : status === 'lost' ? -Number(entry.stake||0) : 0);
    const settledMetrics = status !== 'pending'
      ? `<div class="value-card__metric"><span>P/L after tax</span><strong style="color:${pnl>=0?'var(--profit)':'var(--danger)'}">${formatMoney(pnl)}</strong></div><div class="value-card__metric"><span>Tax</span><strong>${formatMoney(taxOwed)}</strong></div>`
      : '';
    article.innerHTML=`<div class="journal-card__head"><div><h2 class="journal-card__title">${escapeHtml(entry.event)}</h2><div class="muted-line">${escapeHtml(entry.market)} · ${escapeHtml(entry.selection)} · ${bookmakerDot(entry.bookmaker)} ${escapeHtml(entry.bookmaker)}</div></div><span class="pill journal-card__status">${escapeHtml(status)}</span></div><div class="value-card__metric"><span>Odds</span><strong>${Number(entry.odds||0).toFixed(2)}</strong></div><div class="value-card__metric"><span>Stake</span><strong>${formatMoney(entry.stake||0)}</strong></div><div class="value-card__metric"><span>Saved</span><strong>${formatTime(entry.loggedAt||entry.timestamp)}</strong></div>${settledMetrics}<div class="journal-card__actions"><button class="ghost-button" data-action="won" type="button">Won</button><button class="ghost-button" data-action="lost" type="button">Lost</button><button class="ghost-button" data-action="remove" type="button">Remove</button></div>`;
    article.querySelector('[data-action="won"]').addEventListener('click',()=>settleJournalEntry(article,entry,'won'));
    article.querySelector('[data-action="lost"]').addEventListener('click',()=>settleJournalEntry(article,entry,'lost'));
    article.querySelector('[data-action="remove"]').addEventListener('click',()=>removeJournalEntry(article,entry));
    list.appendChild(article);
  });
}

function renderBookmakers() {
  const list=$('#bookmakers-list'); list.innerHTML=''; const entries=state.bookmakerCoverage?.entries||[];
  if(entries.length===0){list.innerHTML='<div class="state-panel">No bookmaker coverage data is available.</div>';return;}
  entries.forEach(entry=>{const card=document.createElement('article');card.className='bookmaker-card';card.innerHTML=`<div class="value-card__top"><div><h2 class="ai-card__title">${bookmakerDot(entry.name)} ${escapeHtml(entry.name)}</h2><div class="muted-line">${escapeHtml(entry.domain||'')}</div></div><span class="pill">${escapeHtml(entry.status||'unknown')}</span></div><div class="muted-line">${escapeHtml(entry.adapter||entry.note||'Coverage tracked in the local registry.')}</div>`;list.appendChild(card);});
}

// #5, #14 — Matches with color dots and market depth toggle
function renderMatches() {
  const list=$('#matches-list'); const events=getFilteredEvents(); list.innerHTML='';
  if(events.length===0){list.innerHTML='<div class="state-panel">No matches matched the current filters.</div>';return;}
  events.forEach(event=>{
    const card=document.createElement('article'); card.className='match-card';
    card.innerHTML=`<div class="match-card__head"><div><h2 class="match-card__title">${escapeHtml(event.homeTeam)} vs ${escapeHtml(event.awayTeam)}</h2><div class="muted-line">${escapeHtml(event.competition||'')} · ${escapeHtml(event.sport||'')} · ${formatTime(event.startsAt)}</div></div></div>`;
    const sortedBms = sortBookmakers(event.bookmakers||[]);
    const table=document.createElement('table'); table.className='odds-table';
    table.innerHTML=`<thead><tr><th>Bookmaker</th><th>Market</th><th>Selections</th><th></th></tr></thead><tbody></tbody>`;
    const body=table.querySelector('tbody');
    sortedBms.forEach(bm=>{
      const isFav=state.favorites.includes(bm.name);
      const allMarkets=Object.entries(bm.markets||{});
      const marketEntries=state.showAllMarkets?allMarkets:allMarkets.slice(0,3);
      marketEntries.forEach(([mk,outcomes])=>{
        const row=document.createElement('tr');
        const selHtml=Object.entries(outcomes||{}).map(([o,od])=>`<button class="odds-button" type="button" data-odds="${Number(od)}" data-bookmaker="${escapeHtml(bm.name)}" data-market="${escapeHtml(mk)}" data-outcome="${escapeHtml(o)}" data-event="${escapeHtml(`${event.homeTeam} vs ${event.awayTeam}`)}">${escapeHtml(o)} ${Number(od).toFixed(2)}</button>`).join(' ');
        row.innerHTML=`<td>${bookmakerDot(bm.name)}${escapeHtml(bm.name)}</td><td>${escapeHtml(mk)}</td><td>${selHtml}</td><td class="bm-actions"><button class="bm-action-btn" data-action="fav" data-bm="${escapeHtml(bm.name)}" type="button" title="${isFav?'Unpin':'Pin'}">${isFav?'Pinned':'Pin'}</button><button class="bm-action-btn" data-action="hide" data-bm="${escapeHtml(bm.name)}" type="button" title="Hide">Hide</button></td>`;
        body.appendChild(row);
      });
    });
    card.appendChild(table);
    card.querySelectorAll('[data-odds]').forEach(btn=>btn.addEventListener('click',()=>{loadSelectionIntoCalculator({event:btn.dataset.event,market:btn.dataset.market,outcome:btn.dataset.outcome,bookmaker:btn.dataset.bookmaker,odds:Number(btn.dataset.odds),type:'manual'});setPage('calculator');}));
    card.querySelectorAll('.bm-action-btn').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();const a=btn.dataset.action,bm=btn.dataset.bm;if(a==='fav')toggleFavorite(bm);if(a==='hide')toggleHidden(bm);renderMatches();}));
    list.appendChild(card);
  });
}

// #3 — Bet Slip Drawer
function renderBetSlip() {
  const list = $('#bet-slip-list'); if (!list) return;
  const pending = getAllJournalEntries().filter(e => (e.status||'pending') === 'pending');
  $('#bet-slip-count').textContent = pending.length;
  if (pending.length === 0) { list.innerHTML = '<div class="state-panel" style="padding:12px">No active positions.</div>'; return; }
  list.innerHTML = pending.map(e => {
    const event = state.events.find(ev => `${ev.homeTeam} vs ${ev.awayTeam}` === e.event);
    let liveOdds = null;
    if (event) { for (const bm of event.bookmakers||[]) { if (bm.name === e.bookmaker) { for (const [mk,outcomes] of Object.entries(bm.markets||{})) { for (const [o,od] of Object.entries(outcomes||{})) { if (o === e.selection?.split(' @ ')[0] || e.selection?.includes(o)) { liveOdds = od; } } } } } }
    const moved = liveOdds && Number(liveOdds) !== Number(e.odds);
    const movedClass = moved ? (Number(liveOdds) > Number(e.odds) ? 'bet-slip-up' : 'bet-slip-down') : '';
    return `<div class="bet-slip-item ${movedClass}"><div><strong>${escapeHtml(e.event)}</strong></div><div class="muted-line">${bookmakerDot(e.bookmaker)} ${escapeHtml(e.bookmaker)} · ${escapeHtml(e.selection||'')} @ ${Number(e.odds).toFixed(2)}${moved?` → ${Number(liveOdds).toFixed(2)}`:''}</div><div class="muted-line">Stake: ${formatMoney(e.stake||0)}</div></div>`;
  }).join('');
}

// Arb History
async function logArbHistory() { const o=getFilteredOpportunities(); if(o.length===0)return; try{await fetch('/api/arbs/log',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({opportunities:o})});}catch{} }
async function loadArbHistory() { try{const d=await fetchJson('/api/arbs?limit=50');state.arbHistory=d;renderArbHistory();}catch{$('#arb-history-list').innerHTML='<div class="state-panel">Unable to load arb history.</div>';} }
function renderArbHistory() { const l=$('#arb-history-list'); if(!state.arbHistory||!state.arbHistory.records||state.arbHistory.records.length===0){l.innerHTML='<div class="state-panel">No arb history yet. Opportunities are logged when you refresh the scanner.</div>';return;} l.innerHTML=''; state.arbHistory.records.forEach(r=>{const a=document.createElement('article');a.className='arb-card';a.innerHTML=`<div class="arb-card__top"><div><h2 class="arb-card__title">${r.count} opportunity${r.count===1?'':'ies'}</h2><div class="muted-line">${formatTime(r.loggedAt)}</div></div></div>${(r.opportunities||[]).slice(0,5).map(o=>`<div class="muted-line">${escapeHtml(o.eventName)} · ${formatPct(o.edge)} · ${escapeHtml(o.marketLabel||o.marketKey)} · ${(o.legs||[]).map(l=>`${escapeHtml(l.label)}@${escapeHtml(l.bookmaker)}`).join(', ')}</div>`).join('')}`;l.appendChild(a);}); }

// Analytics
async function loadAnalytics() { try{const d=await fetchJson('/api/bets/analytics');state.analytics=d;renderAnalytics();}catch{$('#analytics-summary').innerHTML='<div class="state-panel">Unable to load analytics.</div>';} }
function renderAnalytics() {
  if(!state.analytics)return;
  const s=state.analytics.summary;
  const afterTax = Number.isFinite(Number(s.netProfitAfterTax)) ? Number(s.netProfitAfterTax) : Number(s.netProfit||0);
  $('#analytics-summary').innerHTML=`
    <article class="value-card">
      <div class="value-card__top"><div><h2 class="value-card__title">Overview</h2></div></div>
      <div class="value-card__metric"><span>Total bets</span><strong>${s.totalBets}</strong></div>
      <div class="value-card__metric"><span>Settled</span><strong>${s.settledBets}</strong></div>
      <div class="value-card__metric"><span>Pending</span><strong>${s.pendingBets}</strong></div>
      <div class="value-card__metric"><span>Won / Lost</span><strong>${s.wonBets} / ${s.lostBets}</strong></div>
    </article>
    <article class="value-card">
      <div class="value-card__top"><div><h2 class="value-card__title">Financials</h2></div></div>
      <div class="value-card__metric"><span>Total stake</span><strong>${formatMoney(s.totalStake)}</strong></div>
      <div class="value-card__metric"><span>Return</span><strong>${formatMoney(s.totalReturn)}</strong></div>
      <div class="value-card__metric"><span>Net profit</span><strong style="color:${s.netProfit>=0?'var(--profit)':'var(--danger)'}">${formatMoney(s.netProfit)}</strong></div>
      <div class="value-card__metric"><span>Tax owed</span><strong>${formatMoney(s.taxOwed||0)}</strong></div>
      <div class="value-card__metric"><span>After-tax net</span><strong style="color:${afterTax>=0?'var(--profit)':'var(--danger)'}">${formatMoney(afterTax)}</strong></div>
      <div class="value-card__metric"><span>ROI</span><strong>${formatPct(s.roi,2)}</strong></div>
    </article>
    <article class="value-card">
      <div class="value-card__top"><div><h2 class="value-card__title">Quality</h2></div></div>
      <div class="value-card__metric"><span>Hit rate</span><strong>${formatPct(s.hitRate,1)}</strong></div>
      <div class="value-card__metric"><span>Avg odds</span><strong>${Number(s.avgOdds).toFixed(2)}</strong></div>
      <div class="value-card__metric"><span>Avg CLV</span><strong>${formatPct(s.avgClv,2)}</strong></div>
      <div class="value-card__metric"><span>CLV samples</span><strong>${s.clvSamples}</strong></div>
    </article>`;
  const bds=[{t:'By Bookmaker',d:state.analytics.byBookmaker},{t:'By Market',d:state.analytics.byMarket},{t:'By Competition',d:state.analytics.byCompetition}];
  $('#analytics-breakdown').innerHTML=bds.map(s=>`<article class="value-card"><div class="value-card__top"><div><h2 class="value-card__title">${s.t}</h2></div></div><table class="odds-table"><thead><tr><th>Name</th><th>Bets</th><th>Stake</th><th>Profit</th><th>ROI</th><th>Hit%</th></tr></thead><tbody>${Object.entries(s.d||{}).map(([k,v])=>`<tr><td>${escapeHtml(k)}</td><td>${v.bets}</td><td>${formatMoney(v.stake)}</td><td>${formatMoney(v.profit)}</td><td>${formatPct(v.roi,2)}</td><td>${formatPct(v.hitRate,1)}</td></tr>`).join('')||'<tr><td colspan="6" style="text-align:center;color:var(--text-tertiary)">No data</td></tr>'}</tbody></table></article>`).join('');
}

// Movement
async function loadMovement() { try{const d=await fetchJson('/api/odds/movement');state.movement=d;renderMovement();}catch{$('#movement-list').innerHTML='<div class="state-panel">Odds movement tracking not available yet.</div>';} }
function renderMovement() { if(!state.movement||!state.movement.movements){$('#movement-list').innerHTML='<div class="state-panel">No movement data available yet.</div>';return;}const l=$('#movement-list');const ms=state.movement.movements;l.innerHTML='';if(ms.length===0){l.innerHTML='<div class="state-panel">No price changes detected.</div>';return;}ms.forEach(m=>{const dc=m.direction==='up'?'pill--good':'pill--warn';const s=m.direction==='up'?'↑':'↓';const a=document.createElement('article');a.className='arb-card';a.innerHTML=`<div class="arb-card__top"><div><h2 class="arb-card__title">${escapeHtml(m.event)}</h2><div class="muted-line">${bookmakerDot(m.bookmaker)} ${escapeHtml(m.bookmaker)} · ${escapeHtml(m.market)} · ${escapeHtml(m.outcome)}</div></div><span class="pill ${dc}">${s} ${Number(m.change).toFixed(2)}</span></div><div class="value-card__metric"><span>Previous</span><strong>${Number(m.previous).toFixed(2)}</strong></div><div class="value-card__metric"><span>Current</span><strong>${Number(m.current).toFixed(2)}</strong></div>`;l.appendChild(a);});}

// Calculator
function loadSelectionIntoCalculator(s) { state.selectedOdds={...s,stake:Number($('#calc-stake').value||100)}; updateLoadedSelection(); }
function updateLoadedSelection() { if(!state.selectedOdds){$('#calc-odds').textContent='-';$('#calc-context').textContent='No selection loaded yet.';$('#calc-save').disabled=true;$('#calc-prob-output').innerHTML='<div><span>Implied probability</span><strong>-</strong></div>';$('#calc-kelly-output').innerHTML='<div><span>Suggested fraction</span><strong>-</strong></div>';return;} $('#calc-odds').textContent=Number(state.selectedOdds.odds).toFixed(2);$('#calc-context').textContent=`${state.selectedOdds.event} · ${state.selectedOdds.market} · ${state.selectedOdds.outcome} · ${state.selectedOdds.bookmaker}`;$('#calc-save').disabled=false;renderProbCalculator(); }
function renderProbCalculator() { const o=$('#calc-prob-output'),k=$('#calc-kelly-output');if(!state.selectedOdds){o.innerHTML='<div><span>Implied probability</span><strong>-</strong></div>';k.innerHTML='<div><span>Suggested fraction</span><strong>-</strong></div>';return;}const odds=Number(state.selectedOdds.odds);const br=Number($('#calc-bankroll').value||1000);if(odds<=1){o.innerHTML='<div><span>Invalid odds</span><strong>-</strong></div>';k.innerHTML='<div><span>Invalid</span><strong>-</strong></div>';return;}const ip=1/odds;let fp;if(state.selectedOdds.consensus&&state.selectedOdds.consensus>1)fp=1/state.selectedOdds.consensus;else fp=ip/(1+0.04);const fo=fp>0?1/fp:0;const e=Math.max(0,fp-ip);const b=odds-1;const kr=b>0?(b*fp-(1-fp))/b:0;const kf=Math.max(0,Math.min(0.25,kr));o.innerHTML=`<div><span>Implied probability</span><strong>${formatPct(ip)}</strong></div><div><span>Fair probability</span><strong>${formatPct(fp)}</strong></div><div><span>Fair odds</span><strong>${fo.toFixed(2)}</strong></div><div><span>Edge</span><strong>${formatPct(e)}</strong></div>`;k.innerHTML=`<div><span>Kelly (full)</span><strong>${formatPct(kr,2)}</strong></div><div><span>Kelly (capped)</span><strong>${formatPct(kf,2)}</strong></div><div><span>Stake</span><strong>${formatMoney(kf*br)}</strong></div>`; }

function renderAutoStake() { const br=Number($('#autostake-bankroll').value||0);const mp=Number($('#autostake-max-pct').value||25)/100;const mx=br*mp;const os=state.opportunities.filter(o=>o.edge>0).slice(0,20);const out=$('#autostake-results');if(os.length===0||br<=0){out.innerHTML='<div><span>Enter bankroll and ensure opportunities are loaded.</span></div>';return;}const te=os.reduce((s,o)=>s+o.edge,0);if(te<=0){out.innerHTML='<div><span>No positive-edge opportunities.</span></div>';return;}let al=0;const allocs=os.map(o=>{const p=(o.edge/te)*br;const st=Math.min(p,mx);al+=st;return{o,st};});const sc=al>br?br/al:1;const rows=allocs.map(({o,st})=>{const as=st*sc;const rp=o.stake?o.profit/o.stake:0;const ep=as*rp;return `<div class="value-card__metric"><span>${escapeHtml(o.eventName||'')} · ${formatPct(o.edge)}</span><strong>${formatMoney(as)} → +${formatMoney(ep)}</strong></div>`;}).join('');out.innerHTML=`<div class="value-card__metric"><span>Bankroll</span><strong>${formatMoney(br)}</strong></div><div class="value-card__metric"><span>Active arbs</span><strong>${os.length}</strong></div><div class="value-card__metric"><span>Allocated</span><strong>${formatMoney(al*sc)}</strong></div><div class="value-card__metric"><span>Unallocated</span><strong>${formatMoney(br-al*sc)}</strong></div><hr style="border-color:var(--line);margin:6px 0">${rows}`; }

function addDutchLeg(v='') { const r=document.createElement('div');r.className='dutch-leg';r.innerHTML=`<label class="field-block"><span>Odds</span><input type="number" step="0.01" value="${escapeHtml(v)}"></label><button class="ghost-button" type="button">Remove</button>`;r.querySelector('input').addEventListener('input',renderDutchSummary);r.querySelector('button').addEventListener('click',()=>{r.remove();renderDutchSummary();});$('#dutch-legs').appendChild(r); }
function renderDutchSummary() { const st=Number($('#dutch-stake').value||0);const os=$$('.dutch-leg input').map(i=>Number(i.value)).filter(v=>v>1);const s=$('#dutch-summary');if(os.length===0||st<=0){s.innerHTML='<div><span>Guaranteed return</span><strong>-</strong></div><div><span>Net profit</span><strong>-</strong></div><div><span>Cost</span><strong>-</strong></div>';return;}const tp=os.reduce((t,p)=>t+(1/p),0);const gr=st/tp;const p=gr-st;const c=Math.max(0,(tp-1)*100);s.innerHTML=`<div><span>Guaranteed return</span><strong>${formatMoney(gr)}</strong></div><div><span>Net profit</span><strong>${formatMoney(p)}</strong></div><div><span>Cost</span><strong>${c.toFixed(1)}%</strong></div>`; }
function renderArbCheck() { const ps=['#arb-odds-1','#arb-odds-2','#arb-odds-3'].map(s=>Number($(s).value)).filter(v=>v>1);if(ps.length!==3){$('#arb-check-result').textContent='Enter all three prices.';return;}const tp=ps.reduce((t,p)=>t+(1/p),0);const ra=100/tp;const p=ra-100;$('#arb-check-result').textContent=[p>0?'Arbitrage found':'No arbitrage edge','','',...ps.map((p,i)=>`Outcome ${i+1}: ${p.toFixed(2)} · Implied prob ${(100/p).toFixed(1)}%`),'',`Guaranteed return: ${ra.toFixed(2)} RON`,`Net profit: ${p.toFixed(2)} RON`].join('\n'); }
function renderTaxCalculator() {
  const stake = Number($('#tax-stake')?.value || 0);
  const odds = Number($('#tax-odds')?.value || 0);
  const ytd = Number($('#tax-ytd')?.value || 0);
  const out = $('#tax-result');
  if (!out) return;
  if (stake < 0 || odds <= 1 || ytd < 0) {
    out.textContent = 'Enter valid stake, odds, and year-to-date winnings.';
    return;
  }
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
function renderNoVig() { const os=[Number($('#novig-odds-1').value),Number($('#novig-odds-x').value),Number($('#novig-odds-2').value)];if(os.some(v=>v<=1)){$('#novig-results').textContent='Enter all three prices.';return;}const ps=os.map(p=>1/p);const t=ps.reduce((s,v)=>s+v,0);const f=ps.map(v=>v/t).map(v=>1/v);$('#novig-results').textContent=[`Market total ${ (t*100).toFixed(1) }%`,`Hold +${ ((t-1)*100).toFixed(1) }%`,'','Fair odds',`1 ${f[0].toFixed(2)}`,`X ${f[1].toFixed(2)}`,`2 ${f[2].toFixed(2)}`].join('\n'); }
function renderMiddle() { const ol=Number($('#mid-over-line').value),oo=Number($('#mid-over-odds').value),ul=Number($('#mid-under-line').value),uo=Number($('#mid-under-odds').value);if([ol,oo,ul,uo].some(v=>!Number.isFinite(v)||v<=0)){$('#mid-result').textContent='Enter both lines and prices.';return;}$('#mid-result').textContent=[`Middle window: ${ol} to ${ul}`,'',`Normal outcome (one wins): ${oo.toFixed(2)} / ${uo.toFixed(2)}`,`MIDDLE HIT (both win!): any result between ${ol} and ${ul}`].join('\n'); }
function renderConverter() { const d=Number($('#conv-decimal').value);if(!Number.isFinite(d)||d<=1){$('#conv-results').textContent='Enter valid decimal > 1.00.';return;}const n=Math.round((d-1)*2),dn=2,g=gcd(n,dn);const am=d>=2?`+${Math.round((d-1)*100)}`:`${Math.round(-100/(d-1))}`;$('#conv-results').textContent=[`Fractional ${(n/g)}/${(dn/g)}`,`American ${am}`,`Implied prob ${(100/d).toFixed(1)}%`].join('\n'); }
function gcd(a,b){return b?gcd(b,a%b):a;}

// Journal actions
function createLocalJournalEntry(e) { const r={id:`local-${Date.now()}-${Math.random().toString(16).slice(2,8)}`,timestamp:new Date().toISOString(),status:'pending',...e};state.localJournal.unshift(r);writeJournal();renderJournal();renderBetSlip(); }
async function saveCalculatorSelection() { if(!state.selectedOdds)return;try{const r=await fetch('/api/bets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:state.selectedOdds.type||'manual',event:state.selectedOdds.event,market:state.selectedOdds.market,selection:`${state.selectedOdds.outcome} @ ${state.selectedOdds.bookmaker}`,bookmaker:state.selectedOdds.bookmaker,odds:state.selectedOdds.odds,stake:Number($('#calc-stake').value||100)})});const p=await r.json();if(r.ok&&p.id){state.serverJournal.unshift(p);state.analytics=null;renderJournal();renderBetSlip();toast('Saved to journal');setPage('journal');return;}}catch{}createLocalJournalEntry({type:state.selectedOdds.type||'manual',event:state.selectedOdds.event,market:state.selectedOdds.market,selection:`${state.selectedOdds.outcome} @ ${state.selectedOdds.bookmaker}`,bookmaker:state.selectedOdds.bookmaker,odds:state.selectedOdds.odds,stake:Number($('#calc-stake').value||100)});toast('Saved to journal');setPage('journal'); }
async function settleJournalEntry(c,e,r) { if(e.source==='local'){state.localJournal=state.localJournal.map(i=>i.id===e.id?{...i,status:r,result:r}:i);writeJournal();state.analytics=null;renderJournal();renderBetSlip();toast(`Bet settled: ${r}`);return;}try{const r2=await fetch(`/api/bets/${e.id}/settle`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({result:r})});const p=await r2.json();if(!r2.ok||p.error)throw new Error(p.error||'Failed');state.serverJournal=state.serverJournal.map(i=>i.id===e.id?p:i);state.analytics=null;renderJournal();renderBetSlip();toast(`Bet settled: ${r}`);}catch(err){showJournalError(c,err.message);} }
async function removeJournalEntry(c,e) { if(e.source==='local'){state.localJournal=state.localJournal.filter(i=>i.id!==e.id);writeJournal();state.analytics=null;renderJournal();renderBetSlip();toast('Bet removed');return;}try{const r=await fetch(`/api/bets/${e.id}`,{method:'DELETE'});const p=await r.json();if(!r.ok||p.ok!==true)throw new Error(p.error||'Failed');state.serverJournal=state.serverJournal.filter(i=>i.id!==e.id);state.analytics=null;renderJournal();renderBetSlip();toast('Bet removed');}catch(err){showJournalError(c,err.message);} }
function showJournalError(c,m) { let n=c.querySelector('.journal-card__error');if(!n){n=document.createElement('div');n.className='journal-card__error';c.appendChild(n);}n.textContent=m; }
async function clearJournalEntries() { state.localJournal=[];writeJournal();state.analytics=null;renderJournal();renderBetSlip();toast('Local journal cleared'); }
async function exportCsv() { const r=await fetch(`/api/opportunities?minEdge=${encodeURIComponent(state.minEdge)}&sort=edge`);if(!r.ok)return;const p=await r.json();const rows=[['Event','Market','Edge','Profit','Legs']];(p.opportunities||[]).forEach(o=>rows.push([o.eventName||'',o.marketLabel||o.marketKey||'',`${(Number(o.edge)*100).toFixed(1)}%`,Number(o.profit||0).toFixed(2),(o.legs||[]).map(l=>`${l.label}@${l.bookmaker}`).join(' | ')]));const csv=rows.map(r=>r.map(csvEscape).join(',')).join('\n');const b=new Blob([csv],{type:'text/csv;charset=utf-8'});const u=URL.createObjectURL(b);const a=document.createElement('a');a.href=u;a.download='surebets.csv';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(u); }
function csvEscape(v) { const t=String(v??'');if(/[",\n]/.test(t))return`"${t.replace(/"/g,'""')}"`;return t; }

// Journal CSV export (#3 from roadmap)
function exportJournalCsv() {
  const entries = getAllJournalEntries();
  const rows = [['ID','Event','Market','Selection','Bookmaker','Odds','Stake','Status','Type','Saved']];
  entries.forEach(e => rows.push([e.id||'',e.event||'',e.market||'',e.selection||'',e.bookmaker||'',e.odds||'',e.stake||'',e.status||'pending',e.type||'manual',e.loggedAt||e.timestamp||'']));
  const csv = rows.map(r=>r.map(csvEscape).join(',')).join('\n');
  const b = new Blob([csv],{type:'text/csv;charset=utf-8'}); const u = URL.createObjectURL(b);
  const a = document.createElement('a'); a.href=u; a.download='journal.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(u);
  toast('Journal exported');
}

async function importJournalCsv(file) {
  if (!file) return;
  try {
    const csv = await file.text();
    const response = await fetch('/api/bets/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv }),
    });
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error || 'Import failed');
    const journal = await fetchJson('/api/bets');
    state.serverJournal = journal.bets || [];
    state.analytics = null;
    renderJournal();
    renderBetSlip();
    toast(`Imported ${payload.imported} bets`);
  } catch (error) {
    toast(`Import failed: ${error.message}`);
  }
}

// #15 — Keyboard shortcuts
function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Don't intercept when typing in inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') {
      if (e.key === 'Escape') { e.target.blur(); }
      return;
    }
    const key = e.key.toLowerCase();
    if (key === 'r') { e.preventDefault(); loadData(true); }
    else if (key === '/') { e.preventDefault(); $('#search').focus(); }
    else if (key === 's') { if (state.selectedOdds) saveCalculatorSelection(); }
    else if (key === 'f') { const cb = $('#show-favorites-only'); if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); } }
    else if (key === 'd') { toggleDense(); }
    else if (key === 'escape') { state.search=''; $('#search').value=''; renderAllPages(); closeArbModal(); }
    else if (key >= '1' && key <= '9') {
      const idx = Number(key) - 1;
      if (PAGE_ROUTES[idx]) setPage(PAGE_ROUTES[idx]);
    }
  });
}

// Bet slip drawer toggle
function toggleBetSlip() {
  const drawer = $('#bet-slip-drawer');
  const open = drawer.dataset.open === 'true';
  drawer.dataset.open = String(!open);
}

// Event binding
function bindEvents() {
  $$('[data-nav]').forEach(b=>b.addEventListener('click',()=>setPage(b.dataset.nav)));
  $('#search').addEventListener('input',e=>{state.search=normalizeText(e.target.value);renderAllPages();});
  $('#sport-selector').addEventListener('change',async e=>{state.sport=e.target.value;await loadData(true);});
  $('#refresh-btn').addEventListener('click',()=>loadData(true));
  $('#retry-btn').addEventListener('click',()=>loadData(false));
  $('#refresh-interval').addEventListener('change',setupAutoRefresh);
  $('#filter-min-edge').addEventListener('input',e=>{state.minEdge=Number(e.target.value||0);renderScanner();});
  $('#alert-threshold').addEventListener('input',e=>{state.alertThreshold=Number(e.target.value||5);});
  $('#confidence-filter').addEventListener('change',e=>{state.confidenceFilter=e.target.value;renderScanner();});
  $('#dense-view-toggle').addEventListener('change',toggleDense);
  $('#filter-reset').addEventListener('click',()=>{state.minEdge=0;$('#filter-min-edge').value='0';$('#search').value='';state.search='';state.confidenceFilter='';$('#confidence-filter').value='';renderAllPages();});
  $('#export-csv').addEventListener('click',exportCsv);
  // Arb history
  $('#arb-history-refresh').addEventListener('click',loadArbHistory);
  $('#arb-history-clear').addEventListener('click',()=>{state.arbHistory={records:[],total:0};renderArbHistory();});
  // Favorites & markets
  $('#show-favorites-only').addEventListener('change',e=>{state.favoritesOnly=e.target.checked;renderMatches();});
  $('#show-all-markets').addEventListener('change',e=>{state.showAllMarkets=e.target.checked;renderMatches();});
  // Sound & theme
  $('#sound-alert-toggle').addEventListener('change',toggleSound);
  $('#theme-toggle').addEventListener('click',cycleTheme);
  // Calculator
  $('#dutch-add-leg').addEventListener('click',()=>{addDutchLeg();renderDutchSummary();});
  $('#dutch-clear').addEventListener('click',()=>{$('#dutch-legs').innerHTML='';renderDutchSummary();});
  $('#dutch-stake').addEventListener('input',renderDutchSummary);
  $('#arb-check-btn').addEventListener('click',renderArbCheck);
  ['#tax-stake','#tax-odds','#tax-ytd'].forEach(s=>$(s).addEventListener('input',renderTaxCalculator));
  ['#novig-odds-1','#novig-odds-x','#novig-odds-2'].forEach(s=>$(s).addEventListener('input',renderNoVig));
  $('#mid-check-btn').addEventListener('click',renderMiddle);
  $('#conv-decimal').addEventListener('input',renderConverter);
  $('#calc-stake').addEventListener('input',()=>{if(state.selectedOdds)state.selectedOdds.stake=Number($('#calc-stake').value||100);});
  $('#calc-bankroll').addEventListener('input',renderProbCalculator);
  $('#calc-save').addEventListener('click',saveCalculatorSelection);
  $('#journal-clear').addEventListener('click',clearJournalEntries);
  $('#autostake-compute').addEventListener('click',renderAutoStake);
  $('#autostake-bankroll').addEventListener('input',renderAutoStake);
  $('#autostake-max-pct').addEventListener('input',renderAutoStake);
  // Quick stakes (#4)
  $$('.qs-btn').forEach(b=>b.addEventListener('click',()=>{$('#calc-stake').value=b.dataset.stake;if(state.selectedOdds)state.selectedOdds.stake=Number(b.dataset.stake);renderProbCalculator();}));
  // Modal
  $('#arb-modal-close').addEventListener('click',closeArbModal);
  $('#arb-modal-overlay').addEventListener('click',e=>{if(e.target===e.currentTarget)closeArbModal();});
  // Journal filters (#16)
  $('#journal-search').addEventListener('input',e=>{state.journalSearch=e.target.value;renderJournal();});
  $('#journal-status-filter').addEventListener('change',e=>{state.journalStatusFilter=e.target.value;renderJournal();});
  $('#journal-bookmaker-filter').addEventListener('change',e=>{state.journalBookmakerFilter=e.target.value;renderJournal();});
  $('#journal-export').addEventListener('click',exportJournalCsv);
  $('#journal-import').addEventListener('click',()=>$('#journal-import-file').click());
  $('#journal-import-file').addEventListener('change',async e=>{await importJournalCsv(e.target.files?.[0]);e.target.value='';});
  // Bet slip drawer (#3)
  $('#bet-slip-toggle').addEventListener('click',toggleBetSlip);
}

function routeFromLocation() { const s=location.pathname.replace(/^\/+/,'');return PAGE_ROUTES.includes(s)?s:'scanner'; }

async function init() {
  initTheme(); initSound(); initNotifications(); initServiceWorker(); initDense(); initKeyboardShortcuts();
  readJournal(); readFavorites(); bindEvents();
  if (state.denseView) document.body.classList.add('dense-view');
  state.page=routeFromLocation(); renderNoVig(); renderTaxCalculator(); renderMiddle();
  await loadData(false); connectStream(); setupAutoRefresh();
  if(state.opportunities.length>0) logArbHistory();
  loadArbHistory();
}
document.addEventListener('DOMContentLoaded',init);
