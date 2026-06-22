class CompositeProvider {
  constructor(providers) {
    this.name = 'Romanian bookmakers';
    this.providers = providers.filter(Boolean);
  }

  async getOdds() {
    const settled = await Promise.all(
      this.providers.map(async (provider) => {
        try {
          const events = await provider.getOdds();
          return {
            status: { name: provider.name, ok: true, events: events.length },
            events,
          };
        } catch (error) {
          return {
            status: {
              name: provider.name,
              ok: false,
              events: 0,
              error: error.message,
            },
            events: [],
          };
        }
      }),
    );

    return {
      events: mergeEvents(settled.flatMap((result) => result.events)),
      providers: settled.map((result) => result.status),
    };
  }
}

function mergeEvents(events) {
  const merged = new Map();
  for (const event of events) {
    const key = eventKey(event);
    if (!merged.has(key)) {
      merged.set(key, structuredClone(event));
      continue;
    }

    const target = merged.get(key);
    const bookmakers = new Map(
      target.bookmakers.map((bookmaker) => [bookmaker.name, bookmaker]),
    );
    for (const bookmaker of event.bookmakers) {
      bookmakers.set(bookmaker.name, bookmaker);
    }
    target.bookmakers = [...bookmakers.values()];
    target.externalIds = { ...target.externalIds, ...event.externalIds };
  }

  return [...merged.values()].sort(
    (left, right) => new Date(left.startsAt) - new Date(right.startsAt),
  );
}

function eventKey(event) {
  if (event.externalIds?.sportradar) {
    return `sr:${event.externalIds.sportradar}`;
  }
  const teams = [event.homeTeam, event.awayTeam]
    .map(normalizeText)
    .sort()
    .join(':');
  const minute = Math.floor(new Date(event.startsAt).getTime() / 60_000);
  return `fixture:${teams}:${minute}`;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\W/g, '');
}

module.exports = { CompositeProvider, mergeEvents };
