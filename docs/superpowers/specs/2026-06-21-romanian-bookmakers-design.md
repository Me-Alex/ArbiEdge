# Romanian Bookmaker Aggregation Design

## Scope

Add direct football-odds integrations for the major Romanian sportsbooks whose public web applications expose usable data: Fortuna, Casa Pariurilor, Superbet, Unibet, and Betano. Existing The Odds API support remains available. Operators that require authentication, CAPTCHA completion, or undocumented signed requests are not fabricated; they can be added through the same provider contract later.

## Architecture

Each bookmaker implements `getOdds()` and returns the existing normalized event shape. HTTP-capable providers use injected `fetch`; Betano uses an injected browser transport because its public endpoints reject standalone requests. A `CompositeProvider` runs providers concurrently, records failures, and merges equivalent fixtures using Sportradar IDs first and normalized team/start-time identity second.

The service returns live data when at least one provider succeeds. A single bookmaker failure becomes a warning and provider-status entry instead of forcing demo mode. Demo fallback occurs only when every configured live provider fails or returns no usable events.

## Providers

- Fortuna: existing public `api.efortuna.ro` integration.
- Casa Pariurilor: `api.casapariurilor.ro/offer/...`, normalized through the same UFO fixture/market model as Fortuna.
- Superbet: `production-superbet-offer-ro.freetls.fastly.net/v2/ro-RO/events/by-date`, using `betradarId`, `Final`, and active 1/X/2 odds.
- Unibet: `sportsbff-ams.kindredext.net/sports-api/api/v2/views/lobby` with the public Romanian jurisdiction headers, extracting active `1x2` propositions.
- Betano: a persistent Chromium page opens the public football page, requests trending league/event endpoints in page context, and loads `/api` plus each event URL when draw-no-bet details are needed.

## Runtime

Direct HTTP providers are enabled by default. Betano browser collection is opt-in with `BETANO_BROWSER_ENABLED=1` because it opens a local Chrome process and may be interrupted by a Cloudflare challenge. The collector never copies clearance cookies into source code and does not attempt to bypass CAPTCHA or anti-bot controls.

## Error Handling

Every provider has an independent timeout. Composite results expose `providers` with `ok`, `events`, and an error message where applicable. Warnings summarize partial failures. Empty malformed events and incomplete 1/X/2 markets are discarded.

## Testing

Unit fixtures cover each payload normalizer, event merging, partial provider failure, and total failure. Browser transport is dependency-injected so tests do not launch Chrome. Live smoke tests verify only public HTTP endpoints and are not part of the deterministic unit suite.
