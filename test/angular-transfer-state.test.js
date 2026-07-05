const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractAngularTransferStateEntries,
  findTransferStateEntries,
} = require('../src/providers/angular-transfer-state');

const transferStateHtml = `
<!doctype html>
<html>
  <head>
    <script src="/main.js"></script>
    <script>window.boot = {"not":"json"};</script>
    <script id="ng-state" type="application/json">
      {
        "sports": {
          "u": "https://api.example.test/sports",
          "s": 200,
          "st": "OK",
          "h": { "content-type": ["application/json"] },
          "b": {
            "items": [
              { "id": 1, "u": "not-a-transfer-entry", "s": 200 }
            ]
          }
        },
        "status": {
          "u": "https://api.example.test/status",
          "s": 204
        },
        "nested": {
          "children": [
            {
              "u": "https://api.example.test/events",
              "s": 200,
              "b": [{ "id": 99 }]
            }
          ]
        }
      }
    </script>
    <script>{ invalid JavaScript }</script>
  </head>
</html>
`;

test('extracts Angular TransferState HTTP cache entries from inline JSON scripts', () => {
  const entries = extractAngularTransferStateEntries(transferStateHtml);

  assert.equal(entries.length, 3);
  assert.deepEqual(
    entries.map((entry) => ({
      key: entry.key,
      url: entry.url,
      status: entry.status,
      scriptIndex: entry.scriptIndex,
    })),
    [
      {
        key: 'sports',
        url: 'https://api.example.test/sports',
        status: 200,
        scriptIndex: 2,
      },
      {
        key: 'status',
        url: 'https://api.example.test/status',
        status: 204,
        scriptIndex: 2,
      },
      {
        key: 'nested.children[0]',
        url: 'https://api.example.test/events',
        status: 200,
        scriptIndex: 2,
      },
    ],
  );
  assert.deepEqual(entries[0].body.items, [{ id: 1, u: 'not-a-transfer-entry', s: 200 }]);
  assert.equal(entries[1].body, undefined);
});

test('filters extracted TransferState entries', () => {
  const entries = findTransferStateEntries(
    transferStateHtml,
    (entry) => entry.url.includes('/events'),
  );

  assert.equal(entries.length, 1);
  assert.equal(entries[0].key, 'nested.children[0]');
  assert.deepEqual(entries[0].body, [{ id: 99 }]);
});
