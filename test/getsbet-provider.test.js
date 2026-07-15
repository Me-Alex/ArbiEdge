const test = require('node:test');
const assert = require('node:assert/strict');

const {
  discoverGetsBetTournamentIds,
  getsBetMatchDetailTopic,
  getsBetTournamentMainTopic,
  normalizeGetsBetRecords,
} = require('../src/providers/getsbet-provider');

const match = {
  _type: 'MATCH',
  id: '307128274314293248',
  sportId: '1',
  name: 'Brazilia - Japonia',
  startTime: Date.parse('2026-06-29T17:00:00Z'),
  parentName: 'CM Playoffs 2026',
  shortParentName: 'CM Playoffs',
  venueName: 'International',
  categoryName: 'Lume',
  homeParticipantName: 'Brazilia',
  awayParticipantName: 'Japonia',
};

function market(id, bettingTypeId, name, paramFloat1) {
  return {
    _type: 'MARKET',
    id,
    eventId: match.id,
    bettingTypeId: String(bettingTypeId),
    name,
    paramFloat1,
    isClosed: false,
  };
}

function outcome(id, marketId, translatedName, headerNameKey, odds, extra = {}) {
  return [
    {
      _type: 'OUTCOME',
      id,
      eventId: match.id,
      translatedName,
      headerNameKey,
      ...extra,
    },
    {
      _type: 'MARKET_OUTCOME_RELATION',
      id: `rel-${id}`,
      marketId,
      outcomeId: id,
    },
    {
      _type: 'BETTING_OFFER',
      id: `offer-${id}`,
      outcomeId: id,
      statusId: '1',
      isAvailable: true,
      odds,
    },
  ];
}

const records = [
  match,
  market('mega', 693, 'Mega Cota 1X2 - Timp regulamentar.'),
  ...outcome('mega-home', 'mega', 'Brazilia', 'home', 1.8),
  ...outcome('mega-draw', 'mega', 'Egal', 'draw', 3.8),
  ...outcome('mega-away', 'mega', 'Japonia', 'away', 5.1),
  market('final', 69, 'Final - Timp regulamentar.'),
  ...outcome('final-home', 'final', 'Brazilia', 'home', 1.71),
  ...outcome('final-draw', 'final', 'Egal', 'draw', 3.7),
  ...outcome('final-away', 'final', 'Japonia', 'away', 5),
  market('btts', 76, 'Ambele echipe marcheaza - Timp regulamentar.'),
  ...outcome('btts-yes', 'btts', 'Da', 'yes', 1.96),
  ...outcome('btts-no', 'btts', 'Nu', 'no', 1.83),
  market('ht-ft', 624, 'Pauza sau Final - Timp regulamentar.'),
  ...outcome('ht-ft-home', 'ht-ft', 'Brazilia', 'home', 1.48),
  ...outcome('ht-ft-draw', 'ht-ft', 'Egal', 'draw', 1.8),
  ...outcome('ht-ft-away', 'ht-ft', 'Japonia', 'away', 3.4),
  market('total-25', 47, 'Total Peste/Sub 2.5 Timp regulamentar.', 2.5),
  ...outcome('total-25-over', 'total-25', 'Peste 2.5', 'over', 1.99),
  ...outcome('total-25-under', 'total-25', 'Sub 2.5', 'under', 1.82),
  market('total-225', 47, 'Total Peste/Sub 2.25 Timp regulamentar.', 2.25),
  ...outcome('total-225-over', 'total-225', 'Peste 2.25', 'over', 1.74),
  ...outcome('total-225-under', 'total-225', 'Sub 2.25', 'under', 2.06),
  market('first-half-total-15', 47, 'Total Peste/Sub 1.5 - Repriza 1.', 1.5),
  ...outcome('first-half-total-15-over', 'first-half-total-15', 'Peste 1.5', 'over', 2.2),
  ...outcome('first-half-total-15-under', 'first-half-total-15', 'Sub 1.5', 'under', 1.6),
  market('home-total', 77, 'Brazilia Total Peste/Sub 1.5 - Timp regulamentar.', 1.5),
  ...outcome('home-total-over', 'home-total', 'Brazilia Peste 1.5', 'over', 1.86),
  ...outcome('home-total-under', 'home-total', 'Brazilia Sub 1.5', 'under', 1.85),
  market('corners-ft-75', 901, 'Cornere Peste/Sub - Timp regulamentar.', 7.5),
  ...outcome('corners-ft-75-over', 'corners-ft-75', 'Peste 7.5', 'over', 1.27),
  ...outcome('corners-ft-75-under', 'corners-ft-75', 'Sub 7.5', 'under', 3.3),
  market('corners-1h-65', 902, 'Cornere Peste/Sub - Repriza 1.', 6.5),
  ...outcome('corners-1h-65-over', 'corners-1h-65', 'Peste 6.5', 'over', 4.25),
  ...outcome('corners-1h-65-under', 'corners-1h-65', 'Sub 6.5', 'under', 1.15),
  market('corners-2h-45', 904, 'Cornere Peste/Sub - Repriza 2.', 4.5),
  ...outcome('corners-2h-45-over', 'corners-2h-45', 'Peste 4.5', 'over', 1.87),
  ...outcome('corners-2h-45-under', 'corners-2h-45', 'Sub 4.5', 'under', 1.77),
  market('away-corners-ft-45', 903, 'Japonia cornere Peste/Sub - Timp regulamentar.', 4.5),
  ...outcome('away-corners-ft-45-over', 'away-corners-ft-45', 'Peste 4.5', 'over', 1.65),
  ...outcome('away-corners-ft-45-under', 'away-corners-ft-45', 'Sub 4.5', 'under', 2.11),
  market('dnb', 1, 'Egal - Pariul se ramburseaza - Timp regulamentar.'),
  ...outcome('dnb-home', 'dnb', 'Brazilia', 'home', 1.33),
  ...outcome('dnb-away', 'dnb', 'Japonia', 'away', 3.2),
];

