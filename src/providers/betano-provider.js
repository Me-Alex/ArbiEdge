const {
  genericMarketKey,
  handicapMarketKey,
  hasAnyCompleteMarket,
  hasCompleteOutcomes,
  isDecimalOdds,
  normalizeOutcomeKey,
  splitFixtureName,
} = require('./market-utils');
const { absoluteEventUrl, bookmakerLinkFields } = require('./event-links');
const { betanoStartDate } = require('./betano-browser-transport');

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
  if (event?.liveNow || event?.live || event?.isLive) return null;
  const teams = resolveBetanoTeams(event);
  const h2h = event.markets?.find((market) => market.type === 'MRES' && isActiveBetanoMarket(market));
  const prices = Object.fromEntries(
    (h2h?.selections || [])
      .filter((selection) => isActiveBetanoSelection(selection) && isDecimalOdds(selection.price))
      .map((selection) => [selection.name, selection.price]),
  );
  const startsAt = betanoStartDate(event.startTime);
  if (teams.length !== 2 || !startsAt) return null;

  const markets = {};
  if (['1', 'X', '2'].every((name) => isDecimalOdds(prices[name]))) {
    markets.h2h = { home: prices['1'], draw: prices.X, away: prices['2'] };
  }

  const dnb = event.markets?.find((market) => market.type === 'DNOB' && isActiveBetanoMarket(market));
  const dnbHome = teamSelectionPrice(dnb?.selections, teams[0], ['1', 'home']);
  const dnbAway = teamSelectionPrice(dnb?.selections, teams[1], ['2', 'away']);
  if (isDecimalOdds(dnbHome) && isDecimalOdds(dnbAway)) {
    markets.drawNoBet = { home: dnbHome, away: dnbAway };
  }
  for (const market of event.markets || []) {
    const typed = normalizeTypedBetanoMarket(market, teams);
    if (typed && !markets[typed.key]) {
      markets[typed.key] = typed.prices;
      continue;
    }
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
      lastUpdate: event.collectedAt || fetchedAt,
      sourceStartsAt: startsAt.toISOString(),
      collectionMethod: event.collectionMethod || 'playwright',
      collectionEvidence: {
        sourceUrls: (event.sourceUrls || []).filter(isPublicHttpUrl).slice(0, 20),
        capturedAt: event.collectedAt || fetchedAt,
      },
      ...bookmakerLinkFields(
        'Betano',
        absoluteEventUrl(event.url, 'https://ro.betano.com'),
      ),
      markets,
    }],
  };
}

/**
 * Explicit Betano/Kambi-style market type codes. Prefer these over generic
 * label slugs so cross-book scanners share stable keys.
 */
