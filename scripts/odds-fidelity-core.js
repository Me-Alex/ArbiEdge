'use strict';

const { getMarketLabel, getOutcomeLabel } = require('../src/formula-engine');

const DEFAULT_PRICE_TOLERANCE = 0.01;
const DEFAULT_CONTEXT_RADIUS = 8;
const DEFAULT_CONTEXT_CHAR_RADIUS = 480;

const FIDELITY_STATUSES = Object.freeze({
  verified: 'verified',
  mismatch: 'mismatch',
  notFound: 'not_found',
  ambiguous: 'ambiguous',
  unverifiable: 'unverifiable',
});

const UNTRUSTED_FIDELITY_STATUSES = new Set([
  FIDELITY_STATUSES.mismatch,
  FIDELITY_STATUSES.notFound,
  FIDELITY_STATUSES.ambiguous,
  FIDELITY_STATUSES.unverifiable,
]);

const DEFAULT_MARKET_FILTERS = Object.freeze([
  'h2h',
  'totalGoals',
  'totalCorners',
  'bothTeamsToScore',
]);

const LINE_MARKET_PREFIXES = [
  ['totalPoints', 'totalPoints', 'fulltime', false],
  ['totalGames', 'totalGames', 'fulltime', false],
  ['totalSets', 'totalSets', 'fulltime', false],
  ['firstHalfAsianTotalCorners', 'totalCorners', 'firstHalf', true],
  ['secondHalfAsianTotalCorners', 'totalCorners', 'secondHalf', true],
  ['asianTotalCorners', 'totalCorners', 'fulltime', true],
  ['firstHalfAsianTotalGoals', 'totalGoals', 'firstHalf', true],
  ['secondHalfAsianTotalGoals', 'totalGoals', 'secondHalf', true],
  ['asianTotalGoals', 'totalGoals', 'fulltime', true],
  ['firstHalfAsianTotalCards', 'totalCards', 'firstHalf', true],
  ['secondHalfAsianTotalCards', 'totalCards', 'secondHalf', true],
  ['asianTotalCards', 'totalCards', 'fulltime', true],
  ['firstHalfTotalCorners', 'totalCorners', 'firstHalf', false],
  ['secondHalfTotalCorners', 'totalCorners', 'secondHalf', false],
  ['totalCorners', 'totalCorners', 'fulltime', false],
  ['firstHalfTotalGoals', 'totalGoals', 'firstHalf', false],
  ['secondHalfTotalGoals', 'totalGoals', 'secondHalf', false],
  ['totalGoals', 'totalGoals', 'fulltime', false],
  ['firstHalfTotalCards', 'totalCards', 'firstHalf', false],
  ['secondHalfTotalCards', 'totalCards', 'secondHalf', false],
  ['totalCards', 'totalCards', 'fulltime', false],
  ['market_total_goluri_home', 'teamTotalGoals', 'fulltime', false, 'home'],
  ['market_total_goluri_away', 'teamTotalGoals', 'fulltime', false, 'away'],
  ['total_goluri_home', 'teamTotalGoals', 'fulltime', false, 'home'],
  ['total_goluri_away', 'teamTotalGoals', 'fulltime', false, 'away'],
];

const MARKET_ALIASES = {
  h2h: ['1x2', 'rezultat final', 'final', 'castigator', 'match winner', 'winner'],
  doubleChance: ['sansa dubla', 'double chance'],
  drawNoBet: ['egal pariul se ramburseaza', 'draw no bet', 'dnb'],
  // Prefer full labels first. Short "gg" is still accepted, but combo cards
  // such as "GG & Over 2.5" are rejected by isContaminatedMarketContext().
  bothTeamsToScore: [
    'ambele echipe marcheaza',
    'ambele marcheaza',
    'both teams to score',
    'btts',
    'gg',
  ],
  totalGoals: ['total goluri', 'goluri total', 'total goals', 'goluri', 'goals'],
  totalPoints: ['total puncte', 'puncte total', 'total points', 'points'],
  totalGames: ['total jocuri', 'jocuri total', 'total games', 'games'],
  totalSets: ['total seturi', 'seturi total', 'total sets', 'sets'],
  teamTotalGoals: ['total goluri', 'goluri echipa', 'team total goals', 'team goals'],
  totalCorners: ['total cornere', 'cornere', 'corners', 'corner'],
  totalCards: ['total cartonase', 'cartonase', 'cards', 'bookings'],
  handicap: ['handicap', 'asian handicap', 'handicap asiatic'],
  toQualify: ['se califica', 'to qualify'],
};

