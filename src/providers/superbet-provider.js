const { ProviderError } = require('./the-odds-api-provider');

const SUPERBET_EVENTS_URL =
  'https://production-superbet-offer-ro.freetls.fastly.net/v2/ro-RO/events/by-date';

class SuperbetProvider {
  constructor({ fetchImpl = globalThis.fetch, timeoutMs = 8000, now = () => new Date() } = {}) {
    this.name = 'Superbet';
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.now = now;
  }

  async getOdds() {
    const start = this.now();
    const end = new Date(start.getTime() + 8 * 24 * 60 * 60 * 1000);
    const url = new URL(SUPERBET_EVENTS_URL);
    url.search = new URLSearchParams({
      currentStatus: 'active',
      offerState: 'prematch',
      startDate: formatDate(start),
      endDate: formatDate(end),
      sportId: '5',
    });
    const response = await this.fetchImpl(url, {
      headers: { accept: 'application/json', referer: 'https://superbet.ro/' },
      signal: AbortSignal.timeout(this.timeoutMs),
    }).catch((error) => {
      throw new ProviderError(`Unable to reach Superbet: ${error.message}`, { cause: error });
    });
    if (!response.ok) throw new ProviderError(`Superbet returned HTTP ${response.status}`, { status: response.status });
    return normalizeSuperbetPayload(await response.json(), start.toISOString());
  }
}

function normalizeSuperbetPayload(payload, fetchedAt) {
  return (Array.isArray(payload?.data) ? payload.data : []).map((event) => {
    const teams = String(event.matchName || '')
      .split(event.matchName?.includes('·') ? '·' : /\s+-\s+/)
      .map((item) => item.trim())
      .filter(Boolean);
    const final = (event.odds || []).filter((odd) => odd.marketName === 'Final' && odd.status === 'active');
    const prices = Object.fromEntries(final.map((odd) => [odd.name, odd.price]));
    const startsAt = new Date(event.utcDate || event.unixDateMillis);
    if (teams.length !== 2 || !['1', 'X', '2'].every((name) => Number.isFinite(prices[name])) || Number.isNaN(startsAt.getTime())) return null;
    return {
      id: `superbet:${event.eventId}`,
      externalIds: event.betradarId ? { sportradar: String(event.betradarId) } : {},
      sport: 'Football',
      competition: event.tournamentName || 'Superbet Football',
      startsAt: startsAt.toISOString(),
      homeTeam: teams[0],
      awayTeam: teams[1],
      bookmakers: [{
        name: 'Superbet',
        lastUpdate: fetchedAt,
        markets: { h2h: { home: prices['1'], draw: prices.X, away: prices['2'] } },
      }],
    };
  }).filter(Boolean);
}

function formatDate(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

module.exports = { SUPERBET_EVENTS_URL, SuperbetProvider, normalizeSuperbetPayload };
