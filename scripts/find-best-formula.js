const { setTimeout: delay } = require('node:timers/promises');

const { OddsService } = require('../src/odds-service');
const { DemoOddsProvider } = require('../src/providers/demo-provider');
const { CompositeProvider } = require('../src/providers/composite-provider');
const { buildProviderConfig, parsePositiveInteger } = require('../src/provider-config');
const { getAllOpportunities } = require('../src/formula-engine');

function parseArgs(argv) {
  const options = {
    demo: false,
    intervalMs: 1000,
    iterations: 1,
    json: false,
    top: 5,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--demo') {
      options.demo = true;
      continue;
    }
    if (arg === '--iterations') {
      options.iterations = parsePositiveInteger(argv[index + 1], options.iterations);
      index += 1;
      continue;
    }
    if (arg === '--interval-ms') {
      options.intervalMs = parsePositiveInteger(argv[index + 1], options.intervalMs);
      index += 1;
      continue;
    }
    if (arg === '--top') {
      options.top = parsePositiveInteger(argv[index + 1], options.top);
      index += 1;
    }
  }

  return options;
}

function loadFormulaScanner() {
  return (event) => getAllOpportunities([event]);
}

function createOddsService({ demoOnly = false } = {}) {
  const { configuredProviders, liveProviderName } = buildProviderConfig(process.env);
  return new OddsService({
    liveProvider: demoOnly
      ? null
      : new CompositeProvider(configuredProviders, { name: liveProviderName }),
    demoProvider: new DemoOddsProvider(),
    cacheTtlMs: 0,
  });
}

function collectFormulaOpportunities(result, findFormulaArbitrageOpportunities) {
  const opportunities = [];
  for (const event of result.events || []) {
    opportunities.push(
      ...findFormulaArbitrageOpportunities(event, event.bookmakers || []),
    );
  }
  return opportunities.sort((left, right) =>
    (right.edge - left.edge) || (right.profit - left.profit),
  );
}

function formatOpportunity(opportunity) {
  if (!opportunity) {
    return null;
  }
  const eventName = opportunity.eventName ||
    (opportunity.event ? `${opportunity.event.homeTeam} vs ${opportunity.event.awayTeam}` : '');
  const marketKey = opportunity.marketKey || opportunity.market?.key || '';
  const marketLabel = opportunity.marketLabel || opportunity.market?.label || marketKey;
  const edge = Number(opportunity.edge ?? opportunity.margin ?? 0);
  const returnAmount = Number(
    opportunity.returnAmount ??
    ((opportunity.stake || 100) + (opportunity.profit || 0)),
  );
  return {
    event: eventName,
    competition: opportunity.competition || opportunity.event?.competition || null,
    startsAt: opportunity.kickoff || opportunity.event?.startsAt || null,
    key: marketKey,
    label: marketLabel,
    risk: opportunity.risk || opportunity.confidence || null,
    edgePct: Number((edge * 100).toFixed(2)),
    profit: Number(opportunity.profit.toFixed(2)),
    returnAmount: Number(returnAmount.toFixed(2)),
    legs: opportunity.legs.map((leg) => ({
      bookmaker: leg.bookmaker,
      label: leg.label,
      odds: leg.odds || leg.price,
      stake: Number(leg.stake.toFixed(2)),
      marketKeys: leg.marketKeys || [marketKey],
      eventUrl: leg.eventUrl || leg.url || null,
      bookmakerUrl: leg.bookmakerUrl || leg.url || null,
    })),
  };
}

function printText(scan) {
  console.log(`Mode: ${scan.mode}`);
  console.log(`Source: ${scan.source}`);
  if (scan.warning) {
    console.log(`Warning: ${scan.warning}`);
  }
  console.log(`Events: ${scan.eventCount}`);
  console.log(`Formula opportunities: ${scan.formulaCount}`);
  if (!scan.best) {
    console.log('No formula arbitrage opportunities found.');
    return;
  }

  console.log('');
  console.log(`Best formula: ${scan.best.label}`);
  console.log(`Event: ${scan.best.event}`);
  console.log(`Edge: ${scan.best.edgePct}%`);
  console.log(`Profit on 100 stake: ${scan.best.profit}`);
  console.log(`Risk: ${scan.best.risk}`);
  for (const leg of scan.best.legs) {
    console.log(`- ${leg.label} / ${leg.bookmaker} @ ${leg.odds} stake ${leg.stake}${formatLegLink(leg)}`);
  }

  if (scan.top.length > 1) {
    console.log('');
    console.log('Top formulas:');
    for (const item of scan.top) {
      console.log(`- ${item.edgePct}% ${item.label} (${item.event})`);
    }
  }
}

function formatLegLink(leg) {
  const url = leg.eventUrl || leg.bookmakerUrl;
  return url ? ` | ${url}` : '';
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const findFormulaArbitrageOpportunities = loadFormulaScanner();
  const oddsService = createOddsService({ demoOnly: options.demo });
  let bestScan = null;

  for (let iteration = 1; iteration <= options.iterations; iteration += 1) {
    oddsService.clearCache();
    const result = await oddsService.getOdds();
    const opportunities = collectFormulaOpportunities(result, findFormulaArbitrageOpportunities);
    const scan = {
      iteration,
      mode: result.mode,
      source: result.source,
      warning: result.warning || null,
      eventCount: (result.events || []).length,
      formulaCount: opportunities.length,
      best: formatOpportunity(opportunities[0]),
      top: opportunities.slice(0, options.top).map(formatOpportunity),
    };

    if (!bestScan || (scan.best?.edgePct || 0) > (bestScan.best?.edgePct || 0)) {
      bestScan = scan;
    }

    if (iteration < options.iterations) {
      await delay(options.intervalMs);
    }
  }

  if (options.json) {
    console.log(JSON.stringify(bestScan, null, 2));
  } else {
    printText(bestScan);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  collectFormulaOpportunities,
  createOddsService,
  formatLegLink,
  formatOpportunity,
  loadFormulaScanner,
  parseArgs,
};
