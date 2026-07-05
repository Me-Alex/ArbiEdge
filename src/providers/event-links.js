const BOOKMAKER_FOOTBALL_URLS = {
  Betano: 'https://ro.betano.com/sport/fotbal/',
  Betfair: 'https://www.betfair.ro/pariuri/fotbal/s-1',
  Betmen: 'https://agentii.betmen.ro/',
  BetOne: 'https://sportsbook.betone.ro/',
  Bet7: 'https://www.bet7.ro/sport',
  'Casa Pariurilor': 'https://www.casapariurilor.ro/pariuri-online/fotbal',
  CherryBet: 'https://cherrybet.ro/sports',
  EliteSlots: 'https://www.eliteslots.ro/sport',
  FortunaPalace: 'https://fortunapalace.ro/sports',
  Fortuna: 'https://efortuna.ro/pariuri-online/fotbal',
  GetsBet: 'https://www.getsbet.ro/sports',
  HotSpins: 'https://www.hotspins.ro/sport',
  LadyCasino: 'https://www.ladycasino.ro/sport',
  LasVegas: 'https://www.lasvegas.ro/sport',
  LuckySeven: 'https://luckyseven.ro/sports',
  MaxBet: 'https://www.maxbet.ro/ro/pariuri-sportive',
  MaxWin: 'https://maxwin.ro/sports',
  MrPlay: 'https://www.mrplay.ro/sport/fotbal',
  NetBet: 'https://sport.netbet.ro/fotbal/',
  OneCasino: 'https://onecasino.ro/sports',
  Pacanele: 'https://www.pacanele.ro/sport',
  Prowin: 'https://prowin.ro/sports',
  Superbet: 'https://superbet.ro/pariuri-sportive/fotbal',
  Stanleybet: 'https://www.stanleybet.ro/pariuri-sportive/fotbal',
  GameWorld: 'https://www.gameworld.ro/pariuri-sportive/fotbal',
  AdmiralBet: 'https://www.admiralbet.ro/pariuri-sportive/fotbal',
  Seven: 'https://www.seven.ro/pariuri-sportive/fotbal',
  RedSevens: 'https://www.redsevens.ro/pariuri-sportive/fotbal',
  GPCasino: 'https://www.gpcasino.ro/pariuri-sportive/fotbal',
  UltraBet: 'https://ultrabet.ro/sports',
  Unibet: 'https://www.unibet.ro/betting/odds/football',
  VipBet: 'https://vipbet.ro/sports',
  VivaBet: 'https://vivabet.ro/sports',
  Winner: 'https://www.winner.ro/sport/fotbal',
  Winbet: 'https://winbet.ro/sports',
  888: 'https://www.888.ro/sport',
};

const UFO_ORIGINS = {
  'Casa Pariurilor': 'https://www.casapariurilor.ro',
  Fortuna: 'https://efortuna.ro',
};

function bookmakerFootballUrl(bookmaker) {
  return BOOKMAKER_FOOTBALL_URLS[bookmaker] || null;
}

function bookmakerLinkFields(bookmaker, eventUrl, fallbackUrl = bookmakerFootballUrl(bookmaker)) {
  return {
    ...(eventUrl ? { eventUrl } : {}),
    ...(fallbackUrl ? { bookmakerUrl: fallbackUrl } : {}),
  };
}

function absoluteEventUrl(value, origin) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) {
    return null;
  }

  try {
    return new URL(raw, origin).toString();
  } catch {
    return null;
  }
}

function digitainEventUrl(origin, event) {
  if (
    !origin ||
    !event?.idSport ||
    !event?.idCategory ||
    !event?.idTournament ||
    !event?.idMatch
  ) {
    return null;
  }

  return absoluteEventUrl(
    `/bets/match/pre-match/${event.idSport}/${event.idCategory}/${event.idTournament}/${event.idMatch}`,
    origin,
  );
}

function egtEventUrl(origin, event) {
  const eventId = event?.sportEventId || event?.eventId;
  if (!origin || !eventId) {
    return null;
  }

  return absoluteEventUrl(
    `/sports/event/${slugPathPart(event.eventPath || event.eventTitle)}-${eventId}`,
    origin,
  );
}

function betOneEventUrl(event) {
  const fixtureId = event?.fixtureId || event?.fixture_id;
  if (!fixtureId) {
    return null;
  }
  return absoluteEventUrl(`/event/${fixtureId}`, 'https://sportsbook.betone.ro');
}

