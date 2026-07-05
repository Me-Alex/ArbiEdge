const test = require('node:test');
const assert = require('node:assert/strict');

const {
  formatLine,
  genericMarketKey,
  handicapMarketKey,
  hasAnyCompleteMarket,
  hasCompleteOutcomes,
  isDecimalOdds,
  isMatchBothTeamsToScoreLabel,
  isMatchDrawNoBetLabel,
  isMatchDoubleChanceKey,
  isMatchDoubleChanceLabel,
  isMatchHandicapKey,
  isMatchTotalCornersKey,
  normalizeOutcomeKey,
  splitFixtureName,
} = require('../src/providers/market-utils');

test('canonicalizes generic team market labels across bookmaker wording', () => {
  assert.equal(
    genericMarketKey('Home total goluri', { line: 1.5 }),
    'market_total_goluri_home_1_5',
  );
  assert.equal(
    genericMarketKey('Gazde total goluri', { line: 1.5 }),
    'market_total_goluri_home_1_5',
  );
  assert.equal(genericMarketKey('Away sa marcheze'), 'market_marcheaza_away');
  assert.equal(genericMarketKey('Home scores'), 'market_marcheaza_home');
  assert.equal(genericMarketKey('Home team to score'), 'market_marcheaza_home');
  assert.equal(genericMarketKey('Echipa gazda marcheaza'), 'market_marcheaza_home');
  assert.equal(genericMarketKey('Away team scores'), 'market_marcheaza_away');
  assert.equal(genericMarketKey('Oaspeti marcheaza'), 'market_marcheaza_away');
  assert.equal(genericMarketKey('Home clean sheet'), 'market_clean_sheet_home');
  assert.equal(genericMarketKey('Gazde fara gol primit'), 'market_clean_sheet_home');
  assert.equal(genericMarketKey('Away team clean sheet'), 'market_clean_sheet_away');
  assert.equal(genericMarketKey('Fara gol primit oaspeti'), 'market_clean_sheet_away');
  assert.equal(genericMarketKey('Total goluri par/impar'), 'market_total_goluri_impar_par');
  assert.equal(genericMarketKey('Both teams to score'), 'bothTeamsToScore');
  assert.equal(genericMarketKey('Ambele echipe marcheaza'), 'bothTeamsToScore');
  assert.equal(genericMarketKey('Half time or full time'), 'halfTimeOrFullTime');
  assert.equal(genericMarketKey('Pauza sau final'), 'halfTimeOrFullTime');
  assert.equal(genericMarketKey('Total goals odd even'), 'market_total_goluri_impar_par');
});

test('canonicalizes period, corner, and card markets to scanner keys', () => {
  assert.equal(genericMarketKey('Match result'), 'h2h');
  assert.equal(genericMarketKey('Full time result'), 'h2h');
  assert.equal(genericMarketKey('Result 1st half'), 'firstHalfH2h');
  assert.equal(genericMarketKey('Second half result'), 'secondHalfH2h');
  assert.equal(genericMarketKey('Repriza a doua rezultat'), 'secondHalfH2h');
  assert.equal(genericMarketKey('Sansa dubla'), 'doubleChance');
  assert.equal(genericMarketKey('Double chance'), 'doubleChance');
  assert.equal(genericMarketKey('Match double chance'), 'doubleChance');
  assert.equal(genericMarketKey('Draw no bet'), 'drawNoBet');
  assert.equal(genericMarketKey('DNB'), 'drawNoBet');
  assert.equal(genericMarketKey('Final fara egal'), 'drawNoBet');
  assert.equal(genericMarketKey('Egal - Pariul se ramburseaza (DNB)'), 'drawNoBet');
  assert.equal(genericMarketKey('Prima repriza - Egal - Pariul se ramburseaza (DNB)'), 'firstHalfDrawNoBet');
  assert.equal(genericMarketKey('Second half draw no bet'), 'secondHalfDrawNoBet');
  assert.equal(genericMarketKey('Prima repriza - Sansa dubla'), 'firstHalfDoubleChance');
  assert.equal(genericMarketKey('Second half double chance'), 'secondHalfDoubleChance');
  assert.equal(genericMarketKey('Total goals second half', { line: 1.5 }), 'secondHalfTotalGoals_1_5');
  assert.equal(genericMarketKey('Total goals 2.5'), 'totalGoals_2_5');
  assert.equal(genericMarketKey('Total goluri peste/sub', { line: 2.5 }), 'totalGoals_2_5');
  assert.equal(genericMarketKey('Prima repriza total goluri peste/sub', { line: 1.5 }), 'firstHalfTotalGoals_1_5');
  assert.equal(genericMarketKey('Asian total goals 2.25'), 'asianTotalGoals_2_25');
  assert.equal(genericMarketKey('First half Asian total goals 1.25'), 'firstHalfAsianTotalGoals_1_25');
  assert.equal(genericMarketKey('Prima repriza total goluri asiatice', { line: 1.25 }), 'firstHalfAsianTotalGoals_1_25');
  assert.equal(genericMarketKey('Asian total goals second half', { line: 1.25 }), 'secondHalfAsianTotalGoals_1_25');
  assert.equal(genericMarketKey('Total corners', { line: 9.5 }), 'totalCorners_9_5');
  assert.equal(genericMarketKey('Cornere peste/sub', { line: 9.5 }), 'totalCorners_9_5');
  assert.equal(genericMarketKey('First half total corners', { line: 4.5 }), 'firstHalfTotalCorners_4_5');
  assert.equal(genericMarketKey('Asian total corners 9.25'), 'asianTotalCorners_9_25');
  assert.equal(genericMarketKey('First half Asian total corners', { line: 4.25 }), 'firstHalfAsianTotalCorners_4_25');
  assert.equal(genericMarketKey('Asian total corners second half', { line: 4.25 }), 'secondHalfAsianTotalCorners_4_25');
  assert.equal(genericMarketKey('Total cards', { line: 4.5 }), 'totalCards_4_5');
  assert.equal(genericMarketKey('Total cartonase galbene peste/sub', { line: 4.5 }), 'totalCards_4_5');
  assert.equal(genericMarketKey('Second half total yellow cards', { line: 2.5 }), 'secondHalfTotalCards_2_5');
  assert.equal(genericMarketKey('First half Asian total cards', { line: 2.25 }), 'firstHalfAsianTotalCards_2_25');
  assert.equal(genericMarketKey('Asian total yellow cards second half', { line: 2.25 }), 'secondHalfAsianTotalCards_2_25');
  assert.equal(genericMarketKey('Bookings over/under 4.5'), 'totalCards_4_5');
  assert.equal(genericMarketKey('Yellow card total 4.5'), 'totalCards_4_5');
  assert.equal(genericMarketKey('First half booking points over/under', { line: 20.5 }), 'firstHalfTotalCards_20_5');
});

