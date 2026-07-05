const { ProviderError } = require('./the-odds-api-provider');
const { isDecimalOdds } = require('./market-utils');
const { absoluteEventUrl, bookmakerLinkFields, slugPathPart } = require('./event-links');

const BETFAIR_FOOTBALL_URL = 'https://www.betfair.ro/pariuri/fotbal/s-1';
const BETFAIR_ORIGIN = 'https://www.betfair.ro';
const BETFAIR_TIME_ZONE = 'Europe/Bucharest';
const ROMANIAN_MONTHS = Object.freeze({
  ian: 1,
  ianuarie: 1,
  feb: 2,
  februarie: 2,
  mar: 3,
  martie: 3,
  apr: 4,
  aprilie: 4,
  mai: 5,
  iun: 6,
  iunie: 6,
  iul: 7,
  iulie: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  septembrie: 9,
  oct: 10,
  octombrie: 10,
  nov: 11,
  noiembrie: 11,
  dec: 12,
  decembrie: 12,
});

class BetfairProvider {
  constructor({
    pageUrl = BETFAIR_FOOTBALL_URL,
    fetchImpl = globalThis.fetch,
    timeoutMs = 8000,
    now = () => new Date(),
  } = {}) {
    this.name = 'Betfair';
    this.pageUrl = pageUrl;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.now = now;
  }

  async getOdds() {
    const fetchedAt = this.now().toISOString();
    const html = await this.fetchPage();
    return normalizeBetfairFootballHtml(html, {
      fetchedAt,
      now: this.now(),
    });
  }

