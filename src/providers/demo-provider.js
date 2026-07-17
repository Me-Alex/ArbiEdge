const { bookmakerFootballUrl } = require('./event-links');

class DemoOddsProvider {
  constructor({ now = () => new Date() } = {}) {
    this.now = now;
  }

  async getOdds() {
    const baseTime = this.now().getTime();
    const fixtures = [
      // Football
      ['demo-romania-brazil', 'Football', 'FIFA World Cup', 2, 'Romania', 'Brazil'],
      ['demo-spain-japan', 'Football', 'FIFA World Cup', 4.5, 'Spain', 'Japan'],
      ['demo-france-argentina', 'Football', 'International', 21, 'France', 'Argentina'],
      ['demo-portugal-mexico', 'Football', 'International', 31, 'Portugal', 'Mexico'],
      ['demo-netherlands-denmark', 'Football', 'International', 35, 'Netherlands', 'Denmark'],
      ['demo-cfr-craiova', 'Football', 'Romania Liga 1', 49, 'CFR Cluj', 'Universitatea Craiova'],
      ['demo-italy-croatia', 'Football', 'International', 54, 'Italy', 'Croatia'],
      ['demo-rapid-fcsb', 'Football', 'Romania Liga 1', 27, 'Rapid București', 'FCSB'],
      // Basketball (2-way: no draw)
      ['demo-lakers-celtics', 'Basketball', 'NBA', 3, 'LA Lakers', 'Boston Celtics'],
      ['demo-real-baskonia', 'Basketball', 'EuroLeague', 6, 'Real Madrid', 'Baskonia'],
      // Tennis (2-way: no draw)
      ['demo-alcaraz-sinner', 'Tennis', 'ATP Finals', 5, 'Alcaraz', 'Sinner'],
      ['demo-djokovic-medvedev', 'Tennis', 'ATP Finals', 8, 'Djokovic', 'Medvedev'],
    ];

    return fixtures.map(
      ([id, sport, competition, hoursFromNow, homeTeam, awayTeam], index) => ({
        id,
        sport,
        competition,
        startsAt: new Date(
          baseTime + hoursFromNow * 60 * 60 * 1000,
        ).toISOString(),
        homeTeam,
        awayTeam,
        bookmakers: createBookmakers(index, baseTime, sport),
      }),
    );
  }
}

function createBookmakers(eventIndex, baseTime, sport) {
  const homeBase = 1.85 + eventIndex * 0.37;
  const awayBase = 3.65 - eventIndex * 0.28;

  return [
    createBookmaker('Betano (sample)', homeBase, 3.35, awayBase, baseTime, eventIndex, 0, sport),
    createBookmaker(
      'Fortuna (sample)',
      homeBase + 0.08,
      3.3,
      awayBase - 0.05,
      baseTime,
      eventIndex,
      1,
      sport,
    ),
    createBookmaker(
      'Market average (sample)',
      homeBase - 0.04,
      3.4,
      awayBase + 0.07,
      baseTime,
      eventIndex,
      2,
      sport,
    ),
  ];
}

