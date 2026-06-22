const { ProviderError } = require('./the-odds-api-provider');

const UNIBET_LOBBY_URL =
  'https://sportsbff-ams.kindredext.net/sports-api/api/v2/views/lobby?_typ=GetLobbyPageView&category=football&clientOffset=-180';

class UnibetProvider {
  constructor({
    fetchImpl = globalThis.fetch,
    browserTransport = null,
    timeoutMs = 8000,
  } = {}) {
    this.name = 'Unibet';
    this.fetchImpl = fetchImpl;
    this.browserTransport = browserTransport;
    this.timeoutMs = timeoutMs;
  }

  async getOdds() {
    const response = await this.fetchImpl(UNIBET_LOBBY_URL, {
      headers: {
        accept: 'application/json',
        referer: 'https://www.unibet.ro/',
        origin: 'https://www.unibet.ro',
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36',
        ksp_jurisdiction: 'mga',
        jurisdiction: 'RO',
        'content-type': 'application/json',
        locale: 'ro_RO',
        brand: 'unibet',
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    }).catch((error) => {
      throw new ProviderError(`Unable to reach Unibet: ${error.message}`, { cause: error });
    });
    let payload;
    if (response.ok) {
      payload = await response.json();
    } else if (this.browserTransport) {
      payload = await this.browserTransport.getJson(UNIBET_LOBBY_URL, {
        ksp_jurisdiction: 'mga',
        jurisdiction: 'RO',
        'content-type': 'application/json',
        locale: 'ro_RO',
        brand: 'unibet',
      });
    } else {
      throw new ProviderError(`Unibet returned HTTP ${response.status}`, {
        status: response.status,
      });
    }
    return normalizeUnibetPayload(payload);
  }
}

function normalizeUnibetPayload(payload) {
  const contests = (payload?.view?.matches || [])
    .flatMap((match) => match.contestGroups || [])
    .flatMap((group) => group.contests || []);
  return contests.map((contest) => {
    const proposition = (contest.propositions || []).find((item) => item.propositionType === '1x2' && item.status === 'Active');
    const prices = Object.fromEntries((proposition?.options || []).map((option) => [option.optionDisplayName, option.price]));
    const teams = String(contest.name || '').split(/\s+vs\s+/i);
    const startsAt = new Date(contest.startDateTimeUtc?.value || contest.startDateTimeUtc?.unixms);
    if (teams.length !== 2 || !['1', 'X', '2'].every((name) => Number.isFinite(prices[name])) || Number.isNaN(startsAt.getTime())) return null;
    return {
      id: `unibet:${contest.contestKey}`,
      externalIds: {},
      sport: 'Football',
      competition: contest.categoriesDetailed?.[0]?.name || 'Unibet Football',
      startsAt: startsAt.toISOString(),
      homeTeam: teams[0],
      awayTeam: teams[1],
      bookmakers: [{
        name: 'Unibet',
        lastUpdate: proposition.timeStampBFFUtc || null,
        markets: { h2h: { home: prices['1'], draw: prices.X, away: prices['2'] } },
      }],
    };
  }).filter(Boolean);
}

module.exports = { UNIBET_LOBBY_URL, UnibetProvider, normalizeUnibetPayload };
