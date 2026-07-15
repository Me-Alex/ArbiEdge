'use strict';

class TheOddsApiResultsProvider {
  constructor({
    apiKey,
    sportKeys = [],
    daysFrom = 3,
    timeoutMs = 12_000,
    fetchImpl = global.fetch,
    apiBaseUrl = 'https://api.the-odds-api.com/v4',
  } = {}) {
    if (!apiKey) throw new Error('TheOddsApiResultsProvider requires an API key');
    this.name = 'The Odds API scores';
    this.apiKey = apiKey;
    this.sportKeys = sportKeys;
    this.daysFrom = Math.min(3, Math.max(1, Number(daysFrom) || 3));
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.apiBaseUrl = apiBaseUrl.replace(/\/$/, '');
  }

  async getCompletedEvents() {
    const responses = await Promise.all(this.sportKeys.map((sportKey) => this.#fetchSport(sportKey)));
    return responses.flat().filter((event) => event.completed);
  }

  async #fetchSport(sportKey) {
    const url = new URL(`${this.apiBaseUrl}/sports/${encodeURIComponent(sportKey)}/scores/`);
    url.searchParams.set('apiKey', this.apiKey);
    url.searchParams.set('daysFrom', String(this.daysFrom));
    url.searchParams.set('dateFormat', 'iso');
    const response = await this.fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`Results API returned HTTP ${response.status} for ${sportKey}`);
    const payload = await response.json();
    return (Array.isArray(payload) ? payload : []).map(normalizeScoreEvent).filter(Boolean);
  }
}

function normalizeScoreEvent(event) {
  if (!event?.id || !event?.home_team || !event?.away_team) return null;
  const scores = new Map((event.scores || []).map((score) => [score.name, Number(score.score)]));
  const homeScore = scores.get(event.home_team);
  const awayScore = scores.get(event.away_team);
  return {
    id: event.id,
    sportKey: event.sport_key || null,
    homeTeam: event.home_team,
    awayTeam: event.away_team,
    startsAt: event.commence_time || null,
    completed: event.completed === true,
    lastUpdate: event.last_update || null,
    homeScore: Number.isFinite(homeScore) ? homeScore : null,
    awayScore: Number.isFinite(awayScore) ? awayScore : null,
    raw: event,
  };
}

module.exports = { TheOddsApiResultsProvider, normalizeScoreEvent };
