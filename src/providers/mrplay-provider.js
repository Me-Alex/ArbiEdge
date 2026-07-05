const { DigitainProvider } = require('./digitain-provider');

const MRPLAY_EVENTS_URL =
  'https://micros-prod1-sb.gambling-solutions.ro/api/digitain-fetcher/v2/public/events';

class MrPlayProvider extends DigitainProvider {
  constructor(options = {}) {
    super({
      name: 'MrPlay',
      eventsUrl: MRPLAY_EVENTS_URL,
      origin: 'https://www.mrplay.ro',
      ...options,
    });
  }
}

module.exports = {
  MRPLAY_EVENTS_URL,
  MrPlayProvider,
};
