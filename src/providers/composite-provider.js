class CompositeProvider {
  constructor(providers, { name = 'Romanian bookmakers' } = {}) {
    this.name = name;
    this.providers = providers.filter(Boolean);
  }

  async getOdds() {
    const settled = await Promise.all(this.providers.map(collectProviderResult));
    return compositeResult(settled, this.providers.length);
  }

  async *getOddsProgress() {
    const pending = new Map();
    const settled = new Array(this.providers.length);

    for (const [index, provider] of this.providers.entries()) {
      let promise;
      promise = collectProviderResult(provider).then((result) => ({ index, promise, result }));
      pending.set(promise, promise);
    }

    while (pending.size > 0) {
      const { index, promise, result } = await Promise.race(pending.values());
      pending.delete(promise);
      settled[index] = result;
      yield compositeResult(settled.filter(Boolean), this.providers.length, {
        includeProgress: true,
      });
    }
  }
}

const RETRY_DELAYS_MS = [500, 1500];
const RETRYABLE_ERROR_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
]);

function isRetryableError(error) {
  if (!error) return false;
  if (error.code && RETRYABLE_ERROR_CODES.has(error.code)) return true;
  const message = String(error.message || '');
  if (/\b(429|502|503|504)\b/.test(message)) return true;
  if (/timeout|timed out|econnreset|econnrefused|socket hang up|network error/i.test(message)) return true;
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function collectProviderResult(provider) {
  const startedAt = performanceNow();
  const maxAttempts = RETRY_DELAYS_MS.length + 1;
  let lastError;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const events = await provider.getOdds();
      return {
        status: providerStatus(provider, true, events.length, null, elapsedMs(startedAt)),
        events,
      };
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts - 1 && isRetryableError(error)) {
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      break;
    }
  }

  return {
    status: providerStatus(provider, false, 0, lastError?.message || 'Unknown error', elapsedMs(startedAt)),
    events: [],
  };
}

function compositeResult(settled, totalProviders, { includeProgress = false } = {}) {
  const result = {
    events: mergeEvents(settled.flatMap((result) => result.events)),
    providers: settled.map((result) => result.status),
  };
  if (includeProgress) {
    result.progress = {
      done: settled.length,
      total: totalProviders,
      complete: settled.length >= totalProviders,
    };
  }
  return result;
}

function providerStatus(provider, ok, events, error, durationMs = null) {
  const targetEvents = Number(provider?.eventTarget);
  return {
    name: provider.name,
    ok,
    events,
    ...(Number.isFinite(durationMs) ? { durationMs } : {}),
    ...(Number.isInteger(targetEvents) && targetEvents > 0 ? { targetEvents } : {}),
    ...(error ? { error } : {}),
  };
}

function performanceNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function elapsedMs(startedAt) {
  return Math.max(0, Math.round(performanceNow() - startedAt));
}

const NON_UNIQUE_EXTERNAL_ID_KEYS = new Set([
  'xsportPalinsesto',
]);

const STRICT_ID_MATCH_BOOKMAKERS = new Set([
  'Prowin',
]);

const TEAM_OUTCOME_SWAP = {
  home: 'away',
  away: 'home',
  homeDraw: 'drawAway',
  drawAway: 'homeDraw',
  '1': '2',
  '2': '1',
};

function mergeEvents(events) {
  const merged = [];
  for (const event of events) {
    const match = findMergeTarget(merged, event);
    if (!match) {
      merged.push(structuredClone(event));
      continue;
    }

    const { target, evidence } = match;
    const bookmakers = new Map(
      target.bookmakers.map((bookmaker) => [bookmaker.name, bookmaker]),
    );
    for (const bookmaker of event.bookmakers) {
      const alignedBookmaker = alignBookmakerOrientation(
        bookmaker,
        evidence.orientation,
      );
      bookmakers.set(alignedBookmaker.name, alignedBookmaker);
    }
    target.bookmakers = [...bookmakers.values()];
    target.externalIds = { ...target.externalIds, ...event.externalIds };
    target.matchConfidence = evidence.label;
    target.matchEvidence = uniqueStrings([
      ...(target.matchEvidence || []),
      evidence.label,
      evidence.orientation === 'reversed' ? 'home/away order normalized' : null,
    ]);
  }

  return merged.sort(
    (left, right) => new Date(left.startsAt) - new Date(right.startsAt),
  );
}

