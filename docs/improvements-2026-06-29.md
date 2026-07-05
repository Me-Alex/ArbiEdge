# OddsScraper Improvement Backlog - 2026-06-29

Context from the latest local audit:

- Runtime: `http://localhost:3000`
- Live mode: direct Romanian bookmaker adapters plus optional Betano browser mode
- Live event count observed before the latest restricted-network resume: 664
- Current direct provider coverage is tracked in `docs/provider-coverage-2026-06-29.md`
- Normalized market keys observed: 1,462
- Current invariant audit from full local tests: 0 failing provider contract tests
- High-risk area: false positives from generic market classification, fuzzy event matching, and formula validation
- Provider research helper added: `src/providers/angular-transfer-state.js` for extracting Angular SSR cached API entries from Stanleybet-family pages.
- Provider discovery helper added: `src/providers/bookmaker-discovery.js` plus `scripts/discover-bookmaker.js` for extracting API candidates from bookmaker HTML and JavaScript bundles.
- Machine-readable coverage registry added: `src/bookmaker-coverage.js` tracks direct, browser-optional, remaining-provider, and sportsbook-triage domains.
- Bookmaker coverage is exposed through `GET /api/bookmakers` and shown in the dashboard coverage indicator.
- Provider wiring extracted to `src/provider-config.js`; tests now verify every `direct` coverage entry is loaded by the default server provider configuration.
- Powerbet and Winboss were promoted from sportsbook triage to remaining-provider targets after public sportsbook pages and ONJN license text were observed.
- Every remaining-provider target now carries a `discoveryUrl`; `scripts/discover-remaining-bookmakers.js` can list targets offline, scan all remaining targets, or scan a selected subset.
- Betmen direct provider added from the public `agentii.betmen.ro` sports board; parser covers 1X2 and double-chance rows from rendered markup.
- Betfair direct provider added from the public Romanian football sportsbook page; parser covers rendered 1X2 football rows and direct event links.
- Win2 and PlayGG are now tracked as licensed non-sportsbook domains instead of remaining sportsbook provider targets, based on visible casino-only and poker-only surfaces.
- PublicWin is now tracked as inactive instead of a remaining-provider target after its public Romanian shutdown notice dated 2025-12-30 was observed.
- OrientalCasino is now tracked as temporarily unavailable after the public site showed only a maintenance page with no visible sportsbook markets.
- Seven, RedSevens, and GPCasino were promoted from sportsbook triage to remaining-provider targets after Megabet/Stanleybet-family sports surfaces were observed.
- Magnumbet, Excelbet, Spin, and RoyalSlots were promoted to remaining-provider targets after visible sport or prematch pages were observed.
- Arbitrage scanner now models team-total formulas that combine home team total, away team total, and match total lines, using markets already extracted by multiple providers.
- Arbitrage scanner now models team-to-score plus BTTS formulas, including team-total 0.5 markets as equivalent team-score inputs.
- Provider defaults now request more detail events, categories, lookahead days, and EGT markets where public endpoints support it.
- BetOne, EGT, and NetBet now keep extra complete 2/3-outcome markets through a generic normalizer instead of discarding unknown market templates.
- Fuzzy event matching now blocks mismatched fixture variants such as women vs senior, youth vs senior, reserve-team mismatches, and esports vs non-esports before merging bookmaker odds.

## Odds Correctness And Validation

001. Move decimal-odds validation into a shared normalization contract that every provider must call before returning events.
002. Add a server-side odds invariant audit module for invalid odds, double chance, draw no bet, totals monotonicity, and same-book underrounds.
003. Run the invariant audit automatically after every live refresh and expose failures in provider warnings.
004. Add a quarantine bucket for suspicious markets instead of silently discarding them.
005. Store raw market identifiers beside every normalized market for traceability.
006. Store raw outcome identifiers beside every normalized outcome for traceability.
007. Add a debug panel that shows how a normalized odd was derived from raw provider data.
008. Add provider-level tests for `odds <= 1`, missing odds, string odds, and inactive odds.
009. Add timestamp validation per market, not only per bookmaker.
010. Reject or flag stale markets when a provider returns old quote timestamps.
011. Validate double chance against 1X2 during provider normalization, not only in external audit scripts.
012. Validate draw no bet against 1X2 during provider normalization.
013. Validate AH(0) against draw no bet when both exist on the same bookmaker.
014. Validate total-goals lines for monotonic Over and Under pricing per bookmaker.
015. Validate team-total lines for monotonic Over and Under pricing per bookmaker.
016. Detect extreme odds outliers by market type and mark them as suspicious.
017. Add a market confidence score based on source id, known market type, complete outcomes, and invariants.
018. Add a per-market `status` field: usable, suspicious, excluded, stale, or incomplete.
019. Add regression fixtures for the previously wrong Furtuna `12` scenario.
020. Add regression fixtures for period-specific markets that look like full-match markets.

## Event Matching

