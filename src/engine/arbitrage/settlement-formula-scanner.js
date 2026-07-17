'use strict';

const EPSILON = 1e-9;
const DEFAULT_STAKE = 100;
const DEFAULT_MAX_EDGE = 0.25;

function lineKey(line) {
  return Number(line).toFixed(2);
}

function formatLine(line) {
  const value = Number(line);
  if (Math.abs(value) < EPSILON) return '0';

  const absolute = Math.abs(value);
  const decimals = Math.abs(absolute * 2 - Math.round(absolute * 2)) < EPSILON ? 1 : 2;
  return `${value > 0 ? '+' : '-'}${absolute.toFixed(decimals).replace(/\.0$/, '')}`;
}

function formatTotalLine(line) {
  return Number(line).toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function definitionToken(value) {
  return formatLine(value).replace('+', 'p').replace('-', 'm').replace('.', '_');
}

function selection(kind, label, details = {}) {
  return { kind, label, ...details };
}

function resultHandicapDefinitions(line) {
  const formatted = formatLine(line);
  const token = definitionToken(line);

  return [
    {
      id: `ah1_${token}_x_2`,
      family: 'result-handicap',
      label: `AH1(${formatted}) - X - 2`,
      selections: [
        selection('handicap', `AH1(${formatted})`, { side: 'home', line }),
        selection('h2h', 'X', { outcome: 'draw' }),
        selection('h2h', '2', { outcome: 'away' }),
      ],
    },
    {
      id: `ah2_${token}_x_1`,
      family: 'result-handicap',
      label: `AH2(${formatted}) - X - 1`,
      selections: [
        selection('handicap', `AH2(${formatted})`, { side: 'away', line }),
        selection('h2h', 'X', { outcome: 'draw' }),
        selection('h2h', '1', { outcome: 'home' }),
      ],
    },
    {
      id: `ah1_${token}_x2_2`,
      family: 'result-handicap',
      label: `AH1(${formatted}) - X2 - 2`,
      selections: [
        selection('handicap', `AH1(${formatted})`, { side: 'home', line }),
        selection('doubleChance', 'X2', { outcome: 'drawAway' }),
        selection('h2h', '2', { outcome: 'away' }),
      ],
    },
    {
      id: `ah2_${token}_1x_1`,
      family: 'result-handicap',
      label: `AH2(${formatted}) - 1X - 1`,
      selections: [
        selection('handicap', `AH2(${formatted})`, { side: 'away', line }),
        selection('doubleChance', '1X', { outcome: 'homeDraw' }),
        selection('h2h', '1', { outcome: 'home' }),
      ],
    },
  ];
}

function handicapBridgeDefinitions(line) {
  const formatted = formatLine(line);
  const token = definitionToken(line);

  return [
    {
      id: `ah1_${token}_x_ah2_0`,
      family: 'handicap-bridge',
      label: `AH1(${formatted}) - X - AH2(0)`,
      selections: [
        selection('handicap', `AH1(${formatted})`, { side: 'home', line }),
        selection('h2h', 'X', { outcome: 'draw' }),
        selection('handicap', 'AH2(0)', { side: 'away', line: 0 }),
      ],
    },
    {
      id: `ah2_${token}_x_ah1_0`,
      family: 'handicap-bridge',
      label: `AH2(${formatted}) - X - AH1(0)`,
      selections: [
        selection('handicap', `AH2(${formatted})`, { side: 'away', line }),
        selection('h2h', 'X', { outcome: 'draw' }),
        selection('handicap', 'AH1(0)', { side: 'home', line: 0 }),
      ],
    },
  ];
}

function totalsBandDefinitions(anchor) {
  const low = anchor - 0.5;
  const high = anchor + 0.5;
  const quarterLow = anchor - 0.25;
  const quarterHigh = anchor + 0.25;

  const over = (line) => selection('totalGoals', `Over ${formatTotalLine(line)}`, { outcome: 'over', line });
  const under = (line) => selection('totalGoals', `Under ${formatTotalLine(line)}`, { outcome: 'under', line });
  const create = (id, selections) => ({
    id: `totals_${definitionToken(anchor)}_${id}`,
    family: 'totals-band',
    label: selections.map((item) => item.label).join(' - '),
    selections,
  });

  return [
    create('over_integer', [over(anchor), under(high), under(low)]),
    create('under_integer', [under(anchor), over(low), over(high)]),
    create('over_quarter_high', [over(quarterHigh), under(high), under(low)]),
    create('under_quarter_low', [under(quarterLow), over(low), over(high)]),
    create('over_quarter_low', [over(quarterLow), under(high), under(low)]),
    create('under_quarter_high', [under(quarterHigh), over(low), over(high)]),
  ];
}

function resultSubstitutionDefinitions(options = {}) {
  const handicapDoubleChanceLines = options.handicapDoubleChanceLines
    || [-2, -1.5, -1.25, -1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
  const halfHandicapLines = options.halfHandicapLines
    || [0.5, 1.5, 2.5, 3.5, -0.5, -1.5, -2.5, -3.5];
  const ah = (side, line) => selection(
    'handicap',
    `AH${side === 'home' ? '1' : '2'}(${formatLine(line)})`,
    { side, line },
  );

  const definitions = [
    {
      id: 'result_home_x_ah2_0',
      family: 'result-dnb',
      label: '1 - X - AH2(0)',
      selections: [
        selection('h2h', '1', { outcome: 'home' }),
        selection('h2h', 'X', { outcome: 'draw' }),
        ah('away', 0),
      ],
    },
    {
      id: 'result_away_x_ah1_0',
      family: 'result-dnb',
      label: '2 - X - AH1(0)',
      selections: [
        selection('h2h', '2', { outcome: 'away' }),
        selection('h2h', 'X', { outcome: 'draw' }),
        ah('home', 0),
      ],
    },
    {
      id: 'ah1_0_x_ah2_0',
      family: 'result-dnb',
      label: 'AH1(0) - X - AH2(0)',
      selections: [ah('home', 0), selection('h2h', 'X', { outcome: 'draw' }), ah('away', 0)],
    },
    {
      id: 'dc_1x_ah2_m0_5',
      family: 'double-chance-handicap',
      label: '1X - AH2(-0.5)',
      selections: [selection('doubleChance', '1X', { outcome: 'homeDraw' }), ah('away', -0.5)],
    },
    {
      id: 'dc_x2_ah1_m0_5',
      family: 'double-chance-handicap',
      label: 'X2 - AH1(-0.5)',
      selections: [selection('doubleChance', 'X2', { outcome: 'drawAway' }), ah('home', -0.5)],
    },
    {
      id: 'dc_12_x',
      family: 'double-chance-result',
      label: '12 - X',
      selections: [
        selection('doubleChance', '12', { outcome: 'homeAway' }),
        selection('h2h', 'X', { outcome: 'draw' }),
      ],
    },
    {
      id: 'dc_1x_2',
      family: 'double-chance-result',
      label: '1X - 2',
      selections: [
        selection('doubleChance', '1X', { outcome: 'homeDraw' }),
        selection('h2h', '2', { outcome: 'away' }),
      ],
    },
    {
      id: 'dc_x2_1',
      family: 'double-chance-result',
      label: 'X2 - 1',
      selections: [
        selection('doubleChance', 'X2', { outcome: 'drawAway' }),
        selection('h2h', '1', { outcome: 'home' }),
      ],
    },
  ];

  for (const line of halfHandicapLines) {
    const formatted = formatLine(line);
    const token = definitionToken(line);
    // 1 vs AH2(+0.5) style halves: exhaustive for home win vs not.
    if (line > 0) {
      definitions.push(
        {
          id: `result_home_ah2_${token}`,
          family: 'result-half-handicap',
          label: `1 - AH2(${formatted})`,
          selections: [selection('h2h', '1', { outcome: 'home' }), ah('away', line)],
        },
        {
          id: `result_away_ah1_${token}`,
          family: 'result-half-handicap',
          label: `2 - AH1(${formatted})`,
          selections: [selection('h2h', '2', { outcome: 'away' }), ah('home', line)],
        },
      );
    } else {
      definitions.push({
        id: `draw_ah1_${token}_ah2_${token}`,
        family: 'result-half-handicap',
        label: `X - AH1(${formatted}) - AH2(${formatted})`,
        selections: [
          selection('h2h', 'X', { outcome: 'draw' }),
          ah('home', line),
          ah('away', line),
        ],
      });
    }
  }

  for (const line of handicapDoubleChanceLines) {
    const formatted = formatLine(line);
    const token = definitionToken(line);
    definitions.push(
      {
        id: `ah1_${token}_x2`,
        family: 'handicap-double-chance',
        label: `AH1(${formatted}) - X2`,
        selections: [ah('home', line), selection('doubleChance', 'X2', { outcome: 'drawAway' })],
      },
      {
        id: `ah2_${token}_1x`,
        family: 'handicap-double-chance',
        label: `AH2(${formatted}) - 1X`,
        selections: [ah('away', line), selection('doubleChance', '1X', { outcome: 'homeDraw' })],
      },
    );
  }

  return definitions;
}

function isQuarterLine(line) {
  const quarterUnits = Math.round(Number(line) * 4);
  return Math.abs(Number(line) * 4 - quarterUnits) < EPSILON && Math.abs(quarterUnits) % 2 === 1;
}

function uniqueSortedLines(lines) {
  return [...new Set((lines || [])
    .map(Number)
    .filter((line) => Number.isFinite(line) && Math.abs(line) <= 20)
    .map((line) => Number(line.toFixed(2))))]
    .sort((a, b) => a - b);
}

/**
 * Builds additional exhaustive families from the exact Asian lines available
 * on an event. The score-state solver remains the authority: a definition is
 * emitted here, but it becomes an opportunity only if every state is covered
 * with a strictly positive worst-case return.
 */
function createAdditionalFormulaDefinitions(options = {}) {
  const handicapLines = uniqueSortedLines(options.handicapLines);
  const totalLines = uniqueSortedLines(options.totalLines).filter((line) => line >= 0);
  const definitions = resultSubstitutionDefinitions(options);

  // Opposite quarter lines can have half-win/half-loss returns at the boundary.
  // Whole-line pairs are omitted because their shared push can never return a
  // strictly positive guaranteed profit; half lines are handled by classic arb.
  for (const homeLine of handicapLines) {
    for (const awayLine of handicapLines) {
      const corridorWidth = homeLine + awayLine;
      if (corridorWidth < -EPSILON || corridorWidth > 1 + EPSILON) continue;
      if (Math.abs(corridorWidth) < EPSILON && !isQuarterLine(homeLine)) continue;
      const homeLabel = `AH1(${formatLine(homeLine)})`;
      const awayLabel = `AH2(${formatLine(awayLine)})`;
      definitions.push({
        id: `ah_pair_${definitionToken(homeLine)}_${definitionToken(awayLine)}`,
        family: corridorWidth > EPSILON ? 'handicap-corridor' : 'asian-handicap-pair',
        label: `${homeLabel} - ${awayLabel}`,
        selections: [
          selection('handicap', homeLabel, { side: 'home', line: homeLine }),
          selection('handicap', awayLabel, { side: 'away', line: awayLine }),
        ],
      });
    }
  }

  for (const totalLine of totalLines.filter(isQuarterLine)) {
    const formatted = formatTotalLine(totalLine);
    definitions.push({
      id: `asian_total_pair_${definitionToken(totalLine)}`,
      family: 'asian-total-pair',
      label: `Over ${formatted} - Under ${formatted}`,
      selections: [
        selection('totalGoals', `Over ${formatted}`, { outcome: 'over', line: totalLine }),
        selection('totalGoals', `Under ${formatted}`, { outcome: 'under', line: totalLine }),
      ],
    });
  }

  for (const lowerLine of totalLines) {
    for (const upperLine of totalLines) {
      const width = upperLine - lowerLine;
      if (width <= EPSILON || width > 1 + EPSILON) continue;
      const lowerLabel = formatTotalLine(lowerLine);
      const upperLabel = formatTotalLine(upperLine);
      definitions.push({
        id: `totals_corridor_${definitionToken(lowerLine)}_${definitionToken(upperLine)}`,
        family: 'totals-corridor',
        label: `Over ${lowerLabel} - Under ${upperLabel}`,
        selections: [
          selection('totalGoals', `Over ${lowerLabel}`, { outcome: 'over', line: lowerLine }),
          selection('totalGoals', `Under ${upperLabel}`, { outcome: 'under', line: upperLine }),
        ],
      });
    }
  }

  return definitions;
}

/**
 * Returns the formula families shown in the scanner selector. Totals anchors are
 * generated rather than hard-coded so the same settlement logic works for any
 * football total that providers expose.
 */
function createSettlementFormulaDefinitions(options = {}) {
  // Wider default line grid → more formula candidates when books post those lines.
  const handicapLines = options.handicapLines || [
    -2.5, -2, -1.75, -1.5, -1.25, -1, -0.75, -0.5, -0.25, 0,
    0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5,
  ];
  const bridgeLines = options.bridgeLines || [
    -1.5, -1.25, -1, -0.75, -0.5, -0.25, 0.25, 0.5, 0.75, 1, 1.25, 1.5,
  ];
  // 1.0 … 10.5 in half-goal steps (skip 0.5 anchor — band uses anchor±0.5).
  const totalsAnchors = options.totalsAnchors
    || Array.from({ length: 20 }, (_, index) => index * 0.5 + 1); // 1 … 10.5

  return [
    ...handicapLines.flatMap(resultHandicapDefinitions),
    ...bridgeLines.flatMap(handicapBridgeDefinitions),
    ...totalsAnchors.flatMap(totalsBandDefinitions),
  ];
}

/** Quarter Asian lines are settled as two equal half-stakes on adjacent lines. */
function splitAsianLine(line) {
  const numeric = Number(line);
  const quarterUnits = Math.round(numeric * 4);
  if (Math.abs(numeric * 4 - quarterUnits) > EPSILON || Math.abs(quarterUnits) % 2 === 0) {
    return [numeric];
  }
  return [(quarterUnits - 1) / 4, (quarterUnits + 1) / 4];
}

function settleMargin(margin, odds) {
  if (margin > EPSILON) return odds;
  if (margin < -EPSILON) return 0;
  return 1;
}

/** Returns gross return per unit staked for one selection in one score state. */
function settlementReturnMultiplier(selectionSpec, state, odds) {
  const price = Number(odds);
  if (!Number.isFinite(price) || price <= 1) return 0;

  if (selectionSpec.kind === 'h2h') {
    const goalDifference = state.goalDifference;
    const wins = selectionSpec.outcome === 'home'
      ? goalDifference > 0
      : selectionSpec.outcome === 'away'
        ? goalDifference < 0
        : goalDifference === 0;
    return wins ? price : 0;
  }

  if (selectionSpec.kind === 'doubleChance') {
    const goalDifference = state.goalDifference;
    const wins = selectionSpec.outcome === 'homeDraw'
      ? goalDifference >= 0
      : selectionSpec.outcome === 'drawAway'
        ? goalDifference <= 0
        : goalDifference !== 0;
    return wins ? price : 0;
  }

  if (selectionSpec.kind === 'handicap') {
    const teamDifference = selectionSpec.side === 'home'
      ? state.goalDifference
      : -state.goalDifference;
    const components = splitAsianLine(selectionSpec.line);
    return components.reduce((sum, component) => sum + settleMargin(teamDifference + component, price), 0)
      / components.length;
  }

  if (selectionSpec.kind === 'totalGoals') {
    const components = splitAsianLine(selectionSpec.line);
    return components.reduce((sum, component) => {
      const margin = selectionSpec.outcome === 'over'
        ? state.totalGoals - component
        : component - state.totalGoals;
      return sum + settleMargin(margin, price);
    }, 0) / components.length;
  }

  return 0;
}

function combinations(items, size, start = 0, prefix = [], result = []) {
  if (prefix.length === size) {
    result.push(prefix.slice());
    return result;
  }
  for (let index = start; index <= items.length - (size - prefix.length); index += 1) {
    prefix.push(items[index]);
    combinations(items, size, index + 1, prefix, result);
    prefix.pop();
  }
  return result;
}

function solveLinearSystem(matrix, vector) {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);

  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < EPSILON) return null;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];

    const divisor = augmented[column][column];
    for (let index = column; index <= size; index += 1) augmented[column][index] /= divisor;

    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      if (Math.abs(factor) < EPSILON) continue;
      for (let index = column; index <= size; index += 1) {
        augmented[row][index] -= factor * augmented[column][index];
      }
    }
  }

  return augmented.map((row) => row[size]);
}