const PERIOD_ALIASES = {
  fulltime: ['timp regulamentar', 'full time', 'match', 'meci'],
  firstHalf: ['repriza 1', 'repriza i', 'prima repriza', 'first half', '1st half', '1h', 'pauza'],
  secondHalf: ['repriza 2', 'repriza ii', 'a doua repriza', 'second half', '2nd half', '2h'],
};

const PERIOD_CONFLICTS = {
  fulltime: [...PERIOD_ALIASES.firstHalf, ...PERIOD_ALIASES.secondHalf],
  firstHalf: PERIOD_ALIASES.secondHalf,
  secondHalf: PERIOD_ALIASES.firstHalf,
};

const OUTCOME_ALIASES = {
  over: ['peste', 'over'],
  under: ['sub', 'under'],
  yes: ['da', 'yes'],
  no: ['nu', 'no'],
  draw: ['x', 'egal', 'egalitate', 'draw'],
  homeDraw: ['1x', 'home draw'],
  homeAway: ['12', 'home away'],
  drawAway: ['x2', 'draw away'],
};

function parseMarketDescriptor(marketKey) {
  const key = String(marketKey || '');

  for (const [prefix, marketFamily, period, asian, teamScope] of LINE_MARKET_PREFIXES) {
    if (key === prefix || key.startsWith(`${prefix}_`)) {
      return {
        marketKey: key,
        marketFamily,
        period,
        line: formatLineFromKey(key),
        asian,
        teamScope: teamScope || null,
      };
    }
  }

  if (key === 'h2h') {
    return { marketKey: key, marketFamily: 'h2h', period: 'fulltime', line: null, teamScope: null };
  }
  if (key === 'firstHalfH2h') {
    return { marketKey: key, marketFamily: 'h2h', period: 'firstHalf', line: null, teamScope: null };
  }
  if (key === 'secondHalfH2h') {
    return { marketKey: key, marketFamily: 'h2h', period: 'secondHalf', line: null, teamScope: null };
  }
  if (key === 'bothTeamsToScore') {
    return { marketKey: key, marketFamily: 'bothTeamsToScore', period: 'fulltime', line: null, teamScope: null };
  }
  if (/firstHalf.*both.*teams|prima.*repriza.*ambele/i.test(key)) {
    return { marketKey: key, marketFamily: 'bothTeamsToScore', period: 'firstHalf', line: null, teamScope: null };
  }
  if (key === 'doubleChance') {
    return { marketKey: key, marketFamily: 'doubleChance', period: 'fulltime', line: null, teamScope: null };
  }
  if (key === 'drawNoBet') {
    return { marketKey: key, marketFamily: 'drawNoBet', period: 'fulltime', line: null, teamScope: null };
  }
  if (key === 'firstHalfDrawNoBet') {
    return { marketKey: key, marketFamily: 'drawNoBet', period: 'firstHalf', line: null, teamScope: null };
  }
  if (key === 'secondHalfDrawNoBet') {
    return { marketKey: key, marketFamily: 'drawNoBet', period: 'secondHalf', line: null, teamScope: null };
  }
  if (/^(asian)?[Hh]andicap/.test(key)) {
    return {
      marketKey: key,
      marketFamily: 'handicap',
      period: 'fulltime',
      line: formatHandicapLine(key),
      teamScope: null,
    };
  }
  if (key === 'toQualify') {
    return { marketKey: key, marketFamily: 'toQualify', period: 'overtime', line: null, teamScope: null };
  }

  return { marketKey: key, marketFamily: key || 'unknown', period: 'unknown', line: formatLineFromKey(key), teamScope: null };
}

