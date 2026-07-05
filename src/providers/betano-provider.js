const {
  genericMarketKey,
  hasAnyCompleteMarket,
  hasCompleteOutcomes,
  isDecimalOdds,
  normalizeOutcomeKey,
  splitFixtureName,
} = require('./market-utils');
const { absoluteEventUrl, bookmakerLinkFields } = require('./event-links');

class BetanoProvider {
  constructor({ transport }) {
    if (!transport?.collect) throw new TypeError('Betano browser transport is required');
    this.name = 'Betano';
    this.transport = transport;
  }

  async getOdds() {
    const fetchedAt = new Date().toISOString();
    const events = (await this.transport.collect())
      .map((event) => normalizeBetanoEvent(event, fetchedAt))
      .filter(Boolean);
    if (events.length === 0) {
      throw new Error(
        'Betano returned no events; the browser session may be blocked by its challenge',
      );
    }
    return events;
  }
}

function normalizeBetanoEvent(event, fetchedAt) {
  const teams = splitFixtureName(event.name);
  const h2h = event.markets?.find((market) => market.type === 'MRES');
  const prices = Object.fromEntries(
    (h2h?.selections || [])
      .filter((selection) => isDecimalOdds(selection.price))
      .map((selection) => [selection.name, selection.price]),
  );
  const startsAt = new Date(event.startTime);
  if (teams.length !== 2 || Number.isNaN(startsAt.getTime())) return null;

  const markets = {};
  if (['1', 'X', '2'].every((name) => isDecimalOdds(prices[name]))) {
    markets.h2h = { home: prices['1'], draw: prices.X, away: prices['2'] };
  }

  const dnb = event.markets?.find((market) => market.type === 'DNOB');
  const dnbHome = dnb?.selections?.[0]?.price;
  const dnbAway = dnb?.selections?.[1]?.price;
  if (isDecimalOdds(dnbHome) && isDecimalOdds(dnbAway)) {
    markets.drawNoBet = { home: dnbHome, away: dnbAway };
  }
  for (const market of event.markets || []) {
    const normalized = normalizeGenericBetanoMarket(market);
    if (normalized && !markets[normalized.key]) {
      markets[normalized.key] = normalized.prices;
    }
  }
  if (!hasAnyCompleteMarket(markets)) {
    return null;
  }

  return {
    id: `betano:${event.id}`,
    externalIds: event.betRadarId ? { sportradar: String(event.betRadarId) } : {},
    sport: 'Football',
    competition: event.competition || 'Betano Football',
    startsAt: startsAt.toISOString(),
    homeTeam: teams[0],
    awayTeam: teams[1],
    bookmakers: [{
      name: 'Betano',
      lastUpdate: fetchedAt,
      ...bookmakerLinkFields(
        'Betano',
        absoluteEventUrl(event.url, 'https://ro.betano.com'),
      ),
      markets,
    }],
  };
}

function normalizeGenericBetanoMarket(market) {
  if (!market || ['MRES', 'DNOB'].includes(market.type)) {
    return null;
  }

  const label = market.name || market.title || market.type;
  const line = extractBetanoLine(market);
  const prices = {};
  for (const selection of market.selections || []) {
    const outcomeKey = normalizeOutcomeKey(selection.name || selection.title);
    if (outcomeKey && isDecimalOdds(selection.price)) {
      prices[outcomeKey] = selection.price;
    }
  }

  const key = genericMarketKey(label, line ? { line } : undefined);
  return key && hasCompleteOutcomes(prices) ? { key, prices } : null;
}

function extractBetanoLine(market) {
  const marketLine = numericLine(market?.line ?? market?.handicap ?? market?.argument);
  if (marketLine) {
    return marketLine;
  }

  for (const selection of market?.selections || []) {
    const selectionLine = numericLine(selection.line ?? selection.handicap ?? selection.argument);
    if (selectionLine) {
      return selectionLine;
    }

    const label = String(selection.name || selection.title || '');
    const match = label.match(/\b(?:peste|over|sub|under)\s+([0-9]+(?:[.,][0-9]+)?)/i);
    if (match) {
      return match[1].replace(',', '.');
    }
  }
  return null;
}

function numericLine(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : null;
}

module.exports = { BetanoProvider, normalizeBetanoEvent };