/**
 * Solves max(min(A * stake)) subject to stake >= 0 and sum(stake) = 1.
 * Formula groups have three legs, so enumerating LP vertices is deterministic
 * and avoids an extra numerical dependency.
 */
function maximizeMinimumReturn(payoffMatrix) {
  if (!Array.isArray(payoffMatrix) || !payoffMatrix.length) return null;
  const legCount = payoffMatrix[0].length;
  if (!legCount || payoffMatrix.some((row) => row.length !== legCount)) return null;

  const constraints = [
    ...payoffMatrix.map((row, index) => ({ type: 'scenario', row, index })),
    ...Array.from({ length: legCount }, (_, index) => ({ type: 'zero', index })),
  ];
  let best = null;

  for (const active of combinations(constraints, legCount)) {
    const matrix = [
      [...Array(legCount).fill(1), 0],
      ...active.map((constraint) => {
        if (constraint.type === 'zero') {
          const row = Array(legCount + 1).fill(0);
          row[constraint.index] = 1;
          return row;
        }
        return [...constraint.row, -1];
      }),
    ];
    const vector = [1, ...Array(legCount).fill(0)];
    const solution = solveLinearSystem(matrix, vector);
    if (!solution) continue;

    const stakes = solution.slice(0, legCount);
    if (stakes.some((stake) => stake < -EPSILON)) continue;
    const returns = payoffMatrix.map((row) => row.reduce((sum, payout, index) => sum + payout * stakes[index], 0));
    const minimumReturn = Math.min(...returns);
    if (!Number.isFinite(minimumReturn)) continue;
    if (returns.some((value) => value < solution[legCount] - 1e-7)) continue;

    if (!best || minimumReturn > best.minimumReturn + EPSILON) {
      best = { stakes: stakes.map((stake) => Math.max(0, stake)), minimumReturn, returns };
    }
  }

  return best;
}