test('normalizes GetsBet records and prefers normal 1X2 over Mega Cota', () => {
  const events = normalizeGetsBetRecords(records, { fetchedAt: '2026-06-29T10:00:00.000Z' });

  assert.equal(events.length, 1);
  assert.equal(events[0].id, 'getsbet:307128274314293248');
  assert.equal(events[0].bookmakers[0].eventUrl, 'https://sports2.getsbet.ro/ro/eveniment/1/fotbal/international/cm-playoffs/brazilia-japonia/307128274314293248/populare');
  assert.deepEqual(events[0].bookmakers[0].markets.h2h, {
    home: 1.71,
    draw: 3.7,
    away: 5,
  });
  assert.deepEqual(events[0].bookmakers[0].markets.bothTeamsToScore, {
    yes: 1.96,
    no: 1.83,
  });
  assert.deepEqual(events[0].bookmakers[0].markets.halfTimeOrFullTime, {
    home: 1.48,
    draw: 1.8,
    away: 3.4,
  });
  assert.equal(events[0].bookmakers[0].markets.market_pauza_sau_final_minus_timp_regulamentar, undefined);
  assert.deepEqual(events[0].bookmakers[0].markets.totalGoals_2_5, {
    over: 1.99,
    under: 1.82,
  });
  assert.deepEqual(events[0].bookmakers[0].markets.asianTotalGoals_2_25, {
    over: 1.74,
    under: 2.06,
  });
  assert.deepEqual(events[0].bookmakers[0].markets.firstHalfTotalGoals_1_5, {
    over: 2.2,
    under: 1.6,
  });
  assert.deepEqual(events[0].bookmakers[0].markets.market_total_goluri_home_1_5, {
    over: 1.86,
    under: 1.85,
  });
  assert.deepEqual(events[0].bookmakers[0].markets.totalCorners_7_5, {
    over: 1.27,
    under: 3.3,
  });
  assert.deepEqual(events[0].bookmakers[0].markets.firstHalfTotalCorners_6_5, {
    over: 4.25,
    under: 1.15,
  });
  assert.deepEqual(events[0].bookmakers[0].markets.secondHalfTotalCorners_4_5, {
    over: 1.87,
    under: 1.77,
  });
  assert.equal(events[0].bookmakers[0].markets.totalCorners_6_5, undefined);
  assert.equal(events[0].bookmakers[0].markets.totalCorners_4_5, undefined);
  assert.deepEqual(
    events[0].bookmakers[0].markets.market_away_cornere_peste_sub_minus_timp_regulamentar_4_5,
    {
      over: 1.65,
      under: 2.11,
    },
  );
  assert.deepEqual(events[0].bookmakers[0].markets.drawNoBet, {
    home: 1.33,
    away: 3.2,
  });
});

test('builds GetsBet WAMP topics', () => {
  assert.equal(
    getsBetTournamentMainTopic({
      operatorId: 2476,
      lang: 'ro',
      tournamentId: '304262094589714432',
    }),
    '/sports/2476/ro/tournament-aggregator-groups-overview/304262094589714432/default-event-info/NOT_LIVE/2614',
  );
  assert.equal(
    getsBetMatchDetailTopic({
      operatorId: 2476,
      lang: 'ro',
      matchId: '307128274314293248',
    }),
    '/sports/2476/ro/307128274314293248/match-odds/market-group/Populare',
  );
});

test('prioritizes GetsBet tournaments by available event count before applying the cap', async () => {
  const calls = [];
  const client = {
    initialDump: async (topic) => {
      calls.push(topic);
      if (topic.endsWith('/custom-events')) {
        return {
          records: [
            tournament('small-parent', 1),
            tournament('big-parent', 80),
            tournament('medium-parent', 25),
            { _type: 'TOURNAMENT', id: 'other-sport', sportId: '2', numberOfEvents: 999 },
          ],
        };
      }

      if (topic.endsWith('/big-parent')) {
        return {
          records: [
            tournament('big-child-a', 50),
            tournament('big-child-b', 30),
          ],
        };
      }

      if (topic.endsWith('/medium-parent')) {
        return {
          records: [
            tournament('medium-child', 25),
          ],
        };
      }

      return { records: [] };
    },
  };

  const ids = await discoverGetsBetTournamentIds(client, {
    operatorId: 2476,
    lang: 'ro',
    maxTournaments: 3,
  });

  assert.deepEqual(ids, ['big-child-a', 'big-child-b', 'medium-child']);
  assert.equal(calls.some((topic) => topic.endsWith('/small-parent')), false);
});

function tournament(id, count) {
  return {
    _type: 'TOURNAMENT',
    id,
    name: id,
    sportId: '1',
    numberOfUpcomingMatches: count,
  };
}
