class ProviderError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'ProviderError';
    this.status = options.status;
  }
}

class TheOddsApiProvider {
  constructor({
    apiKey,
    sportKeys,
    fetchImpl = globalThis.fetch,
    timeoutMs = 8000,
  }) {
    if (!apiKey) {
      throw new TypeError('The Odds API key is required');
    }

    this.apiKey = apiKey;
    this.name = 'The Odds API';
    this.sportKeys = sportKeys;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async getOdds() {
    const results = await Promise.all(
      this.sportKeys.map((sportKey) => this.#fetchSport(sportKey)),
    );

    const uniqueEvents = new Map();
    for (const event of results.flat().map(normalizeEvent).filter(Boolean)) {
      uniqueEvents.set(event.id, event);
    }

    return [...uniqueEvents.values()].sort(
      (left, right) => new Date(left.startsAt) - new Date(right.startsAt),
    );
  }

  async #fetchSport(sportKey) {
    const url = new URL(
      `https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sportKey)}/odds/`,
    );
    url.search = new URLSearchParams({
      apiKey: this.apiKey,
      regions: 'eu',
      markets: 'h2h',
      oddsFormat: 'decimal',
      dateFormat: 'iso',
    });

    let response;
    try {
      response = await this.fetchImpl(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new ProviderError(`Unable to reach The Odds API: ${error.message}`, {
        cause: error,
      });
    }

    if (!response.ok) {
      throw new ProviderError(
        `The Odds API returned HTTP ${response.status}`,
        { status: response.status },
      );
    }

    try {
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    } catch (error) {
      throw new ProviderError('The Odds API returned invalid JSON', {
        cause: error,
      });
    }
  }
}

function normalizeEvent(event) {
  if (
    !event ||
    typeof event.id !== 'string' ||
    typeof event.home_team !== 'string' ||
    typeof event.away_team !== 'string'
  ) {
    return null;
  }

  const startsAt = toIsoDate(event.commence_time);
  if (!startsAt) {
    return null;
  }

  const bookmakers = Array.isArray(event.bookmakers)
    ? event.bookmakers
        .map((bookmaker) =>
          normalizeBookmaker(bookmaker, event.home_team, event.away_team),
        )
        .filter(Boolean)
    : [];

  if (bookmakers.length === 0) {
    return null;
  }

  return {
    id: event.id,
    sport: 'Football',
    competition: event.sport_title || event.sport_key || 'Football',
    startsAt,
    homeTeam: event.home_team,
    awayTeam: event.away_team,
    bookmakers,
  };
}

function normalizeBookmaker(bookmaker, homeTeam, awayTeam) {
  if (!bookmaker || typeof bookmaker.title !== 'string') {
    return null;
  }

  const h2h = Array.isArray(bookmaker.markets)
    ? bookmaker.markets.find((market) => market?.key === 'h2h')
    : null;
  if (!h2h || !Array.isArray(h2h.outcomes)) {
    return null;
  }

  const prices = Object.fromEntries(
    h2h.outcomes
      .filter(
        (outcome) =>
          outcome &&
          typeof outcome.name === 'string' &&
          Number.isFinite(outcome.price),
      )
      .map((outcome) => [outcome.name, outcome.price]),
  );

  const home = prices[homeTeam];
  const away = prices[awayTeam];
  const draw = prices.Draw;
  if (![home, draw, away].every(Number.isFinite)) {
    return null;
  }

  return {
    name: bookmaker.title,
    lastUpdate: toIsoDate(bookmaker.last_update),
    markets: {
      h2h: { home, draw, away },
    },
  };
}

function toIsoDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

module.exports = {
  ProviderError,
  TheOddsApiProvider,
  normalizeEvent,
};
