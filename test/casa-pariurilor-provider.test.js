const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CasaPariurilorProvider,
  CASA_UPCOMING_URL,
} = require('../src/providers/casa-pariurilor-provider');

const payload = {
  tournaments: [{ id: 'tour', name: 'Liga 1' }],
  fixtures: [{
    id: 'match',
    sportId: 'ufo:sprt:00',
    tournamentId: 'tour',
    sportradarIds: ['987'],
    participants: [
      { type: 'HOME', name: 'Craiova' },
      { type: 'AWAY', name: 'Rapid' },
    ],
    startDatetime: 1782122400000,
    status: 'ACTIVE',
  }],
  markets: [{
    fixtureId: 'match',
    marketTypeId: 'ufo:mtyp:00-00',
    outcomes: [
      { name: '1', odds: 2.1 },
      { name: 'X', odds: 3.2 },
      { name: '2', odds: 3.4 },
    ],
  }],
};

test('loads Casa Pariurilor through the shared UFO offer model', async () => {
  const urls = [];
  const provider = new CasaPariurilorProvider({
    now: () => new Date('2026-06-21T20:00:00Z'),
    fetchImpl: async (url) => {
      urls.push(url.toString());
      return new Response(JSON.stringify(payload), { status: 200 });
    },
  });

  const events = await provider.getOdds();

  assert.equal(urls[0], CASA_UPCOMING_URL);
  assert.equal(events[0].bookmakers[0].name, 'Casa Pariurilor');
  assert.equal(events[0].externalIds.sportradar, '987');
});
