/**
 * Developer Scaffolding CLI Utility: Provider Scraper Generator
 *
 * Usage:
 *   node scripts/create-provider.js SuperOdds superodds.ro
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
if (args.length < 2) {
  console.log('Usage: node scripts/create-provider.js <ProviderName> <Domain>');
  console.log('Example: node scripts/create-provider.js SuperOdds superodds.ro');
  process.exit(1);
}

const rawName = args[0];
const domain = args[1];

const slug = rawName.toLowerCase().replace(/[^a-z0-9]/g, '');
const className = rawName.replace(/[^a-zA-Z0-9]/g, '') + 'Provider';
const fileName = `${rawName.toLowerCase().replace(/[^a-z0-9]/g, '-')}-provider.js`;
const testFileName = `${rawName.toLowerCase().replace(/[^a-z0-9]/g, '-')}-provider.test.js`;

const providerTemplate = `'use strict';

const { BaseProvider } = require('./base-provider');

class ${className} extends BaseProvider {
  constructor({ timeoutMs = 12_000 } = {}) {
    super({ name: '${rawName}', domain: '${domain}', timeoutMs });
    this.endpointUrl = \`https://\${this.domain}/api/sports/football\`;
  }

  async fetchAndNormalizeOdds() {
    // Scaffold implementation: fetch endpoint payload
    const response = await fetch(this.endpointUrl, {
      signal: this.createTimeoutSignal(),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(\`HTTP \${response.status} from \${this.endpointUrl}\`);
    }

    const payload = await response.json();
    return this.normalizePayload(payload);
  }

  normalizePayload(payload) {
    const rawEvents = Array.isArray(payload) ? payload : payload?.events || [];
    return rawEvents.map((item) =>
      this.normalizeEvent({
        id: item.id || item.eventId,
        sport: 'Football',
        competition: item.competition || item.leagueName || 'Default League',
        homeTeam: item.homeTeam || item.home,
        awayTeam: item.awayTeam || item.away,
        startsAt: item.startsAt || item.kickoff,
        bookmakers: [
          {
            name: this.name,
            lastUpdate: new Date().toISOString(),
            markets: {
              h2h: {
                home: Number(item.odds?.home || item.h2h?.['1']),
                draw: Number(item.odds?.draw || item.h2h?.['X']),
                away: Number(item.odds?.away || item.h2h?.['2']),
              },
            },
          },
        ],
      })
    );
  }
}

module.exports = { ${className} };
`;

const testTemplate = `'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ${className} } = require('../src/providers/${fileName.replace('.js', '')}');

test('${className} initializes correctly with defaults', () => {
  const provider = new ${className}();
  assert.equal(provider.name, '${rawName}');
  assert.equal(provider.domain, '${domain}');
});

test('${className} normalizes sample payload correctly', () => {
  const provider = new ${className}();
  const sample = [
    {
      id: 'evt_101',
      competition: 'Liga 1',
      homeTeam: 'Team A',
      awayTeam: 'Team B',
      odds: { home: 2.10, draw: 3.20, away: 3.50 },
    },
  ];

  const events = provider.normalizePayload(sample);
  assert.equal(events.length, 1);
  assert.equal(events[0].homeTeam, 'Team A');
  assert.equal(events[0].bookmakers[0].markets.h2h.home, 2.10);
});
`;

const providerPath = path.join(__dirname, '..', 'src', 'providers', fileName);
const testPath = path.join(__dirname, '..', 'test', testFileName);

fs.writeFileSync(providerPath, providerTemplate, 'utf8');
fs.writeFileSync(testPath, testTemplate, 'utf8');

console.log(`✅ Provider created: ${providerPath}`);
console.log(`✅ Test created: ${testPath}`);
