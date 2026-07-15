/**
 * Structured logger with levels and optional JSON output.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const LEVEL_NAMES = Object.fromEntries(
  Object.entries(LEVELS).map(([name, val]) => [val, name]),
);

function resolveLevel(level) {
  if (typeof level === 'string' && LEVELS[level] != null) return LEVELS[level];
  if (typeof level === 'number' && LEVEL_NAMES[level]) return level;
  return LEVELS.info;
}

function createLogger({ level = 'info', json = false, prefix = '' } = {}) {
  const minLevel = resolveLevel(level);

  function emit(levelName, message, meta) {
    const numericLevel = LEVELS[levelName];
    if (numericLevel < minLevel) return;

    const timestamp = new Date().toISOString();
    const consoleMethod =
      levelName === 'debug' ? 'log' : levelName === 'warn' ? 'warn' : levelName === 'error' ? 'error' : 'log';

    if (json) {
      const entry = { timestamp, level: levelName, message };
      if (prefix) entry.prefix = prefix;
      if (meta && Object.keys(meta).length) entry.meta = meta;
      console[consoleMethod](JSON.stringify(entry));
    } else {
      const tag = prefix ? `[${prefix}] ` : '';
      const metaStr =
        meta && Object.keys(meta).length
          ? ' ' + JSON.stringify(meta)
          : '';
      console[consoleMethod](`[${timestamp}] ${levelName.toUpperCase()} ${tag}${message}${metaStr}`);
    }
  }

  return {
    debug: (msg, meta) => emit('debug', msg, meta),
    info: (msg, meta) => emit('info', msg, meta),
    warn: (msg, meta) => emit('warn', msg, meta),
    error: (msg, meta) => emit('error', msg, meta),
    child: (opts = {}) =>
      createLogger({
        level,
        json,
        prefix: opts.prefix ? (prefix ? `${prefix}:${opts.prefix}` : opts.prefix) : prefix,
      }),
  };
}

module.exports = { createLogger, LEVELS };