function buildExpectedOddRecord({ event, bookmaker, check }) {
  const descriptor = parseMarketDescriptor(check.marketKey);
  return {
    bookmaker: bookmaker?.name || check.bookmaker || '',
    eventId: event?.id || null,
    eventUrl: bookmaker?.url || bookmaker?.eventUrl || bookmaker?.bookmakerUrl || '',
    homeTeam: event?.homeTeam || '',
    awayTeam: event?.awayTeam || '',
    competition: event?.competition || '',
    startsAt: event?.startsAt || null,
    marketKey: check.marketKey,
    marketLabel: check.marketLabel || getMarketLabel(check.marketKey),
    marketFamily: descriptor.marketFamily,
    period: descriptor.period,
    line: descriptor.line,
    teamScope: descriptor.teamScope,
    outcome: check.outcome,
    outcomeLabel: check.outcomeLabel || getOutcomeLabel(check.outcome),
    endpointPrice: Number(check.price ?? check.endpointPrice),
    websitePrice: null,
    status: null,
  };
}

function verifyRecordsAgainstText(records, visibleText, options = {}) {
  return (Array.isArray(records) ? records : []).map((record) =>
    verifyOddAgainstText(record, visibleText, options));
}

function verifyOddAgainstText(record, visibleText, options = {}) {
  const priceTolerance = nonNegativeNumber(options.priceTolerance, DEFAULT_PRICE_TOLERANCE);
  const contextRows = normalizeContextRows(options.contextRows || options.structuredRows || []);
  const normalizedText = normalizeWhitespace(visibleText);
  const normalizedBody = normalizeText(normalizedText);

  if (isBlockedOrEmpty(normalizedBody)) {
    return finalizeRecord(record, {
      status: FIDELITY_STATUSES.unverifiable,
      evidence: {
        reason: normalizedBody ? 'blocked_or_login_required' : 'empty_page_text',
        pageTextLength: normalizedText.length,
      },
    });
  }

  const descriptor = parseMarketDescriptor(record.marketKey);
  const enriched = { ...record, ...descriptor };
  const teamEvidence = eventEvidence(enriched, normalizedBody);
  const priceAnywhere = textContainsPrice(normalizedText, enriched.endpointPrice, priceTolerance);
  const contextBlocks = buildContextBlocks(normalizedText, enriched, contextRows);
  const evaluatedBlocks = contextBlocks.map((block) => evaluateContextBlock(block, enriched, priceTolerance));
  const verifiedBlock = evaluatedBlocks.find((block) => block.contextMatched && block.priceMatched);

  if (verifiedBlock && teamEvidence.eventMatched) {
    return finalizeRecord(enriched, {
      status: FIDELITY_STATUSES.verified,
      websitePrice: verifiedBlock.websitePrice,
      evidence: {
        ...teamEvidence,
        ...verifiedBlock.evidence,
      },
    });
  }

  const strongestContext = pickStrongestContext(evaluatedBlocks);
  if (strongestContext?.contextMatched && !strongestContext.priceMatched) {
    return finalizeRecord(enriched, {
      status: FIDELITY_STATUSES.mismatch,
      websitePrice: strongestContext.websitePrice,
      evidence: {
        ...teamEvidence,
        ...strongestContext.evidence,
      },
    });
  }

  if (priceAnywhere) {
    return finalizeRecord(enriched, {
      status: FIDELITY_STATUSES.ambiguous,
      websitePrice: priceAnywhere.price,
      evidence: {
        ...teamEvidence,
        priceFound: true,
        marketFound: Boolean(strongestContext?.evidence?.marketFound),
        lineFound: Boolean(strongestContext?.evidence?.lineFound),
        outcomeFound: Boolean(strongestContext?.evidence?.outcomeFound),
        periodFound: Boolean(strongestContext?.evidence?.periodFound),
        reason: 'price_visible_without_proven_context',
        contextSample: strongestContext?.evidence?.contextSample || priceAnywhere.contextSample,
      },
    });
  }

  return finalizeRecord(enriched, {
    status: FIDELITY_STATUSES.notFound,
    evidence: {
      ...teamEvidence,
      priceFound: false,
      marketFound: Boolean(strongestContext?.evidence?.marketFound),
      lineFound: Boolean(strongestContext?.evidence?.lineFound),
      outcomeFound: Boolean(strongestContext?.evidence?.outcomeFound),
      periodFound: Boolean(strongestContext?.evidence?.periodFound),
      reason: strongestContext?.contextMatched ? 'context_found_price_missing' : 'exact_context_not_found',
      contextSample: strongestContext?.evidence?.contextSample || '',
    },
  });
}

