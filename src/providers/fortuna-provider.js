const { ProviderError } = require('./the-odds-api-provider');

const FORTUNA_UPCOMING_URL =
  'https://api.efortuna.ro/offer/structure/api/v1_0/widget/upcoming';
const FORTUNA_MARKETS_URL =
  'https://api.efortuna.ro/offer/markets/api/v1_0/fixtures/markets/overview';
const FOOTBALL_SPORT_ID = 'ufo:sprt:00';
const MATCH_MARKET_TYPE_ID = 'ufo:mtyp:00-00';
const DRAW_NO_BET_MARKET_TYPE_ID = 'ufo:mtyp:00-03';

class FortunaProvider {
  constructor({
    fetchImpl = globalThis.fetch,
    timeoutMs = 8000,
    now = () => new Date(),
  } = {}) {
    this.name = 'Fortuna';
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.now = now;
  }

  async getOdds() {
    const payload = await this.#fetchJson(FORTUNA_UPCOMING_URL);
    const fixtureIds = Array.isArray(payload.fixtures)
      ? payload.fixtures
          .filter(
            (fixture) =>
              fixture?.sportId === FOOTBALL_SPORT_ID &&
              fixture.status === 'ACTIVE' &&
              fixture.id,
          )
          .map((fixture) => fixture.id)
      : [];

    let drawNoBetPayload = {};
    if (fixtureIds.length > 0) {
      const marketsUrl = new URL(FORTUNA_MARKETS_URL);
      marketsUrl.search = new URLSearchParams({
        fixtureIds: fixtureIds.join(','),
        marketTypeIds: DRAW_NO_BET_MARKET_TYPE_ID,
      });
      drawNoBetPayload = await this.#fetchJson(marketsUrl, { optional: true });
    }

    return normalizeFortunaPayload(
      payload,
      this.now().toISOString(),
      drawNoBetPayload,
    );
  }

  async #fetchJson(url, { optional = false } = {}) {
    let response;
    try {
      response = await this.fetchImpl(url, {
        headers: {
          accept: 'application/json',
          referer: 'https://efortuna.ro/',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new ProviderError(`Unable to reach Fortuna: ${error.message}`, {
        cause: error,
      });
    }

    if (!response.ok) {
      if (optional) {
        return {};
      }

      throw new ProviderError(`Fortuna returned HTTP ${response.status}`, {
        status: response.status,
      });
    }

    try {
      return await response.json();
    } catch (error) {
      if (error instanceof ProviderError) {
        throw error;
      }

      if (optional) {
        return {};
      }

      throw new ProviderError('Fortuna returned invalid JSON', {
        cause: error,
      });
    }
  }
}

function normalizeFortunaPayload(payload, fetchedAt, drawNoBetPayload = {}) {
  if (
    !payload ||
    !Array.isArray(payload.fixtures) ||
    !Array.isArray(payload.markets)
  ) {
    return [];
  }

  const tournaments = new Map(
    (Array.isArray(payload.tournaments) ? payload.tournaments : [])
      .filter((tournament) => tournament?.id)
      .map((tournament) => [tournament.id, tournament.name]),
  );
  const matchMarkets = new Map();
  const drawNoBetMarkets = normalizeDrawNoBetMarkets(drawNoBetPayload);

  for (const market of payload.markets) {
    if (
      !market?.fixtureId ||
      (market.marketTypeId !== MATCH_MARKET_TYPE_ID &&
        market.syntheticGroupKey !== 'match')
    ) {
      continue;
    }

    const prices = Object.fromEntries(
      (Array.isArray(market.outcomes) ? market.outcomes : [])
        .filter(
          (outcome) =>
            ['1', 'X', '2'].includes(outcome?.name) &&
            Number.isFinite(outcome.odds),
        )
        .map((outcome) => [outcome.name, outcome.odds]),
    );

    if (['1', 'X', '2'].every((outcome) => Number.isFinite(prices[outcome]))) {
      matchMarkets.set(market.fixtureId, prices);
    }
  }

  return payload.fixtures
    .filter(
      (fixture) =>
        fixture?.sportId === FOOTBALL_SPORT_ID &&
        fixture.status === 'ACTIVE' &&
        matchMarkets.has(fixture.id),
    )
    .map((fixture) =>
      normalizeFixture(
        fixture,
        matchMarkets,
        drawNoBetMarkets,
        tournaments,
        fetchedAt,
      ),
    )
    .filter(Boolean)
    .sort((left, right) => new Date(left.startsAt) - new Date(right.startsAt));
}

function normalizeDrawNoBetMarkets(payload) {
  const result = new Map();
  if (!payload || typeof payload !== 'object') {
    return result;
  }

  for (const [fixtureId, markets] of Object.entries(payload)) {
    const market = Array.isArray(markets)
      ? markets.find(
          (candidate) =>
            candidate?.marketTypeId === DRAW_NO_BET_MARKET_TYPE_ID ||
            candidate?.syntheticGroupKey === 'draw_no_bet',
        )
      : null;
    if (!market) {
      continue;
    }

    const prices = Object.fromEntries(
      (Array.isArray(market.outcomes) ? market.outcomes : [])
        .filter(
          (outcome) =>
            ['1', '2'].includes(outcome?.name) &&
            Number.isFinite(outcome.odds),
        )
        .map((outcome) => [outcome.name, outcome.odds]),
    );
    if (Number.isFinite(prices['1']) && Number.isFinite(prices['2'])) {
      result.set(fixtureId, {
        home: prices['1'],
        away: prices['2'],
      });
    }
  }

  return result;
}

function normalizeFixture(
  fixture,
  matchMarkets,
  drawNoBetMarkets,
  tournaments,
  fetchedAt,
) {
  const homeTeam = fixture.participants?.find(
    (participant) => participant?.type === 'HOME',
  )?.name;
  const awayTeam = fixture.participants?.find(
    (participant) => participant?.type === 'AWAY',
  )?.name;
  const startsAt = new Date(fixture.startDatetime);

  if (
    !homeTeam ||
    !awayTeam ||
    Number.isNaN(startsAt.getTime()) ||
    !fixture.id
  ) {
    return null;
  }

  const prices = matchMarkets.get(fixture.id);
  const markets = {
    h2h: {
      home: prices['1'],
      draw: prices.X,
      away: prices['2'],
    },
  };
  if (drawNoBetMarkets.has(fixture.id)) {
    markets.drawNoBet = drawNoBetMarkets.get(fixture.id);
  }

  return {
    id: `fortuna:${fixture.id}`,
    externalIds: fixture.sportradarIds?.[0]
      ? { sportradar: String(fixture.sportradarIds[0]) }
      : {},
    sport: 'Football',
    competition: tournaments.get(fixture.tournamentId) || 'Fortuna Football',
    startsAt: startsAt.toISOString(),
    homeTeam,
    awayTeam,
    bookmakers: [
      {
        name: 'Fortuna',
        lastUpdate: fetchedAt,
        markets,
      },
    ],
  };
}

module.exports = {
  FORTUNA_UPCOMING_URL,
  FortunaProvider,
  normalizeFortunaPayload,
};