test('canonicalizes simple line outcomes to over and under', () => {
  assert.equal(normalizeOutcomeKey('Peste 1.5'), 'over');
  assert.equal(normalizeOutcomeKey('Sub 1.5'), 'under');
  assert.equal(normalizeOutcomeKey('Over 2.5'), 'over');
  assert.equal(normalizeOutcomeKey('Under 2.5'), 'under');
});

test('splits fixture names across common bookmaker separators', () => {
  assert.deepEqual(splitFixtureName('Uruguay - Capul Verde'), ['Uruguay', 'Capul Verde']);
  assert.deepEqual(splitFixtureName('Uruguay vs Capul Verde'), ['Uruguay', 'Capul Verde']);
  assert.deepEqual(splitFixtureName('Uruguay v. Capul Verde'), ['Uruguay', 'Capul Verde']);
  assert.deepEqual(splitFixtureName(`Uruguay ${String.fromCharCode(0x2013)} Capul Verde`), [
    'Uruguay',
    'Capul Verde',
  ]);
  assert.deepEqual(splitFixtureName('UruguayÂ·Capul Verde'), ['Uruguay', 'Capul Verde']);
});

test('canonicalizes odd and even outcomes across languages', () => {
  assert.equal(normalizeOutcomeKey('Impar'), 'odd');
  assert.equal(normalizeOutcomeKey('Odd'), 'odd');
  assert.equal(normalizeOutcomeKey('Par'), 'even');
  assert.equal(normalizeOutcomeKey('Even'), 'even');
});

test('preserves quarter Asian lines for formula scanning', () => {
  assert.equal(formatLine(0.25), '0.25');
  assert.equal(formatLine(1.75), '1.75');
  assert.equal(formatLine(2.5), '2.5');
  assert.equal(handicapMarketKey('asianHandicap', 0.25), 'asianHandicap_plus_0_25');
  assert.equal(handicapMarketKey('asianHandicap', -0.25), 'asianHandicap_minus_0_25');
});

test('accepts only valid decimal odds', () => {
  assert.equal(isDecimalOdds(1.01), true);
  assert.equal(isDecimalOdds(1), false);
  assert.equal(isDecimalOdds(0), false);
  assert.equal(isDecimalOdds(Number.NaN), false);

  assert.equal(hasCompleteOutcomes({ home: 1.8, away: 2.1 }), true);
  assert.equal(hasCompleteOutcomes({ home: 0, away: 2.1 }), false);

  assert.equal(hasAnyCompleteMarket({ totalGoals_2_5: { over: 1.9, under: 1.95 } }), true);
  assert.equal(hasAnyCompleteMarket({ totalGoals_2_5: { over: 1.9 } }), false);
  assert.equal(hasAnyCompleteMarket({ totalGoals_2_5: { over: 1.9, under: 1 } }), false);
});

test('matches only full-match double chance keys', () => {
  assert.equal(isMatchDoubleChanceKey('match_-_double_chance'), true);
  assert.equal(isMatchDoubleChanceKey('double_chance'), true);
  assert.equal(isMatchDoubleChanceKey('1st_half_-_double_chance'), false);
});

test('matches only full-match labels for special markets', () => {
  assert.equal(isMatchDoubleChanceLabel('Sansa dubla'), true);
  assert.equal(isMatchDoubleChanceLabel('Șansă dublă'), true);
  assert.equal(isMatchDoubleChanceLabel('Prima repriza - Sansa dubla'), false);
  assert.equal(isMatchDoubleChanceLabel('Sansa dubla & Total goluri'), false);

  assert.equal(isMatchHandicapKey('handicap_/_asian_handicap'), true);
  assert.equal(isMatchHandicapKey('asian_handicap'), true);
  assert.equal(isMatchHandicapKey('1st_half_handicap'), false);

  assert.equal(isMatchBothTeamsToScoreLabel('Ambele echipe marcheaza (GG)'), true);
  assert.equal(isMatchBothTeamsToScoreLabel('Both teams to score'), true);
  assert.equal(isMatchBothTeamsToScoreLabel('Prima repriza - Ambele echipe marcheaza (GG)'), false);

  assert.equal(isMatchDrawNoBetLabel('Egal - Pariul se ramburseaza (DNB)'), true);
  assert.equal(isMatchDrawNoBetLabel('Prima repriza - Egal - Pariul se ramburseaza (DNB)'), false);

  assert.equal(isMatchTotalCornersKey('total_corners'), true);
  assert.equal(isMatchTotalCornersKey('1st_half_total_corners'), false);
});
