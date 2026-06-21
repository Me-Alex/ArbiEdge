class DemoOddsProvider {
  constructor({ now = () => new Date() } = {}) {
    this.now = now;
  }

  async getOdds() {
    const baseTime = this.now().getTime();
    const fixtures = [
      ['demo-romania-brazil', 'FIFA World Cup', 2, 'Romania', 'Brazil'],
      ['demo-spain-japan', 'FIFA World Cup', 4.5, 'Spain', 'Japan'],
      ['demo-france-argentina', 'International', 21, 'France', 'Argentina'],
      ['demo-rapid-fcsb', 'Romania Liga 1', 27, 'Rapid București', 'FCSB'],
    ];

    return fixtures.map(
      ([id, competition, hoursFromNow, homeTeam, awayTeam], index) => ({
        id,
        sport: 'Football',
        competition,
        startsAt: new Date(
          baseTime + hoursFromNow * 60 * 60 * 1000,
        ).toISOString(),
        homeTeam,
        awayTeam,
        bookmakers: createBookmakers(index, baseTime),
      }),
    );
  }
}

function createBookmakers(eventIndex, baseTime) {
  const homeBase = 1.85 + eventIndex * 0.37;
  const awayBase = 3.65 - eventIndex * 0.28;

  return [
    createBookmaker('Betano (sample)', homeBase, 3.35, awayBase, baseTime),
    createBookmaker(
      'Fortuna (sample)',
      homeBase + 0.08,
      3.3,
      awayBase - 0.05,
      baseTime,
    ),
    createBookmaker(
      'Market average (sample)',
      homeBase - 0.04,
      3.4,
      awayBase + 0.07,
      baseTime,
    ),
  ];
}

function createBookmaker(name, home, draw, away, baseTime) {
  return {
    name,
    lastUpdate: new Date(baseTime).toISOString(),
    markets: {
      h2h: {
        home: round(home),
        draw: round(draw),
        away: round(away),
      },
      drawNoBet: {
        home: round(Math.max(1.05, home - 0.32)),
        away: round(Math.max(1.05, away - 0.72)),
      },
    },
  };
}

function round(value) {
  return Math.round(value * 100) / 100;
}

module.exports = { DemoOddsProvider };
