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
  const teams = String(event.name || '').split(/\s+-\s+/);
  const h2h = event.markets?.find((market) => market.type === 'MRES');
  const prices = Object.fromEntries((h2h?.selections || []).map((selection) => [selection.name, selection.price]));
  const startsAt = new Date(event.startTime);
  if (teams.length !== 2 || !['1', 'X', '2'].every((name) => Number.isFinite(prices[name])) || Number.isNaN(startsAt.getTime())) return null;
  const markets = { h2h: { home: prices['1'], draw: prices.X, away: prices['2'] } };
  const dnb = event.markets?.find((market) => market.type === 'DNOB');
  if (dnb?.selections?.length >= 2) {
    markets.drawNoBet = { home: dnb.selections[0].price, away: dnb.selections[1].price };
  }
  return {
    id: `betano:${event.id}`,
    externalIds: event.betRadarId ? { sportradar: String(event.betRadarId) } : {},
    sport: 'Football',
    competition: event.competition || 'Betano Football',
    startsAt: startsAt.toISOString(),
    homeTeam: teams[0],
    awayTeam: teams[1],
    bookmakers: [{ name: 'Betano', lastUpdate: fetchedAt, markets }],
  };
}

module.exports = { BetanoProvider, normalizeBetanoEvent };
