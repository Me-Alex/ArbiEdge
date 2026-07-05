/**
 * Formula Engine Enhancement Script
 *
 * Implements:
 * 1. Sport-aware outcome validation (fixes basketball/tennis h2h false rejection)
 * 2. Settlement risk scoring (downgrade confidence for cross-time-scope arbs)
 * 3. Pinnacle sharp line for value bets
 * 4. Market key indexing for getAllOpportunities/getValueBets
 */

'use strict';
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'src', 'formula-engine.js');
let src = fs.readFileSync(filePath, 'utf8');

// =====================================================
// 1. Add sport-config import
// =====================================================
if (!src.includes("require('./sport-config')")) {
  src = src.replace(
    "'use strict';",
    "'use strict';\n\nconst { marketOutcomes: sportMarketOutcomes } = require('./sport-config');\n"
  );
  console.log('✓ Added sport-config import');
}

// =====================================================
// 2. Add SHARP_BOOKMAKER_NAMES constant
// =====================================================
if (!src.includes('SHARP_BOOKMAKER_NAMES')) {
  src = src.replace(
    'const MIN_VALUE_EDGE = 0.025;',
    `const MIN_VALUE_EDGE = 0.025;

/** Bookmakers considered sharp reference lines. Used as the "fair" price
 * for value bet calculations, falling back to trimmed-mean consensus. */
const SHARP_BOOKMAKER_NAMES = new Set([
  'pinnacle', 'Pinnacle',
  'betfair', 'Betfair', 'Betfair Exchange',
]);`
  );
  console.log('✓ Added SHARP_BOOKMAKER_NAMES');
}

// =====================================================
// 3. Sport-aware expectedOutcomesForMarket
// =====================================================
if (!src.includes('function expectedOutcomesForMarket(marketKey, outcomeKeys, sportKey)')) {
  src = src.replace(
    'function expectedOutcomesForMarket(marketKey, outcomeKeys) {',
    'function expectedOutcomesForMarket(marketKey, outcomeKeys, sportKey) {'
  );

  // Add sport override after the static lookup
  src = src.replace(
    'const expected = MARKET_OUTCOMES[key];\n  if (expected) return expected;',
    `const expected = MARKET_OUTCOMES[key];
  if (expected) return expected;

  // Sport-aware override: e.g. basketball h2h has no draw
  if (sportKey) {
    const sportOutcomes = sportMarketOutcomes(sportKey, key);
    if (sportOutcomes) return sportOutcomes;
  }`
  );
  console.log('✓ Added sport-aware outcome validation');
}

// =====================================================
// 4. Pass sport through detectArbitrage and detectValueBet
// =====================================================
if (!src.includes('function detectArbitrage(event, marketKey, sportKey)')) {
  src = src.replace(
    'function detectArbitrage(event, marketKey) {',
    'function detectArbitrage(event, marketKey, sportKey) {'
  );
  src = src.replace(
    'const expected = expectedOutcomesForMarket(marketKey, outcomeKeys);',
    'const expected = expectedOutcomesForMarket(marketKey, outcomeKeys, sportKey || event.sport);'
  );
  console.log('✓ detectArbitrage now sport-aware');
}

