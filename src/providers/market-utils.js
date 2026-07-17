function genericMarketKey(label, { line } = {}) {
  const slug = slugKey(label);
  const embeddedLine = line === undefined ? splitTrailingLine(slug) : null;
  const base = canonicalMarketBase(embeddedLine?.base || slug);
  if (!base) {
    return null;
  }
  const finalLine = line ?? embeddedLine?.line;
  if (isDirectMarketBase(base)) {
    return finalLine ? `${base}_${formatLine(finalLine).replace('.', '_')}` : base;
  }
  return finalLine ? `market_${base}_${formatLine(finalLine).replace('.', '_')}` : `market_${base}`;
}

function handicapMarketKey(baseKey, homeLine) {
  return `${baseKey}_${signedLineKey(homeLine)}`;
}

function signedLineKey(value) {
  const line = Number(value);
  if (!Number.isFinite(line)) {
    return null;
  }
  if (Object.is(line, -0) || line === 0) {
    return '0';
  }
  const prefix = line > 0 ? 'plus' : 'minus';
  return `${prefix}_${formatLine(Math.abs(line)).replace('.', '_')}`;
}

function normalizeOutcomeKey(value) {
  const normalized = normalizeLabel(value);
  const compact = normalized.replace(/\s+/g, '');
  const lineOutcome = normalized.match(/^(peste|over|sub|under)\s+[0-9]+(?:[.,][0-9]+)?$/);
  if (lineOutcome) {
    return ['peste', 'over'].includes(lineOutcome[1]) ? 'over' : 'under';
  }

  const aliases = {
    '1': 'home',
    x: 'draw',
    '2': 'away',
    '1x': 'homeDraw',
    '12': 'homeAway',
    x2: 'drawAway',
    peste: 'over',
    over: 'over',
    '+': 'over',
    sub: 'under',
    under: 'under',
    '-': 'under',
    da: 'yes',
    yes: 'yes',
    nu: 'no',
    no: 'no',
    niciunul: 'none',
    none: 'none',
    nogoal: 'none',
    withoutgoal: 'none',
    impar: 'odd',
    odd: 'odd',
    par: 'even',
    even: 'even',
  };

  return aliases[compact] || slugKey(normalized);
}

function normalizeLabel(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}+\-.]+/gu, ' ')
    .trim();
}