function evaluateContextBlock(block, record, priceTolerance) {
  const normalizedBlock = normalizeText(block.text);
  const contaminated = isContaminatedMarketContext(record, normalizedBlock, block.text);
  const marketFound = !contaminated && hasAnyAlias(normalizedBlock, marketAliasesForRecord(record));
  const lineFound = record.line === null || record.line === undefined || lineTokenFound(normalizedBlock, record.line);
  const outcomeFound = hasAnyAlias(normalizedBlock, outcomeAliasesForRecord(record));
  const periodFound = periodMatches(normalizedBlock, record.period);
  const priceMatch = textContainsPrice(block.text, record.endpointPrice, priceTolerance);
  // Only harvest a website price from pure market context. Combo cards
  // (e.g. "GG & Over 2.5") must not be treated as the standalone market.
  const websitePrice = contaminated
    ? null
    : (priceMatch?.price || bestWebsitePrice(block.text, record));
  const contextMatched = marketFound && lineFound && outcomeFound && periodFound;

  return {
    ...block,
    contextMatched,
    priceMatched: Boolean(priceMatch) && !contaminated,
    websitePrice,
    evidence: {
      source: block.source,
      adapterId: block.adapterId || null,
      selector: block.selector || null,
      networkUrl: block.networkUrl || null,
      marketFound,
      lineFound,
      outcomeFound,
      periodFound,
      priceFound: Boolean(priceMatch) && !contaminated,
      contextMatched,
      contaminated,
      contextSample: sampleText(block.text),
      marketAliases: marketAliasesForRecord(record),
      outcomeAliases: outcomeAliasesForRecord(record),
    },
  };
}

/**
 * Reject multi-leg promo/combo cards when verifying a single canonical market.
 * Superbet carousels often show "GG & Peste 2.5" next to pure BTTS; those must
 * not be accepted as evidence for bothTeamsToScore or totalGoals alone.
 */
function isContaminatedMarketContext(record, normalizedBlock, rawText = '') {
  const family = parseMarketDescriptor(record.marketKey).marketFamily;
  const text = String(normalizedBlock || '');
  const raw = normalizeText(rawText || '');
  const haystack = `${text} ${raw}`.trim();
  if (!haystack) return false;

  const hasComboConnector = /\b(gg|btts|ambele)\b.{0,24}\b(&|si|sau|and|or|\+|\/)\b|\b(&|si|sau|and|or|\+|\/)\b.{0,24}\b(gg|btts|peste|sub|over|under)\b/.test(haystack)
    || /\b(gg|btts)\s*&\s*/.test(haystack)
    || /\bgg\s+(sau|si|and|or)\s+/.test(haystack)
    || /\bambele\s+echipe\s+marcheaza\s*(&|si|sau|and|or)/.test(haystack);

  if (family === 'bothTeamsToScore') {
    // Pure BTTS card should not also name a goals-total combo leg.
    if (hasComboConnector && /\b(peste|sub|over|under|goluri|goals)\b/.test(haystack)) {
      return true;
    }
    // "GG & Peste 2.5 goluri - Da 1.57" style carousel items.
    if (/\b(gg|btts)\b.{0,40}\b(peste|sub|over|under)\b/.test(haystack)
      && /\b(peste|sub|over|under)\b.{0,12}\d/.test(haystack)) {
      return true;
    }
  }

  if (family === 'totalGoals' || family === 'totalCorners' || family === 'totalCards') {
    // Pure totals should not live inside a BTTS combo card.
    if (hasComboConnector && /\b(gg|btts|ambele)\b/.test(haystack)) {
      return true;
    }
  }

  if (family === 'h2h') {
    // "1X2 & Total goluri (2.5)" style combo cards must not stand in for pure 1X2.
    // Avoid \b around "&" — "&" is non-word so word-boundary checks fail.
    if (/\b(1x2|final|rezultat)\b.{0,24}(&|\+| si | and ).{0,24}\b(total|goluri|peste|sub|over|under)\b/.test(haystack)
      || /\b(total|goluri)\b.{0,24}(&|\+| si | and ).{0,24}\b(1x2|final)\b/.test(haystack)) {
      return true;
    }
  }

  if (family === 'doubleChance') {
    // DC combo cards (e.g. "1X & Over 1.5") are not pure double-chance evidence.
    if (hasComboConnector && /\b(peste|sub|over|under|goluri|goals|gg|btts)\b/.test(haystack)) {
      return true;
    }
  }

  return false;
}

