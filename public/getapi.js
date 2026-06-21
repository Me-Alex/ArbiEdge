const state = {
  events: [],
  filter: '',
};

const elements = {
  announcement: document.querySelector('#announcement'),
  dataMode: document.querySelector('#data-mode'),
  empty: document.querySelector('#empty'),
  error: document.querySelector('#error'),
  errorMessage: document.querySelector('#error-message'),
  events: document.querySelector('#events'),
  filter: document.querySelector('#filter'),
  lastUpdated: document.querySelector('#last-updated'),
  loading: document.querySelector('#loading'),
  refresh: document.querySelector('#refresh'),
  statusDot: document.querySelector('#status-dot'),
  warning: document.querySelector('#warning'),
  warningMessage: document.querySelector('#warning-message'),
};

elements.filter.addEventListener('input', (event) => {
  state.filter = event.target.value.trim().toLocaleLowerCase();
  renderEvents();
});

elements.refresh.addEventListener('click', () => loadOdds({ refresh: true }));

loadOdds();

async function loadOdds({ refresh = false } = {}) {
  setLoading(true);
  elements.error.hidden = true;

  try {
    const endpoint = refresh ? '/api/odds?refresh=1' : '/api/odds';
    const response = await fetch(endpoint, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`The server returned HTTP ${response.status}.`);
    }

    const payload = await response.json();
    state.events = Array.isArray(payload.events) ? payload.events : [];
    updateMetadata(payload);
    renderEvents();
    elements.announcement.textContent = `${state.events.length} events loaded.`;
  } catch (error) {
    state.events = [];
    elements.events.replaceChildren();
    elements.empty.hidden = true;
    elements.error.hidden = false;
    elements.errorMessage.textContent = error.message;
    elements.announcement.textContent = 'Odds could not be loaded.';
  } finally {
    setLoading(false);
  }
}

function updateMetadata(payload) {
  const mode = payload.mode === 'live' ? 'live' : 'demo';
  elements.dataMode.textContent =
    mode === 'live'
      ? `Live — ${payload.source || 'normalized'}`
      : 'Demo (sample prices)';
  elements.statusDot.dataset.mode = mode;
  elements.lastUpdated.textContent = formatDate(payload.fetchedAt);
  elements.warning.hidden = !payload.warning;
  elements.warningMessage.textContent = payload.warning || '';
}

function renderEvents() {
  const visibleEvents = state.events.filter(matchesFilter);
  elements.events.replaceChildren(
    ...visibleEvents.map((event) => createEventCard(event)),
  );
  elements.empty.hidden = visibleEvents.length > 0 || state.events.length === 0;

  if (state.filter) {
    elements.announcement.textContent = `${visibleEvents.length} matching events.`;
  }
}

function matchesFilter(event) {
  if (!state.filter) {
    return true;
  }

  return [event.competition, event.homeTeam, event.awayTeam]
    .filter(Boolean)
    .some((value) => value.toLocaleLowerCase().includes(state.filter));
}

function createEventCard(event) {
  const article = createElement('article', 'event');
  article.dataset.eventId = event.id;

  const details = createElement('div', 'event__details');
  details.append(
    createElement('h2', 'event__competition', event.competition),
    createElement('p', 'event__time', formatDate(event.startsAt)),
  );

  const teams = createElement('div', 'event__teams');
  teams.append(
    createElement('span', '', event.homeTeam),
    createElement('span', '', 'vs'),
    createElement('span', '', event.awayTeam),
  );

  const odds = createElement('div', 'event__odds');
  odds.append(createOddsTable(event.bookmakers || []));

  article.append(details, teams, odds);
  return article;
}

function createOddsTable(bookmakers) {
  const table = createElement('table', 'odds-table');
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const label of ['Bookmaker', '1', 'X', '2']) {
    headRow.append(createElement('th', '', label));
  }
  head.append(headRow);

  const body = document.createElement('tbody');
  const best = findBestPrices(bookmakers);
  for (const bookmaker of bookmakers) {
    const row = document.createElement('tr');
    const name = createElement('th', '', bookmaker.name);
    name.scope = 'row';
    row.append(name);

    for (const outcome of ['home', 'draw', 'away']) {
      const value = bookmaker.markets?.h2h?.[outcome];
      const cell = createElement(
        'td',
        Number.isFinite(value) && value === best[outcome] ? 'best' : '',
        formatPrice(value),
      );
      row.append(cell);
    }
    body.append(row);
  }

  table.append(head, body);
  const marketGroup = createElement('div', 'market-group');
  marketGroup.append(table);

  const drawNoBetBookmakers = bookmakers.filter(
    (bookmaker) =>
      Number.isFinite(bookmaker.markets?.drawNoBet?.home) &&
      Number.isFinite(bookmaker.markets?.drawNoBet?.away),
  );
  if (drawNoBetBookmakers.length > 0) {
    marketGroup.append(createDrawNoBetTable(drawNoBetBookmakers));
  }

  return marketGroup;
}

function createDrawNoBetTable(bookmakers) {
  const section = createElement('section', 'draw-no-bet');
  section.append(
    createElement('h3', 'draw-no-bet__title', 'Draw no bet'),
  );

  const table = createElement('table', 'odds-table odds-table--two-way');
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const label of ['Bookmaker', '1', '2']) {
    headRow.append(createElement('th', '', label));
  }
  head.append(headRow);

  const body = document.createElement('tbody');
  for (const bookmaker of bookmakers) {
    const row = document.createElement('tr');
    const name = createElement('th', '', bookmaker.name);
    name.scope = 'row';
    row.append(
      name,
      createElement('td', '', formatPrice(bookmaker.markets.drawNoBet.home)),
      createElement('td', '', formatPrice(bookmaker.markets.drawNoBet.away)),
    );
    body.append(row);
  }

  table.append(head, body);
  section.append(table);
  return section;
}

function findBestPrices(bookmakers) {
  const result = { home: null, draw: null, away: null };
  for (const outcome of Object.keys(result)) {
    const prices = bookmakers
      .map((bookmaker) => bookmaker.markets?.h2h?.[outcome])
      .filter(Number.isFinite);
    result[outcome] = prices.length ? Math.max(...prices) : null;
  }
  return result;
}

function createElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

function setLoading(isLoading) {
  elements.loading.hidden = !isLoading || state.events.length > 0;
  elements.refresh.disabled = isLoading;
  elements.refresh.classList.toggle('is-loading', isLoading);
  elements.refresh.querySelector('span').textContent = isLoading
    ? 'Refreshing…'
    : 'Refresh odds';
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatPrice(value) {
  return Number.isFinite(value) ? value.toFixed(2) : '—';
}
