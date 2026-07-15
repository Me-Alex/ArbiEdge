'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TheOddsApiResultsProvider, normalizeScoreEvent } = require('../src/results/the-odds-api-results-provider');

test('TheOddsApiResultsProvider loads completed score events', async () => {
  const urls = [];
  const provider = new TheOddsApiResultsProvider({
    apiKey: 'test', sportKeys: ['soccer_test'],
    fetchImpl: async (url) => {
      urls.push(String(url));
      return { ok: true, json: async () => [{
        id: 'e1', sport_key: 'soccer_test', home_team: 'Home', away_team: 'Away',
        commence_time: '2026-07-14T10:00:00Z', completed: true,
        scores: [{ name: 'Home', score: '2' }, { name: 'Away', score: '1' }],
      }] };
    },
  });
  const [event] = await provider.getCompletedEvents();
  assert.equal(event.homeScore, 2);
  assert.match(urls[0], /daysFrom=3/);
  assert.equal(normalizeScoreEvent({}), null);
});
