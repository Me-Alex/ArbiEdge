'use strict';

const EXACT_FEED_GROUPS = new Map([
  ...['Stanleybet', 'GameWorld', 'AdmiralBet', 'Seven', 'RedSevens', 'GPCasino']
    .map((name) => [name, 'nsoft:stanleybet-family']),
  ...['Winner', 'MrPlay', 'Bet7', 'EliteSlots']
    .map((name) => [name, 'digitain:micros-prod1']),
  ...['LasVegas', 'Spin']
    .map((name) => [name, 'xsport:exalogic-ro']),
]);

const PLATFORM_GROUPS = new Map([
  ...['Stanleybet', 'GameWorld', 'AdmiralBet', 'Seven', 'RedSevens', 'GPCasino', 'MaxBet', 'Betmen', 'RoyalSlots']
    .map((name) => [name, 'nsoft']),
  ...['Winner', 'MrPlay', 'Bet7', 'EliteSlots', '888']
    .map((name) => [name, 'digitain']),
  ...['LasVegas', 'Spin', 'Winboss', 'PowerBet', 'Magnumbet', 'Excelbet']
    .map((name) => [name, 'xsport']),
  ...['Winbet', 'VivaBet', 'LuckySeven', 'OneCasino', 'MaxWin', 'Prowin', 'VipBet']
    .map((name) => [name, 'egt-digital']),
  ...['VictoryBet', 'Manhattan']
    .map((name) => [name, 'betconstruct']),
  ...['Fortuna', 'Casa Pariurilor']
    .map((name) => [name, 'ufo']),
]);

function feedGroupForBookmaker(name) {
  const normalized = String(name || '').trim();
  return EXACT_FEED_GROUPS.get(normalized) || `bookmaker:${slug(normalized)}`;
}

function platformGroupForBookmaker(name) {
  const normalized = String(name || '').trim();
  return PLATFORM_GROUPS.get(normalized) || `independent:${slug(normalized)}`;
}

function annotateFeedGroups(events) {
  for (const event of events || []) {
    for (const bookmaker of event?.bookmakers || []) {
      bookmaker.feedGroup = bookmaker.feedGroup || feedGroupForBookmaker(bookmaker.name);
      bookmaker.platformGroup = bookmaker.platformGroup || platformGroupForBookmaker(bookmaker.name);
    }
  }
  return events;
}

function independentFeedCount(bookmakers) {
  return new Set((bookmakers || []).map((bookmaker) =>
    bookmaker?.feedGroup || feedGroupForBookmaker(bookmaker?.name),
  ).filter(Boolean)).size;
}

function slug(value) {
  return String(value || 'unknown')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'unknown';
}

module.exports = {
  annotateFeedGroups,
  feedGroupForBookmaker,
  independentFeedCount,
  platformGroupForBookmaker,
};
