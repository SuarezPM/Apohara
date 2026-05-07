---
phase: 01-tracer-bullet-credential-resolution
plan: 01-credential-injection
subsystem: credentials
tags: [credentials, env-vars, provider-router, config-wizard]

# Dependency graph
requires: []
provides:
  - PROVIDER_TO_ENV_MAP constant mapping 18 provider IDs to canonical env var names
  - injectCredentials() startup function bridging credentials.json to process.env
  - Unified credential resolution supporting both provider-ID and ENV_VAR-style keys
affects:
  - "Phase 1 Plan 02 (auth-cli-provider-management)"
  - "ProviderRouter (receives env-injected credentials)"
  - "agent-router (getProviderKey now resolves all 18 providers correctly)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single-source-of-truth provider-to-env mapping (PROVIDER_TO_ENV_MAP)"
    - "Startup injection pattern: credentials.json → process.env before any downstream consumers"
    - "Precedence-preserving injection: existing env vars are never overwritten"

key-files:
  created: []
  modified:
    - src/core/credentials.ts
    - src/core/config.ts
    - src/commands/auto.ts

key-decisions:
  - "Consolidated all provider-to-env mappings into single PROVIDER_TO_ENV_MAP constant (eliminated duplicate 2-entry ENV_KEY_MAP)"
  - "injectCredentials() runs synchronously at CLI startup, before ProviderRouter instantiation"
  - "Env var precedence preserved: injectCredentials never overwrites existing process.env values"

patterns-established:
  - "Startup injection: inject at CLI entry point, before any provider/router instantiation"
  - "Provider mapping: single canonical map shared by resolver, config, and injection layers"

requirements-completed: [CRED-01, CRED-02]

# Metrics
duration: 16min
completed: 2026-05-07
---

# Phase 1 Plan 1: Credential Injection Summary

**Wired credentials.json into the auto execution path via PROVIDER_TO_ENV_MAP, dual-key credential resolution, and startup env injection — bridging the config wizard to the ProviderRouter's env-based auth.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-05-07T18:33:18Z
- **Completed:** 2026-05-07T18:48:49Z
- **Tasks:** 4
- **Files modified:** 3

## Accomplishments

- Added `PROVIDER_TO_ENV_MAP` constant mapping all 18 providers to canonical env var names
- `resolveCredentialSync()` and `resolveCredential()` now support both provider-ID and ENV_VAR-style lookups
- `getProviderKey()` unified to use the shared map (replaced 2-entry local map)
- `injectCredentials()` injects credentials.json entries into process.env at CLI startup
- Wired `injectCredentials()` into `auto.ts` before ProviderRouter instantiation
- All 5 existing credentials tests pass; full suite unchanged at 520 pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Expand resolveCredentialSync for ENV_VAR-style keys** — `ed71e69` (feat)
2. **Task 2: Unify ENV_KEY_MAP in getProviderKey** — `30ed522` (feat)
3. **Task 3: Create injectCredentials() startup function** — `74bfe89` (feat)
4. **Task 4: Wire injectCredentials() into auto.ts startup** — `3e85170` (feat)

## Files Modified

- `src/core/credentials.ts` — Added `PROVIDER_TO_ENV_MAP` (18 entries), `injectCredentials()`, dual-key lookup in `resolveCredential()`/`resolveCredentialSync()`
- `src/core/config.ts` — Replaced local `ENV_KEY_MAP` with imported `PROVIDER_TO_ENV_MAP`
- `src/commands/auto.ts` — Added `injectCredentials()` call before `new ProviderRouter()`

## Decisions Made

1. **Single-source-of-truth mapping** — Consolidated all provider-to-env mappings into `PROVIDER_TO_ENV_MAP`, eliminating the previous 2-entry duplicate in `getProviderKey()`. This ensures the config wizard, credential resolver, and env injection all agree on key names.
2. **Startup injection pattern** — `injectCredentials()` called synchronously at CLI entry point, before any downstream consumer. This guarantees credentials are available when ProviderRouter reads `process.env`.
3. **Precedence preservation** — `injectCredentials()` checks `process.env[key]` before writing and never overwrites. OS-level env vars take priority over credential file values (4-tier precedence: env vars > credentials.json > OAuth cache > anonymous).

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None. All acceptance criteria passed on first implementation. Pre-existing test failures (58 e2e/TUI/decomposer tests) are unrelated to credential injection changes.

## User Setup Required

None — no external service configuration required. Users with existing `~/.apohara/credentials.json` files will see credentials automatically loaded on next `apohara auto` run.

## Next Phase Readiness

Ready for Plan 02 (auth-cli-provider-management). The credential injection pipeline is fully operational:
- Config wizard saves to `credentials.json` with ENV_VAR keys ✓
- `injectCredentials()` loads them into `process.env` at startup ✓
- `resolveCredentialSync()`/`resolveCredential()` resolve via dual-key lookup ✓
- `getProviderKey()` uses the shared mapping for env var access ✓
- ProviderRouter receives credentials via `process.env` bridge ✓

---
*Phase: 01-tracer-bullet-credential-resolution*
*Completed: 2026-05-07*