function buildContextBlocks(visibleText, record, contextRows = []) {
  const lines = normalizeLines(visibleText);
  const blocks = [];
  const marketAliases = marketAliasesForRecord(record);
  const outcomeAliases = outcomeAliasesForRecord(record);

  for (const row of contextRows) {
    const text = normalizeWhitespace(row.text);
    if (!text) continue;
    const normalizedRow = normalizeText(text);
    const rowHasUsefulContext =
      hasAnyAlias(normalizedRow, marketAliases) ||
      hasAnyAlias(normalizedRow, outcomeAliases) ||
      textContainsPrice(text, record.endpointPrice);
    if (!rowHasUsefulContext) continue;
    blocks.push({
      source: row.source || 'structured-row',
      text,
      adapterId: row.adapterId || null,
      selector: row.selector || null,
      networkUrl: row.networkUrl || null,
    });
  }

  for (let index = 0; index < lines.length; index += 1) {
    const normalizedLine = normalizeText(lines[index]);
    if (hasAnyAlias(normalizedLine, marketAliases)) {
      if (lines[index].length > DEFAULT_CONTEXT_CHAR_RADIUS * 2) {
        blocks.push(...aliasWindowBlocks(lines[index], marketAliases, 'market'));
      } else {
        blocks.push(lineBlock(lines, index, DEFAULT_CONTEXT_RADIUS, 'market'));
      }
    }
    if (hasAnyAlias(normalizedLine, outcomeAliases) && (
      record.line === null ||
      record.line === undefined ||
      lineTokenFound(normalizedLine, record.line)
    )) {
      if (lines[index].length > DEFAULT_CONTEXT_CHAR_RADIUS * 2) {
        blocks.push(...aliasWindowBlocks(lines[index], outcomeAliases, 'row'));
      } else {
        blocks.push(lineBlock(lines, index, 4, 'row'));
      }
    }
  }

  for (const block of priceContextBlocks(visibleText, record.endpointPrice)) {
    blocks.push(block);
  }

  return uniqueBlocks(blocks);
}

function priceContextBlocks(visibleText, price) {
  const variants = decimalPriceVariants(price);
  if (variants.length === 0) {
    return [];
  }
  const blocks = [];
  const compact = normalizeWhitespace(visibleText);
  for (const variant of variants) {
    const pattern = numberBoundaryPattern(variant);
    for (const match of compact.matchAll(new RegExp(pattern.source, 'gi'))) {
      const start = Math.max(0, match.index - 260);
      const end = Math.min(compact.length, match.index + match[0].length + 260);
      blocks.push({
        source: 'price',
        text: compact.slice(start, end),
      });
    }
  }
  return blocks;
}

function lineBlock(lines, center, radius, source) {
  const start = Math.max(0, center - Math.max(1, Math.floor(radius / 2)));
  const end = Math.min(lines.length, center + radius + 1);
  return {
    source,
    text: lines.slice(start, end).join(' '),
  };
}

function aliasWindowBlocks(text, aliases, source) {
  const normalized = normalizeText(text);
  const blocks = [];
  for (const alias of aliases || []) {
    const normalizedAlias = normalizeText(alias);
    if (!normalizedAlias || normalizedAlias.length < 2) {
      continue;
    }
    let from = 0;
    while (from < normalized.length) {
      const index = normalized.indexOf(normalizedAlias, from);
      if (index < 0) {
        break;
      }
      const start = Math.max(0, index - DEFAULT_CONTEXT_CHAR_RADIUS);
      const end = Math.min(String(text).length, index + normalizedAlias.length + DEFAULT_CONTEXT_CHAR_RADIUS);
      blocks.push({
        source,
        text: String(text).slice(start, end),
      });
      from = index + normalizedAlias.length;
    }
  }
  return blocks;
}

