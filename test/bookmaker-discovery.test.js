const test = require('node:test');
const assert = require('node:assert/strict');

const {
  discoverBookmakerPage,
  extractApiCandidates,
  extractScriptUrls,
  extractUrlsFromText,
} = require('../src/providers/bookmaker-discovery');

const bookmakerHtml = `
<!doctype html>
<html>
  <head>
    <script src="/runtime-ABCD.js"></script>
    <script src="main-GQHCNMXP.js"></script>
    <script src="https://cdn.example.test/assets/vendor.js"></script>
    <script>
      window.__config = {
        cms: "https:\\/\\/promo-cms.example.test\\/api\\/v1\\/promotion",
        image: "https://cdn.example.test/logo.png",
        events: "/api/v1/events?lang=ro"
      };
    </script>
    <script id="ng-state" type="application/json">
      {
        "promo": {
          "u": "https://promo-cms.example.test/api/v1/promotion",
          "s": 200,
          "b": []
        }
      }
    </script>
  </head>
</html>
`;

const mainBundle = `
  const environment = {
    comtrade: { apiUrl: "https://sports-api.example.test/comtrade/api" },
    navatar: { apiUrl: "https:\\/\\/navatar.example.test\\/api\\/v2" },
    staticCdn: "https://cdn.example.test/assets"
  };
  fetch("/sports/api/prematch/events");
`;

test('extracts absolute script URLs from bookmaker pages', () => {
  assert.deepEqual(
    extractScriptUrls(bookmakerHtml, 'https://www.example.test/pariuri-sportive'),
    [
      'https://www.example.test/runtime-ABCD.js',
      'https://www.example.test/main-GQHCNMXP.js',
      'https://cdn.example.test/assets/vendor.js',
    ],
  );
});

test('extracts likely API URLs from page and bundle text', () => {
  assert.deepEqual(extractUrlsFromText(mainBundle), [
    'https://sports-api.example.test/comtrade/api',
    'https://navatar.example.test/api/v2',
    'https://cdn.example.test/assets',
    '/sports/api/prematch/events',
  ]);

  const candidates = extractApiCandidates(
    [
      { source: 'page', text: bookmakerHtml },
      { source: 'main.js', text: mainBundle },
    ],
    'https://www.example.test/pariuri-sportive',
  );

  assert.deepEqual(candidates, [
    {
      source: 'page',
      url: 'https://promo-cms.example.test/api/v1/promotion',
    },
    {
      source: 'page',
      url: 'https://www.example.test/api/v1/events?lang=ro',
    },
    {
      source: 'main.js',
      url: 'https://sports-api.example.test/comtrade/api',
    },
    {
      source: 'main.js',
      url: 'https://navatar.example.test/api/v2',
    },
    {
      source: 'main.js',
      url: 'https://www.example.test/sports/api/prematch/events',
    },
  ]);
});

test('summarizes bookmaker page discovery inputs', () => {
  const discovery = discoverBookmakerPage({
    pageUrl: 'https://www.example.test/pariuri-sportive',
    html: bookmakerHtml,
    scriptBodies: {
      'https://www.example.test/main-GQHCNMXP.js': mainBundle,
    },
  });

  assert.deepEqual(discovery.scriptUrls, [
    'https://www.example.test/runtime-ABCD.js',
    'https://www.example.test/main-GQHCNMXP.js',
    'https://cdn.example.test/assets/vendor.js',
  ]);
  assert.deepEqual(discovery.transferStateUrls, [
    'https://promo-cms.example.test/api/v1/promotion',
  ]);
  assert.equal(discovery.transferStateEntries.length, 1);
  assert.equal(
    discovery.apiCandidates.at(-1).url,
    'https://www.example.test/sports/api/prematch/events',
  );
});
