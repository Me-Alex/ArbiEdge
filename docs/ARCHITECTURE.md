# Architecture & System Design

## Overview

The **Odds Dashboard & Scanner** is a high-performance, real-time sports betting analytics engine built on Node.js. It collects, normalizes, audits, and evaluates odds across 20+ Romanian bookmakers to identify arbitrage opportunities (surebets), value bets, middle bets, and line movements.

---

## High-Level System Architecture

```mermaid
graph TD
    A[Clients / SPA Frontend] -->|REST / SSE| B[Express App Layer (src/server/app.js)]
    B --> C[Odds Service (src/services/odds-service.js)]
    C --> D[Composite Provider (src/providers/composite-provider.js)]
    D --> E1[Direct Bookmaker Scrapers]
    D --> E2[The Odds API Provider]
    D --> E3[Demo Fallback Provider]
    
    C --> F[Formula Engine (src/engine/formula-engine.js)]
    C --> G[Odds Audit Pipeline (src/audit/odds-audit.js)]
    
    B --> H[Bet Tracker & Bankroll Manager]
    B --> I[Webhook & Alert Dispatcher]
    J[Autonomous Runtime] --> D
    J --> K[(PostgreSQL)]
    J --> L[Fidelity / Endpoint / Discovery Monitors]
    J --> M[Durable Alert Outbox]
```

---

## Component Responsibilities

### 1. Application Layer (`src/server/`, `src/index.js`)
* `src/server/server.js` initializes environment variables via `src/core/env.js`
  and starts the HTTP process.
* `src/server/app.js` owns Express routes, middleware, and static asset hosting.
* `src/index.js` is the package entry point and exposes both flat exports and
  domain namespaces.
* Sets up express HTTP server, security headers (`helmet`-like security rules), CORS policies, rate limiters, and static asset streaming.
* Exposes JSON APIs for scanner data, odds movements, value bets, fidelity audits, and betting journal persistence.

### 2. Provider Infrastructure (`src/providers/`)
* **CompositeProvider (`src/providers/composite-provider.js`)**: Executes concurrent fetching across configured direct scrapers with robust error isolation, progressive fallback to cached/demo data, and diagnostics tracking.
* **Direct Providers**: Normalizes raw JSON/HTML/WAMP API feeds from major Romanian betting platforms (Superbet, Fortuna, GetsBet, Unibet, Betano, MaxBet, NetBet, Casa Pariurilor, Winbet, Winner, LasVegas, etc.).
* **Canonical Market Utilities (`src/providers/market-utils.js`)**: Converts variant outcome wording across Romanian/English dialects into canonical keys (`h2h`, `bothTeamsToScore`, `doubleChance`, `drawNoBet`, `asianHandicap`, `totalGoals`, etc.).

### 3. Analytics & Evaluation Engine (`src/engine/`)
* **Arbitrage Detector**: Identifies 2-way and 3-way surebets across bookmaker pricing edges.
* **Cross-Market Arbitrage**: Crosses disparate market structures (e.g. BTTS Yes + Clean Sheets; Match Over 2.5 + Team Unders).
* **Middle Bet Detector**: Evaluates line overlap windows (e.g. Over 2.5 @ Book A + Under 3.5 @ Book B).
* **Value Bet Engine**: Computes fair probabilities using sharp reference odds (Pinnacle/Betfair) or overround-adjusted consensus pricing, and outputs fractional Kelly stakes.

### 4. Integrity & Audit Pipeline (`src/audit/`)
* Runs automated integrity checks against scraped odds (e.g. checking for non-monotonic goal lines, impossible double chance probabilities, draw-no-bet anomalies, and strict same-book underrounds).
* Assigns confidence levels (`trusted`, `review`, `risky`) to opportunities based on data quality and verification checks.

### 5. Financial & Tracking Services (`src/finance/`)
* **Bankroll Manager**: Tracks cash allocations across bookmaker accounts.
* **Tax Calculator**: Computes Romanian gambling tax compliance based on cumulative annual profit brackets and tax-exempt thresholds (10,000 RON).
* **Bet Tracker**: Saves bet logs into persistent JSONL storage with win/loss settlement status.
