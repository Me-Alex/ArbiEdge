# Romanian Bookmaker Provider Coverage - 2026-06-29

This file tracks implementation progress against Romanian licensed online
operators observed on the ONJN class I licensed-operator page during the
2026-06-29 work session. It is a working engineering checklist, not a legal
source of truth.

The machine-readable tracker is `src/bookmaker-coverage.js`. Current registry
counts are: 29 direct providers, 1 browser-optional provider, 19 remaining
provider targets, 9 licensed domains that still need sportsbook triage, and
2 tracked licensed domains without visible sportsbook markets. 1 previously
licensed sportsbook domain is tracked as inactive, and 1 licensed domain is
temporarily unavailable.
The app exposes the same registry at `GET /api/bookmakers`, and the dashboard
coverage line combines live source health with implemented-bookmaker progress.
The default server provider configuration lives in `src/provider-config.js`;
`test/provider-config.test.js` verifies that every `direct` registry entry is
actually loaded by the default runtime.

## Implemented Directly

| Bookmaker / brand | Adapter |
| --- | --- |
| Fortuna | `FortunaProvider` |
| Casa Pariurilor | `CasaPariurilorProvider` |
| Superbet | `SuperbetProvider` |
| BetOne | `BetOneProvider` |
| Betfair | `BetfairProvider` |
| Betmen | `BetmenProvider` |
| GetsBet | `GetsBetProvider` |
| Winner | `WinnerProvider` |
| 888 | `EightEightEightProvider` |
| MrPlay | `MrPlayProvider` |
| Bet7 | `NewGamblingBrandsProvider` |
| HotSpins | `NewGamblingBrandsProvider` |
| EliteSlots | `NewGamblingBrandsProvider` |
| LadyCasino | `NewGamblingBrandsProvider` |
| Pacanele | `NewGamblingBrandsProvider` |
| LasVegas | `LasVegasProvider` |
| MaxBet | `MaxBetProvider` |
| NetBet | `NetBetProvider` |
| Winbet | `WinbetProvider` |
| VivaBet | `EgtProvider` via `createVivaGamesProviders` |
| LuckySeven | `EgtProvider` via `createVivaGamesProviders` |
| OneCasino | `EgtProvider` via `createVivaGamesProviders` |
| FortunaPalace | `EgtProvider` via `createVivaGamesProviders` |
| MaxWin | `EgtProvider` via `createVivaGamesProviders` |
| UltraBet | `EgtProvider` via `createVivaGamesProviders` |
| Prowin | `EgtProvider` via `createVivaGamesProviders` |
| CherryBet | `EgtProvider` via `createVivaGamesProviders` |
| VipBet | `EgtProvider` via `createVivaGamesProviders` |
| Unibet | `UnibetProvider` |

## Browser-Optional

| Bookmaker / brand | Status |
| --- | --- |
| Betano | Implemented behind `BETANO_BROWSER_ENABLED=1`; requires local Chrome and may be blocked by challenge/CAPTCHA. |

## High-Priority Remaining Targets

These were observed as licensed domains with fixed-odds betting and are not
yet implemented as deterministic direct providers.

