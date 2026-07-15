#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SCRIPT_EXPORTS = new Set([
  'scripts/discover-bookmaker.js',
  'scripts/discover-remaining-bookmakers.js',
  'scripts/find-best-formula.js',
  'scripts/odds-fidelity-core.js',
  'scripts/verify-bookmaker-odds.js',
  'scripts/verify-odds-fidelity.js',
]);

const UI_E2E_COVERED = [
  'public/js/api.js',
  'public/js/pages/',
  'public/js/state.js',
  'public/js/ui-common.js',
];

const TEST_ALIASES = new Map([
  ['scripts/discover-bookmaker.js', ['test/discover-bookmaker-script.test.js']],
  ['scripts/discover-remaining-bookmakers.js', ['test/discover-remaining-bookmakers-script.test.js']],
  ['scripts/find-best-formula.js', ['test/find-best-formula-script.test.js']],
  ['scripts/verify-bookmaker-odds.js', ['test/bookmaker-odds-verifier.test.js']],
  ['scripts/verify-odds-fidelity.js', ['test/verify-odds-fidelity-script.test.js']],
]);

if (require.main === module) {
  const report = auditFunctionTests({ root: process.cwd() });
  if (report.missing.length > 0) {
    console.error('Public export test audit failed.');
    for (const item of report.missing) {
      console.error(`- ${item.file}: ${item.name} (${item.kind}) has no test signal`);
    }
    process.exitCode = 1;
  } else {
    console.log(
      `Function test audit ok: ${report.covered.length}/${report.callable.length} callable exports covered `
      + `across ${report.files.length} source files`,
    );
  }
}

function auditFunctionTests({ root = process.cwd() } = {}) {
  const files = findAuditedSourceFiles(root);
  const coverageFiles = loadCoverageFiles(root);
  const exports = files.flatMap((file) => extractPublicExports(fs.readFileSync(path.join(root, file), 'utf8'), file));
  const callable = exports.filter((item) => item.kind === 'function' || item.kind === 'class');
  const covered = [];
  const missing = [];

  for (const item of callable) {
    const signal = findCoverageSignal(item, coverageFiles);
    if (signal) covered.push({ ...item, coveredBy: signal.file, coverageType: signal.type });
    else missing.push(item);
  }

  return { files, exports, callable, covered, missing };
}

function findAuditedSourceFiles(root) {
  return [
    ...findJavaScriptFiles(path.join(root, 'src')).map((file) => relativePath(root, file)),
    ...findJavaScriptFiles(path.join(root, 'public', 'js')).map((file) => relativePath(root, file)),
    ...findJavaScriptFiles(path.join(root, 'scripts'))
      .map((file) => relativePath(root, file))
      .filter((file) => DEFAULT_SCRIPT_EXPORTS.has(file)),
  ].sort((left, right) => left.localeCompare(right));
}

function loadCoverageFiles(root) {
  const files = [
    ...findJavaScriptFiles(path.join(root, 'test')),
    path.join(root, 'scripts', 'test-calc.js'),
    path.join(root, 'scripts', 'ui-smoke.js'),
  ].filter((file) => fs.existsSync(file));

  return files.map((file) => ({
    file: relativePath(root, file),
    text: fs.readFileSync(file, 'utf8'),
  }));
}

function findCoverageSignal(item, coverageFiles) {
  const namePattern = new RegExp(`\\b${escapeRegExp(item.name)}\\b`);
  const direct = coverageFiles.find((coverageFile) => namePattern.test(coverageFile.text));
  if (direct) return { type: 'direct', file: direct.file };

  const moduleLevel = coverageFiles.find((coverageFile) =>
    expectedTestFiles(item.file).includes(coverageFile.file));
  if (moduleLevel) return { type: 'module', file: moduleLevel.file };

  if (isUiE2eCovered(item.file)) {
    const smoke = coverageFiles.find((coverageFile) => coverageFile.file === 'scripts/ui-smoke.js');
    if (smoke) return { type: 'ui-smoke', file: smoke.file };
  }

  return null;
}

function expectedTestFiles(file) {
  const basename = path.basename(file, '.js');
  return [
    `test/${basename}.test.js`,
    `test/frontend-${basename}.test.js`,
    ...(TEST_ALIASES.get(file) || []),
  ];
}

function isUiE2eCovered(file) {
  return UI_E2E_COVERED.some((pattern) => (
    pattern.endsWith('/') ? file.startsWith(pattern) : file === pattern
  ));
}

