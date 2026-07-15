const {
  genericMarketKey,
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
