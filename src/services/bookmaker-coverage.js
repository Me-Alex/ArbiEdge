/**
 * Romanian Bookmaker Coverage Summary & Registry Component.
 */

const COVERAGE_STATUSES = Object.freeze({
  direct: 'direct',
  browserOptional: 'browserOptional',
  remainingProvider: 'remainingProvider',
  needsTriage: 'needsTriage',
  notSportsbook: 'notSportsbook',
  inactive: 'inactive',
  temporarilyUnavailable: 'temporarilyUnavailable',
});

const ROMANIAN_BOOKMAKER_COVERAGE = Object.freeze([
  direct('Fortuna', 'efortuna.ro', 'FortunaProvider'),
  direct('Favbet', 'favbet.ro', 'FavbetProvider'),
  direct('VictoryBet', 'victorybet.ro', 'VictoryBetProvider'),
  direct('Manhattan', 'manhattan.ro', 'ManhattanProvider'),
  direct('Casa Pariurilor', 'casapariurilor.ro', 'CasaPariurilorProvider'),
  direct('Superbet', 'superbet.ro', 'SuperbetProvider'),
  direct('BetOne', 'betone.ro', 'BetOneProvider'),
  direct('Betmen', 'betmen.ro', 'BetmenProvider'),
  direct('GetsBet', 'getsbet.ro', 'GetsBetProvider'),
  direct('Winner', 'winner.ro', 'WinnerProvider'),
  direct('888', '888.ro', 'EightEightEightProvider'),
  direct('MrPlay', 'mrplay.ro', 'MrPlayProvider'),
  direct('Bet7', 'bet7.ro', 'NewGamblingBrandsProvider'),
  direct('EliteSlots', 'eliteslots.ro', 'NewGamblingBrandsProvider'),
  direct('LasVegas', 'lasvegas.ro', 'LasVegasProvider'),
  direct('Spin', 'spin.ro', 'SpinProvider'),
  direct('MaxBet', 'maxbet.ro', 'MaxBetProvider'),
  direct('Stanleybet', 'stanleybet.ro', 'StanleybetFamilyProvider'),
  direct('GameWorld', 'gameworld.ro', 'StanleybetFamilyProvider'),
  direct('AdmiralBet', 'admiralbet.ro', 'StanleybetFamilyProvider'),
  direct('Seven', 'seven.ro', 'StanleybetFamilyProvider'),
  direct('RedSevens', 'redsevens.ro', 'StanleybetFamilyProvider'),
  direct('GPCasino', 'gpcasino.ro', 'StanleybetFamilyProvider'),
  direct('NetBet', 'netbet.ro', 'NetBetProvider'),
  direct('Winbet', 'winbet.ro', 'WinbetProvider'),
  direct('VivaBet', 'vivabet.ro', 'EgtProvider'),
  direct('LuckySeven', 'luckyseven.ro', 'EgtProvider'),
  direct('OneCasino', 'onecasino.ro', 'EgtProvider'),
  direct('MaxWin', 'maxwin.ro', 'EgtProvider'),
  direct('Prowin', 'prowin.ro', 'EgtProvider'),
  direct('VipBet', 'vipbet.ro', 'EgtProvider'),
  direct('Unibet', 'unibet.ro', 'UnibetProvider'),

  browserOptional(
    'Betano',
    'ro.betano.com',
    'BetanoProvider',
    'Requires BETANO_BROWSER_ENABLED=1 and a local browser session.',
  ),

  remainingProvider(
    'Betfair',
    'betfair.ro',
    'Validated on 2026-07-14: the current Apollo app uses apitbd.betfair.ro/api/tbd/bff-gql/v11/ and publishes a 119-operation persisted-query manifest. The initial view/card variables still require a stable runtime capture before safe normalization.',
    'https://www.betfair.ro/pariuri/fotbal/s-1',
  ),
  inactive(
    'PublicWin',
    'publicwin.ro',
    'PublicWin announced that it ceased Romanian operations on 2025-12-30.',
    'https://publicwin.ro',
  ),
  remainingProvider(
    'MozzartBet',
    'mozzartbet.ro',
    'Returned Cloudflare 521 during research; retry later.',
    'https://mozzartbet.ro',
  ),
  remainingProvider(
    '777',
    '777.ro',
    'Sports feature present; endpoint still hidden in app config.',
    'https://www.777.ro/pariuri-sportive',
  ),
  remainingProvider(
    'Xbet',
    'xbet.ro',
    'Returned HTTP 401 during research; retry with browser headers.',
    'https://xbet.ro',
  ),
  remainingProvider(
    'Zinx / TopBet',
    'zinx.ro',
    'Checked on 2026-07-14: the Angular shell loads, but all three JavaScript assets referenced by the current HTML return HTTP 404, so no live sportsbook endpoint can be verified yet.',
    'https://zinx.ro',
  ),
  remainingProvider(
    'PokerStars Sports',
    'pokerstarssports.ro',
    'PokerStars sports app observed; endpoint discovery needed.',
    'https://www.pokerstarssports.ro',
  ),
  remainingProvider(
    'Winboss',
    'winboss.ro',
    'Validated on 2026-07-14: https://exalogic.winboss.ro/XSportDatastore returns current football schedules and market details with systemCode WINBOSS. The existing XSport adapter can be reused after shared-family request scheduling is added.',
    'https://winboss.ro/sport',
  ),
  remainingProvider(
    'PowerBet',
    'powerbet.ro',
    'Validated on 2026-07-14: https://exalogic.powerbet.ro/XSportDatastore returns current football schedules and prices with systemCode POWERBETRO. The existing XSport adapter can be reused after shared-family request scheduling is added.',
    'https://online.powerbet.ro/sport',
  ),
  remainingProvider(
    'Magnumbet',
    'magnumbet.ro',
    'Validated on 2026-07-14: https://sport.magnumbet.ro/XSportDatastore returns current football schedules and prices with systemCode MAGNUMBET. The existing XSport adapter can be reused after shared-family request scheduling is added.',
    'https://magnumbet.ro/sport',
  ),
  remainingProvider(
    'Excelbet',
    'excelbet.ro',
    'Validated on 2026-07-14: https://exalogic.excelbet.ro/XSportDatastore returns current football schedules and prices with systemCode EXCELBET. The existing XSport adapter can be reused after shared-family request scheduling is added.',
    'https://excelbet.ro/sport',
  ),
  remainingProvider(
    'RoyalSlots',
    'royalslots.ro',
    'Runtime inspection on 2026-07-14 shows an embedded Betmen-branded 7platform/NSoft sportsbook. No independent RoyalSlots price feed was confirmed, so it is intentionally not cloned as a separate bookmaker.',
    'https://www.royalslots.ro/prematch',
  ),

  needsTriage('Winmasters', 'winmasters.ro'),
  needsTriage('PariuriPlus', 'pariuriplus.ro'),
  needsTriage('12XBet', '12xbet.ro'),
  needsTriage('Sport.com', 'sport.com'),
  notSportsbook(
    'HotSpins',
    'hotspins.ro',
    'Browser verification on 2026-07-05 showed event URLs returning a casino-only 404 page with no visible sportsbook event or odds.',
    'https://www.hotspins.ro/bets/match/pre-match/1/2350/18724/38869524',
  ),
  notSportsbook(
    'LadyCasino',
    'ladycasino.ro',
    'Browser verification on 2026-07-05 showed event URLs returning a casino-only 404 page with no visible sportsbook event or odds.',
    'https://www.ladycasino.ro/bets/match/pre-match/1/2350/18724/38869524',
  ),
  notSportsbook(
    'Pacanele',
    'pacanele.ro',
    'Browser verification on 2026-07-05 showed event URLs with no event information or visible odds.',
    'https://www.pacanele.ro/bets/match/pre-match/1/2350/18724/38869524',
  ),
  notSportsbook(
    'FortunaPalace',
    'fortunapalace.ro',
    'Browser verification on 2026-07-05 redirected sports event URLs to a casino page with no visible sportsbook event or odds.',
    'https://fortunapalace.ro/sports/event/suwon-fc-vs-jeonnam-dragons-50006555052',
  ),
  notSportsbook(
    'UltraBet',
    'ultrabet.ro',
    'Browser verification on 2026-07-05 redirected sports event URLs to a casino page with no visible sportsbook event or odds.',
    'https://ultrabet.ro/sports/event/suwon-fc-vs-jeonnam-dragons-50006555052',
  ),
  notSportsbook(
    'Win2',
    'win2.ro',
    'Casino and live-casino platform observed; no sportsbook navigation or fixed-odds markets were visible.',
    'https://www.win2.ro/',
  ),
  needsTriage('Betinia', 'betinia.ro'),
  temporarilyUnavailable(
    'CherryBet',
    'cherrybet.ro',
    'Browser verification on 2026-07-05 showed scheduled maintenance and no visible sportsbook markets.',
    'https://cherrybet.ro/sports/event/suwon-fc-vs-jeonnam-dragons-50006555052',
  ),
  temporarilyUnavailable(
    'OrientalCasino',
    'orientalcasino.ro',
    'Site shows a maintenance page and no sportsbook markets are currently visible.',
    'https://www.orientalcasino.ro/',
  ),
  needsTriage('BetPlaces', 'betplaces.ro'),
  needsTriage('FlashWin', 'flashwin.ro'),
  needsTriage('CasinoFun', 'casinofun.ro'),
  notSportsbook(
    'PlayGG',
    'playgg.ro',
    'Redirects to a GGPoker poker site; no sportsbook markets were visible.',
    'https://playgg.ro/',
  ),
]);