function parseNumericKey(value) {
  return Number(String(value).replace(/_/g, '.'));
}

function parseHandicapMarketKey(marketKey) {
  const match = String(marketKey).match(/^(?:asianHandicap|handicap)_(?:(plus|minus)_)?(\d+(?:_\d+)?)$/);
  if (!match) return null;
  const sign = match[1] === 'minus' ? -1 : 1;
  const value = parseNumericKey(match[2]) * sign;
  return Number.isFinite(value) ? value : null;
}

function parseTotalMarketKey(marketKey) {
  // Goals, corners, and cards share the same over/under count settlement model.
  // Catalog keys stay totalGoals:* so existing corridor/band formulas apply.
  const match = String(marketKey).match(
    /^(?:asianTotalGoals|totalGoals|asianTotalCorners|totalCorners|asianTotalCards|totalCards)_(\d+(?:_\d+)?)$/,
  );
  if (!match) return null;
  const value = parseNumericKey(match[1]);
  return Number.isFinite(value) ? value : null;
}

function selectionCatalogKey(spec) {
  if (spec.kind === 'h2h' || spec.kind === 'doubleChance') return `${spec.kind}:${spec.outcome}`;
  if (spec.kind === 'handicap') return `${spec.kind}:${spec.side}:${lineKey(spec.line)}`;
  if (spec.kind === 'totalGoals') return `${spec.kind}:${spec.outcome}:${lineKey(spec.line)}`;
  return '';
}