function alignBookmakerOrientation(bookmaker, orientation = 'direct') {
  const aligned = structuredClone(bookmaker);
  if (orientation !== 'reversed') {
    return aligned;
  }

  aligned.markets = reverseHomeAwayMarkets(aligned.markets || {});
  return aligned;
}

function reverseHomeAwayMarkets(markets) {
  const reversed = {};
  for (const [marketKey, prices] of Object.entries(markets || {})) {
    const nextMarketKey = reverseMarketKey(marketKey);
    const nextPrices = reverseMarketPrices(prices);
    reversed[nextMarketKey] = {
      ...(reversed[nextMarketKey] || {}),
      ...nextPrices,
    };
  }
  return reversed;
}

function reverseMarketKey(marketKey) {
  return reverseTeamTokenMarketKey(reverseHandicapMarketKey(marketKey));
}

function reverseHandicapMarketKey(marketKey) {
  const match = String(marketKey || '').match(
    /^(asianHandicap|handicap)_(?:(plus|minus)_)?([0-9]+(?:_[0-9]+)?)$/,
  );
  if (!match) {
    return marketKey;
  }

  const [, base, sign, line] = match;
  if (!sign) {
    return `${base}_0`;
  }
  return `${base}_${sign === 'plus' ? 'minus' : 'plus'}_${line}`;
}

function reverseTeamTokenMarketKey(marketKey) {
  return String(marketKey)
    .replaceAll('home', '__HOME__')
    .replaceAll('away', 'home')
    .replaceAll('__HOME__', 'away');
}

function reverseMarketPrices(prices) {
  if (!prices || typeof prices !== 'object' || Array.isArray(prices)) {
    return prices;
  }

  return Object.fromEntries(
    Object.entries(prices).map(([outcome, odds]) => [
      reverseOutcomeKey(outcome),
      odds,
    ]),
  );
}

function reverseOutcomeKey(outcome) {
  return TEAM_OUTCOME_SWAP[outcome] || outcome;
}

function findMergeTarget(candidates, event) {
  for (const candidate of candidates) {
    const evidence = fixtureMatchEvidence(candidate, event);
    if (evidence) {
      return { target: candidate, evidence };
    }
  }
  return null;
}

function isSameFixture(left, right) {
  return Boolean(fixtureMatchEvidence(left, right));
}

function fixtureMatchEvidence(left, right) {
  if (hasMatchingExternalId(left, right)) {
    return {
      label: matchingExternalIdLabel(left, right),
      orientation: fixtureOrientation(left, right),
    };
  }

  if (hasConflictingTrustedExternalId(left, right)) {
    return null;
  }

  if (hasSharedBookmaker(left, right)) {
    return null;
  }

  if (requiresSharedIdForMerge(left, right)) {
    return null;
  }

  if (!fixtureVariantsCompatible(left, right)) {
    return null;
  }

  if (!competitionsCompatible(left.competition, right.competition)) {
    return null;
  }

  const leftTime = new Date(left.startsAt).getTime();
  const rightTime = new Date(right.startsAt).getTime();
  const timeDistance = Math.abs(leftTime - rightTime);
  if (
    Number.isNaN(leftTime) ||
    Number.isNaN(rightTime) ||
    timeDistance > 90 * 60 * 1000
  ) {
    return null;
  }

  const similarity = fixtureSimilarityDetails(left, right);
  if (similarity.weakest < 0.72) {
    return null;
  }

  if (timeDistance <= 2 * 60 * 1000) {
    return similarity.score >= 0.82
      ? { label: 'fuzzy team/time', orientation: similarity.orientation }
      : null;
  }

  if (timeDistance <= 15 * 60 * 1000) {
    return similarity.score >= 0.88
      ? { label: 'fuzzy team/time', orientation: similarity.orientation }
      : null;
  }

  return similarity.score >= 0.92
    ? { label: 'fuzzy team/time', orientation: similarity.orientation }
    : null;
}