function uniqueBlocks(blocks) {
  const seen = new Set();
  const unique = [];
  for (const block of blocks) {
    const key = `${block.source || ''}|${block.selector || ''}|${block.networkUrl || ''}|${normalizeWhitespace(block.text).slice(0, 600)}`;
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(block);
  }
  return unique;
}

function normalizeContextRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      if (typeof row === 'string') {
        return { source: 'structured-row', text: row };
      }
      return {
        source: row?.source || 'structured-row',
        text: normalizeWhitespace(row?.text || ''),
        adapterId: row?.adapterId || null,
        selector: row?.selector || null,
        networkUrl: row?.networkUrl || null,
      };
    })
    .filter((row) => row.text);
}

function pickStrongestContext(blocks) {
  return [...blocks].sort((left, right) =>
    contextScore(right.evidence) - contextScore(left.evidence))[0] || null;
}

function contextScore(evidence = {}) {
  return [
    evidence.contextMatched,
    evidence.marketFound,
    evidence.lineFound,
    evidence.outcomeFound,
    evidence.periodFound,
    evidence.priceFound,
  ].reduce((total, value) => total + (value ? 1 : 0), 0);
}

function marketAliasesForRecord(record) {
  const descriptor = parseMarketDescriptor(record.marketKey);
  const aliases = [
    ...(MARKET_ALIASES[descriptor.marketFamily] || []),
    record.marketLabel,
    getMarketLabel(record.marketKey),
  ];
  if (descriptor.teamScope === 'home' && record.homeTeam) {
    aliases.push(record.homeTeam);
  }
  if (descriptor.teamScope === 'away' && record.awayTeam) {
    aliases.push(record.awayTeam);
  }
  return uniqNormalizedAliases(aliases);
}

function outcomeAliasesForRecord(record) {
  const outcome = String(record.outcome || '');
  const aliases = [
    ...(OUTCOME_ALIASES[outcome] || []),
    record.outcomeLabel,
    getOutcomeLabel(outcome),
  ];

  if (outcome === 'home' && record.homeTeam) aliases.push('1', 'home', 'gazde', record.homeTeam);
  if (outcome === 'away' && record.awayTeam) aliases.push('2', 'away', 'oaspete', record.awayTeam);
  if (outcome === 'draw') aliases.push('x', 'egal', 'egalitate', 'draw');
  if (outcome === 'homeNo' || outcome === 'awayNo') aliases.push('nu', 'no', 'under', 'sub');

  return uniqNormalizedAliases(aliases);
}

function periodMatches(normalizedBlock, period) {
  if (!period || period === 'unknown' || period === 'overtime') {
    return true;
  }

  const conflicts = PERIOD_CONFLICTS[period] || [];
  if (hasAnyAlias(normalizedBlock, conflicts)) {
    return false;
  }

  if (period === 'fulltime') {
    return true;
  }

  return hasAnyAlias(normalizedBlock, PERIOD_ALIASES[period] || []);
}

function eventEvidence(record, normalizedBody) {
  const homeFound = containsNormalized(normalizedBody, record.homeTeam);
  const awayFound = containsNormalized(normalizedBody, record.awayTeam);
  const competitionFound = record.competition
    ? containsNormalized(normalizedBody, record.competition)
    : false;
  return {
    homeTeam: record.homeTeam || '',
    awayTeam: record.awayTeam || '',
    competition: record.competition || '',
    homeFound,
    awayFound,
    competitionFound,
    eventMatched: homeFound && awayFound,
  };
}

function bestWebsitePrice(text, record) {
  const numbers = extractDecimalNumbers(text)
    .filter((number) => number > 1 && number <= 100)
    .filter((number) => record.line === null || Math.abs(number - Number(record.line)) > 0.000001);
  if (numbers.length === 0) {
    return null;
  }
  return numbers
    .map((number) => ({ number, distance: Math.abs(number - Number(record.endpointPrice)) }))
    .sort((left, right) => left.distance - right.distance)[0].number;
}