021. Track source event ids from every bookmaker under a common `externalIds` map.
022. Normalize Sportradar and Betradar ids into one trusted id namespace.
023. Add tournament or league similarity into fuzzy matching.
024. Add category/country similarity into fuzzy matching.
025. Lower fuzzy confidence when kickoff times differ by more than 15 minutes.
026. Add a review list for fuzzy merges below a high-confidence threshold.
027. Prevent fuzzy merges for youth, women, reserve, or esports variants unless both sides match those tokens. Done for fuzzy matching in `CompositeProvider`.
028. Add more team aliases for Romanian abbreviations and international club names.
029. Add tests for reversed home/away names where bookmakers use neutral-venue order.
030. Add tests for duplicate events from the same bookmaker appearing in different categories.
031. Add a visible match confidence badge on each event card.
032. Add a filter for only shared-id matched events.
033. Add a filter for fuzzy-only matches that need review.
034. Expose match evidence in the API response in a structured form.
035. Create a nightly matching quality report from live data snapshots.

## Provider Coverage And Resilience

036. Add per-provider retry policy with exponential backoff for temporary 429/5xx responses.
037. Add per-provider timing metrics for list fetch, detail fetch, normalization, and event count.
038. Add provider-specific timeout environment variables.
039. Add chunk retry for Fortuna and Casa market overview batches.
040. Add partial chunk recovery when one UFO market chunk fails.
041. Add Superbet detail-fetch backoff and retry for missing detail payloads.
042. Add a cap and warning when Superbet returns unusually large detail payloads.
043. Make Unibet detail limit dynamic based on category count and response health.
044. Add Unibet coverage metrics for lobby events versus detail-enriched events.
045. Add Digitain detail enrichment metrics for list markets versus detailed markets.
046. Add Betano browser session health status before attempting collection.
047. Add a clear Betano challenge state when the page is blocked.
048. Add The Odds API quota and remaining-request metadata when headers expose it.
049. Skip events that have already started unless an explicit live mode is enabled.
050. Add a provider contract test suite that every new bookmaker adapter must pass.

## Market Normalization

051. Move shared UFO normalization out of duplicated Fortuna and UFO code paths.
052. Move line-market grouping into `market-utils` so providers do not each implement first-line parsing.
053. Add multi-line output support for every provider line market that can return several lines in one market object.
054. Normalize first-half and second-half market prefixes consistently across providers.
055. Normalize corner markets across all providers into first-half, match, and team-corner variants.
056. Normalize card markets separately from generic `market_` keys.
057. Normalize player props into a separate namespace that the strict scanner never treats as exhaustive.
058. Add a known-market registry with scanner eligibility and push rules.
059. Store market display labels separately from canonical market keys.
060. Add market alias tests for Romanian, English, and provider-specific wording.
061. Add explicit support for "both teams to score in first half" as a period-specific market.
062. Add explicit support for "draw no bet first half" as a period-specific market.
063. Add explicit support for "double chance first half" as a period-specific market.
064. Add explicit support for "team to score" markets with home/away canonicalization.
065. Add a market normalization coverage dashboard by bookmaker.

## Arbitrage Scanner

066. Move the arbitrage classifier and formula engine into a shared module outside `public/getapi.js`.
067. Unit test the formula optimizer directly instead of loading browser code through `vm`.
068. Add scanner-side audit output explaining why each market is eligible or excluded.
069. Add a minimum edge threshold to hide tiny theoretical edges.
070. Add a maximum suspicious edge threshold that requires extra validation before display.
071. Add confidence scoring to opportunities based on match evidence and market confidence.
072. Suppress opportunities that depend on fuzzy-only event matches unless the user enables them.
073. Add a "verified only" toggle that requires shared external ids or high-confidence match evidence.
074. Show source market ids on each opportunity leg.
075. Show last update time on each opportunity leg.
076. Prevent duplicate formulas from surfacing the same effective hedge.
077. Add formula categories: strict, push-modeled, quarter-line-modeled, and experimental.
078. Add a clear warning when a formula contains push or quarter-line behavior.
079. Add support for commission and exchange fee settings per bookmaker.
080. Add currency and rounding rules per bookmaker.

## Frontend UX

081. Persist bookmaker, market, search, and profit-only filters in the URL query string.
082. Add a reset-all-filters button.
083. Add a market group selector for results, goals, team totals, corners, cards, and player props.
084. Add a compact/dense layout toggle for scanning many events.
085. Add virtual scrolling for large event lists.
086. Add sticky bookmaker headers inside large odds tables.
087. Add an event detail drawer with all markets for a selected match.
088. Add per-event open links for every bookmaker in one row.
089. Add odds movement indicators between refreshes.
090. Add "new opportunity" highlighting that expires after one refresh.
091. Add CSV export for visible events and opportunities.
092. Add JSON export for diagnostics and bug reports.
093. Add keyboard navigation for odds buttons and filters.
094. Replace inline refresh SVG with an icon component or shared icon helper.
095. Add better mobile handling for wide market tables.

## Performance And Architecture

096. Precompute event market specs server-side to reduce repeated browser work.
097. Memoize expensive market classification results in the UI.
098. Debounce board search and market search input rendering.
099. Avoid replacing the full event DOM on every filter change when only visibility changed.
100. Split `public/getapi.js` into modules for state, rendering, market classification, and formulas.