function normalizeTypedBetanoMarket(market, teams = []) {
  if (!market || !isActiveBetanoMarket(market)) return null;
  const type = String(market.type || '').toUpperCase();
  if (['MRES', 'DNOB'].includes(type)) return null;

  // Both teams to score
  if (['BTSC', 'BTTS', 'BTST', 'GGNG'].includes(type) || /ambele.*marcheaza|both teams to score/i.test(market.name || '')) {
    const prices = yesNoPrices(market);
    if (prices) {
      const name = String(market.name || '').toLowerCase();
      const key = /pauza|prima|1st|half time/i.test(name)
        ? 'firstHalfBothTeamsToScore'
        : /a doua|2nd|second half/i.test(name)
          ? 'secondHalfBothTeamsToScore'
          : 'bothTeamsToScore';
      return { key, prices };
    }
  }

  // Double chance
  if (['DBLC', 'DBCH', 'DCHN'].includes(type) || /sansa dubla|double chance/i.test(market.name || '')) {
    const prices = doubleChancePrices(market);
    if (prices) {
      const name = String(market.name || '').toLowerCase();
      const key = /pauza|prima|1st/i.test(name)
        ? 'firstHalfDoubleChance'
        : /a doua|2nd/i.test(name)
          ? 'secondHalfDoubleChance'
          : 'doubleChance';
      return { key, prices };
    }
  }

  // Period 1X2
  if (['HCTG', 'HTFT', '1HRS', 'FHRS'].includes(type) || /^(pauza|prima repriza|1st half)$/i.test(String(market.name || '').trim())) {
    const prices = threeWayPrices(market);
    if (prices && type !== 'HTFT') return { key: 'firstHalfH2h', prices };
  }
  if (['2HRS', 'SHRS'].includes(type) || /^(a doua repriza|2nd half)$/i.test(String(market.name || '').trim())) {
    const prices = threeWayPrices(market);
    if (prices) return { key: 'secondHalfH2h', prices };
  }

  // Totals by type — period asian before EU half totals (labels share "total goluri" + "pauza").
  if (['TOTG', 'OU', 'OUGS'].includes(type)) {
    return lineMarketFromBetano(market, 'totalGoals');
  }
  if (
    /total goluri asiatice|asian total/i.test(market.name || '')
    && /(pauza|prima|1st)/i.test(market.name || '')
    && !/(a doua|2nd|second)/i.test(market.name || '')
  ) {
    return lineMarketFromBetano(market, 'firstHalfAsianTotalGoals');
  }
  if (
    /total goluri asiatice|asian total/i.test(market.name || '')
    && /(a doua|2nd|second)/i.test(market.name || '')
  ) {
    return lineMarketFromBetano(market, 'secondHalfAsianTotalGoals');
  }
  if (['AOTG', 'ASOU', 'ATOU'].includes(type) || /total goluri asiatice|asian total/i.test(market.name || '')) {
    return lineMarketFromBetano(market, 'asianTotalGoals');
  }
  if (
    ['OUHG', '1HOU', 'FHOU'].includes(type)
    || (/total goluri.*(pauza|prima)/i.test(market.name || '')
      && !/asiatic|asian/i.test(market.name || ''))
  ) {
    return lineMarketFromBetano(market, 'firstHalfTotalGoals');
  }
  if (
    ['2HOU', 'SHOU'].includes(type)
    || (/total goluri.*(a doua|2nd)/i.test(market.name || '')
      && !/asiatic|asian/i.test(market.name || ''))
  ) {
    return lineMarketFromBetano(market, 'secondHalfTotalGoals');
  }
  if (['TCOR', 'OUCR', 'CRNR'].includes(type) || /total cornere|total corners/i.test(market.name || '')) {
    return lineMarketFromBetano(market, 'totalCorners');
  }
  if (['TCAR', 'OUCD', 'CARD'].includes(type) || /cartonas|cards|booking/i.test(market.name || '')) {
    return lineMarketFromBetano(market, 'totalCards');
  }

  // Team totals
  if (['TTHG', 'HTOU', 'OU1'].includes(type) || /total goluri.*(gazde|gazda|home)/i.test(market.name || '')) {
    return lineMarketFromBetano(market, 'market_total_goluri_home');
  }
  if (['TTAG', 'ATOU2', 'OU2'].includes(type) || /total goluri.*(oaspeti|oaspete|away)/i.test(market.name || '')) {
    return lineMarketFromBetano(market, 'market_total_goluri_away');
  }

  // Team to score / clean sheet
  if (['HTSC', 'HTTS'].includes(type) || /gazde.*marcheaza|gazda.*marcheaza|home to score/i.test(market.name || '')) {
    const prices = yesNoPrices(market);
    if (prices) return { key: 'market_marcheaza_home', prices };
  }
  if (['ATSC', 'ATTS'].includes(type) || /oaspeti.*marcheaza|oaspete.*marcheaza|away to score/i.test(market.name || '')) {
    const prices = yesNoPrices(market);
    if (prices) return { key: 'market_marcheaza_away', prices };
  }
  if (/fara gol primit|clean sheet/i.test(market.name || '')) {
    const name = String(market.name || '').toLowerCase();
    const prices = yesNoPrices(market);
    if (prices) {
      if (/gazda|gazde|home/.test(name)) return { key: 'market_clean_sheet_home', prices };
      if (/oaspete|oaspeti|away/.test(name)) return { key: 'market_clean_sheet_away', prices };
    }
  }

  // Asian handicap (2-way)
  if (['AHCP', 'ASAH', 'GAHC'].includes(type) || /handicap asiatic|asian handicap/i.test(market.name || '')) {
    return handicapMarketFromBetano(market, 'asianHandicap', teams);
  }

  // Half-period draw no bet (full-time DNOB handled above)
  if (['HDNB', '1DNB'].includes(type) || /fara egal.*(pauza|prima)|dnb.*(1st|half)/i.test(market.name || '')) {
    const home = teamSelectionPrice(market.selections, teams[0], ['1', 'home']);
    const away = teamSelectionPrice(market.selections, teams[1], ['2', 'away']);
    if (isDecimalOdds(home) && isDecimalOdds(away)) {
      return { key: 'firstHalfDrawNoBet', prices: { home, away } };
    }
  }

  if (
    ['SDNB', '2DNB', '2HDN'].includes(type)
    || /fara egal.*(a doua|2nd|second)|dnb.*(2nd|second)/i.test(market.name || '')
  ) {
    const home = teamSelectionPrice(market.selections, teams[0], ['1', 'home']);
    const away = teamSelectionPrice(market.selections, teams[1], ['2', 'away']);
    if (isDecimalOdds(home) && isDecimalOdds(away)) {
      return { key: 'secondHalfDrawNoBet', prices: { home, away } };
    }
  }

  // Odd/even goals
  if (['OEGS', 'ODEV', 'PARI'].includes(type) || /par.?impar|odd.?even/i.test(market.name || '')) {
    const prices = oddEvenPrices(market);
    if (prices) return { key: 'market_total_goluri_impar_par', prices };
  }

  // To qualify
  if (['QUAL', 'TQFY', 'WINR'].includes(type) && /califica|qualify|merge mai departe/i.test(market.name || type)) {
    const home = teamSelectionPrice(market.selections, teams[0], ['1', 'home']);
    const away = teamSelectionPrice(market.selections, teams[1], ['2', 'away']);
    if (isDecimalOdds(home) && isDecimalOdds(away)) {
      return { key: 'toQualify', prices: { home, away } };
    }
  }

  return null;
}

