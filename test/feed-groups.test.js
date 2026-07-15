'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  annotateFeedGroups,
  feedGroupForBookmaker,
  independentFeedCount,
  platformGroupForBookmaker,
} = require('../src/providers/feed-groups');

test('feed groups identify correlated brands without merging their identities', () => {
  assert.equal(feedGroupForBookmaker('Stanleybet'), feedGroupForBookmaker('GameWorld'));
  assert.equal(feedGroupForBookmaker('Winner'), feedGroupForBookmaker('MrPlay'));
  assert.notEqual(feedGroupForBookmaker('Fortuna'), feedGroupForBookmaker('Casa Pariurilor'));
  assert.equal(platformGroupForBookmaker('VictoryBet'), 'betconstruct');

  const events = annotateFeedGroups([{ bookmakers: [{ name: 'Stanleybet' }, { name: 'GameWorld' }, { name: 'Fortuna' }] }]);
  assert.equal(independentFeedCount(events[0].bookmakers), 2);
  assert.equal(events[0].bookmakers[0].platformGroup, 'nsoft');
});
