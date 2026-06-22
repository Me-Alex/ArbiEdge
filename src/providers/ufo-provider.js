const { ProviderError } = require('./the-odds-api-provider');

const FOOTBALL_SPORT_ID = 'ufo:sprt:00';
const MATCH_MARKET_TYPE_ID = 'ufo:mtyp:00-00';
const DRAW_NO_BET_MARKET_TYPE_ID = 'ufo:mtyp:00-03';

class UfoProvider {
  constructor({
    name,
    baseUrl,
    fetchImpl = globalThis.fetch,
    timeoutMs = 8000,
    now = () => new Date(),
  }) {
    this.name = name;
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.now = now;
  }

  async getOdds() {
    const payload = await this.fetchJson(`${this.baseUrl}/structure/api/v1_0/widget/upcoming`);
    const fixtureIds = (payload.fixtures || [])
      .filter((fixture) => fixture?.sportId === FOOTBALL_SPORT_ID && fixture.status === 'ACTIVE')
      .map((fixture) => fixture.id);
    let drawNoBetPayload = {};
    if (fixtureIds.length) {
      const url = new URL(`${this.baseUrl}/markets/api/v1_0/fixtures/markets/overview`);
      url.search = new URLSearchParams({
        fixtureIds: fixtureIds.join(','),
        marketTypeIds: DRAW_NO_BET_MARKET_TYPE_ID,
      });
      drawNoBetPayload = await this.fetchJson(url, true);
    }
    return normalizeUfoPayload(payload, {
      bookmaker: this.name,
      fetchedAt: this.now().toISOString(),
      drawNoBetPayload,
    });
  }

  async fetchJson(url, optional = false) {
    let response;
    try {
      response = await this.fetchImpl(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new ProviderError(`Unable to reach ${this.name}: ${error.message}`, { cause: error });
    }
    if (!response.ok) {
      if (optional) return {};
      throw new ProviderError(`${this.name} returned HTTP ${response.status}`, { status: response.status });
    }
    try {
      return await response.json();
    } catch (error) {
      if (optional) return {};
      throw new ProviderError(`${this.name} returned invalid JSON`, { cause: error });
    }
  }
}

function normalizeUfoPayload(payload, { bookmaker, fetchedAt, drawNoBetPayload = {} }) {
  if (!Array.isArray(payload?.fixtures) || !Array.isArray(payload?.markets)) return [];
  const tournaments = new Map((payload.tournaments || []).map((item) => [item.id, item.name]));
  const marketMap = marketPrices(payload.markets, MATCH_MARKET_TYPE_ID, ['1', 'X', '2']);
  const drawNoBet = new Map();
  for (const [fixtureId, markets] of Object.entries(drawNoBetPayload || {})) {
    const prices = marketPrices(markets, DRAW_NO_BET_MARKET_TYPE_ID, ['1', '2'], true);
    if (prices.has(fixtureId)) drawNoBet.set(fixtureId, prices.get(fixtureId));
  }

  return payload.fixtures
    .filter((fixture) => fixture?.sportId === FOOTBALL_SPORT_ID && fixture.status === 'ACTIVE' && marketMap.has(fixture.id))
    .map((fixture) => {
      const homeTeam = fixture.participants?.find((p) => p.type === 'HOME')?.name;
      const awayTeam = fixture.participants?.find((p) => p.type === 'AWAY')?.name;
      const startsAt = new Date(fixture.startDatetime);
      if (!homeTeam || !awayTeam || Number.isNaN(startsAt.getTime())) return null;
      const prices = marketMap.get(fixture.id);
      const markets = { h2h: { home: prices['1'], draw: prices.X, away: prices['2'] } };
      const dnb = drawNoBet.get(fixture.id);
      if (dnb) markets.drawNoBet = { home: dnb['1'], away: dnb['2'] };
      return {
        id: `${normalizeName(bookmaker)}:${fixture.id}`,
        externalIds: fixture.sportradarIds?.[0] ? { sportradar: String(fixture.sportradarIds[0]) } : {},
        sport: 'Football',
        competition: tournaments.get(fixture.tournamentId) || `${bookmaker} Football`,
        startsAt: startsAt.toISOString(),
        homeTeam,
        awayTeam,
        bookmakers: [{ name: bookmaker, lastUpdate: fetchedAt, markets }],
      };
    })
    .filter(Boolean);
}

function marketPrices(markets, typeId, names, nested = false) {
  const result = new Map();
  for (const market of markets || []) {
    if (market?.marketTypeId !== typeId && !(typeId === MATCH_MARKET_TYPE_ID && market?.syntheticGroupKey === 'match')) continue;
    const values = Object.fromEntries((market.outcomes || []).filter((o) => names.includes(o.name) && Number.isFinite(o.odds)).map((o) => [o.name, o.odds]));
    if (names.every((name) => Number.isFinite(values[name]))) {
      result.set(market.fixtureId || (nested ? market.fixtureId : undefined), values);
    }
  }
  return result;
}

function normalizeName(value) {
  return value.toLowerCase().replace(/\W+/g, '-');
}

module.exports = {
  DRAW_NO_BET_MARKET_TYPE_ID,
  MATCH_MARKET_TYPE_ID,
  UfoProvider,
  normalizeUfoPayload,
};