function hasMatchingExternalId(left, right) {
  const leftIds = left.externalIds || {};
  const rightIds = right.externalIds || {};
  return Object.entries(leftIds).some(
    ([key, value]) =>
      !NON_UNIQUE_EXTERNAL_ID_KEYS.has(key) &&
      value &&
      rightIds[key] &&
      String(value) === String(rightIds[key]),
  );
}

function matchingExternalIdLabel(left, right) {
  const leftIds = left.externalIds || {};
  const rightIds = right.externalIds || {};
  const match = Object.entries(leftIds).find(
    ([key, value]) =>
      !NON_UNIQUE_EXTERNAL_ID_KEYS.has(key) &&
      value &&
      rightIds[key] &&
      String(value) === String(rightIds[key]),
  );
  return match ? `shared ${match[0]}` : 'shared external id';
}

function hasConflictingTrustedExternalId(left, right) {
  const trustedKeys = ['sportradar', 'betradar'];
  return trustedKeys.some((key) => {
    const leftValue = left.externalIds?.[key];
    const rightValue = right.externalIds?.[key];
    return leftValue && rightValue && String(leftValue) !== String(rightValue);
  });
}

function hasSharedBookmaker(left, right) {
  const leftBookmakers = new Set(
    (left.bookmakers || []).map((bookmaker) => bookmaker.name),
  );
  return (right.bookmakers || []).some((bookmaker) =>
    leftBookmakers.has(bookmaker.name),
  );
}

function requiresSharedIdForMerge(left, right) {
  return hasStrictIdBookmaker(left) || hasStrictIdBookmaker(right);
}

function hasStrictIdBookmaker(event) {
  return (event.bookmakers || []).some((bookmaker) =>
    STRICT_ID_MATCH_BOOKMAKERS.has(bookmaker.name),
  );
}

function fixtureSimilarity(left, right) {
  return fixtureSimilarityDetails(left, right).score;
}

function fixtureOrientation(left, right) {
  const similarity = fixtureSimilarityDetails(left, right);
  return (
    similarity.orientation === 'reversed' &&
    similarity.reversed >= 0.82 &&
    similarity.reversedWeakest >= 0.72 &&
    similarity.reversed > similarity.direct + 0.05
  )
    ? 'reversed'
    : 'direct';
}

function fixtureSimilarityDetails(left, right) {
  const directHome = teamSimilarity(left.homeTeam, right.homeTeam);
  const directAway = teamSimilarity(left.awayTeam, right.awayTeam);
  const reversedHome = teamSimilarity(left.homeTeam, right.awayTeam);
  const reversedAway = teamSimilarity(left.awayTeam, right.homeTeam);
  const direct =
    (directHome + directAway) / 2;
  const reversed =
    (reversedHome + reversedAway) / 2;
  if (direct >= reversed) {
    return {
      score: direct,
      weakest: Math.min(directHome, directAway),
      orientation: 'direct',
      direct,
      reversed,
      directWeakest: Math.min(directHome, directAway),
      reversedWeakest: Math.min(reversedHome, reversedAway),
    };
  }
  return {
    score: reversed,
    weakest: Math.min(reversedHome, reversedAway),
    orientation: 'reversed',
    direct,
    reversed,
    directWeakest: Math.min(directHome, directAway),
    reversedWeakest: Math.min(reversedHome, reversedAway),
  };
}

