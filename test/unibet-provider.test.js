const test = require('node:test');
const assert = require('node:assert/strict');

const {
  UNIBET_CONTEST_PAGE_URL,
  UnibetProvider,
  extractFootballCategoryRns,
  normalizeUnibetPayload,
} = require('../src/providers/unibet-provider');

const contest = {
  contestKey: 'abc',
  category: 'football:fifa_world_cup:group_matches',
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
  assert.equal(
    events[0].bookmakers[0].eventUrl,
    'https://www.unibet.ro/betting/odds/football/fifa-world-cup/group-matches/uruguay-vs-capul-verde/abc',
  );
  assert.equal(events[0].bookmakers[0].bookmakerUrl, 'https://www.unibet.ro/betting/odds/football');
  assert.equal(events[0].bookmakers[0].markets.h2h.draw, 4.5);
});

test('normalizes Unibet contests with dash-separated team names', () => {
  const dashPayload = {
    view: {
      matches: [{
        contestGroups: [{
          contests: [{
            ...contest,
            contestKey: 'dash',
            name: 'Franta - Romania',
          }],
        }],
      }],
    },
  };

  const events = normalizeUnibetPayload(dashPayload);

  assert.equal(events.length, 1);
  assert.equal(events[0].homeTeam, 'Franta');
  assert.equal(events[0].awayTeam, 'Romania');
});

test('rejects Unibet events with invalid decimal prices', () => {
  const invalidPayload = {
    view: {
      matches: [{
        contestGroups: [{
          contests: [{
            ...contest,
            contestKey: 'invalid',
            propositions: [{
              propositionType: '1x2',
              status: 'Active',
              options: [
                { optionDisplayName: '1', price: 0 },
                { optionDisplayName: 'X', price: 251 },
                { optionDisplayName: '2', price: 251 },
              ],
            }],
          }],
        }],
      }],
    },
  };

  assert.equal(normalizeUnibetPayload(invalidPayload).length, 0);
});

test('extracts football category routes from Unibet quickbrowse', () => {
  const categories = extractFootballCategoryRns({
    quickBrowseItems: [
      {
        category: { categoryRn: 'football' },
        children: [
          { category: { categoryRn: 'football:brazil' } },
          { category: { categoryRn: 'football:sweden' } },
          { category: { categoryRn: 'tennis' } },
        ],
      },
    ],
  });

  assert.deepEqual(categories, ['football', 'football:brazil', 'football:sweden']);
});