function textContainsPrice(value, price, tolerance = DEFAULT_PRICE_TOLERANCE) {
  const compact = normalizeWhitespace(value);
  const endpoint = Number(price);
  if (!Number.isFinite(endpoint)) {
    return null;
  }

  for (const variant of decimalPriceVariants(endpoint)) {
    const pattern = numberBoundaryPattern(variant);
    const match = compact.match(pattern);
    if (match) {
      return {
        price: Number(formatPrice(endpoint)),
        variant,
        contextSample: priceContextSample(compact, match.index || 0, match[0].length),
      };
    }
  }

  const numericMatch = extractDecimalNumbers(compact)
    .map((number) => ({ number, distance: Math.abs(number - endpoint) }))
    .filter((entry) => entry.distance <= tolerance)
    .sort((left, right) => left.distance - right.distance)[0];
  if (!numericMatch) {
    return null;
  }
  return {
    price: numericMatch.number,
    variant: formatPrice(numericMatch.number),
    contextSample: '',
  };
}

function decimalPriceVariants(price) {
  const number = Number(price);
  if (!Number.isFinite(number)) {
    return [];
  }
  const fixed = number.toFixed(2);
  const trimmed = fixed.replace(/\.?0+$/, '');
  return [...new Set([
    fixed,
    fixed.replace('.', ','),
    trimmed,
    trimmed.replace('.', ','),
  ])];
}

function lineTokenFound(normalizedTextValue, line) {
  if (line === null || line === undefined || line === '') {
    return true;
  }
  const normalized = normalizeText(normalizedTextValue);
  return decimalPriceVariants(line).some((variant) => numberBoundaryPattern(variant).test(normalized));
}

function hasAnyAlias(normalizedTextValue, aliases) {
  const normalized = normalizeText(normalizedTextValue);
  return (aliases || []).some((alias) => tokenOrPhraseFound(normalized, alias));
}