function setBestPrice(catalog, key, candidate) {
  const price = Number(candidate?.odds ?? candidate?.price);
  if (!candidate || !Number.isFinite(price) || price <= 1) return;
  const normalized = { ...candidate, odds: price, price };
  const current = catalog.get(key);
  if (!current || price > Number(current.odds)) catalog.set(key, normalized);
}

function buildCatalog(event, findBestPrices, getEventMarkets) {
  const catalog = new Map();
  const markets = getEventMarkets(event);

  for (const marketKey of markets) {
    const best = findBestPrices(event, marketKey);
    if (!best) continue;

    if (marketKey === 'h2h') {
      for (const outcome of ['home', 'draw', 'away']) {
        setBestPrice(catalog, `h2h:${outcome}`, best[outcome] && { ...best[outcome], marketKey, outcome });
      }
      continue;
    }

    if (marketKey === 'doubleChance') {
      for (const outcome of ['homeDraw', 'drawAway', 'homeAway']) {
        setBestPrice(catalog, `doubleChance:${outcome}`, best[outcome] && { ...best[outcome], marketKey, outcome });
      }
      continue;
    }

    const homeLine = parseHandicapMarketKey(marketKey);
    if (homeLine !== null && !best.draw) {
      setBestPrice(catalog, `handicap:home:${lineKey(homeLine)}`, best.home && {
        ...best.home,
        marketKey,
        outcome: 'home',
      });
      setBestPrice(catalog, `handicap:away:${lineKey(-homeLine)}`, best.away && {
        ...best.away,
        marketKey,
        outcome: 'away',
      });
      continue;
    }

    const totalLine = parseTotalMarketKey(marketKey);
    if (totalLine !== null) {
      setBestPrice(catalog, `totalGoals:over:${lineKey(totalLine)}`, best.over && {
        ...best.over,
        marketKey,
        outcome: 'over',
      });
      setBestPrice(catalog, `totalGoals:under:${lineKey(totalLine)}`, best.under && {
        ...best.under,
        marketKey,
        outcome: 'under',
      });
    }
  }

  return catalog;
}