function fixtureVariantsCompatible(left, right) {
  const leftProfile = fixtureVariantProfile(left);
  const rightProfile = fixtureVariantProfile(right);
  return (
    variantValueCompatible(leftProfile.gender, rightProfile.gender) &&
    variantValueCompatible(leftProfile.youth, rightProfile.youth) &&
    reserveVariantCompatible(leftProfile.reserve, rightProfile.reserve) &&
    variantValueCompatible(leftProfile.esports, rightProfile.esports)
  );
}

function competitionsCompatible(left, right) {
  if (!left || !right) {
    return true;
  }

  const leftNormalized = normalizeCompetition(left);
  const rightNormalized = normalizeCompetition(right);
  if (!leftNormalized.compact || !rightNormalized.compact) {
    return true;
  }
  if (leftNormalized.compact === rightNormalized.compact) {
    return true;
  }

  const containment = containmentScore(leftNormalized.tokens, rightNormalized.tokens);
  const jaccard = tokenJaccard(leftNormalized.tokens, rightNormalized.tokens);
  const editScore =
    1 -
    levenshtein(leftNormalized.compact, rightNormalized.compact) /
      Math.max(leftNormalized.compact.length, rightNormalized.compact.length);
  return Math.max(containment * 0.9, jaccard, editScore) >= 0.68;
}

function normalizeCompetition(value) {
  const words = String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\bclubs\b/g, ' club ')
    .replace(/\bfriendlies\b/g, ' friendly ')
    .replace(/\b(liga|league|division|divizia)\b/g, ' ')
    .replace(/\b(cupa|cup)\b/g, ' cup ')
    .replace(/\b(campionat|championship)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => word.length > 1)
    .filter((word) => !isCompetitionStopword(word));
  return {
    tokens: new Set(words),
    compact: words.join(''),
  };
}

function isCompetitionStopword(word) {
  return [
    'football',
    'fotbal',
    'soccer',
    'men',
    'male',
    'masculin',
    'the',
    'de',
    'la',
    'of',
    'and',
  ].includes(word);
}

function fixtureVariantProfile(event) {
  const teamText = [event?.homeTeam, event?.awayTeam].filter(Boolean).join(' ');
  const fullText = [teamText, event?.competition].filter(Boolean).join(' ');
  return {
    gender: detectGenderVariant(fullText),
    youth: detectYouthVariant(fullText),
    reserve: detectReserveVariant(teamText),
    esports: detectEsportsVariant(fullText),
  };
}

function variantValueCompatible(left, right) {
  return left === right || (!left && !right);
}

function reserveVariantCompatible(left, right) {
  if (left === right || (!left && !right)) {
    return true;
  }
  return Boolean(left && right && (left === 'reserve' || right === 'reserve'));
}

function detectGenderVariant(value) {
  const text = String(value || '').toLowerCase();
  if (
    /\b(women|woman|ladies|female|feminin|femei)\b/.test(text) ||
    /(^|[^a-z0-9])[fw](?=[^a-z0-9]|$)/.test(text)
  ) {
    return 'women';
  }
  return null;
}

function detectYouthVariant(value) {
  const text = String(value || '').toLowerCase();
  const ages = [];
  const pattern = /\b(?:u|under|sub)[\s-]?([0-9]{2})\b/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    ages.push(`u${match[1]}`);
  }
  return ages.length ? [...new Set(ages)].sort().join('|') : null;
}

function detectReserveVariant(value) {
  const text = String(value || '').toLowerCase();
  const match = text.match(/(^|[^a-z0-9])(ii|iii|iv|2|3|4|b|reserves?|rezerve)(?=[^a-z0-9]|$)/);
  if (!match) {
    return null;
  }
  const token = match[2];
  const aliases = {
    ii: 'reserve_2',
    '2': 'reserve_2',
    iii: 'reserve_3',
    '3': 'reserve_3',
    iv: 'reserve_4',
    '4': 'reserve_4',
  };
  return aliases[token] || 'reserve';
}