test('loads Unibet football category lobbies beyond the main lobby', async () => {
  const brazilContest = {
    ...contest,
    contestKey: 'brazil',
    name: 'Athletic Club MG vs Avaí SC',
    categoriesDetailed: [{ name: 'Brazilia' }],
  };
  const quickbrowsePayload = {
    quickBrowseItems: [
      {
        category: { categoryRn: 'football' },
        children: [{ category: { categoryRn: 'football:brazil' } }],
      },
    ],
  };
  const categoryPayload = {
    view: { matches: [{ contestGroups: [{ contests: [brazilContest] }] }] },
  };
  const requests = [];
  const provider = new UnibetProvider({
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      if (String(url).includes('quickbrowse')) {
        return new Response(JSON.stringify(quickbrowsePayload), { status: 200 });
      }
      if (String(url).includes('category=football%3Abrazil')) {
        return new Response(JSON.stringify(categoryPayload), { status: 200 });
      }
      return new Response(JSON.stringify(payload), { status: 200 });
    },
  });

  const events = await provider.getOdds();

  assert.ok(requests.some((request) => request.url.includes('quickbrowse')));
  assert.ok(requests.some((request) => request.url.includes('football%3Abrazil')));
  assert.deepEqual(
    events.map((event) => `${event.homeTeam} vs ${event.awayTeam}`).sort(),
    ['Athletic Club MG vs Avaí SC', 'Uruguay vs Capul Verde'],
  );
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

test('enriches Unibet lobby contests with contest-page markets', async () => {
  const lobbyPayload = structuredClone(payload);
  lobbyPayload.view.matches[0].contestGroups[0].contests[0].propositionCount = 4;

  const detailPayload = {
    contest: {
      ...contest,
      propositionCount: 4,
      propositions: [
        ...contest.propositions,
        {
          propositionType: 'total',
          status: 'Active',
          name: 'Total Goluri',
          options: [
            { optionDisplayName: 'Peste', total: 2.5, price: 1.91 },
            { optionDisplayName: 'Sub', total: 2.5, price: 1.82 },
          ],
        },
        {
          propositionType: 'both_teams_to_score',
          status: 'Active',
          name: 'Ambele Echipe sa Inscrie',
          options: [
            { optionDisplayName: 'Da', price: 1.74 },
            { optionDisplayName: 'Nu', price: 2.02 },
          ],
        },
        {
          propositionType: '1st_half_total',
          status: 'Active',
          name: 'Total Goluri - Repriza a 1-a',
          options: [
            { optionDisplayName: 'Peste', total: 0.5, price: 1.42 },
            { optionDisplayName: 'Sub', total: 0.5, price: 2.75 },
          ],
        },
        {
          propositionType: 'draw_no_bet',
          status: 'Active',
          name: 'Victorie Fara Egal',
          options: [
            { optionDisplayName: '1', price: 1.16 },
            { optionDisplayName: '2', price: 4.8 },
          ],
        },
        {
          propositionType: '{competitor1}_total',
          status: 'Active',
          name: 'Total Goluri Uruguay',
          options: [
            { optionDisplayName: 'Peste', total: 1.5, price: 2.15 },
            { optionDisplayName: 'Sub', total: 1.5, price: 1.62 },
          ],
        },
      ],
    },
  };

  const requests = [];
  const provider = new UnibetProvider({
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response(
        JSON.stringify(String(url).startsWith(UNIBET_CONTEST_PAGE_URL) ? detailPayload : lobbyPayload),
        { status: 200 },
      );
    },
  });

  const events = await provider.getOdds();
  const markets = events[0].bookmakers[0].markets;

  assert.equal(requests.length, 3);
  assert.match(String(requests[2].url), /contest-page/);
  assert.deepEqual(markets.totalGoals_2_5, { over: 1.91, under: 1.82 });
  assert.deepEqual(markets.bothTeamsToScore, { yes: 1.74, no: 2.02 });
  assert.deepEqual(markets.firstHalfTotalGoals_0_5, { over: 1.42, under: 2.75 });
  assert.deepEqual(markets.drawNoBet, { home: 1.16, away: 4.8 });
  assert.deepEqual(markets.market_total_goluri_home_1_5, { over: 2.15, under: 1.62 });
});

test('keeps direct Unibet detail payloads and retries only failed detail URLs in browser', async () => {
  const firstContest = { ...contest, propositionCount: 2 };
  const secondContest = {
    ...contest,
    contestKey: 'second',
    name: 'Argentina - Brazil',
    propositionCount: 2,
  };
  const lobbyPayload = {
    view: {
      matches: [{
        contestGroups: [{ contests: [firstContest, secondContest] }],
      }],
    },
  };
  let browserCalls = 0;
  const provider = new UnibetProvider({
    requestConcurrency: 1,
    fetchImpl: async (url) => {
      const requestUrl = String(url);
      if (requestUrl.startsWith(UNIBET_CONTEST_PAGE_URL)) {
        const key = new URL(requestUrl).searchParams.get('contestKey');
        if (key === 'abc') {
          return new Response(JSON.stringify(detailPayloadForContest(firstContest, 1.5)), {
            status: 200,
          });
        }
        return new Response('Blocked', { status: 503 });
      }
      return new Response(JSON.stringify(lobbyPayload), { status: 200 });
    },
    browserTransport: {
      getJson: async (url) => {
        browserCalls += 1;
        const key = new URL(String(url)).searchParams.get('contestKey');
        assert.equal(key, 'second');
        return detailPayloadForContest(secondContest, 2.5);
      },
    },
  });

  const events = await provider.getOdds();
  const marketsByKey = new Map(
    events.map((event) => [event.externalIds.unibetContest, event.bookmakers[0].markets]),
  );

  assert.equal(browserCalls, 1);
  assert.deepEqual(marketsByKey.get('abc').totalGoals_1_5, { over: 1.91, under: 1.82 });
  assert.deepEqual(marketsByKey.get('second').totalGoals_2_5, { over: 1.91, under: 1.82 });
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

  assert.equal(browserCalls, 2);
  assert.equal(events.length, 1);
});

function detailPayloadForContest(sourceContest, total) {
  return {
    contest: {
      ...sourceContest,
      propositions: [
        ...sourceContest.propositions,
        {
          propositionType: 'total',
          status: 'Active',
          name: 'Total Goluri',
          options: [
            { optionDisplayName: 'Peste', total, price: 1.91 },
            { optionDisplayName: 'Sub', total, price: 1.82 },
          ],
        },
      ],
    },
  };
}