function netbetEventUrl(event) {
  const rawId = String(event?.id || '').split('-').pop();
  const sportSlug = slugPathPart(event?.translated_sport_slug || event?.sport_slug || 'fotbal');
  const competitionSlug = slugPathPart(
    event?.translated_competition_slug ||
      event?.competition_slug ||
      event?.competition_name,
  );
  const eventSlug = slugPathPart(event?.name || event?.event_name);
  if (!rawId || !sportSlug || !competitionSlug || !eventSlug) {
    return null;
  }

  return absoluteEventUrl(
    `/${sportSlug}/${competitionSlug}/${eventSlug}-${rawId}/`,
    'https://sport.netbet.ro',
  );
}

function getsBetEventUrl(event) {
  const matchId = event?.id || event?.matchId;
  const homeTeam = event?.homeParticipantName || event?.homeTeam;
  const awayTeam = event?.awayParticipantName || event?.awayTeam;
  if (!matchId || !homeTeam || !awayTeam) {
    return null;
  }

  const location = slugPathPart(event?.venueName || event?.categoryName || 'fotbal');
  const tournament = slugPathPart(event?.shortParentName || event?.parentName || 'eveniment');
  const teams = slugPathPart(`${homeTeam}-${awayTeam}`);
  return absoluteEventUrl(
    `/ro/eveniment/1/fotbal/${location}/${tournament}/${teams}/${matchId}/populare`,
    'https://sports2.getsbet.ro',
  );
}

function xsportEventUrl(origin, event, { sportSlug = 'fotbal' } = {}) {
  if (!origin || !event?.a || !event?.p || !event?.it || !event?.ic) {
    return null;
  }

  const tournament = slugPathPart(event.tournamentName || event.tournament || '');
  const eventSlug = slugPathPart(localizedXsportText(event.dsl));
  if (!tournament || !eventSlug) {
    return null;
  }

  return absoluteEventUrl(
    `/sport/${sportSlug}/${tournament}/${eventSlug}_1_${event.ic}_${event.it}_${event.p}_${event.a}`,
    origin,
  );
}

function superbetEventUrl(event) {
  const eventId = event?.eventId || event?.offerId || event?.event_id;
  const teams = splitEventTeams(event?.matchName || event?.event_name || event?.name);
  if (!eventId || teams.length !== 2) {
    return null;
  }

  return absoluteEventUrl(
    `/cote/fotbal/${slugPathPart(`${teams[0]} vs ${teams[1]}`)}-${eventId}`,
    'https://superbet.ro',
  );
}

function ufoEventUrl(bookmaker, fixture) {
  const origin = UFO_ORIGINS[bookmaker];
  if (
    !origin ||
    !fixture?.sportSeoName ||
    !fixture?.categorySeoName ||
    !fixture?.tournamentSeoName ||
    !fixture?.seoName
  ) {
    return null;
  }

  const path = [
    'pariuri-online',
    fixture.sportSeoName,
    fixture.categorySeoName,
    fixture.tournamentSeoName,
    fixture.seoName,
  ].join('/');

  return `${origin}/${path}?filter=all&tab=offer`;
}

function unibetEventUrl(contest) {
  const explicitUrl = absoluteEventUrl(
    contest?.url || contest?.eventUrl || contest?.webUrl,
    'https://www.unibet.ro',
  );
  if (explicitUrl) {
    return explicitUrl;
  }

  const category = String(contest?.category || '');
  if (!contest?.contestKey || !contest?.name || !category.startsWith('football:')) {
    return null;
  }

  const categoryPath = category
    .split(':')
    .map(slugPathPart)
    .filter(Boolean)
    .join('/');
  const eventSlug = slugPathPart(contest.name);
  if (!categoryPath || !eventSlug) {
    return null;
  }

  return absoluteEventUrl(
    `/betting/odds/${categoryPath}/${eventSlug}/${encodeURIComponent(contest.contestKey)}`,
    'https://www.unibet.ro',
  );
}

function splitEventTeams(value) {
  return String(value || '')
    .split(/\s+-\s+|\u00c2\u00b7|\u00b7|\s+vs\s+/i)
    .map((item) => item.trim())
    .filter(Boolean);
}

function slugPathPart(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

function localizedXsportText(value) {
  if (typeof value === 'string') {
    return value;
  }
  return value?.RO || value?.EN || value?.ORIGINAL_FROM_DB || Object.values(value || {})[0] || '';
}

module.exports = {
  absoluteEventUrl,
  betOneEventUrl,
  bookmakerFootballUrl,
  bookmakerLinkFields,
  digitainEventUrl,
  egtEventUrl,
  getsBetEventUrl,
  netbetEventUrl,
  slugPathPart,
  superbetEventUrl,
  ufoEventUrl,
  unibetEventUrl,
  xsportEventUrl,
};
