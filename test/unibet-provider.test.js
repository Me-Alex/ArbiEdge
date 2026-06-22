const test = require('node:test');
const assert = require('node:assert/strict');

const {
  UnibetProvider,
  normalizeUnibetPayload,
} = require('../src/providers/unibet-provider');

const contest = {
  contestKey: 'abc',
  name: 'Uruguay vs Capul Verde',
  startDateTimeUtc: { value: '2026-06-21T22:00:00.000Z' },
  categoriesDetailed: [{ name: 'Meciuri Cupa Mondială' }],
  propositions: [{
    propositionType: '1x2',
    status: 'Active',
    options: [
      { optionDisplayName: '1', price: 1.42 },
      { optionDisplayName: 'X', price: 4.5 },
      { optionDisplayName: '2', price: 9.5 },
    ],
  }],
};
const payload = {
  view: { matches: [{ contestGroups: [{ contests: [contest] }] }] },
};

test('normalizes Unibet lobby contests', () => {
  const events = normalizeUnibetPayload(payload);

  assert.equal(events.length, 1);
  assert.equal(events[0].bookmakers[0].name, 'Unibet');
  assert.equal(events[0].bookmakers[0].markets.h2h.draw, 4.5);
});

test('sends the Romanian public lobby headers', async () => {
  let options;
  const provider = new UnibetProvider({
    fetchImpl: async (url, requestOptions) => {
      options = requestOptions;
      return new Response(JSON.stringify(payload), { status: 200 });
    },
  });

  await provider.getOdds();
  assert.equal(options.headers.jurisdiction, 'RO');
  assert.equal(options.headers.locale, 'ro_RO');
  assert.equal(options.headers.origin, 'https://www.unibet.ro');
  assert.match(options.headers['user-agent'], /Mozilla/);
});

test('falls back to an in-page request when direct Unibet access is rejected', async () => {
  let browserCalls = 0;
  const provider = new UnibetProvider({
    fetchImpl: async () => new Response('Unavailable', { status: 503 }),
    browserTransport: {
      getJson: async () => {
        browserCalls += 1;
        return payload;
      },
    },
  });

  const events = await provider.getOdds();

  assert.equal(browserCalls, 1);
  assert.equal(events.length, 1);
});
