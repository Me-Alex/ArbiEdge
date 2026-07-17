const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDiscoveryReport,
  buildTargetListReport,
  parsePositiveInteger,
  parseTargetFilter,
  remainingProviderTargets,
  targetMatchesFilter,
} = require('../scripts/discover-remaining-bookmakers');

test('lists remaining provider targets with discovery URLs', () => {
  const targets = remainingProviderTargets({
    targetFilter: 'Betfair,mozzartbet.ro',
  });
  const report = buildTargetListReport(targets);

  assert.equal(report.count, 2);
  assert.deepEqual(
    report.targets.map((target) => [target.name, target.discoveryUrl]),
    [
      ['Betfair', 'https://www.betfair.ro/pariuri/fotbal/s-1'],
      ['MozzartBet', 'https://mozzartbet.ro'],
    ],
  );
});

test('matches target filters by bookmaker name or domain', () => {
  const filter = parseTargetFilter('Betfair, mozzartbet.ro');

  assert.equal(
    targetMatchesFilter({ name: 'Betfair', domain: 'betfair.ro' }, filter),
    true,
  );
  assert.equal(
    targetMatchesFilter({ name: 'MozzartBet', domain: 'mozzartbet.ro' }, filter),
    true,
  );
  assert.equal(
    targetMatchesFilter({ name: 'Favbet', domain: 'favbet.ro' }, filter),
    false,
  );
  assert.equal(parsePositiveInteger('4', 8), 4);
  assert.equal(parsePositiveInteger('0', 8), 8);
});

test('builds a discovery report without network when fetch is injected', async () => {
  const target = {
    name: 'SampleBook',
    domain: 'sample.test',
    discoveryUrl: 'https://sample.test/sport',
    note: 'Test target.',
  };
  const html = `
    <script src="/main.js"></script>
    <script id="ng-state" type="application/json">
      {
        "events": {
          "u": "https://sample.test/api/sports/events",
          "s": 200,
          "b": []
        }
      }
    </script>
  `;
  const bundle = 'fetch("https://sample.test/api/sports/prematch");';
  const requested = [];

  const report = await buildDiscoveryReport([target], {
    maxScripts: 1,
    fetchTextImpl: async (url) => {
      requested.push(url);
      return url.endsWith('/main.js') ? bundle : html;
    },
  });

  assert.deepEqual(requested, [
    'https://sample.test/sport',
    'https://sample.test/main.js',
  ]);
  assert.equal(report.count, 1);
  assert.equal(report.results[0].ok, true);
  assert.deepEqual(report.results[0].transferStateUrls, [
    'https://sample.test/api/sports/events',
  ]);
  assert.deepEqual(
    report.results[0].apiCandidates.map((candidate) => candidate.url),
    [
      'https://sample.test/api/sports/events',
      'https://sample.test/api/sports/prematch',
    ],
  );
});
