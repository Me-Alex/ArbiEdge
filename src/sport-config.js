/**
 * Multi-sport configuration.
 *
 * Each sport defines:
 * - canonical key (matches event.sport)
 * - display label
 * - which market keys are 2-way vs 3-way
 * - provider sport IDs for bookmakers that use numeric/encoded sport filters
 *
 * Providers check their sport config to decide which sport filter to send
 * to upstream APIs. The formula engine uses the outcome map to validate
 * markets per sport (e.g. tennis has no draw).
 */

const SPORTS = {
  football: {
    label: 'Football',
    canonical: 'Football',
    outcomes: { h2h: ['home', 'draw', 'away'] },
    // provider-specific sport IDs
    fortuna: 'ufo:sprt:00',
    superbet: '5',
    oddsApi: 'soccer_fifa_world_cup',
  },
  basketball: {
    label: 'Basketball',
    canonical: 'Basketball',
    outcomes: { h2h: ['home', 'away'] },
    fortuna: 'ufo:sprt:02',
    superbet: '2',
    oddsApi: 'basketball_nba',
  },
  tennis: {
    label: 'Tennis',
    canonical: 'Tennis',
    outcomes: { h2h: ['home', 'away'] },
    fortuna: 'ufo:sprt:05',
    superbet: '7',
    oddsApi: 'tennis_atp_aus_open_singles',
  },
  icehockey: {
    label: 'Ice Hockey',
    canonical: 'Ice Hockey',
    outcomes: { h2h: ['home', 'draw', 'away'] },
    fortuna: 'ufo:sprt:06',
    superbet: '6',
    oddsApi: 'icehockey_nhl',
  },
};

const DEFAULT_SPORT = 'football';

/**
 * Resolve a sport key from environment or config.
 * Accepts the canonical key (e.g. 'football') or the display label
 * (e.g. 'Football', 'Ice Hockey').
 */
function resolveSportKey(value) {
  if (!value) return DEFAULT_SPORT;
  const normalized = String(value).toLowerCase().replace(/\s+/g, '');
  if (SPORTS[normalized]) return normalized;
  // match by label
  for (const [key, sport] of Object.entries(SPORTS)) {
    if (sport.label.toLowerCase().replace(/\s+/g, '') === normalized) {
      return key;
    }
  }
  return DEFAULT_SPORT;
}

function sportLabel(key) {
  return SPORTS[key]?.label || key;
}

function sportCanonical(key) {
  return SPORTS[key]?.canonical || key;
}

/**
 * Parse a comma-separated sport list from env.
 * Returns an array of canonical sport labels.
 */
function parseSportList(value) {
  if (!value) return [SPORTS[DEFAULT_SPORT].canonical];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((key) => {
      const resolved = resolveSportKey(key);
      return SPORTS[resolved]?.canonical || key;
    });
}

/**
 * Get provider sport ID for a given sport key and provider.
 */
function providerSportId(sportKey, providerName) {
  const sport = SPORTS[sportKey];
  if (!sport) return null;
  return sport[providerName] || null;
}

/**
 * Market outcome expectations per sport.
 * Used by the formula engine to validate markets.
 */
function marketOutcomes(sportKey, marketKey) {
  const sport = SPORTS[sportKey];
  if (!sport) return null;
  return sport.outcomes[marketKey] || null;
}

/**
 * All sport keys.
 */
function allSportKeys() {
  return Object.keys(SPORTS);
}

/**
 * All sport labels for UI dropdowns.
 */
function allSportOptions() {
  return Object.entries(SPORTS).map(([key, sport]) => ({
    key,
    label: sport.label,
  }));
}

module.exports = {
  SPORTS,
  DEFAULT_SPORT,
  resolveSportKey,
  sportLabel,
  sportCanonical,
  parseSportList,
  providerSportId,
  marketOutcomes,
  allSportKeys,
  allSportOptions,
};
