const test = require('node:test');
const assert = require('node:assert/strict');

const {
  collectFormulaOpportunities,
  createOddsService,
  formatLegLink,
  formatOpportunity,
  loadFormulaScanner,
  parseArgs,
} = require('../scripts/find-best-formula');

test('parses demo formula scanner options', () => {
  assert.deepEqual(
    parseArgs(['--demo', '--json', '--iterations', '3', '--interval-ms', '25', '--top', '2']),
    {
      demo: true,
      intervalMs: 25,
      iterations: 3,
      json: true,
      top: 2,
    },
  );
});

test('formats formula leg links for text output', () => {
  assert.equal(
    formatLegLink({ eventUrl: 'https://book.test/event', bookmakerUrl: 'https://book.test' }),
    ' | https://book.test/event',
  );
  assert.equal(
    formatLegLink({ bookmakerUrl: 'https://book.test' }),
    ' | https://book.test',
  );
  assert.equal(formatLegLink({}), '');
});

test('runs the formula scanner against demo odds without live providers', async () => {
  const oddsService = createOddsService({ demoOnly: true });
  const result = await oddsService.getOdds();
  const findFormulaArbitrageOpportunities = loadFormulaScanner();
  const opportunities = collectFormulaOpportunities(
    { ...result, events: result.events.slice(0, 1) },
    findFormulaArbitrageOpportunities,
  );
  const formatted = formatOpportunity(opportunities[0]);

  assert.equal(result.mode, 'demo');
  assert.ok(opportunities.length > 0);
  assert.ok(formatted.event.includes(' vs '));
  assert.ok(formatted.edgePct > 0);
  assert.ok(formatted.legs.length >= 2);
  assert.ok(formatted.legs.every((leg) => 'bookmakerUrl' in leg));
});