function handicapMarketFromBetano(market, baseKey, teams = []) {
  const prices = {};
  let homeLine = null;
  for (const selection of market.selections || []) {
    if (!isActiveBetanoSelection(selection) || !isDecimalOdds(selection.price)) continue;
    const raw = String(selection.name || selection.title || '');
    const line = Number(selection.handicap ?? selection.line ?? selection.argument);
    const side = raw === '1' || /home|1\s*\(/i.test(raw)
      ? 'home'
      : raw === '2' || /away|2\s*\(/i.test(raw)
        ? 'away'
        : null;
    if (!side) {
      // Team-name based sides when available.
      if (teams[0] && teamNamesCompatible(raw, teams[0])) {
        prices.home = selection.price;
        if (Number.isFinite(line)) homeLine = line;
        continue;
      }
      if (teams[1] && teamNamesCompatible(raw, teams[1])) {
        prices.away = selection.price;
        continue;
      }
      continue;
    }
    prices[side] = selection.price;
    if (side === 'home' && Number.isFinite(line)) homeLine = line;
  }
  if (!prices.home || !prices.away || !Number.isFinite(homeLine)) return null;
  const key = handicapMarketKey(baseKey, homeLine);
  return key ? { key, prices: { home: prices.home, away: prices.away } } : null;
}

function normalizeGenericBetanoMarket(market) {
  if (!market || !isActiveBetanoMarket(market) || ['MRES', 'DNOB'].includes(market.type)) {
    return null;
  }

  const label = market.name || market.title || market.type;
  const line = extractBetanoLine(market);
  const prices = {};
  for (const selection of market.selections || []) {
    if (!isActiveBetanoSelection(selection)) continue;
    const outcomeKey = normalizeOutcomeKey(selection.name || selection.title);
    if (outcomeKey && isDecimalOdds(selection.price)) {
      if (prices[outcomeKey] && prices[outcomeKey] !== selection.price) return null;
      prices[outcomeKey] = selection.price;
    }
  }

  const key = genericMarketKey(label, line ? { line } : undefined);
  return key && hasCompleteOutcomes(prices) ? { key, prices } : null;
}

function yesNoPrices(market) {
  const prices = {};
  for (const selection of market.selections || []) {
    if (!isActiveBetanoSelection(selection) || !isDecimalOdds(selection.price)) continue;
    const key = normalizeOutcomeKey(selection.name || selection.title);
    if (key === 'yes' || key === 'no') prices[key] = selection.price;
  }
  return hasCompleteOutcomes(prices) && prices.yes && prices.no ? prices : null;
}

function threeWayPrices(market) {
  const prices = {};
  for (const selection of market.selections || []) {
    if (!isActiveBetanoSelection(selection) || !isDecimalOdds(selection.price)) continue;
    const raw = String(selection.name || selection.title || '').trim();
    const key = raw === '1' || raw === 'X' || raw === '2'
      ? { 1: 'home', X: 'draw', 2: 'away' }[raw]
      : normalizeOutcomeKey(raw);
    if (['home', 'draw', 'away'].includes(key)) prices[key] = selection.price;
  }
  return ['home', 'draw', 'away'].every((k) => isDecimalOdds(prices[k])) ? prices : null;
}

function doubleChancePrices(market) {
  const prices = {};
  for (const selection of market.selections || []) {
    if (!isActiveBetanoSelection(selection) || !isDecimalOdds(selection.price)) continue;
    const compact = String(selection.name || selection.title || '').toLowerCase().replace(/\s+/g, '');
    const key = { '1x': 'homeDraw', '12': 'homeAway', x2: 'drawAway', 'homedraw': 'homeDraw', 'homeaway': 'homeAway', 'drawaway': 'drawAway' }[compact]
      || normalizeOutcomeKey(selection.name || selection.title);
    if (['homeDraw', 'homeAway', 'drawAway'].includes(key)) prices[key] = selection.price;
  }
  return ['homeDraw', 'homeAway', 'drawAway'].every((k) => isDecimalOdds(prices[k])) ? prices : null;
}

function oddEvenPrices(market) {
  const prices = {};
  for (const selection of market.selections || []) {
    if (!isActiveBetanoSelection(selection) || !isDecimalOdds(selection.price)) continue;
    const key = normalizeOutcomeKey(selection.name || selection.title);
    if (key === 'odd' || key === 'even') prices[key] = selection.price;
  }
  return prices.odd && prices.even ? prices : null;
}

function lineMarketFromBetano(market, baseKey) {
  const line = extractBetanoLine(market);
  if (!line) return null;
  const prices = {};
  for (const selection of market.selections || []) {
    if (!isActiveBetanoSelection(selection) || !isDecimalOdds(selection.price)) continue;
    const key = normalizeOutcomeKey(selection.name || selection.title);
    if (key === 'over' || key === 'under') prices[key] = selection.price;
  }
  if (!prices.over || !prices.under) return null;
  return {
    key: `${baseKey}_${String(line).replace('.', '_')}`,
    prices,
  };
}

function resolveBetanoTeams(event) {
  const explicit = [event?.homeTeam, event?.awayTeam]
    .map((value) => String(value || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const fromName = splitFixtureName(event?.name);
  if (explicit.length === 2) {
    if (
      fromName.length === 2
      && (!teamNamesCompatible(explicit[0], fromName[0]) || !teamNamesCompatible(explicit[1], fromName[1]))
    ) return [];
    return explicit;
  }
  return fromName;
}

function teamSelectionPrice(selections, teamName, aliases = []) {
  const active = (selections || []).filter(isActiveBetanoSelection);
  const teamMatch = active.find((selection) =>
    teamNamesCompatible(selection?.name || selection?.title, teamName));
  if (teamMatch && isDecimalOdds(teamMatch.price)) return teamMatch.price;
  const normalizedAliases = new Set(aliases.map(normalizeComparable));
  const aliasMatch = active.find((selection) =>
    normalizedAliases.has(normalizeComparable(selection?.name || selection?.title)));
  return aliasMatch && isDecimalOdds(aliasMatch.price) ? aliasMatch.price : null;
}

function teamNamesCompatible(left, right) {
  const leftValue = normalizeComparable(left);
  const rightValue = normalizeComparable(right);
  if (!leftValue || !rightValue) return false;
  if (leftValue === rightValue) return true;
  const shorter = leftValue.length <= rightValue.length ? leftValue : rightValue;
  const longer = leftValue.length <= rightValue.length ? rightValue : leftValue;
  return shorter.length >= 4 && longer.includes(shorter);
}

function normalizeComparable(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function isActiveBetanoMarket(market) {
  if (!market || market.active === false || market.suspended === true || market.open === false) return false;
  return !/closed|suspend|settled|resulted/i.test(String(market.status || ''));
}

function isActiveBetanoSelection(selection) {
  if (!selection || selection.active === false || selection.suspended === true || selection.open === false) return false;
  return !/closed|suspend|settled|resulted/i.test(String(selection.status || ''));
}

function isPublicHttpUrl(value) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
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

module.exports = {
  BetanoProvider,
  isActiveBetanoMarket,
  isActiveBetanoSelection,
  normalizeBetanoEvent,
  resolveBetanoTeams,
  teamNamesCompatible,
};