function direct(name, domain, adapter) {
  return { name, domain, status: COVERAGE_STATUSES.direct, adapter };
}

function browserOptional(name, domain, adapter, note) {
  return { name, domain, status: COVERAGE_STATUSES.browserOptional, adapter, note };
}

function remainingProvider(name, domain, note, discoveryUrl = `https://${domain}`) {
  return { name, domain, status: COVERAGE_STATUSES.remainingProvider, note, discoveryUrl };
}

function needsTriage(name, domain, note = 'Confirm whether this licensed domain exposes sportsbook markets.') {
  return { name, domain, status: COVERAGE_STATUSES.needsTriage, note };
}

function notSportsbook(name, domain, note, evidenceUrl = `https://${domain}`) {
  return { name, domain, status: COVERAGE_STATUSES.notSportsbook, note, evidenceUrl };
}

function inactive(name, domain, note, evidenceUrl = `https://${domain}`) {
  return { name, domain, status: COVERAGE_STATUSES.inactive, note, evidenceUrl };
}

function temporarilyUnavailable(name, domain, note, evidenceUrl = `https://${domain}`) {
  return {
    name,
    domain,
    status: COVERAGE_STATUSES.temporarilyUnavailable,
    note,
    evidenceUrl,
  };
}

function coverageByStatus(entries = ROMANIAN_BOOKMAKER_COVERAGE) {
  return entries.reduce((summary, entry) => {
    summary[entry.status] = (summary[entry.status] || 0) + 1;
    return summary;
  }, {});
}

function coverageSummary(entries = ROMANIAN_BOOKMAKER_COVERAGE) {
  const counts = Object.fromEntries(
    Object.values(COVERAGE_STATUSES).map((status) => [status, 0]),
  );
  for (const entry of entries) {
    counts[entry.status] = (counts[entry.status] || 0) + 1;
  }

  return {
    total: entries.length,
    active: counts.direct + counts.browserOptional,
    remaining: counts.remainingProvider + counts.needsTriage,
    counts,
    entries,
  };
}

function coverageRemaining(entries = ROMANIAN_BOOKMAKER_COVERAGE) {
  return entries.filter((entry) =>
    [COVERAGE_STATUSES.remainingProvider, COVERAGE_STATUSES.needsTriage].includes(entry.status),
  );
}

module.exports = {
  COVERAGE_STATUSES,
  ROMANIAN_BOOKMAKER_COVERAGE,
  coverageByStatus,
  coverageRemaining,
  coverageSummary,
};