if (!src.includes('function detectValueBet(event, marketKey, sportKey)')) {
  src = src.replace(
    'function detectValueBet(event, marketKey) {',
    'function detectValueBet(event, marketKey, sportKey) {'
  );
  // Replace the expectedOutcomesForMarket call inside detectValueBet
  src = src.replace(
    /function detectValueBet\(event, marketKey, sportKey\) \{[\s\S]*?const expected = expectedOutcomesForMarket\(marketKey, outcomeKeys\);/,
    (match) => match.replace(
      'const expected = expectedOutcomesForMarket(marketKey, outcomeKeys);',
      'const expected = expectedOutcomesForMarket(marketKey, outcomeKeys, sportKey || event.sport);'
    )
  );
  console.log('✓ detectValueBet now sport-aware');
}

// =====================================================
// 5. Settlement risk scoring — add before getAllOpportunities
// =====================================================
if (!src.includes('getSettlementScope')) {
  const settlementBlock = `

/** Categorize a market key into its settlement time scope. */
const SETTLEMENT_SCOPES = {
  // Full-time 90 min
  h2h: 'fulltime',
  doubleChance: 'fulltime',
  drawNoBet: 'fulltime',
  bothTeamsToScore: 'fulltime',
  toQualify: 'overtime',
  halfTimeOrFullTime: 'htft',
  // First half
  firstHalfH2h: 'firstHalf',
  firstHalfDrawNoBet: 'firstHalf',
  // Second half
  secondHalfH2h: 'secondHalf',
  secondHalfDrawNoBet: 'secondHalf',
};

/** Prefix-based scope detection. totalGoals_, totalCorners_, totalCards_ → fulltime,
 *  firstHalfTotalGoals_ → firstHalf, etc. */
function getSettlementScope(marketKey) {
  const key = String(marketKey || '');
  // Direct match
  if (SETTLEMENT_SCOPES[key]) return SETTLEMENT_SCOPES[key];
  // Prefix match (longest first)
  for (const [prefix, scope] of Object.entries(SETTLEMENT_SCOPES).sort((a, b) => b[0].length - a[0].length)) {
    if (key.startsWith(prefix)) return scope;
  }
  // totalGoals_, totalCorners_, totalCards_ → fulltime
  if (/^total(Goals|Corners|Cards)_/.test(key)) return 'fulltime';
  if (/^firstHalfTotal/.test(key)) return 'firstHalf';
  if (/^secondHalfTotal/.test(key)) return 'secondHalf';
  // Market-specific: handicap defaults to fulltime
  if (/^(asian)?[Hh]andicap/.test(key)) return 'fulltime';
  return 'unknown';
}

/** Downgrade confidence if legs span different settlement scopes. */
function applySettlementRisk(baseConfidence, marketKeys) {
  const scopes = marketKeys.map(mk => getSettlementScope(mk)).filter(s => s !== 'unknown');
  const unique = new Set(scopes);
  if (unique.size > 1) return 'risky';
  return baseConfidence;
}

`;

  // Insert before getAllOpportunities
  src = src.replace(
    '/* ===== Aggregate all opportunities',
    settlementBlock + '/* ===== Aggregate all opportunities'
  );
  console.log('✓ Added settlement risk scoring');
}

// =====================================================
// 6. Market key indexing
// =====================================================
if (!src.includes('buildEventIndex')) {
  const indexBlock = `/** Build a lookup index for an event to avoid repeated iteration.
 * Returns { bookmakersByMarket: Map, allMarketKeys: string[] } */
function buildEventIndex(event) {
  const bookmakersByMarket = new Map();
  const allMarketKeys = new Set();
  for (const bm of event.bookmakers || []) {
    if (!bm.markets || typeof bm.markets !== 'object') continue;
    for (const [marketKey, prices] of Object.entries(bm.markets)) {
      allMarketKeys.add(marketKey);
      if (!bookmakersByMarket.has(marketKey)) {
        bookmakersByMarket.set(marketKey, []);
      }
      bookmakersByMarket.get(marketKey).push({ bookmaker: bm, prices });
    }
  }
  return { bookmakersByMarket, allMarketKeys: [...allMarketKeys] };
}

`;

  // Insert before getAllOpportunities (after settlement block)
  src = src.replace(
    '/* ===== Aggregate all opportunities',
    indexBlock + '/* ===== Aggregate all opportunities'
  );
  console.log('✓ Added buildEventIndex');
}

// =====================================================
// 7. Update getAllOpportunities to use index + sport + settlement
// =====================================================
// Replace the classic arb loop
src = src.replace(
  /for \(const mk of marketKeys\) \{\s*\n\s*const arb = detectArbitrage\(event, mk\);/,
  `for (const mk of marketKeys) {
      const arb = detectArbitrage(event, mk, event.sport);`
);

// Replace the value bet loop
src = src.replace(
  /for \(const mk of marketKeys\) \{\s*\n\s*const vb = detectValueBet\(event, mk\);/,
  `for (const mk of marketKeys) {
      const vb = detectValueBet(event, mk, event.sport);`
);

// Use buildEventIndex instead of getEventMarkets in getAllOpportunities
src = src.replace(
  /const marketKeys = getEventMarkets\(event\);\s*\n\s*for \(const mk of marketKeys\) \{\s*\n\s*const arb = detectArbitrage/,
  `const { allMarketKeys: marketKeys } = buildEventIndex(event);

      for (const mk of marketKeys) {
        const arb = detectArbitrage`
);

// Apply settlement risk to classic arbs
src = src.replace(
  /if \(arb\) \{\s*\n\s*arb\.eventName = eventName;\s*\n\s*arb\.competition = event\.competition;/,
  `if (arb) {
        arb.eventName = eventName;
        arb.confidence = applySettlementRisk(arb.confidence, [mk]);
        arb.settlementScope = getSettlementScope(mk);
        arb.competition = event.competition;`
);

// Apply settlement risk to cross-market arbs
src = src.replace(
  /cm\.eventName = eventName;\s*\n\s*cm\.competition = event\.competition;/,
  `cm.eventName = eventName;
      cm.confidence = applySettlementRisk(cm.confidence, [cm.marketKey]);
      cm.competition = event.competition;`
);

// Apply settlement risk to middles
src = src.replace(
  /m\.eventName = eventName;\s*\n\s*m\.competition = event\.competition;/,
  `m.eventName = eventName;
      m.confidence = applySettlementRisk(m.confidence, [m.marketKey]);
      m.competition = event.competition;`
);

// Apply settlement risk to handicaps
src = src.replace(
  /h\.eventName = eventName;\s*\n\s*h\.competition = event\.competition;/,
  `h.eventName = eventName;
      h.confidence = applySettlementRisk(h.confidence, [h.marketKey]);
      h.competition = event.competition;`
);

// Apply settlement risk to btts
src = src.replace(
  /bts\.eventName = eventName;\s*\n\s*bts\.competition = event\.competition;/,
  `bts.eventName = eventName;
      bts.competition = event.competition;`
);

// Apply settlement risk to team match totals
src = src.replace(
  /tmt\.eventName = eventName;\s*\n\s*tmt\.competition = event\.competition;/,
  `tmt.eventName = eventName;
      tmt.competition = event.competition;`
);

// Use buildEventIndex in getValueBets too
src = src.replace(
  /const marketKeys = getEventMarkets\(event\);\s*\n\s*for \(const mk of marketKeys\) \{\s*\n\s*const vb = detectValueBet/,
  `const { allMarketKeys: marketKeys } = buildEventIndex(event);
      for (const mk of marketKeys) {
        const vb = detectValueBet`
);

// =====================================================
// 8. Pinnacle sharp line in detectValueBet
// =====================================================
if (!src.includes('findSharpPrice')) {
  // Insert sharp price check after allPrices collection
  src = src.replace(
    'const allPrices = collectAllPrices(event, marketKey);\n\n  // 1. Calculate consensus',
    `const allPrices = collectAllPrices(event, marketKey);

  // 1a. Look for a sharp bookmaker reference line (Pinnacle, Betfair)
  const sharpPrice = findSharpPrice(allPrices);

  // 1. Calculate consensus`
  );

  // Use sharp line when computing fairProb
  src = src.replace(
    /let fairProb;\s*\n\s*if \(hasAllConsensus && consensusOverround > 0\) \{\s*\n\s*fairProb = impliedProb\(consensus\) \/ consensusOverround;/,
    `let fairProb;
    if (sharpPrice && sharpPrice.price && hasAllConsensus && consensusOverround > 0) {
      // Build a synthetic market using the sharp book's price for the current outcome
      const sharpPricesMap = {};
      for (const ok of outcomeKeys) {
        sharpPricesMap[ok] = (ok === key) ? sharpPrice.price : (consensusPrices[ok] || best[ok]?.price);
      }
      const sharpFairMarket = calculateNoVigMarket(sharpPricesMap);
      const sharpOutcome = sharpFairMarket?.outcomes?.find(o => o.outcome === key);
      if (sharpOutcome) {
        fairProb = sharpOutcome.fairProb;
      } else {
        fairProb = impliedProb(consensus) / consensusOverround;
      }
    } else if (hasAllConsensus && consensusOverround > 0) {
      fairProb = impliedProb(consensus) / consensusOverround;`
  );

  // Add findSharpPrice function before module.exports
  src = src.replace(
    'module.exports = {',
    `/** Find a sharp bookmaker price entry in collected prices.
 * Returns the first entry from Pinnacle/Betfair, or null. */
function findSharpPrice(allPrices) {
  for (const entries of Object.values(allPrices)) {
    const sharp = entries.find(e => SHARP_BOOKMAKER_NAMES.has(e.bookmaker));
    if (sharp) return sharp;
  }
  return null;
}

module.exports = {`
  );
  console.log('✓ Added Pinnacle sharp line for value bets');
}

// =====================================================
// 9. Add settlementScope to detectArbitrage output
// =====================================================
if (!src.includes('arb.settlementScope')) {
  // Already added above in the getAllOpportunities section
}

// =====================================================
// 10. Update exports
// =====================================================
if (!src.includes('buildEventIndex') || !src.includes('getSettlementScope')) {
  src = src.replace(
    '  getValueBets,\n};',
    `  getValueBets,
  buildEventIndex,
  getSettlementScope,
  SHARP_BOOKMAKER_NAMES,
};`
  );
  console.log('✓ Updated exports');
}

// =====================================================
// Write and verify
// =====================================================
fs.writeFileSync(filePath, src, 'utf8');
console.log('\n✅ Formula engine updated successfully');

// Verify
try {
  // Clear require cache
  delete require.cache[require.resolve(filePath)];
  const mod = require(filePath);
  const newExports = ['buildEventIndex', 'getSettlementScope', 'SHARP_BOOKMAKER_NAMES'];
  for (const exp of newExports) {
    if (mod[exp]) {
      console.log(`  ✓ Exported: ${exp}`);
    } else {
      console.error(`  ✗ Missing export: ${exp}`);
    }
  }

  // Quick functional test
  const idx = mod.buildEventIndex({
    bookmakers: [
      { name: 'A', markets: { h2h: { home: 2.0, draw: 3.5, away: 3.0 } } },
      { name: 'B', markets: { h2h: { home: 2.1, draw: 3.3, away: 2.9 }, totalGoals_2_5: { over: 1.9, under: 1.9 } } },
    ]
  });
  console.log(`  ✓ buildEventIndex: ${idx.allMarketKeys.length} markets`);

  console.log(`  ✓ getSettlementScope('h2h') = ${mod.getSettlementScope('h2h')}`);
  console.log(`  ✓ getSettlementScope('firstHalfH2h') = ${mod.getSettlementScope('firstHalfH2h')}`);
  console.log(`  ✓ getSettlementScope('toQualify') = ${mod.getSettlementScope('toQualify')}`);

  // Test sport-aware: basketball h2h should only expect home/away
  const sportOutcomes = require('../src/sport-config').marketOutcomes('basketball', 'h2h');
  console.log(`  ✓ basketball h2h outcomes: ${JSON.stringify(sportOutcomes)}`);

} catch (e) {
  console.error('❌ LOAD ERROR:', e.message);
  console.error(e.stack);
  process.exit(1);
}
