'use strict';

const { PlaywrightNetworkCollector } = require('./playwright-network-collector');

const BETANO_ORIGIN = 'https://ro.betano.com';
const BETANO_FOOTBALL_URL = `${BETANO_ORIGIN}/sport/fotbal/`;
const BETANO_LIST_PATTERN = /(?:\/api\/.*(?:events|event-list|offer|prematch)|\/graphql(?:\?|$))/i;

class BetanoBrowserTransport {
  constructor({
    headless = true,
    timeoutMs = 30_000,
    settleMs = 8_000,
    maxEvents = 120,
    detailConcurrency = 4,
    maxResponseBytes = 20 * 1024 * 1024,
    collector = null,
    now = () => new Date(),
  } = {}) {
    this.headless = headless;
    this.timeoutMs = timeoutMs;
    this.settleMs = settleMs;
    this.maxEvents = maxEvents;
    this.detailConcurrency = detailConcurrency;
    this.maxResponseBytes = maxResponseBytes;
    this.now = now;
    this.collector = collector || new PlaywrightNetworkCollector({
      headless,
      timeoutMs,
      settleMs,
      maxResponseBytes,
    });
  }

  async collect() {
    const capture = await this.collector.captureJson({
      pageUrl: BETANO_FOOTBALL_URL,
      responsePatterns: [BETANO_LIST_PATTERN],
      settleMs: this.settleMs,
      afterLoad: async ({ page, records }) => {
        const fallbackUrls = await discoverBetanoListUrls(page);
        const capturedUrls = new Set(records.map((record) => record.url));
        const fallbackRecords = await fetchJsonUrlsInPage(
          page,
          fallbackUrls.filter((url) => !capturedUrls.has(url)),
          this.detailConcurrency,
        );
        const listRecords = [...records, ...fallbackRecords];
        const candidates = dedupeBetanoEvents(listRecords)
          .filter((event) => isBetanoPrematchCandidate(event, this.now()))
          .slice(0, this.maxEvents);

        const detailRequests = candidates.map((event) => ({
          id: String(event.id),
          url: betanoDetailUrl(event.url),
        })).filter((request) => request.url);
        const detailRecords = await fetchJsonUrlsInPage(
          page,
          detailRequests.map((request) => request.url),
          this.detailConcurrency,
        );
        const detailByUrl = new Map(detailRecords.map((record) => [record.url, record]));
        const listSourceByEvent = eventSourceIndex(listRecords);
        const collectedAt = new Date().toISOString();

        return candidates.map((event) => {
          const detailUrl = betanoDetailUrl(event.url);
          const detail = detailByUrl.get(detailUrl)?.payload;
          const detailEvent = detail?.data?.event || detail?.event || null;
          const combinedEvent = { ...event, ...(detailEvent || {}) };
          const teams = extractBetanoTeams(combinedEvent);
          return {
            ...combinedEvent,
            id: event.id,
            url: event.url || detailEvent?.url,
            betRadarId: event.betRadarId || detailEvent?.betRadarId,
            name: event.name || detailEvent?.name,
            startTime: event.startTime || detailEvent?.startTime,
            competition: event.leagueName || event.competition || detailEvent?.leagueName,
            markets: Array.isArray(detailEvent?.markets) && detailEvent.markets.length > 0
              ? detailEvent.markets
              : event.markets || [],
            homeTeam: teams[0] || null,
            awayTeam: teams[1] || null,
            collectedAt,
            collectionMethod: 'playwright-network',
            sourceUrls: [
              ...(listSourceByEvent.get(String(event.id)) || []),
              ...(detailUrl && detailByUrl.has(detailUrl) ? [detailUrl] : []),
            ],
          };
        });
      },
    });

    return Array.isArray(capture.result) ? capture.result : [];
  }
}

async function discoverBetanoListUrls(page) {
  if (typeof page?.evaluate !== 'function') return [];
  return page.evaluate(() => [...new Set(
    performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((url) => /(?:\/api\/.*(?:events|event-list|offer|prematch)|\/graphql(?:\?|$))/i.test(url)),
  )]).catch(() => []);
}

async function fetchJsonUrlsInPage(page, urls, concurrency = 4) {
  const uniqueUrls = [...new Set((urls || []).filter(Boolean))];
  if (uniqueUrls.length === 0) return [];
  const results = await page.evaluate(async ({ requestUrls, workerCount }) => {
    let nextIndex = 0;
    const output = new Array(requestUrls.length);
    await Promise.all(Array.from({ length: Math.min(workerCount, requestUrls.length) }, async () => {
      while (nextIndex < requestUrls.length) {
        const index = nextIndex;
        nextIndex += 1;
        const url = requestUrls[index];
        try {
          const response = await fetch(url, {
            credentials: 'include',
            headers: { accept: 'application/json, text/plain, */*' },
          });
          if (!response.ok) {
            output[index] = { url, status: response.status, payload: null };
            continue;
          }
          output[index] = { url, status: response.status, payload: await response.json() };
        } catch (error) {
          output[index] = { url, status: 0, payload: null, error: error.message };
        }
      }
    }));
    return output;
  }, {
    requestUrls: uniqueUrls,
    workerCount: positiveInteger(concurrency, 4),
  });

  return (results || [])
    .filter((record) => record?.payload)
    .map((record) => ({
      ...record,
      capturedAt: new Date().toISOString(),
    }));
}