  async fetchPage() {
    let response;
    try {
      response = await this.fetchImpl(this.pageUrl, {
        headers: {
          accept: 'text/html',
          'accept-language': 'ro-RO,ro;q=0.9,en;q=0.8',
          'user-agent': 'Mozilla/5.0',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new ProviderError(`Unable to reach Betfair: ${error.message}`, {
        cause: error,
      });
    }

    if (!response.ok) {
      throw new ProviderError(`Betfair returned HTTP ${response.status}`, {
        status: response.status,
      });
    }

    return response.text();
  }
}

function normalizeBetfairFootballHtml(html, {
  fetchedAt = new Date().toISOString(),
  now = new Date(),
} = {}) {
  const eventsByKey = new Map();

  for (const row of extractBetfairRows(html)) {
    const event = normalizeBetfairRow(row, { fetchedAt, now });
    if (!event) {
      continue;
    }

    const key = row.eventId || `${event.homeTeam}:${event.awayTeam}:${event.startsAt}`;
    if (!eventsByKey.has(key)) {
      eventsByKey.set(key, event);
    }
  }

  return [...eventsByKey.values()]
    .sort((left, right) => new Date(left.startsAt) - new Date(right.startsAt));
}

function extractBetfairRows(html) {
  const anchors = extractAnchors(html);
  const rows = [];

  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    const eventId = betfairEventId(anchor.href);
    if (!eventId) {
      continue;
    }

    const eventUrl = absoluteEventUrl(anchor.href, BETFAIR_ORIGIN);
    const nextAnchor = anchors[index + 1];
    const afterText = htmlToText(String(html || '').slice(anchor.end, nextAnchor?.start));
    const teamsFromHref = betfairTeamsFromHref(anchor.href);
    const labelDetails = parseBetfairEventLabel(anchor.label, teamsFromHref);
    const oddsRow =
      parseBetfairLabeledOdds(afterText) ||
      parseBetfairOddsOnly(afterText, teamsFromHref);

    if (!labelDetails || !oddsRow) {
      continue;
    }

    rows.push({
      eventId,
      eventUrl,
      competition: labelDetails.competition || 'Betfair Football',
      dateLabel: labelDetails.dateLabel,
      time: labelDetails.time,
      homeTeam: oddsRow.homeTeam,
      awayTeam: oddsRow.awayTeam,
      odds: oddsRow.odds,
    });
  }

  return rows;
}

function extractAnchors(html) {
  const anchors = [];
  const anchorPattern = /<a\b(?<attributes>[^>]*)>(?<body>[\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorPattern.exec(String(html || ''))) !== null) {
    const href = hrefFromAttributes(match.groups.attributes);
    if (!href) {
      continue;
    }

    anchors.push({
      href,
      label: htmlToText(match.groups.body),
      start: match.index,
      end: anchorPattern.lastIndex,
    });
  }

  return anchors;
}

function hrefFromAttributes(value) {
  const match = String(value || '').match(/\bhref\s*=\s*(["'])(?<href>.*?)\1/i);
  return match?.groups?.href || null;
}

function parseBetfairEventLabel(label, teamsFromHref) {
  const text = cleanText(label);
  const match = text.match(
    /(?<prefix>.*?)\b(?<dateLabel>astazi|astăzi|maine|mâine|ieri|\d{1,2}\s+[a-zăâîșț.]+)\s*,?\s*(?:la\s+)?(?<time>[0-2]?\d:[0-5]\d)\b(?<suffix>.*)$/i,
  );
  if (!match) {
    return null;
  }

  const prefix = cleanText(match.groups.prefix);
  const suffix = cleanText(match.groups.suffix);
  const teamsLabel = teamsFromHref ? `${teamsFromHref.homeTeam} ${teamsFromHref.awayTeam}` : '';
  const competition = !sameCompactText(prefix, teamsLabel) ? prefix : '';

  return {
    competition: competition || (!sameCompactText(suffix, teamsLabel) ? suffix : ''),
    dateLabel: match.groups.dateLabel,
    time: match.groups.time,
  };
}

function parseBetfairLabeledOdds(value) {
  const text = cleanText(value);
  const match = text.match(
    /^(?<homeTeam>.+?)\s+(?<home>\d+(?:[.,]\d+)?)\s+Egal\s+(?<draw>\d+(?:[.,]\d+)?)\s+(?<awayTeam>.+?)\s+(?<away>\d+(?:[.,]\d+)?)(?:\s|$)/i,
  );
  if (!match) {
    return null;
  }

  return buildBetfairOddsRow({
    homeTeam: match.groups.homeTeam,
    awayTeam: match.groups.awayTeam,
    home: match.groups.home,
    draw: match.groups.draw,
    away: match.groups.away,
  });
}

function parseBetfairOddsOnly(value, teamsFromHref) {
  if (!teamsFromHref) {
    return null;
  }

  const match = cleanText(value).match(
    /^(?<home>\d+(?:[.,]\d+)?)\s+(?<draw>\d+(?:[.,]\d+)?)\s+(?<away>\d+(?:[.,]\d+)?)(?:\s|$)/,
  );
  if (!match) {
    return null;
  }

  return buildBetfairOddsRow({
    homeTeam: teamsFromHref.homeTeam,
    awayTeam: teamsFromHref.awayTeam,
    home: match.groups.home,
    draw: match.groups.draw,
    away: match.groups.away,
  });
}

function buildBetfairOddsRow({ homeTeam, awayTeam, home, draw, away }) {
  const odds = {
    home: parseBetfairOdd(home),
    draw: parseBetfairOdd(draw),
    away: parseBetfairOdd(away),
  };
  const normalizedHome = cleanTeamName(homeTeam);
  const normalizedAway = cleanTeamName(awayTeam);

  if (
    !normalizedHome ||
    !normalizedAway ||
    !['home', 'draw', 'away'].every((key) => isDecimalOdds(odds[key]))
  ) {
    return null;
  }

  return {
    homeTeam: normalizedHome,
    awayTeam: normalizedAway,
    odds,
  };
}

function normalizeBetfairRow(row, { fetchedAt, now }) {
  const startsAt = resolveBetfairStartTime(row.dateLabel, row.time, now);
  if (!startsAt) {
    return null;
  }

  return {
    id: `betfair:${row.eventId}`,
    externalIds: {
      betfairEventId: row.eventId,
    },
    sport: 'Football',
    competition: row.competition || 'Betfair Football',
    startsAt: startsAt.toISOString(),
    homeTeam: row.homeTeam,
    awayTeam: row.awayTeam,
    bookmakers: [
      {
        name: 'Betfair',
        lastUpdate: fetchedAt,
        ...bookmakerLinkFields('Betfair', row.eventUrl, BETFAIR_FOOTBALL_URL),
        markets: {
          h2h: row.odds,
        },
      },
    ],
  };
}

function betfairEventId(value) {
  const match = String(value || '').match(/\/e-(?<id>\d+)(?:[/?#]|$)/i);
  return match?.groups?.id || null;
}

function betfairTeamsFromHref(value) {
  const path = String(value || '').split(/[?#]/)[0];
  const eventSegment = path.split('/').filter(Boolean).at(-2);
  if (!eventSegment || !eventSegment.includes('-v-')) {
    return null;
  }

  const [homeSlug, awaySlug] = eventSegment.split('-v-');
  const homeTeam = titleizeBetfairSlug(homeSlug);
  const awayTeam = titleizeBetfairSlug(awaySlug);
  return homeTeam && awayTeam ? { homeTeam, awayTeam } : null;
}

function titleizeBetfairSlug(value) {
  const decoded = safeDecodeURIComponent(value).toLocaleLowerCase('ro-RO');
  return decoded
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^|[\s'’(-])(\p{Letter})/gu, (_match, prefix, letter) =>
      `${prefix}${letter.toLocaleUpperCase('ro-RO')}`,
    );
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(String(value || ''));
  } catch {
    return String(value || '');
  }
}

function resolveBetfairStartTime(dateLabel, time, now = new Date()) {
  const timeMatch = String(time || '').match(/^([0-2]?\d):([0-5]\d)$/);
  if (!timeMatch) {
    return null;
  }

  const current = zonedParts(now, BETFAIR_TIME_ZONE);
  const dateParts = resolveBetfairLocalDate(dateLabel, current);
  if (!dateParts) {
    return null;
  }

  const candidate = zonedTimeToUtcDate({
    ...dateParts,
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
    second: 0,
  }, BETFAIR_TIME_ZONE);

  return candidate.getTime() >= now.getTime() - 3 * 60 * 60 * 1000 ? candidate : null;
}

function resolveBetfairLocalDate(dateLabel, current) {
  const key = cleanText(dateLabel).toLowerCase();
  if (key === 'astazi' || key === 'astăzi') {
    return { year: current.year, month: current.month, day: current.day };
  }
  if (key === 'maine' || key === 'mâine') {
    return addLocalDays(current, 1);
  }
  if (key === 'ieri') {
    return addLocalDays(current, -1);
  }

  const match = key.match(/^(?<day>\d{1,2})\s+(?<month>[a-zăâîșț.]+)$/i);
  if (!match) {
    return null;
  }

  const monthKey = match.groups.month.replace(/\.$/, '');
  const month = ROMANIAN_MONTHS[monthKey];
  if (!month) {
    return null;
  }

  const day = Number(match.groups.day);
  let year = current.year;
  const candidate = Date.UTC(year, month - 1, day);
  const today = Date.UTC(current.year, current.month - 1, current.day);
  if (candidate < today - 7 * 24 * 60 * 60 * 1000) {
    year += 1;
  }

  return { year, month, day };
}

function addLocalDays(parts, days) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function zonedTimeToUtcDate(parts, timeZone) {
  const naiveUtc = new Date(Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second || 0,
  ));
  const offsetMs = timeZoneOffsetMs(naiveUtc, timeZone);
  return new Date(naiveUtc.getTime() - offsetMs);
}

function timeZoneOffsetMs(date, timeZone) {
  const parts = zonedParts(date, timeZone);
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return localAsUtc - date.getTime();
}

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function htmlToText(html) {
  return decodeHtmlEntities(
    String(html || '')
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&icirc;/gi, 'î')
    .replace(/&acirc;/gi, 'â')
    .replace(/&abreve;/gi, 'ă')
    .replace(/&scedil;/gi, 'ș')
    .replace(/&tcedil;/gi, 'ț');
}

function parseBetfairOdd(value) {
  const odd = Number(String(value || '').replace(',', '.'));
  return isDecimalOdds(odd) ? odd : null;
}

function cleanTeamName(value) {
  return cleanText(value)
    .replace(/\s+v\s+.*$/i, '')
    .replace(/\bStatistici\b.*$/i, '')
    .trim();
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function sameCompactText(left, right) {
  return slugPathPart(left).replace(/-/g, '') === slugPathPart(right).replace(/-/g, '');
}

module.exports = {
  BETFAIR_FOOTBALL_URL,
  BetfairProvider,
  betfairTeamsFromHref,
  extractBetfairRows,
  normalizeBetfairFootballHtml,
  resolveBetfairStartTime,
};
