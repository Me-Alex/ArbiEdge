const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  auditFunctionTests,
  extractPublicExports,
  findAuditedSourceFiles,
} = require('../scripts/audit-function-tests');

function makeFixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'function-audit-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'test'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'public', 'js'), { recursive: true });
  return root;
}

test('extractPublicExports parses CommonJS and ES module public callables', () => {
  const source = `
    function parseThing() {}
    class ThingRunner {}
    const NOT_CALLABLE = 1;
    export async function fetchThing() {}
    export class BrowserThing {}
    export const LABEL = 'x';
    export { parseThing, ThingRunner as Runner };
    module.exports = {
      parseThing,
      Runner: ThingRunner,
      NOT_CALLABLE,
    };
  `;

  const exports = extractPublicExports(source, 'src/example.js');
  const callables = exports
    .filter((item) => item.kind === 'function' || item.kind === 'class')
    .map((item) => `${item.name}:${item.kind}`)
    .sort();

  assert.deepEqual(callables, [
    'BrowserThing:class',
    'Runner:class',
    'fetchThing:function',
    'parseThing:function',
  ]);
});

test('auditFunctionTests reports callable exports without test signals', () => {
  const root = makeFixtureRoot();
  fs.writeFileSync(path.join(root, 'src', 'tool.js'), `
    function coveredTool() {}
    function missingTool() {}
    module.exports = { coveredTool, missingTool };
  `);
  fs.writeFileSync(path.join(root, 'test', 'other.test.js'), `
    const { coveredTool } = require('../src/tool');
    coveredTool();
  `);

  const report = auditFunctionTests({ root });

  assert.equal(report.missing.length, 1);
  assert.equal(report.missing[0].name, 'missingTool');
  assert.equal(report.covered.some((item) => item.name === 'coveredTool'), true);
});

test('auditFunctionTests accepts UI smoke coverage for DOM-only frontend modules', () => {
  const root = makeFixtureRoot();
  fs.mkdirSync(path.join(root, 'public', 'js', 'pages'), { recursive: true });
  fs.writeFileSync(path.join(root, 'public', 'js', 'pages', 'scanner.js'), `
    export function renderScanner() {}
  `);
  fs.writeFileSync(path.join(root, 'scripts', 'ui-smoke.js'), '/* route smoke */');

  const report = auditFunctionTests({ root });

  assert.equal(report.missing.length, 0);
  assert.equal(report.covered[0].coverageType, 'ui-smoke');
});

test('findAuditedSourceFiles includes app source, frontend modules, and supported verification scripts', () => {
  const root = makeFixtureRoot();
  fs.writeFileSync(path.join(root, 'src', 'core.js'), 'module.exports = {};');
  fs.writeFileSync(path.join(root, 'public', 'js', 'state.js'), 'export const state = {};');
  fs.writeFileSync(path.join(root, 'scripts', 'verify-odds-fidelity.js'), 'module.exports = {};');
  fs.writeFileSync(path.join(root, 'scripts', 'debug-local.js'), 'module.exports = {};');

  assert.deepEqual(findAuditedSourceFiles(root), [
    'public/js/state.js',
    'scripts/verify-odds-fidelity.js',
    'src/core.js',
  ]);
});