function detectEsportsVariant(value) {
  return /\b(e-?sports?|cyber|virtual)\b/i.test(String(value || '')) ? 'esports' : null;
}

function teamSimilarity(left, right) {
  const leftNormalized = normalizeTeam(left);
  const rightNormalized = normalizeTeam(right);
  if (!leftNormalized.compact || !rightNormalized.compact) {
    return 0;
  }

  if (leftNormalized.compact === rightNormalized.compact) {
    return 1;
  }

  const shorter =
    leftNormalized.compact.length < rightNormalized.compact.length
      ? leftNormalized.compact
      : rightNormalized.compact;
  const longer =
    leftNormalized.compact.length < rightNormalized.compact.length
      ? rightNormalized.compact
      : leftNormalized.compact;
  if (shorter.length >= 5 && longer.includes(shorter)) {
    return 0.94;
  }

  const tokenContainment = containmentScore(
    leftNormalized.tokens,
    rightNormalized.tokens,
  );
  if (
    Math.min(leftNormalized.tokens.size, rightNormalized.tokens.size) >= 2 &&
    tokenContainment === 1
  ) {
    return 0.96;
  }

  const tokenScore = tokenJaccard(leftNormalized.tokens, rightNormalized.tokens);
  const editScore =
    1 -
    levenshtein(leftNormalized.compact, rightNormalized.compact) /
      Math.max(leftNormalized.compact.length, rightNormalized.compact.length);
  return Math.max(tokenContainment * 0.88, tokenScore, editScore);
}

function normalizeTeam(value) {
  const words = String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\bii\b/g, ' 2 ')
    .replace(/\biii\b/g, ' 3 ')
    .replace(/\biv\b/g, ' 4 ')
    .replace(/\buniv\b/g, ' universidad ')
    .replace(/\buniv\.\b/g, ' universidad ')
    .replace(/\buniversitatea\b/g, ' universidad ')
    .replace(/\buniversity\b/g, ' universidad ')
    .replace(/\brb\b/g, ' red bulls ')
    .replace(/\butd\b/g, 'united')
    .replace(/\bst\b/g, 'saint')
    .replace(/\b(w|f)\b/g, ' ')
    .replace(/\bwomen\b/g, ' ')
    .replace(/\bfeminin\b/g, ' ')
    .replace(/\bfemei\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !isShortNoiseToken(word))
    .filter((word) => !isTeamStopword(word));
  return {
    tokens: new Set(words),
    compact: words.join(''),
  };
}

function isShortNoiseToken(word) {
  return /^[a-z]$/.test(word);
}

function isTeamStopword(word) {
  return [
    'fc',
    'cf',
    'ac',
    'sc',
    'fk',
    'afc',
    'club',
    'ca',
    'cd',
    'cs',
    'as',
    'bk',
    'sk',
    'if',
    'il',
    'oc',
    'de',
    'del',
    'la',
    'las',
    'los',
    'le',
    'el',
    'al',
    'y',
    'da',
    'do',
    'dos',
    'das',
  ].includes(word);
}

function containmentScore(left, right) {
  const smaller = left.size < right.size ? left : right;
  const larger = left.size < right.size ? right : left;
  if (smaller.size === 0) {
    return 0;
  }
  let matches = 0;
  for (const token of smaller) {
    if (larger.has(token)) {
      matches += 1;
    }
  }
  return matches / smaller.size;
}

function tokenJaccard(left, right) {
  const union = new Set([...left, ...right]);
  if (union.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
    }
  }
  return intersection / union.size;
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function levenshtein(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const current = [leftIndex + 1];
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      current.push(
        Math.min(
          current[rightIndex] + 1,
          previous[rightIndex + 1] + 1,
          previous[rightIndex] + (left[leftIndex] === right[rightIndex] ? 0 : 1),
        ),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

module.exports = { CompositeProvider, mergeEvents };
