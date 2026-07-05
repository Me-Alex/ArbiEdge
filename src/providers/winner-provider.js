const { DigitainProvider, normalizeDigitainPayload } = require('./digitain-provider');

const WINNER_EVENTS_URL =
  'https://micros-prod1-sb.gambling-solutions.ro/api/digitain-fetcher/v2/public/events';

class WinnerProvider extends DigitainProvider {
  constructor(options = {}) {
    super({
      name: 'Winner',
      eventsUrl: WINNER_EVENTS_URL,
      origin: 'https://www.winner.ro',
      ...options,
    });
  }
}

function normalizeWinnerPayload(payload, fetchedAt) {
  return normalizeDigitainPayload(payload, {
    bookmaker: 'Winner',
    fetchedAt,
    origin: 'https://www.winner.ro',
  });
}

module.exports = {
  WINNER_EVENTS_URL,
  WinnerProvider,
  normalizeWinnerPayload,
};