| Domain / brand | Current research note |
| --- | --- |
| `favbet.ro` | Public app loads `alfFrontStatic` bundles; endpoint discovery still needed. |
| `mozzartbet.ro` | Returned Cloudflare 521 during research; retry later. |
| `stanleybet.ro` | Angular SSR app; TransferState and minified `comtrade`/`navatar` config need deeper parsing. |
| `gameworld.ro` | Same family as Stanleybet; likely reusable once one brand is decoded. |
| `admiralbet.ro` | Same family as Stanleybet; likely reusable once one brand is decoded. |
| `777.ro` | Same family as Stanleybet; sports feature present but endpoint still hidden in config. |
| `seven.ro` | Megabet/Stanleybet-family sports page observed; endpoint discovery needed. |
| `redsevens.ro` | Megabet/Stanleybet-family sports page and sports-betting copy observed; endpoint discovery needed. |
| `gpcasino.ro` | Megabet/Stanleybet-family sports navigation observed; endpoint discovery needed. |
| `victorybet.ro` | Betco app shell observed; endpoint discovery needed. |
| `xbet.ro` | Returned HTTP 401 during research; may need browser headers or is unavailable from current environment. |
| `zinx.ro` / `topbet.ro` | Angular app observed; endpoint discovery needed. |
| `pokerstarssports.ro` | PokerStars sports app observed; endpoint discovery needed. |
| `winboss.ro` | Winvia/Crowd Entertainment sportsbook page and ONJN license text observed; endpoint discovery needed. |
| `powerbet.ro` | Winvia/Crowd Entertainment sportsbook page and ONJN license text observed; endpoint discovery needed. |
| `magnumbet.ro` | Winvia/Crowd Entertainment sportsbook page and ONJN license text observed; endpoint discovery needed. |
| `excelbet.ro` | Winvia/Crowd Entertainment sportsbook page and ONJN license text observed; endpoint discovery needed. |
| `spin.ro` | Sports route and betting links observed; endpoint discovery needed. |
| `royalslots.ro` | Prematch/sports navigation observed; endpoint discovery needed. |

## Tracked Non-Sportsbook Domains

These licensed domains are kept in the registry for audit completeness, but
they are not counted as remaining sportsbook provider targets until a sports
betting surface is observed.

| Domain / brand | Current research note |
| --- | --- |
| `win2.ro` | Casino and live-casino platform observed; no sportsbook navigation or fixed-odds markets were visible at `https://www.win2.ro/`. |
| `playgg.ro` | Redirects to a GGPoker poker site; no sportsbook markets were visible at `https://playgg.ro/`. |

## Tracked Inactive Domains

These licensed sportsbook domains are kept for audit completeness but are not
counted as unfinished provider targets because they have publicly announced
that Romanian operations have ended.

| Domain / brand | Current research note |
| --- | --- |
| `publicwin.ro` | PublicWin announced that it ceased Romanian operations on 2025-12-30 at `https://publicwin.ro`. |

## Tracked Temporarily Unavailable Domains

These licensed domains are kept for audit completeness but are not counted as
unfinished provider targets while the public site has no available sportsbook
surface.

| Domain / brand | Current research note |
| --- | --- |
| `orientalcasino.ro` | The public site shows a maintenance page at `https://www.orientalcasino.ro/` and no sportsbook markets are currently visible. |

## Research Utilities Added

- `src/providers/angular-transfer-state.js` extracts Angular SSR
  TransferState HTTP-cache entries from bookmaker HTML. This is intended for
  the Stanleybet/GameWorld/AdmiralBet/777 family, where the sport app exposes
  cached API URLs and response bodies in inline JSON before the browser app
  hydrates.
- `src/providers/bookmaker-discovery.js` and `scripts/discover-bookmaker.js`
  extract script URLs, TransferState URLs, and likely API candidates from a
  bookmaker page plus its JavaScript bundles. Run
  `node scripts/discover-bookmaker.js https://www.stanleybet.ro/pariuri-sportive`
  when network access is available to produce endpoint evidence for a new
  adapter.
- Every `remainingProvider` registry entry has a `discoveryUrl`. Run
  `node scripts/discover-remaining-bookmakers.js` to scan all remaining
  provider targets in one pass, or set `DISCOVERY_TARGETS=PowerBet,Winboss`
  to scan a subset. Use `node scripts/discover-remaining-bookmakers.js --list`
  to print the 19 target URLs without making network requests.

## Next Best Actions

1. Run the bookmaker discovery script for Stanleybet/GameWorld/AdmiralBet/777 and build one reusable adapter if their sport API is public.
2. Run the bookmaker discovery script for Favbet, then retry with browser network logging if the static bundles do not expose the endpoint.
3. Retry MozzartBet and PublicWin when upstream/network access is available.
4. Keep adding provider contract tests for every adapter before enabling it in `src/server.js`.
