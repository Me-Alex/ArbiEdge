const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const SKIPPED_DIRS = new Set([
  '.git',
  'coverage',
  'node_modules',
  'output',
  'tmp',
]);

const files = findJavaScriptFiles(ROOT);
const failures = [];

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    failures.push({
      file: path.relative(ROOT, file),
      output: [result.stdout, result.stderr].filter(Boolean).join('\n').trim(),
    });
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`\n${failure.file}`);
    console.error(failure.output);
  }
  process.exitCode = 1;
} else {
  console.log(`JS syntax ok: ${files.length} files`);
}

function findJavaScriptFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const result = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.env.example') {
      continue;
    }

    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) {
        result.push(...findJavaScriptFiles(fullPath));
      }
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.js')) {
      result.push(fullPath);
    }
  }

  return result.sort((left, right) => left.localeCompare(right));
}
