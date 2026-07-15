const assert = require('node:assert/strict');
const test = require('node:test');

const {
  absoluteEventUrl,
  betOneEventUrl,
  bookmakerFootballUrl,
  bookmakerLinkFields,
  digitainEventUrl,
  egtEventUrl,
  favbetEventUrl,
  getsBetEventUrl,
  netbetEventUrl,
  slugPathPart,
  superbetEventUrl,
  ufoEventUrl,
  unibetEventUrl,
  xsportEventUrl,
} = require('../src/providers/event-links');

test('event link helpers build stable bookmaker and absolute URLs', () => {
  assert.equal(bookmakerFootballUrl('Superbet'), 'https://superbet.ro/pariuri-sportive/fotbal');
  assert.equal(bookmakerFootballUrl('Spin'), 'https://spin.ro/sport');
  assert.equal(bookmakerFootballUrl('VictoryBet'), 'https://www.victorybet.ro/rv/pre-match');
  assert.equal(bookmakerFootballUrl('Manhattan'), 'https://www.manhattan.ro/ro/sports/pre-match');
  assert.equal(bookmakerFootballUrl('UnknownBook'), null);
  assert.equal(absoluteEventUrl('/event/123', 'https://example.test/base'), 'https://example.test/event/123');
  assert.equal(absoluteEventUrl('', 'https://example.test'), null);
  assert.deepEqual(bookmakerLinkFields('Superbet', 'https://superbet.ro/cote/fotbal/a-1'), {
    eventUrl: 'https://superbet.ro/cote/fotbal/a-1',
    bookmakerUrl: 'https://superbet.ro/pariuri-sportive/fotbal',
  });
  assert.equal(slugPathPart('CFR Cluj & FCSB'), 'cfr-cluj-and-fcsb');
});

test('event link helpers build direct event URLs for provider payloads', () => {
  assert.equal(
    digitainEventUrl('https://www.winner.ro', {
      idSport: 1,
      idCategory: 2,
      idTournament: 3,
      idMatch: 4,
    }),
    'https://www.winner.ro/bets/match/pre-match/1/2/3/4',
  );

  assert.equal(
    egtEventUrl('https://winbet.ro', {
      sportEventId: 99,
      eventTitle: 'CFR Cluj - FCSB',
    }),
    'https://winbet.ro/sports/event/cfr-cluj-fcsb-99',
  );

  assert.equal(
    favbetEventUrl({ event_id: 43277348 }),
    'https://www.favbet.ro/ro/sports/event/soccer/43277348',
  );

  assert.equal(
    betOneEventUrl({ fixtureId: 102292 }),
    'https://sportsbook.betone.ro/event/102292',
  );

  assert.equal(
    netbetEventUrl({
      id: 'match-777',
      translated_sport_slug: 'fotbal',
      translated_competition_slug: 'liga-1',
      name: 'CFR Cluj - FCSB',
    }),
    'https://sport.netbet.ro/fotbal/liga-1/cfr-cluj-fcsb-777/',
  );

  assert.equal(
    getsBetEventUrl({
      id: 123,
      homeParticipantName: 'CFR Cluj',
      awayParticipantName: 'FCSB',
      venueName: 'Romania',
      parentName: 'Liga 1',
    }),
    'https://sports2.getsbet.ro/ro/eveniment/1/fotbal/romania/liga-1/cfr-cluj-fcsb/123/populare',
  );

  assert.equal(
    superbetEventUrl({ eventId: 555, matchName: 'CFR Cluj - FCSB' }),
    'https://superbet.ro/cote/fotbal/cfr-cluj-vs-fcsb-555',
  );

  assert.equal(
    ufoEventUrl('Casa Pariurilor', {
      sportSeoName: 'fotbal',
      categorySeoName: 'romania',
      tournamentSeoName: 'liga-1',
      seoName: 'cfr-cluj-fcsb',
    }),
    'https://www.casapariurilor.ro/pariuri-online/fotbal/romania/liga-1/cfr-cluj-fcsb?filter=all&tab=offer',
  );

  assert.equal(
    unibetEventUrl({
      category: 'football:romania:liga-1',
      contestKey: 'abc/123',
      name: 'CFR Cluj - FCSB',
    }),
    'https://www.unibet.ro/betting/odds/football/romania/liga-1/cfr-cluj-fcsb/abc%2F123',
  );

  assert.equal(
    xsportEventUrl('https://www.lasvegas.ro', {
      a: 1,
      p: 2,
      it: 3,
      ic: 4,
      tournamentName: 'Liga 1',
      dsl: { RO: 'CFR Cluj - FCSB' },
    }),
    'https://www.lasvegas.ro/sport/fotbal/liga-1/cfr-cluj-fcsb_1_4_3_2_1',
  );
});