function availableLinesFromCatalog(catalog) {
  const handicapLines = [];
  const totalLines = [];
  for (const key of catalog.keys()) {
    let match = key.match(/^handicap:(?:home|away):(-?\d+(?:\.\d+)?)$/);
    if (match) {
      handicapLines.push(Number(match[1]));
      continue;
    }
    match = key.match(/^totalGoals:(?:over|under):(\d+(?:\.\d+)?)$/);
    if (match) totalLines.push(Number(match[1]));
  }
  return {
    handicapLines: uniqueSortedLines(handicapLines),
    totalLines: uniqueSortedLines(totalLines),
  };
}

function enumerateStates(definition) {
  if (definition.selections.every((item) => item.kind === 'totalGoals')) {
    const maximumLine = Math.max(...definition.selections.map((item) => Number(item.line) || 0));
    return Array.from({ length: Math.ceil(maximumLine) + 4 }, (_, totalGoals) => ({
      totalGoals,
      label: `${totalGoals} total goal${totalGoals === 1 ? '' : 's'}`,
    }));
  }

  const maximumLine = Math.max(...definition.selections.map((item) => Math.abs(Number(item.line) || 0)));
  const boundary = Math.max(3, Math.ceil(maximumLine) + 2);
  return Array.from({ length: boundary * 2 + 1 }, (_, index) => {
    const goalDifference = index - boundary;
    return {
      goalDifference,
      label: goalDifference > 0
        ? `home by ${goalDifference}`
        : goalDifference < 0
          ? `away by ${Math.abs(goalDifference)}`
          : 'draw',
    };
  });
}

