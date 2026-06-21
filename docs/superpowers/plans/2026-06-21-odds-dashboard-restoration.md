# Odds Dashboard Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a tested local football-odds dashboard with optional live data and an explicit always-available demo fallback.

**Architecture:** An Express application exposes normalized odds through provider adapters. A provider service selects live or demo mode, handles timeout/fallback/caching, and a framework-free frontend renders and filters the normalized result.

**Tech Stack:** Node.js 24, Express, built-in `fetch`, built-in `node:test`, HTML, CSS, browser JavaScript.

---

### Task 1: Repository and application foundation

**Files:**
- Create: `.gitignore`
- Create: `.env.example`
- Modify: `package.json`
- Delete: committed `node_modules/**`
- Delete: `example.png`
- Delete: `example2.png`

- [ ] Replace obsolete dependencies and scripts with an Express-only runtime and Node test scripts.
- [ ] Remove generated/vendor files from source control.
- [ ] Install dependencies and regenerate `package-lock.json`.
- [ ] Run `npm test` and confirm the initial test command executes.

### Task 2: Normalized providers

**Files:**
- Create: `src/providers/demo-provider.js`
- Create: `src/providers/the-odds-api-provider.js`
- Create: `test/the-odds-api-provider.test.js`

- [ ] Write a failing normalization test using a representative The Odds API response.
- [ ] Run the focused test and confirm failure because the provider does not exist.
- [ ] Implement timeout-aware fetching and normalized h2h output.
- [ ] Run the focused test and confirm it passes.
- [ ] Add tests for malformed records and non-2xx provider responses.

### Task 3: Provider service and cache

**Files:**
- Create: `src/odds-service.js`
- Create: `test/odds-service.test.js`

- [ ] Write failing tests for demo mode, live mode, fallback warnings, and cache reuse.
- [ ] Run the focused tests and confirm expected failures.
- [ ] Implement the minimal provider selection, fallback, metadata, and TTL cache.
- [ ] Run the focused tests and confirm they pass.

### Task 4: HTTP application

**Files:**
- Create: `src/app.js`
- Create: `src/server.js`
- Create: `test/app.test.js`
- Delete: `js/main.js`

- [ ] Write failing HTTP tests for `/api/health`, `/api/odds`, static index serving, and JSON 404 responses.
- [ ] Run the focused tests and confirm expected failures.
- [ ] Implement an app factory with injected odds service and a separate process entrypoint.
- [ ] Run the focused tests and confirm they pass.

### Task 5: Frontend dashboard

**Files:**
- Modify: `public/index.html`
- Modify: `public/css/style.css`
- Modify: `public/getapi.js`

- [ ] Replace the fragile template with semantic controls, status, event grid, loading, empty, and error regions.
- [ ] Render normalized event cards with safe DOM APIs.
- [ ] Implement case-insensitive filtering and manual refresh.
- [ ] Add responsive desktop/mobile styling and accessible status updates.

### Task 6: Documentation and verification

**Files:**
- Create: `README.md`

- [ ] Document local setup, demo/live modes, environment variables, API output, and provider limitations.
- [ ] Run the full automated test suite.
- [ ] Run dependency audit and inspect remaining findings.
- [ ] Start the application and verify health and odds endpoints.
- [ ] Use the in-app browser to verify desktop and mobile rendering, filtering, refresh behavior, and console health.
- [ ] Inspect `git diff` and confirm only restoration-related changes remain.
