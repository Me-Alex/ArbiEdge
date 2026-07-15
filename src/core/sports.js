/**
 * Multi-sport configuration registry.
 */

const SPORTS = {
  football: {
    label: 'Football',
    canonical: 'Football',
    outcomes: { h2h: ['home', 'draw', 'away'] },
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
  handball: {
    label: 'Handball',
    canonical: 'Handball',
    outcomes: { h2h: ['home', 'draw', 'away'] },
    fortuna: 'ufo:sprt:03',
    superbet: '3',
    oddsApi: 'handball_champions_league',
  },
  volleyball: {
    label: 'Volleyball',
    canonical: 'Volleyball',
    outcomes: { h2h: ['home', 'away'] },
    fortuna: 'ufo:sprt:04',
    superbet: '4',
    oddsApi: 'volleyball_serie_a1',
  },
  americanfootball: {
    label: 'American Football',
    canonical: 'American Football',
    outcomes: { h2h: ['home', 'away'] },
    fortuna: 'ufo:sprt:08',
    superbet: '8',
    oddsApi: 'americanfootball_nfl',
  },
  esports: {
    label: 'eSports',
    canonical: 'eSports',
    outcomes: { h2h: ['home', 'away'] },
    fortuna: 'ufo:sprt:15',
    superbet: '15',
    oddsApi: 'csgo_esl_pro_league',
  },
};

const DEFAULT_SPORT = 'football';

function resolveSportKey(value) {
  if (!value) return DEFAULT_SPORT;
  const normalized = String(value).toLowerCase().replace(/\s+/g, '');
  if (SPORTS[normalized]) return normalized;
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

function providerSportId(sportKey, providerName) {
  const sport = SPORTS[sportKey];
  if (!sport) return null;
  return sport[providerName] || null;
}

function marketOutcomes(sportKey, marketKey) {
  const sport = SPORTS[resolveSportKey(sportKey)];
  if (!sport) return null;
  return sport.outcomes[marketKey] || null;
}

function allSportKeys() {
  return Object.keys(SPORTS);
}

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