function formulaOpportunity(definition, resolved, totalStake, maxEdge) {
  const states = enumerateStates(definition);
  const payoffMatrix = states.map((state) => definition.selections.map((spec, index) => (
    settlementReturnMultiplier(spec, state, resolved[index].odds)
  )));

  if (payoffMatrix.some((row) => row.every((returnMultiplier) => returnMultiplier <= EPSILON))) return null;
  const solution = maximizeMinimumReturn(payoffMatrix);
  if (!solution || solution.stakes.some((stake) => stake < 0.005)) return null;

  const edge = solution.minimumReturn - 1;
  if (edge <= EPSILON || edge > maxEdge + EPSILON) return null;

  const stake = Number(totalStake) || DEFAULT_STAKE;
  const minimumReturn = solution.minimumReturn * stake;
  const scenarioReturns = states.map((state, index) => ({
    scenario: state.label,
    returnAmount: solution.returns[index] * stake,
    profit: (solution.returns[index] - 1) * stake,
  }));

  return {
    type: 'settlement-formula',
    marketKey: `formula_${definition.id}`,
    marketLabel: definition.label,
    formulaId: definition.id,
    formulaFamily: definition.family,
    settlementModel: 'score-state-matrix-v1',
    coverageVerified: true,
    edge,
    profit: minimumReturn - stake,
    stake,
    returnAmount: minimumReturn,
    minimumReturn,
    worstCaseReturn: minimumReturn,
    confidence: edge >= 0.02 ? 'trusted' : 'review',
    legs: definition.selections.map((spec, index) => ({
      bookmaker: resolved[index].bookmaker,
      odds: Number(resolved[index].odds),
      price: Number(resolved[index].odds),
      outcome: resolved[index].outcome,
      label: spec.label,
      marketKey: resolved[index].marketKey,
      url: resolved[index].url || null,
      verificationStatus: resolved[index].verificationStatus || 'unverified',
      stake: solution.stakes[index] * stake,
      formulaSelection: {
        kind: spec.kind,
        outcome: spec.outcome,
        side: spec.side,
        line: spec.line,
      },
    })),
    scenarioReturns,
  };
}