function extractPublicExports(source, file) {
  return dedupeExports([
    ...extractEsmExports(source, file),
    ...extractCommonJsExports(source, file),
  ]).sort((left, right) => left.name.localeCompare(right.name));
}

function extractEsmExports(source, file) {
  const exports = [];
  for (const match of source.matchAll(/\bexport\s+(async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    exports.push({ file, name: match[2], localName: match[2], kind: 'function' });
  }
  for (const match of source.matchAll(/\bexport\s+class\s+([A-Za-z_$][\w$]*)\b/g)) {
    exports.push({ file, name: match[1], localName: match[1], kind: 'class' });
  }
  for (const match of source.matchAll(/\bexport\s+const\s+([A-Za-z_$][\w$]*)\b/g)) {
    const localName = match[1];
    exports.push({ file, name: localName, localName, kind: inferExportKind(source, localName) });
  }
  for (const block of source.matchAll(/\bexport\s*\{([\s\S]*?)\}\s*;?/g)) {
    for (const item of splitTopLevel(block[1])) {
      const parsed = parseExportEntry(item);
      if (!parsed) continue;
      exports.push({
        file,
        name: parsed.exportName,
        localName: parsed.localName,
        kind: inferExportKind(source, parsed.localName),
      });
    }
  }
  return dedupeExports(exports);
}

function extractCommonJsExports(source, file) {
  const block = findModuleExportsObject(source);
  if (!block) return [];
  const exports = [];
  for (const item of splitTopLevel(stripComments(block))) {
    const parsed = parseExportEntry(item);
    if (!parsed) continue;
    exports.push({
      file,
      name: parsed.exportName,
      localName: parsed.localName,
      kind: inferExportKind(source, parsed.localName),
    });
  }
  return dedupeExports(exports);
}

function findModuleExportsObject(source) {
  const marker = 'module.exports';
  let searchIndex = 0;
  while (searchIndex < source.length) {
    const markerIndex = source.indexOf(marker, searchIndex);
    if (markerIndex === -1) return null;
    const equalsIndex = source.indexOf('=', markerIndex + marker.length);
    const braceIndex = source.indexOf('{', equalsIndex + 1);
    if (equalsIndex !== -1 && braceIndex !== -1) {
      const endIndex = findMatchingBrace(source, braceIndex);
      if (endIndex !== -1) return source.slice(braceIndex + 1, endIndex);
    }
    searchIndex = markerIndex + marker.length;
  }
  return null;
}

function findMatchingBrace(source, startIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = startIndex; index < source.length; index++) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function splitTopLevel(value) {
  const entries = [];
  let start = 0;
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') depth++;
    else if (char === ')' || char === ']' || char === '}') depth--;
    else if (char === ',' && depth === 0) {
      entries.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  entries.push(value.slice(start).trim());
  return entries.filter(Boolean);
}

function parseExportEntry(entry) {
  const clean = entry.trim().replace(/\s+/g, ' ');
  if (!clean) return null;
  const alias = clean.match(/^['"]?([A-Za-z_$][\w$-]*)['"]?\s*:\s*([A-Za-z_$][\w$]*)$/);
  if (alias) return { exportName: alias[1], localName: alias[2] };
  const esmAlias = clean.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
  if (esmAlias) return { exportName: esmAlias[2], localName: esmAlias[1] };
  const shorthand = clean.match(/^([A-Za-z_$][\w$]*)$/);
  if (shorthand) return { exportName: shorthand[1], localName: shorthand[1] };
  return null;
}

function inferExportKind(source, localName) {
  const escaped = escapeRegExp(localName);
  if (new RegExp(`\\b(async\\s+)?function\\s+${escaped}\\s*\\(`).test(source)) return 'function';
  if (new RegExp(`\\bclass\\s+${escaped}\\b`).test(source)) return 'class';
  if (new RegExp(`\\bconst\\s+${escaped}\\s*=\\s*(async\\s*)?(\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\s*=>`).test(source)) return 'function';
  return 'constant';
}

function dedupeExports(exports) {
  const seen = new Set();
  return exports.filter((item) => {
    const key = `${item.file}:${item.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

function findJavaScriptFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...findJavaScriptFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.js')) result.push(fullPath);
  }
  return result.sort((left, right) => left.localeCompare(right));
}

function relativePath(root, file) {
  return path.relative(root, file).replace(/\\/g, '/');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  auditFunctionTests,
  extractPublicExports,
  findAuditedSourceFiles,
};
