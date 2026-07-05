const { mergeEvents } = require('./composite-provider');
const { DigitainProvider, normalizeDigitainPayload } = require('./digitain-provider');

const NEW_GAMBLING_EVENTS_URL =
  'https://micros-prod1-sb.gambling-solutions.ro/api/digitain-fetcher/v2/public/events';
const EAGLE_EVENTS_URL =
  'https://micros-eagle-prod1-sb.gambling-solutions.ro/api/digitain-fetcher/v2/public/events';

class DigitainBrandGroupProvider extends DigitainProvider {
  constructor({ name, brands, eventsUrl, origin, ...options } = {}) {
    const normalizedBrands = normalizeBrands(brands);
    if (normalizedBrands.length === 0) {
      throw new Error('DigitainBrandGroupProvider requires at least one brand');
    }

    super({
      name,
      eventsUrl,
      origin: origin || normalizedBrands[0].origin,
      ...options,
    });

    this.brands = normalizedBrands;
  }

  async getOdds() {
    const start = this.now();
    const payload = await this.fetchFootballPayload(start);
    const fetchedAt = start.toISOString();

    return mergeEvents(
      this.brands.flatMap((brand) =>
        normalizeDigitainPayload(payload, {
          bookmaker: brand.name,
          fetchedAt,
          origin: brand.origin,
        }),
      ),
    );
  }
}

function normalizeBrands(brands) {
  return (Array.isArray(brands) ? brands : [])
    .map((brand) => ({
      name: String(brand?.name || '').trim(),
      origin: String(brand?.origin || '').replace(/\/+$/g, ''),
    }))
    .filter((brand) => brand.name && brand.origin);
}

module.exports = {
  DigitainBrandGroupProvider,
  EAGLE_EVENTS_URL,
  NEW_GAMBLING_EVENTS_URL,
};