function tokenOrPhraseFound(normalizedTextValue, alias) {
  const normalizedAlias = normalizeText(alias);
  if (!normalizedAlias) {
    return false;
  }
  if (/^[0-9]+(?:[.,][0-9]+)?$/.test(normalizedAlias)) {
    return numberBoundaryPattern(normalizedAlias).test(normalizedTextValue);
  }
  if (/^[a-z0-9]+$/i.test(normalizedAlias) && normalizedAlias.length <= 3) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalizedAlias)}([^a-z0-9]|$)`, 'i')
      .test(normalizedTextValue);
  }
  return normalizedTextValue.includes(normalizedAlias);
}

function numberBoundaryPattern(value) {
  const normalizedVariant = escapeRegExp(String(value)).replace(/[.,]/g, '[.,]');
  return new RegExp(`(^|[^0-9])${normalizedVariant}([^0-9]|$)`, 'i');
}

function containsNormalized(normalizedHaystack, needle) {
  const normalizedNeedle = normalizeText(needle);
  return Boolean(normalizedNeedle && normalizedHaystack.includes(normalizedNeedle));
}

function extractDecimalNumbers(text) {
  const values = [];
  for (const match of String(text || '').matchAll(/(^|[^0-9])([0-9]+(?:[.,][0-9]+)?)(?=[^0-9]|$)/g)) {
    const parsed = Number(String(match[2]).replace(',', '.'));
    if (Number.isFinite(parsed)) {
      values.push(parsed);
    }
  }
  return values;
}

function parseMarketList(value, fallback = DEFAULT_MARKET_FILTERS) {
  const raw = Array.isArray(value) ? value.join(',') : String(value || '');
  const items = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? [...new Set(items)] : [...fallback];
}

function marketMatchesFilter(marketKey, filters = DEFAULT_MARKET_FILTERS) {
  const descriptor = parseMarketDescriptor(marketKey);
  const normalizedKey = normalizeText(marketKey);
  const normalizedLabel = normalizeText(getMarketLabel(marketKey));
  return parseMarketList(filters).some((filter) => {
    const normalizedFilter = normalizeText(filter);
    return descriptor.marketFamily === filter ||
      normalizedKey.includes(normalizedFilter) ||
      normalizedLabel.includes(normalizedFilter);
  });
}

function summarizeFidelityRecords(records) {
  const statusCounts = Object.fromEntries(
    Object.values(FIDELITY_STATUSES).map((status) => [status, 0]),
  );
  for (const record of Array.isArray(records) ? records : []) {
    const status = record?.status || FIDELITY_STATUSES.notFound;
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }
  const total = Object.values(statusCounts).reduce((sum, count) => sum + count, 0);
  return {
    total,
    statusCounts,
    ok: total > 0 && total === statusCounts.verified,
  };
}

function isTrustedFidelityStatus(status) {
  return !status || status === FIDELITY_STATUSES.verified;
}

function isUntrustedFidelityStatus(status) {
  return UNTRUSTED_FIDELITY_STATUSES.has(status);
}

function finalizeRecord(record, patch) {
  return {
    ...record,
    websitePrice: patch.websitePrice ?? record.websitePrice ?? null,
    status: patch.status,
    evidence: patch.evidence || {},
  };
}

function formatLineFromKey(key) {
  const match = String(key || '').match(/_(\d+)(?:_(\d+))?$/);
  if (!match) {
    return null;
  }
  return match[2] ? `${match[1]}.${match[2]}` : match[1];
}

function formatHandicapLine(key) {
  const match = String(key || '').match(/(?:asian)?[Hh]andicap_(plus|minus)_(\d+)(?:_(\d+))?$/);
  if (!match) {
    return null;
  }
  const sign = match[1] === 'plus' ? '+' : '-';
  return `${sign}${match[2]}${match[3] ? `.${match[3]}` : ''}`;
}

function normalizeLines(value) {
  return String(value || '')
    .split(/\r?\n+/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
}

function normalizeText(value) {
  return normalizeWhitespace(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function compactText(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, '');
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function uniqNormalizedAliases(aliases) {
  const seen = new Set();
  const result = [];
  for (const alias of aliases || []) {
    const normalized = normalizeText(alias);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function sampleText(value) {
  return normalizeWhitespace(value).slice(0, 400);
}

function priceContextSample(text, index, length) {
  const start = Math.max(0, index - 120);
  const end = Math.min(text.length, index + length + 120);
  return sampleText(text.slice(start, end));
}

function isBlockedOrEmpty(normalizedBody) {
  if (!normalizedBody || normalizedBody.length < 30) {
    return true;
  }

  // Romanian sportsbook chrome almost always includes a "Conectare" nav link.
  // Only treat the page as blocked when the body is a real challenge/login wall.
  const challenge = [
    /\bplease verify you are a human\b/,
    /\baccess denied\b/,
    /\bforbidden\b/,
    /\bcaptcha\b/,
    /\bare you a robot\b/,
    /\bcloudflare\b.{0,40}\b(ray id|attention required)\b/,
    /\bjust a moment\b.{0,20}\bcloudflare\b/,
    /\blogin required\b/,
    /\bautentificare necesara\b/,
    /\btrebuie sa te autentifici\b/,
    /\bsession expired\b/,
  ].some((pattern) => pattern.test(normalizedBody));

  if (!challenge) {
    return false;
  }

  // Cookie banners alone are not blockers; a challenge on a tiny body is.
  const looksLikeFullWall = normalizedBody.length < 500
    || !/\b(1x2|final|total goluri|peste|sub|ambele|handicap|cote|odds|pariuri)\b/.test(normalizedBody);
  return looksLikeFullWall;
}

function formatPrice(value) {
  return Number(value).toFixed(2);
}

function nonNegativeNumber(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  DEFAULT_MARKET_FILTERS,
  DEFAULT_PRICE_TOLERANCE,
  FIDELITY_STATUSES,
  buildExpectedOddRecord,
  compactText,
  decimalPriceVariants,
  isTrustedFidelityStatus,
  isUntrustedFidelityStatus,
  marketMatchesFilter,
  normalizeText,
  normalizeWhitespace,
  parseMarketDescriptor,
  parseMarketList,
  summarizeFidelityRecords,
  textContainsPrice,
  verifyOddAgainstText,
  verifyRecordsAgainstText,
};