/** Detects only formulas for which every exact normalized market line exists. */
function detectSettlementFormulaArbitrage(event, helpers = {}) {
  let { findBestPrices, getEventMarkets } = helpers;
  if (!findBestPrices || !getEventMarkets) {
    // Lazy loading keeps the pure settlement module reusable without creating a
    // module-initialization cycle when formula-engine imports this scanner.
    const formulaEngine = require('../formula-engine');
    findBestPrices = findBestPrices || formulaEngine.findBestPrices;
    getEventMarkets = getEventMarkets || formulaEngine.getEventMarkets;
  }

  if (typeof findBestPrices !== 'function' || typeof getEventMarkets !== 'function') return [];

  const catalog = buildCatalog(event, findBestPrices, getEventMarkets);
  const definitions = helpers.definitions || [
    ...createSettlementFormulaDefinitions(helpers.definitionOptions),
    ...(helpers.includeAdditionalFamilies === false
      ? []
      : createAdditionalFormulaDefinitions({
        ...availableLinesFromCatalog(catalog),
        ...helpers.additionalDefinitionOptions,
      })),
  ];
  const totalStake = helpers.totalStake || DEFAULT_STAKE;
  const maxEdge = Number.isFinite(helpers.maxEdge) ? helpers.maxEdge : DEFAULT_MAX_EDGE;

  return definitions.flatMap((definition) => {
    const resolved = definition.selections.map((spec) => catalog.get(selectionCatalogKey(spec)) || null);
    if (resolved.some((candidate) => !candidate)) return [];
    const opportunity = formulaOpportunity(definition, resolved, totalStake, maxEdge);
    return opportunity ? [opportunity] : [];
  });
}

module.exports = {
  createAdditionalFormulaDefinitions,
  createSettlementFormulaDefinitions,
  detectSettlementFormulaArbitrage,
  maximizeMinimumReturn,
  settlementReturnMultiplier,
  splitAsianLine,
};