function slugKey(value) {
  return normalizeLabel(value)
    .replace(/[+\-]/g, (match) => (match === '+' ? 'plus' : 'minus'))
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function canonicalMarketBase(value) {
  const firstHalf = '(?:pauza|prima_repriza|repriza_1|1st_half|first_half|half_time)';
  const secondHalf = '(?:a_doua_repriza|repriza_a_doua|repriza_2|2nd_half|second_half)';
  const separator = '(?:_|_minus_)';
  const overUnder = '(?:_(?:peste_sub|over_under|over_sub|sub_peste|under_over))?';
  const asianGoalTotal = '(?:total_(?:goluri|goals)_(?:asiatice|asian)|asian_total_(?:goluri|goals))';
  const asianCornerTotal = '(?:total_(?:cornere|corners)_(?:asiatice|asian)|asian_total_(?:cornere|corners))';
  const asianCardTotal = '(?:total_(?:cartonase|cartonase_galbene|cards|yellow_cards|yellow_card|bookings|booking_points)_(?:asiatice|asian)|asian_total_(?:cartonase|cartonase_galbene|cards|yellow_cards|yellow_card|bookings|booking_points)|(?:cartonase|cartonase_galbene|cards|yellow_cards|yellow_card|bookings|booking_points)_asian_total)';
  const drawNoBet = '(?:draw_no_bet|dnb|no_draw|final_fara_egal|fara_egal|egal_pariul_se_ramburseaza|egal_minus_pariul_se_ramburseaza|egal_pariul_se_ramburseaza_dnb|egal_minus_pariul_se_ramburseaza_dnb|egal_miza_returnata|egal_se_ramburseaza|money_back_draw|draw_money_back)';
  const aliases = [
    [/^(rezultat_)?(final|meci|match|full_time|fulltime|regular_time)(_(rezultat|result|1x2))?$/, 'h2h'],
    [/^(both_teams_to_score|both_teams_score|btts|gg_ng|gg|ambele_echipe_marcheaza|ambele_marcheaza|ambele_marcheaza_gg|ambele_echipe_marcheaza_gg)$/, 'bothTeamsToScore'],
    [new RegExp(`^(?:${firstHalf}${separator}(?:both_teams_to_score|both_teams_score|btts|gg_ng|gg|ambele_echipe_marcheaza|ambele_marcheaza)|(?:both_teams_to_score|both_teams_score|btts|gg_ng|gg|ambele_echipe_marcheaza|ambele_marcheaza)${separator}${firstHalf})$`), 'firstHalfBothTeamsToScore'],
    [new RegExp(`^(?:${secondHalf}${separator}(?:both_teams_to_score|both_teams_score|btts|gg_ng|gg|ambele_echipe_marcheaza|ambele_marcheaza)|(?:both_teams_to_score|both_teams_score|btts|gg_ng|gg|ambele_echipe_marcheaza|ambele_marcheaza)${separator}${secondHalf})$`), 'secondHalfBothTeamsToScore'],
    [/^(half_time_or_full_time|half_time_full_time|pauza_sau_final|pauza_final|castiga_la_pauza_sau_final|castiga_pauza_sau_final)$/, 'halfTimeOrFullTime'],
    [new RegExp(`^(?:${firstHalf}${separator}${asianGoalTotal}|${asianGoalTotal}${separator}${firstHalf})${overUnder}$`), 'firstHalfAsianTotalGoals'],
    [new RegExp(`^(?:${secondHalf}${separator}${asianGoalTotal}|${asianGoalTotal}${separator}${secondHalf})${overUnder}$`), 'secondHalfAsianTotalGoals'],
    [/^(total_)?(goluri|goals)(_(peste_sub|over_under|over_sub|sub_peste|under_over))?$/, 'totalGoals'],
    [/^(total_)?(puncte|points)(_(peste_sub|over_under|over_sub|sub_peste|under_over))?$/, 'totalPoints'],
    [/^(total_)?(jocuri|games)(_(peste_sub|over_under|over_sub|sub_peste|under_over))?$/, 'totalGames'],
    [/^(total_)?(seturi|sets)(_(peste_sub|over_under|over_sub|sub_peste|under_over))?$/, 'totalSets'],
    [/^(total_(goluri|goals)_(asiatice|asian)|asian_total_(goluri|goals))(_(peste_sub|over_under|over_sub|sub_peste|under_over))?$/, 'asianTotalGoals'],
    [/^(rezultat_)?(pauza|prima_repriza|repriza_1|1st_half|first_half|half_time)(_(rezultat|result|1x2))?$/, 'firstHalfH2h'],
    [/^(rezultat_)?(a_doua_repriza|repriza_a_doua|repriza_2|2nd_half|second_half)(_(rezultat|result|1x2))?$/, 'secondHalfH2h'],
    [/^((pauza|prima_repriza|repriza_1|1st_half|first_half|half_time)_(rezultat|result|1x2)|(result|rezultat)_(pauza|prima_repriza|repriza_1|1st_half|first_half|half_time))$/, 'firstHalfH2h'],
    [/^((a_doua_repriza|repriza_a_doua|repriza_2|2nd_half|second_half)_(rezultat|result|1x2)|(result|rezultat)_(a_doua_repriza|repriza_a_doua|repriza_2|2nd_half|second_half))$/, 'secondHalfH2h'],
    [/^(sansa_dubla|double_chance)_(pauza|prima_repriza|repriza_1|1st_half|first_half|half_time)$/, 'firstHalfDoubleChance'],
    [/^(sansa_dubla|double_chance)_(a_doua_repriza|repriza_a_doua|repriza_2|2nd_half|second_half)$/, 'secondHalfDoubleChance'],
    [/^(pauza|prima_repriza|repriza_1|1st_half|first_half|half_time)_(sansa_dubla|double_chance)$/, 'firstHalfDoubleChance'],
    [/^(a_doua_repriza|repriza_a_doua|repriza_2|2nd_half|second_half)_(sansa_dubla|double_chance)$/, 'secondHalfDoubleChance'],
    [/^(sansa_dubla|double_chance)_minus_(pauza|prima_repriza|repriza_1|1st_half|first_half|half_time)$/, 'firstHalfDoubleChance'],
    [/^(sansa_dubla|double_chance)_minus_(a_doua_repriza|repriza_a_doua|repriza_2|2nd_half|second_half)$/, 'secondHalfDoubleChance'],
    [/^(pauza|prima_repriza|repriza_1|1st_half|first_half|half_time)_minus_(sansa_dubla|double_chance)$/, 'firstHalfDoubleChance'],
    [/^(a_doua_repriza|repriza_a_doua|repriza_2|2nd_half|second_half)_minus_(sansa_dubla|double_chance)$/, 'secondHalfDoubleChance'],
    [/^((match|meci)_(minus_)?(sansa_dubla|dubla_sansa|double_chance)|(sansa_dubla|dubla_sansa|double_chance)_(minus_)?(match|meci)|(sansa_dubla|dubla_sansa|double_chance|match_double_chance|match_minus_double_chance))$/, 'doubleChance'],
    [new RegExp(`^(?:${firstHalf}${separator}${drawNoBet}|${drawNoBet}${separator}${firstHalf})$`), 'firstHalfDrawNoBet'],
    [new RegExp(`^(?:${secondHalf}${separator}${drawNoBet}|${drawNoBet}${separator}${secondHalf})$`), 'secondHalfDrawNoBet'],
    [new RegExp(`^${drawNoBet}$`), 'drawNoBet'],
    [/^(total_(goluri|goals)_(repriza_2|repriza_a_doua|a_doua_repriza|2nd_half|second_half)|(repriza_2|repriza_a_doua|a_doua_repriza|2nd_half|second_half)_total_(goluri|goals))(_(peste_sub|over_under|over_sub|sub_peste|under_over))?$/, 'secondHalfTotalGoals'],
    [/^(total_(goluri|goals)_(pauza|prima_repriza|repriza_1|1st_half|first_half|half_time)|(pauza|prima_repriza|repriza_1|1st_half|first_half|half_time)_total_(goluri|goals))(_(peste_sub|over_under|over_sub|sub_peste|under_over))?$/, 'firstHalfTotalGoals'],
    [new RegExp(`^(?:${firstHalf}${separator}${asianCornerTotal}|${asianCornerTotal}${separator}${firstHalf})${overUnder}$`), 'firstHalfAsianTotalCorners'],
    [new RegExp(`^(?:${secondHalf}${separator}${asianCornerTotal}|${asianCornerTotal}${separator}${secondHalf})${overUnder}$`), 'secondHalfAsianTotalCorners'],
    [/^(total_(cornere|corners)_(asiatice|asian)|asian_total_(cornere|corners))(_(peste_sub|over_under|over_sub|sub_peste|under_over))?$/, 'asianTotalCorners'],
    [/^(total_(cornere|corners)_(repriza_2|repriza_a_doua|a_doua_repriza|2nd_half|second_half)|(repriza_2|repriza_a_doua|a_doua_repriza|2nd_half|second_half)_total_(cornere|corners))(_(peste_sub|over_under|over_sub|sub_peste|under_over))?$/, 'secondHalfTotalCorners'],
    [/^(total_(cornere|corners)_(pauza|prima_repriza|repriza_1|1st_half|first_half|half_time)|(pauza|prima_repriza|repriza_1|1st_half|first_half|half_time)_total_(cornere|corners))(_(peste_sub|over_under|over_sub|sub_peste|under_over))?$/, 'firstHalfTotalCorners'],
    [/^(total_)?(cornere|corners)(_(peste_sub|over_under|over_sub|sub_peste|under_over))?$/, 'totalCorners'],
    [new RegExp(`^(?:${firstHalf}${separator}${asianCardTotal}|${asianCardTotal}${separator}${firstHalf})${overUnder}$`), 'firstHalfAsianTotalCards'],
    [new RegExp(`^(?:${secondHalf}${separator}${asianCardTotal}|${asianCardTotal}${separator}${secondHalf})${overUnder}$`), 'secondHalfAsianTotalCards'],
    [/^(total_(cartonase|cartonase_galbene|cards|yellow_cards|yellow_card|bookings|booking_points)_(asiatice|asian)|asian_total_(cartonase|cartonase_galbene|cards|yellow_cards|yellow_card|bookings|booking_points)|(cartonase|cartonase_galbene|cards|yellow_cards|yellow_card|bookings|booking_points)_asian_total)(_?(peste_sub|over_under|over_sub|sub_peste|under_over))?$/, 'asianTotalCards'],
    [/^(total_(cartonase|cartonase_galbene|cards|yellow_cards|yellow_card|bookings|booking_points)_(repriza_2|repriza_a_doua|a_doua_repriza|2nd_half|second_half)|(repriza_2|repriza_a_doua|a_doua_repriza|2nd_half|second_half)_(total_)?(cartonase|cartonase_galbene|cards|yellow_cards|yellow_card|bookings|booking_points))(_(peste_sub|over_under|over_sub|sub_peste|under_over))?$/, 'secondHalfTotalCards'],
    [/^(total_(cartonase|cartonase_galbene|cards|yellow_cards|yellow_card|bookings|booking_points)_(pauza|prima_repriza|repriza_1|1st_half|first_half|half_time)|(pauza|prima_repriza|repriza_1|1st_half|first_half|half_time)_(total_)?(cartonase|cartonase_galbene|cards|yellow_cards|yellow_card|bookings|booking_points))(_(peste_sub|over_under|over_sub|sub_peste|under_over))?$/, 'firstHalfTotalCards'],
    [/^((total_)?(cartonase|cartonase_galbene|cards|yellow_cards|yellow_card|bookings|booking_points)|(cartonase|cartonase_galbene|cards|yellow_cards|yellow_card|bookings|booking_points)_total)(_(peste_sub|over_under|over_sub|sub_peste|under_over))?$/, 'totalCards'],
    [/^(home|gazde|echipa_1|team_1)_total_(goluri|goals)$/, 'total_goluri_home'],
    [/^(away|oaspeti|echipa_2|team_2)_total_(goluri|goals)$/, 'total_goluri_away'],
    [/^total_(goluri|goals)_(home|gazde|echipa_1|team_1)$/, 'total_goluri_home'],
    [/^total_(goluri|goals)_(away|oaspeti|echipa_2|team_2)$/, 'total_goluri_away'],
    [/^(home|gazde|gazda|echipa_gazda|echipa_1|team_1|home_team)_(sa_marcheze|marcheaza|to_score|scores|score)$/, 'marcheaza_home'],
    [/^(away|oaspeti|oaspete|echipa_oaspete|echipa_2|team_2|away_team)_(sa_marcheze|marcheaza|to_score|scores|score)$/, 'marcheaza_away'],
    [/^(sa_marcheze|marcheaza|to_score|scores|score)_(home|gazde|gazda|echipa_gazda|echipa_1|team_1|home_team)$/, 'marcheaza_home'],
    [/^(sa_marcheze|marcheaza|to_score|scores|score)_(away|oaspeti|oaspete|echipa_oaspete|echipa_2|team_2|away_team)$/, 'marcheaza_away'],
    [/^(home|gazde|gazda|echipa_gazda|echipa_1|team_1|home_team)_(clean_sheet|fara_gol_primit)$/, 'clean_sheet_home'],
    [/^(away|oaspeti|oaspete|echipa_oaspete|echipa_2|team_2|away_team)_(clean_sheet|fara_gol_primit)$/, 'clean_sheet_away'],
    [/^(clean_sheet|fara_gol_primit)_(home|gazde|gazda|echipa_gazda|echipa_1|team_1|home_team)$/, 'clean_sheet_home'],
    [/^(clean_sheet|fara_gol_primit)_(away|oaspeti|oaspete|echipa_oaspete|echipa_2|team_2|away_team)$/, 'clean_sheet_away'],
    [/^((total_)?(goluri|goals)_(par_impar|impar_par|odd_even|even_odd)|(par_impar|impar_par|odd_even|even_odd)_(goluri|goals))$/, 'total_goluri_impar_par'],
    [/^(home|gazde|echipa_1|team_1)_sa_castige_cel_putin_o_repriza$/, 'castiga_oricare_repriza_home'],
    [/^(away|oaspeti|echipa_2|team_2)_sa_castige_cel_putin_o_repriza$/, 'castiga_oricare_repriza_away'],
  ];

  for (const [pattern, replacement] of aliases) {
    if (pattern.test(value)) {
      return replacement;
    }
  }
  return value;
}

function isDirectMarketBase(value) {
  return [
    'totalGoals',
    'totalPoints',
    'totalGames',
    'totalSets',
    'asianTotalGoals',
    'h2h',
    'bothTeamsToScore',
    'firstHalfBothTeamsToScore',
    'secondHalfBothTeamsToScore',
    'halfTimeOrFullTime',
    'drawNoBet',
    'firstHalfDrawNoBet',
    'secondHalfDrawNoBet',
    'doubleChance',
    'firstHalfH2h',
    'secondHalfH2h',
    'firstHalfDoubleChance',
    'secondHalfDoubleChance',
    'firstHalfTotalGoals',
    'secondHalfTotalGoals',
    'firstHalfAsianTotalGoals',
    'secondHalfAsianTotalGoals',
    'asianTotalCorners',
    'totalCorners',
    'firstHalfTotalCorners',
    'secondHalfTotalCorners',
    'firstHalfAsianTotalCorners',
    'secondHalfAsianTotalCorners',
    'asianTotalCards',
    'totalCards',
    'firstHalfTotalCards',
    'secondHalfTotalCards',
    'firstHalfAsianTotalCards',
    'secondHalfAsianTotalCards',
  ].includes(value);
}

function splitTrailingLine(value) {
  const match = String(value || '').match(/^(.*?)(?:_([0-9]+)_([0-9]+)|_([0-9]+))$/);
  if (!match) {
    return null;
  }

  const base = match[1];
  const line = match[4] ? `${match[4]}.0` : `${match[2]}.${match[3]}`;
  const canonicalBase = canonicalMarketBase(base);
  if (!isLineCompatibleBase(canonicalBase)) {
    return null;
  }

  return { base, line };
}

function isLineCompatibleBase(value) {
  return isDirectMarketBase(value) || [
    'total_goluri_home',
    'total_goluri_away',
  ].includes(value);
}

function formatLine(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return String(value || '').trim();
  }
  if (Number.isInteger(number)) {
    return number.toFixed(0);
  }
  return Number.isInteger(number * 2) ? number.toFixed(1) : number.toFixed(2);
}

