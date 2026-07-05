/**
 * Minimal .env file loader — no dependencies.
 * Loads KEY=VALUE pairs from .env into process.env, but never overwrites
 * variables that are already set (so systemd EnvironmentFile and shell
 * exports take priority).
 *
 * Usage (at the top of server.js, before reading process.env):
 *   require('./env-loader').loadEnvFile();
 */

const fs = require('node:fs');
const path = require('node:path');

function loadEnvFile(filePath) {
  const resolved = filePath || path.join(__dirname, '..', '.env');
  let content;
  try {
    content = fs.readFileSync(resolved, 'utf8');
  } catch {
    return; // File doesn't exist — silently skip
  }

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) continue;

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Don't override existing env vars
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

module.exports = { loadEnvFile };
