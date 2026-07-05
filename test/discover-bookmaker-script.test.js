const test = require('node:test');
const assert = require('node:assert/strict');

const {
  discoverSingleBookmakerPage,
  parsePositiveInteger,
} = require('../scripts/discover-bookmaker');

test('discovers one bookmaker page with injected fetch', async () => {
  const html = `
    <script src="/main.js"></script>
    <script src="/lazy.js"></script>
  `;
  const mainBundle = 'fetch("/api/sports/events");';
  const requested = [];

  const report = await discoverSingleBookmakerPage('https://book.test/sport', {
    maxScripts: 1,
    fetchTextImpl: async (url) => {
      requested.push(url);
      return url.endsWith('/main.js') ? mainBundle : html;
    },
  });

  assert.deepEqual(requested, [
    'https://book.test/sport',
    'https://book.test/main.js',
  ]);
  assert.deepEqual(report.fetchedScripts, ['https://book.test/main.js']);
  assert.deepEqual(report.scriptErrors, []);
  assert.deepEqual(
    report.apiCandidates.map((candidate) => candidate.url),
    ['https://book.test/api/sports/events'],
  );
});

test('records script fetch errors without failing the discovery report', async () => {
  const report = await discoverSingleBookmakerPage('https://book.test/sport', {
    fetchTextImpl: async (url) => {
      if (url.endsWith('/broken.js')) {
        throw new Error('blocked');
      }
      return '<script src="/broken.js"></script>';
    },
  });

  assert.deepEqual(report.fetchedScripts, []);
  assert.deepEqual(report.scriptErrors, [
    { url: 'https://book.test/broken.js', error: 'blocked' },
  ]);
  assert.equal(parsePositiveInteger('4', 8), 4);
  assert.equal(parsePositiveInteger('0', 8), 8);
});
