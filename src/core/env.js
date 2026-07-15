/**
 * Environment configuration loader — zero external dependencies.
 */

const fs = require('node:fs');
const path = require('node:path');

function loadEnvFile(filePath) {
  const resolved = filePath || path.join(__dirname, '..', '..', '.env');
  let content;
  try {
    content = fs.readFileSync(resolved, 'utf8');
  } catch {
    return;
  }

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) continue;

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

module.exports = { loadEnvFile };