function hasCompleteOutcomes(prices) {
  const values = Object.values(prices || {});
  return values.length >= 2 && values.length <= 3 && values.every(isDecimalOdds);
}

function hasAnyCompleteMarket(markets) {
  return Object.values(markets || {}).some((prices) => {
    const values = Object.values(prices || {}).filter(isDecimalOdds);
    return values.length >= 2;
  });
}

function splitFixtureName(value) {
  const label = String(value || '').trim();
  for (const separator of [
    /\s+vs?\.?\s+/i,
    /\s+[-\u2013\u2014]\s+/,
    /\s*\u00c2?\u00b7\s*/,
  ]) {
    const parts = label.split(separator).map((part) => part.trim()).filter(Boolean);
    if (parts.length === 2) {
      return parts;
    }
  }
  return [];
}

function isDecimalOdds(value) {
  return Number.isFinite(value) && value > 1;
}

function isMatchDoubleChanceKey(value) {
  const key = canonicalDescriptorKey(value);
  return key === 'double_chance' || key === 'match_double_chance';
}

function isMatchDoubleChanceLabel(value) {
  const key = canonicalDescriptorKey(value);
  return key === 'sansa_dubla' || key === 'double_chance';
}

function isMatchHandicapKey(value) {
  const key = canonicalDescriptorKey(value);
  return ['handicap', 'asian_handicap', 'handicap_asian_handicap'].includes(key);
}

function isMatchBothTeamsToScoreLabel(value) {
  const key = canonicalDescriptorKey(value);
  return [
    'ambele_echipe_marcheaza',
    'ambele_echipe_marcheaza_gg',
    'both_teams_to_score',
    'gg',
  ].includes(key);
}

function isMatchDrawNoBetLabel(value) {
  const key = canonicalDescriptorKey(value);
  return ['dnb', 'draw_no_bet', 'egal_pariul_se_ramburseaza_dnb'].includes(key);
}

function isMatchTotalCornersKey(value) {
  const key = canonicalDescriptorKey(value);
  return key === 'total_corners' || key === 'match_total_corners';
}

function canonicalDescriptorKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

module.exports = {
  formatLine,
  hasAnyCompleteMarket,
  genericMarketKey,
  handicapMarketKey,
  hasCompleteOutcomes,
  isDecimalOdds,
  isMatchDoubleChanceKey,
  isMatchDoubleChanceLabel,
  isMatchHandicapKey,
  isMatchBothTeamsToScoreLabel,
  isMatchDrawNoBetLabel,
  isMatchTotalCornersKey,
  normalizeOutcomeKey,
  splitFixtureName,
  signedLineKey,
  slugKey,
};
