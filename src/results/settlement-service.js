'use strict';

class SettlementService {
  constructor({
    resultsProvider,
    betTracker,
    store = null,
    intervalMs = 15 * 60_000,
    now = () => new Date(),
    logger = null,
  } = {}) {
    this.resultsProvider = resultsProvider;
    this.betTracker = betTracker;
    this.store = store;
    this.intervalMs = intervalMs;
    this.now = now;
    this.logger = logger;
    this.lastRunAt = null;
    this.running = null;
  }

  async settlePending({ force = false } = {}) {
    if (!this.resultsProvider || !this.betTracker) return { skipped: 'results provider disabled', settled: 0, reviewed: 0 };
    if (this.running) return this.running;
    if (!force && this.lastRunAt && this.now().getTime() - new Date(this.lastRunAt).getTime() < this.intervalMs) {
      return { skipped: 'settlement interval not elapsed', settled: 0, reviewed: 0 };
    }
    this.running = this.#settle().finally(() => { this.running = null; });
    return this.running;
  }

  async #settle() {
    this.lastRunAt = this.now().toISOString();
    const completed = await this.resultsProvider.getCompletedEvents();
    const pending = this.betTracker.readAll().filter((bet) => bet.status === 'pending');
    const summary = { checked: pending.length, matched: 0, settled: 0, reviewed: 0 };
    for (const bet of pending) {
      const resultEvent = findResultEvent(bet, completed);
      if (!resultEvent || !Number.isFinite(resultEvent.homeScore) || !Number.isFinite(resultEvent.awayScore)) continue;
      summary.matched += 1;
      const result = settleBetFromScore(bet, resultEvent);
      if (!result) {
        summary.reviewed += 1;
        continue;
      }
      const settled = this.betTracker.settle(bet.id, result, {
        notes: appendNote(bet.notes, `Authoritative settlement: ${resultEvent.homeScore}-${resultEvent.awayScore} via ${this.resultsProvider.name}`),
      });
      await this.store?.recordSettlement?.({
        subjectType: 'bet',
        subjectId: bet.id,
        provider: this.resultsProvider.name,
        result,
        homeScore: resultEvent.homeScore,
        awayScore: resultEvent.awayScore,
        payload: { eventId: resultEvent.id, lastUpdate: resultEvent.lastUpdate },
        settledAt: settled.settledAt,
      });
      summary.settled += 1;
    }
    this.logger?.info?.('Authoritative settlement cycle completed', summary);
    return summary;
  }
}

function findResultEvent(bet, events) {
  if (bet.externalEventId) {
    const exact = events.find((event) => String(event.id) === String(bet.externalEventId));
    if (exact) return exact;
  }
  const betText = normalizeText([bet.event, bet.homeTeam, bet.awayTeam].filter(Boolean).join(' '));
  const betStart = new Date(bet.eventStartsAt || bet.startsAt || 0).getTime();
  return (events || []).find((event) => {
    const teamsMatch = betText.includes(normalizeText(event.homeTeam))
      && betText.includes(normalizeText(event.awayTeam));
    if (!teamsMatch) return false;
    const eventStart = new Date(event.startsAt || 0).getTime();
    return !Number.isFinite(betStart) || betStart <= 0 || !Number.isFinite(eventStart)
      || Math.abs(eventStart - betStart) <= 24 * 60 * 60_000;
  }) || null;
}

function settleBetFromScore(bet, event) {
  const market = normalizeText(bet.market);
  const selection = normalizeText(bet.selection);
  const homeWon = event.homeScore > event.awayScore;
  const awayWon = event.awayScore > event.homeScore;
  const draw = event.homeScore === event.awayScore;

  if (/h2h|1x2|rezultat final|match result/.test(market)) {
    if (['1', 'home'].includes(selection) || selection.includes(normalizeText(event.homeTeam))) return homeWon ? 'won' : 'lost';
    if (['2', 'away'].includes(selection) || selection.includes(normalizeText(event.awayTeam))) return awayWon ? 'won' : 'lost';
    if (['x', 'draw', 'egal'].includes(selection)) return draw ? 'won' : 'lost';
  }
  if (/both teams|btts|ambele/.test(market)) {
    const yes = event.homeScore > 0 && event.awayScore > 0;
    if (/yes|da/.test(selection)) return yes ? 'won' : 'lost';
    if (/no|nu/.test(selection)) return yes ? 'lost' : 'won';
  }
  if (/total|over|under|goluri/.test(`${market} ${selection}`)) {
    const match = `${bet.market || ''} ${bet.selection || ''}`.match(/(?:over|under|peste|sub)\s*([0-9]+(?:[.,][0-9]+)?)/i);
    if (!match) return null;
    const line = Number(match[1].replace(',', '.'));
    const total = event.homeScore + event.awayScore;
    if (Math.abs(total - line) < 1e-9) return 'void';
    if (/over|peste/i.test(`${bet.market} ${bet.selection}`)) return total > line ? 'won' : 'lost';
    if (/under|sub/i.test(`${bet.market} ${bet.selection}`)) return total < line ? 'won' : 'lost';
  }
  return null;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function appendNote(existing, note) {
  return [existing, note].filter(Boolean).join(' | ');
}

module.exports = {
  SettlementService,
  findResultEvent,
  settleBetFromScore,
};
