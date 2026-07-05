const { DigitainProvider } = require('./digitain-provider');

const EIGHT_EIGHT_EIGHT_EVENTS_URL =
  'https://micros-eagle-prod1-sb.gambling-solutions.ro/api/digitain-fetcher/v2/public/events';

class EightEightEightProvider extends DigitainProvider {
  constructor(options = {}) {
    super({
      name: '888',
      eventsUrl: EIGHT_EIGHT_EIGHT_EVENTS_URL,
      origin: 'https://www.888.ro',
      ...options,
    });
  }
}

module.exports = {
  EIGHT_EIGHT_EIGHT_EVENTS_URL,
  EightEightEightProvider,
};
