# Romanian Bookmakers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggregate normalized football odds from Fortuna, Casa Pariurilor, Superbet, Unibet, and browser-backed Betano without allowing one failed provider to break the dashboard.

**Architecture:** Add focused provider adapters and a concurrent composite provider. Merge events by stable external IDs and normalized fixture identity, preserve the existing API shape, and add provider health metadata and partial-failure warnings.

**Tech Stack:** Node.js 20, Express 5, native fetch, playwright-core, node:test.

---

### Task 1: Composite provider

**Files:**
- Create: `src/providers/composite-provider.js`
- Test: `test/composite-provider.test.js`

- [ ] Write failing tests for merging equivalent fixtures and retaining successful results when another provider fails.
- [ ] Run `node --test test/composite-provider.test.js` and verify missing-module failure.
- [ ] Implement concurrent provider execution, result status, Sportradar/team-time matching, and bookmaker merging.
- [ ] Run the focused test and verify it passes.

### Task 2: Casa Pariurilor provider

**Files:**
- Create: `src/providers/ufo-provider.js`
- Create: `src/providers/casa-pariurilor-provider.js`
- Modify: `src/providers/fortuna-provider.js`
- Test: `test/casa-pariurilor-provider.test.js`

- [ ] Write failing normalization and endpoint tests.
- [ ] Verify failure.
- [ ] Extract shared UFO normalization and implement Casa Pariurilor.
- [ ] Verify focused and Fortuna tests pass.

### Task 3: Superbet provider

**Files:**
- Create: `src/providers/superbet-provider.js`
- Test: `test/superbet-provider.test.js`

- [ ] Write failing tests for active `Final` 1/X/2 extraction and malformed-event rejection.
- [ ] Verify failure.
- [ ] Implement dynamic date URL construction, fetching, and normalization.
- [ ] Verify focused tests pass.

### Task 4: Unibet provider

**Files:**
- Create: `src/providers/unibet-provider.js`
- Test: `test/unibet-provider.test.js`

- [ ] Write failing tests for nested lobby contests and active `1x2` propositions.
- [ ] Verify failure.
- [ ] Implement required public headers and normalization.
- [ ] Verify focused tests pass.

### Task 5: Betano browser provider

**Files:**
- Create: `src/providers/betano-provider.js`
- Create: `src/providers/betano-browser-transport.js`
- Test: `test/betano-provider.test.js`

- [ ] Write failing tests for Betano list/detail normalization using an injected browser transport.
- [ ] Verify failure.
- [ ] Implement market normalization and the Playwright Chrome transport.
- [ ] Verify focused tests pass without launching a browser.

### Task 6: Runtime and service integration

**Files:**
- Modify: `src/server.js`
- Modify: `src/odds-service.js`
- Modify: `README.md`
- Modify: `.env.example`
- Test: `test/odds-service.test.js`

- [ ] Write failing tests for partial-live metadata and all-provider fallback.
- [ ] Verify failure.
- [ ] Configure the composite provider and expose provider status/warnings.
- [ ] Update runtime documentation.
- [ ] Run the complete deterministic test suite.

### Task 7: Verification

- [ ] Run `npm test`.
- [ ] Start the server and verify `/api/health` and `/api/odds`.
- [ ] Smoke-test public Casa Pariurilor, Superbet, and Unibet endpoints.
- [ ] Review `git diff --check` and `git status`.
- [ ] Commit the implementation.
