const { ProviderError } = require('./the-odds-api-provider');
const { isDecimalOdds, splitFixtureName } = require('./market-utils');
const { bookmakerLinkFields } = require('./event-links');

const BETMEN_PAGE_URL = 'https://agentii.betmen.ro/';
const BETMEN_TIME_ZONE = 'Europe/Bucharest';
const BETMEN_WEEKDAYS = Object.freeze({
  du: 0,
  lu: 1,
  ma: 2,
  mi: 3,
  jo: 4,
  vi: 5,
  sa: 6,
});

class BetmenProvider {
  constructor({
    pageUrl = BETMEN_PAGE_URL,
    fetchImpl = globalThis.fetch,
    timeoutMs = 8000,
    now = () => new Date(),
  } = {}) {
    this.name = 'Betmen';
    this.pageUrl = pageUrl;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.now = now;
  }

  async getOdds() {
    const fetchedAt = this.now().toISOString();
    const html = await this.fetchPage();
    return normalizeBetmenAgencyHtml(html, {
      fetchedAt,
      now: this.now(),
      pageUrl: this.pageUrl,
    });
  }

  async fetchPage() {
    let response;
    try {
      response = await this.fetchImpl(this.pageUrl, {
        headers: {
          accept: 'text/html',
          'user-agent': 'Mozilla/5.0',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new ProviderError(`Unable to reach Betmen: ${error.message}`, {
        cause: error,
      });
    }

    if (!response.ok) {
      throw new ProviderError(`Betmen returned HTTP ${response.status}`, {
        status: response.status,
      });
    }

    return response.text();
  }
}

function normalizeBetmenAgencyHtml(html, {
  fetchedAt = new Date().toISOString(),
  now = new Date(),
  pageUrl = BETMEN_PAGE_URL,
} = {}) {
  return extractBetmenRows(html)
    .map((row) => normalizeBetmenRow(row, { fetchedAt, now, pageUrl }))
    .filter(Boolean)
    .sort((left, right) => new Date(left.startsAt) - new Date(right.startsAt));
}

function extractBetmenRows(html) {
  const text = htmlToText(html);
  const rows = [];
  const rowPattern =
    /\b(?<weekday>du|lu|ma|mi|jo|vi|sa)\.\s+(?<time>[0-2]\d:[0-5]\d)\s+(?<code>\d{3,8})\s+(?<match>.+?)\s+(?<home>\d+(?:\.\d{2})?|[-])\s+(?<draw>\d+(?:\.\d{2})?|[-])\s+(?<away>\d+(?:\.\d{2})?|[-])\s+(?<homeDraw>\d+(?:\.\d{2})?|[-])\s+(?<drawAway>\d+(?:\.\d{2})?|[-])\s+(?<homeAway>\d+(?:\.\d{2})?|[-])(?=\s|$)/gi;
  let match;

  while ((match = rowPattern.exec(text)) !== null) {
    const teams = splitMatchTeams(cleanBetmenMatchName(match.groups.match));
    if (!teams) {
      continue;
    }

    rows.push({
      weekday: match.groups.weekday.toLowerCase(),
      time: match.groups.time,
      code: match.groups.code,
      homeTeam: teams.homeTeam,
      awayTeam: teams.awayTeam,
      odds: {
        home: parseBetmenOdd(match.groups.home),
        draw: parseBetmenOdd(match.groups.draw),
        away: parseBetmenOdd(match.groups.away),
        homeDraw: parseBetmenOdd(match.groups.homeDraw),
        drawAway: parseBetmenOdd(match.groups.drawAway),
        homeAway: parseBetmenOdd(match.groups.homeAway),
      },
    });
  }

  return rows;
}

function normalizeBetmenRow(row, { fetchedAt, now, pageUrl }) {
  const startsAt = resolveBetmenStartTime(row.weekday, row.time, now);
  if (
    !startsAt ||
    !row.code ||
    !row.homeTeam ||
    !row.awayTeam ||
    !['home', 'draw', 'away'].every((key) => isDecimalOdds(row.odds[key]))
  ) {
    return null;
  }

  const markets = {
    h2h: {
      home: row.odds.home,
      draw: row.odds.draw,
      away: row.odds.away,
    },
  };

  if (['homeDraw', 'drawAway', 'homeAway'].every((key) => isDecimalOdds(row.odds[key]))) {
    markets.doubleChance = {
      homeDraw: row.odds.homeDraw,
      drawAway: row.odds.drawAway,
      homeAway: row.odds.homeAway,
    };
  }

  return {
    id: `betmen:${row.code}:${slugPart(row.homeTeam)}:${slugPart(row.awayTeam)}`,
    externalIds: {
      betmenCode: String(row.code),
    },
    sport: 'Football',
    competition: 'Betmen Football',
    startsAt: startsAt.toISOString(),
    homeTeam: row.homeTeam,
    awayTeam: row.awayTeam,
    bookmakers: [
      {
        name: 'Betmen',
        lastUpdate: fetchedAt,
        ...bookmakerLinkFields('Betmen', pageUrl, pageUrl),
        markets,
      },
    ],
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
    .replace(/&apos;/gi, "'");
}

function cleanBetmenMatchName(value) {
  return String(value || '')
    .replace(/\s*»\s*ADAUGA PE BILET\s*/gi, ' ')
    .replace(/\s*Se disputa pe\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitMatchTeams(value) {
  const teams = splitFixtureName(value);
  if (teams.length !== 2) {
    return null;
  }
  const [homeTeam, awayTeam] = teams.map(cleanTeamName);
  return homeTeam && awayTeam ? { homeTeam, awayTeam } : null;
}

function cleanTeamName(value) {
  return String(value || '')
    .replace(/^\((f)\)\s*/i, '$1 ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseBetmenOdd(value) {
  const odd = Number(String(value || '').replace(',', '.'));
  return isDecimalOdds(odd) ? odd : null;
}

function resolveBetmenStartTime(weekday, time, now = new Date()) {
  const targetDay = BETMEN_WEEKDAYS[String(weekday || '').toLowerCase()];
  const timeMatch = String(time || '').match(/^([0-2]\d):([0-5]\d)$/);
  if (targetDay === undefined || !timeMatch) {
    return null;
  }

  const current = zonedParts(now, BETMEN_TIME_ZONE);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);

  for (let offset = 0; offset <= 7; offset += 1) {
    const localDate = addLocalDays(current, offset);
    if (localDate.weekday !== targetDay) {
      continue;
    }

    const candidate = zonedTimeToUtcDate({
      ...localDate,
      hour,
      minute,
      second: 0,
    }, BETMEN_TIME_ZONE);
    if (candidate.getTime() >= now.getTime() - 2 * 60 * 60 * 1000) {
      return candidate;
    }
  }

  return null;
}

function addLocalDays(parts, days) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    weekday: date.getUTCDay(),
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
  const localDate = new Date(Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
  ));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    weekday: localDate.getUTCDay(),
  };
}

function slugPart(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

module.exports = {
  BETMEN_PAGE_URL,
  BetmenProvider,
  extractBetmenRows,
  normalizeBetmenAgencyHtml,
  resolveBetmenStartTime,
};