function createBookmaker(name, home, draw, away, baseTime, eventIndex, bookmakerIndex, sport) {
  const liveBookmakerName = name.replace(/\s+\(sample\)$/, '');
  const tilt = bookmakerIndex * 0.08 + eventIndex * 0.03;
  const isTwoWay = sport === 'Basketball' || sport === 'Tennis';

  const markets = {
    h2h: isTwoWay
      ? { home: round(home), away: round(away) }
      : { home: round(home), draw: round(draw), away: round(away) },
  };

  // Asian handicap applies to all sports
  markets.asianHandicap_plus_0_5 = {
    home: round(1.52 + bookmakerIndex * 0.09 + eventIndex * 0.02),
    away: round(2.38 + bookmakerIndex * 0.06),
  };
  markets.asianHandicap_minus_0_5 = {
    home: round(2.26 + bookmakerIndex * 0.08),
    away: round(1.61 + eventIndex * 0.03),
  };

  // Totals apply to all sports
  markets.totalGoals_2_5 = {
    over: round(1.82 + tilt),
    under: round(1.96 + eventIndex * 0.03 - bookmakerIndex * 0.02),
  };

  if (!isTwoWay) {
    // Football-only markets
    markets.drawNoBet = {
      home: round(Math.max(1.05, home - 0.32)),
      away: round(Math.max(1.05, away - 0.72)),
    };
    markets.asianHandicap_plus_0_75 = {
      home: round(1.76 + bookmakerIndex * 0.08 + eventIndex * 0.02),
      away: round(2.02 + bookmakerIndex * 0.05),
    };
    markets.asianHandicap_plus_1 = {
      home: round(1.92 + bookmakerIndex * 0.08 + eventIndex * 0.02),
      away: round(1.86 + bookmakerIndex * 0.05),
    };
    markets.asianHandicap_minus_0_75 = {
      home: round(2.48 + bookmakerIndex * 0.08),
      away: round(1.48 + eventIndex * 0.03),
    };
    markets.asianHandicap_minus_1 = {
      home: round(2.72 + bookmakerIndex * 0.09),
      away: round(1.38 + eventIndex * 0.02),
    };
    markets.doubleChance = {
      homeDraw: round(1.34 + tilt),
      homeAway: round(1.28 + bookmakerIndex * 0.04),
      drawAway: round(1.58 + eventIndex * 0.05 - bookmakerIndex * 0.03),
    };
    markets.firstHalfH2h = {
      home: round(home + 0.58),
      draw: round(2.02 + bookmakerIndex * 0.09),
      away: round(away + 0.65),
    };
    markets.firstHalfDoubleChance = {
      homeDraw: round(1.24 + tilt),
      homeAway: round(1.42 + bookmakerIndex * 0.05),
      drawAway: round(1.36 + eventIndex * 0.04),
    };
    markets.secondHalfH2h = {
      home: round(home + 0.38),
      draw: round(2.65 + bookmakerIndex * 0.08),
      away: round(away + 0.42),
    };
    markets.secondHalfDoubleChance = {
      homeDraw: round(1.31 + tilt),
      homeAway: round(1.36 + bookmakerIndex * 0.05),
      drawAway: round(1.48 + eventIndex * 0.04),
    };
    markets.bothTeamsToScore = {
      yes: round(1.74 + bookmakerIndex * 0.07),
      no: round(2.06 + eventIndex * 0.04 - bookmakerIndex * 0.03),
    };
    markets.market_marcheaza_home = {
      yes: round(1.38 + bookmakerIndex * 0.07 + eventIndex * 0.02),
      no: round(3.05 + eventIndex * 0.08 - bookmakerIndex * 0.04),
    };
    markets.market_marcheaza_away = {
      yes: round(1.58 + bookmakerIndex * 0.07 + eventIndex * 0.02),
      no: round(2.58 + eventIndex * 0.08 - bookmakerIndex * 0.04),
    };
    markets.market_clean_sheet_home = {
      yes: round(2.18 + eventIndex * 0.06 - bookmakerIndex * 0.03),
      no: round(1.64 + bookmakerIndex * 0.05),
    };
    markets.market_clean_sheet_away = {
      yes: round(2.72 + eventIndex * 0.07 - bookmakerIndex * 0.04),
      no: round(1.44 + bookmakerIndex * 0.05),
    };
    markets.totalGoals_3_5 = {
      over: round(2.62 + bookmakerIndex * 0.11),
      under: round(1.47 + eventIndex * 0.02),
    };
    markets.firstHalfTotalGoals_1_5 = {
      over: round(2.34 + bookmakerIndex * 0.12),
      under: round(1.58 + eventIndex * 0.03),
    };
    markets.secondHalfTotalGoals_1_5 = {
      over: round(2.02 + bookmakerIndex * 0.1),
      under: round(1.76 + eventIndex * 0.03),
    };
    markets.totalCorners_8_5 = {
      over: round(1.9 + bookmakerIndex * 0.08),
      under: round(1.9 + eventIndex * 0.02),
    };
    markets.totalCorners_9 = {
      over: round(2.42 + bookmakerIndex * 0.15),
      under: round(2.36 + eventIndex * 0.04),
    };
    markets.totalCorners_9_5 = {
      over: round(2.08 + bookmakerIndex * 0.09),
      under: round(1.78 + eventIndex * 0.02),
    };
    markets.totalCards_3_5 = {
      over: round(1.68 + bookmakerIndex * 0.06),
      under: round(2.18 + eventIndex * 0.03),
    };
    markets.totalCards_4 = {
      over: round(2.18 + bookmakerIndex * 0.12),
      under: round(2.12 + eventIndex * 0.04),
    };
    markets.totalCards_4_5 = {
      over: round(2.54 + bookmakerIndex * 0.13),
      under: round(1.55 + eventIndex * 0.03),
    };
    markets.asianTotalGoals_2_25 = {
      over: round(1.94 + bookmakerIndex * 0.07),
      under: round(1.88 + eventIndex * 0.02),
    };
    markets.asianTotalGoals_2_75 = {
      over: round(2.18 + bookmakerIndex * 0.09),
      under: round(1.7 + eventIndex * 0.02),
    };
    markets.totalGoals_1_5 = {
      over: round(1.38 + bookmakerIndex * 0.05),
      under: round(3.05 + eventIndex * 0.04),
    };
    markets.totalGoals_4_5 = {
      over: round(4.2 + bookmakerIndex * 0.15),
      under: round(1.22 + eventIndex * 0.02),
    };
    markets.toQualify = {
      home: round(Math.max(1.08, home - 0.18)),
      away: round(Math.max(1.08, away - 0.35)),
    };
    markets.market_total_goluri_home_0_5 = {
      over: round(1.28 + bookmakerIndex * 0.04),
      under: round(3.55 + eventIndex * 0.05),
    };
    markets.market_total_goluri_away_0_5 = {
      over: round(1.48 + bookmakerIndex * 0.05),
      under: round(2.65 + eventIndex * 0.05),
    };
    markets.market_total_goluri_home_1_5 = {
      over: round(2.15 + bookmakerIndex * 0.08 + eventIndex * 0.02),
      under: round(1.72 + eventIndex * 0.03),
    };
    markets.market_total_goluri_away_1_5 = {
      over: round(2.45 + bookmakerIndex * 0.09 + eventIndex * 0.02),
      under: round(1.55 + eventIndex * 0.03),
    };
  }

  if (!isTwoWay && eventIndex === 0) {
    if (bookmakerIndex === 0) {
      markets.bothTeamsToScore = { yes: 3.10, no: 1.40 };
      markets.totalGoals_2_5 = { over: 3.10, under: 1.40 };
    } else if (bookmakerIndex === 1) {
      markets.market_marcheaza_home = { yes: 1.40, no: 3.10 };
      markets.market_total_goluri_home_1_5 = { over: 1.40, under: 3.10 };
    } else if (bookmakerIndex === 2) {
      markets.market_marcheaza_away = { yes: 1.40, no: 3.10 };
      markets.market_total_goluri_away_1_5 = { over: 1.40, under: 3.10 };
    }
  }

  return {
    name,
    lastUpdate: new Date(baseTime).toISOString(),
    ...(bookmakerFootballUrl(liveBookmakerName)
      ? { bookmakerUrl: bookmakerFootballUrl(liveBookmakerName) }
      : {}),
    markets,
  };
}

function round(value) {
  return Math.round(value * 100) / 100;
}

module.exports = { DemoOddsProvider };