function dedupeBetanoEvents(records) {
  const events = [];
  for (const record of records || []) {
    for (const event of betanoEventsFromPayload(record?.payload)) {
      events.push({ ...event, _sourceUrl: record.url });
    }
  }
  return [...new Map(
    events.filter((event) => event?.id).map((event) => [String(event.id), event]),
  ).values()];
}

function betanoEventsFromPayload(payload) {
  const output = [];
  const visited = new Set();
  const visit = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 6 || visited.has(node)) return;
    visited.add(node);
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    if (Array.isArray(node.events)) {
      output.push(...node.events.filter((event) => event && typeof event === 'object'));
    }
    for (const value of Object.values(node)) visit(value, depth + 1);
  };
  visit(payload);
  return output;
}

function eventSourceIndex(records) {
  const index = new Map();
  for (const record of records || []) {
    for (const event of betanoEventsFromPayload(record?.payload)) {
      if (!event?.id) continue;
      const key = String(event.id);
      if (!index.has(key)) index.set(key, []);
      if (record.url && !index.get(key).includes(record.url)) index.get(key).push(record.url);
    }
  }
  return index;
}

function isBetanoPrematchCandidate(event, now = new Date()) {
  if (!event?.id || !event?.url) return false;
  if (event.liveNow || event.live || event.isLive || /live|in[_ -]?play/i.test(String(event.status || ''))) {
    return false;
  }
  const startsAt = betanoStartDate(event.startTime);
  if (!startsAt) return false;
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (Number.isFinite(nowMs) && startsAt.getTime() < nowMs - 5 * 60_000) return false;
  return extractBetanoTeams(event).length === 2;
}

function extractBetanoTeams(event) {
  const direct = [
    event?.homeTeam || event?.homeParticipantName,
    event?.awayTeam || event?.awayParticipantName,
  ].map(cleanTeam).filter(Boolean);
  if (direct.length === 2) return direct;

  const participants = event?.participants || event?.competitors || event?.teams || [];
  if (Array.isArray(participants)) {
    const home = participants.find((participant) => /home|gazd/i.test(String(participant?.type || participant?.role || '')));
    const away = participants.find((participant) => /away|oaspet/i.test(String(participant?.type || participant?.role || '')));
    const explicit = [participantName(home), participantName(away)].map(cleanTeam).filter(Boolean);
    if (explicit.length === 2) return explicit;
    const ordered = participants.map(participantName).map(cleanTeam).filter(Boolean);
    if (ordered.length === 2) return ordered;
  }

  return splitFixtureName(event?.name || event?.eventName);
}

function splitFixtureName(value) {
  const label = String(value || '').trim();
  for (const separator of [/\s+vs?\.?\s+/i, /\s+[-\u2013\u2014]\s+/, /\s*\u00b7\s*/]) {
    const parts = label.split(separator).map(cleanTeam).filter(Boolean);
    if (parts.length === 2) return parts;
  }
  return [];
}

function participantName(participant) {
  return participant?.name || participant?.participantName || participant?.label || '';
}

function cleanTeam(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function betanoStartDate(value) {
  const numeric = Number(value);
  const normalized = Number.isFinite(numeric) && numeric > 0 && numeric < 1e12
    ? numeric * 1000
    : value;
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? date : null;
}

function betanoDetailUrl(value) {
  const path = String(value || '').trim();
  if (!path) return null;
  try {
    const url = new URL(path, BETANO_ORIGIN);
    if (url.origin !== BETANO_ORIGIN) return null;
    const apiPath = url.pathname.startsWith('/api/') ? url.pathname : `/api${url.pathname}`;
    return new URL(`${apiPath}${url.search}`, BETANO_ORIGIN).toString();
  } catch {
    return null;
  }
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

module.exports = {
  BETANO_FOOTBALL_URL,
  BETANO_LIST_PATTERN,
  BetanoBrowserTransport,
  betanoDetailUrl,
  betanoEventsFromPayload,
  betanoStartDate,
  dedupeBetanoEvents,
  extractBetanoTeams,
  fetchJsonUrlsInPage,
  isBetanoPrematchCandidate,
};
