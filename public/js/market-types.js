export const MARKET_TYPES = Object.freeze([
  { key: 'result', label: '1X2 / Result' },
  { key: 'doubleChance', label: 'Double Chance' },
  { key: 'drawNoBet', label: 'Draw No Bet' },
  { key: 'btts', label: 'BTTS' },
  { key: 'goalsTotals', label: 'Goals Totals' },
  { key: 'cornersTotals', label: 'Corners Totals' },
  { key: 'cardsTotals', label: 'Cards Totals' },
  { key: 'handicap', label: 'Handicap' },
  { key: 'teamGoals', label: 'Team Goals / Team Score' },
  { key: 'crossMarket', label: 'Cross-Market' },
  { key: 'other', label: 'Other' },
]);

export const MARKET_TYPE_KEYS = Object.freeze(MARKET_TYPES.map((type) => type.key));

const MARKET_TYPE_LABELS = Object.freeze(
  Object.fromEntries(MARKET_TYPES.map((type) => [type.key, type.label])),
);

export function marketTypeLabel(key) {
  return MARKET_TYPE_LABELS[key] || MARKET_TYPE_LABELS.other;
}

export function classifyOpportunityMarketType(opp = {}) {
  const type = String(opp.type || '');
  const key = String(opp.marketKey || '');
  if (type === 'settlement-formula') {
    return String(opp.formulaFamily || '').startsWith('total')
      || opp.formulaFamily === 'asian-total-pair'
      ? 'goalsTotals'
      : 'crossMarket';
  }
  if (type === 'cross-market' || /^cross(?:_|$)/i.test(key)) return 'crossMarket';

  const signals = collectOpportunitySignals(opp);
  for (const signal of signals) {
    const classified = classifyMarketSignal(signal);
    if (classified) return classified;
  }
  return 'other';
}

export function classifyMarketSignal(value) {
  const text = normalizeMarketSignal(value);
  if (!text) return null;

  if (hasAny(text, [
    'teamgoal', 'teamscore', 'totalgolurihome', 'totalgoluriaway',
    'totalgoalshome', 'totalgoalsaway', 'marcheazahome', 'marcheazaaway',
    'cleansheethome', 'cleansheetaway', 'homescore', 'awayscore',
  ])) return 'teamGoals';

  if (hasAny(text, ['doublechance', 'sansadubla', 'dublasansa'])) return 'doubleChance';
  if (hasAny(text, ['drawnobet', 'dnb', 'faraegal', 'noraw', 'moneybackdraw'])) return 'drawNoBet';
  if (hasAny(text, ['bothteamstoscore', 'btts', 'ambeleechipemarcheaza', 'ambelemarcheaza', 'ggng'])) return 'btts';
  if (hasAny(text, ['totalcorners', 'asiantotalcorners', 'cornertotal', 'cornere', 'corners'])) return 'cornersTotals';
  if (hasAny(text, ['totalcards', 'asiantotalcards', 'cardstotal', 'cartonase', 'yellowcards', 'bookings'])) return 'cardsTotals';
  if (hasAny(text, ['handicap', 'asianhandicap'])) return 'handicap';
  if (hasAny(text, ['totalgoals', 'asiantotalgoals', 'goalstotal', 'totalgoluri', 'goalsmiddle', 'goluri'])) return 'goalsTotals';
  if (hasAny(text, ['h2h', '1x2', 'matchwinner', 'winner1x2', 'rezultatfinal', 'fulltimeresult', 'finalresult'])) return 'result';
  if (hasAny(text, ['crossmarket', 'cross'])) return 'crossMarket';

  return null;
}

function collectOpportunitySignals(opp) {
  const primary = [opp.marketKey, opp.marketLabel, opp.marketFamilyLabel, opp.marketDescription];
  const legs = (opp.legs || []).flatMap((leg) => [
    leg.marketKey,
    leg.marketLabel,
    leg.label,
    leg.outcome,
  ]);
  return opp.type === 'middle' ? [...legs, ...primary] : [...primary, ...legs];
}

function normalizeMarketSignal(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function hasAny(text, needles) {
  return needles.some((needle) => text.includes(needle));
}
