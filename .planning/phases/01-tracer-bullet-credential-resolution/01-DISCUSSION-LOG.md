# Phase 1 Discussion Log

**Date:** 2026-05-07
**Phase:** 1 — Tracer Bullet — Credential Resolution
**Areas discussed:** 4

## Area 1: Wiring Strategy

**Question:** Patch ProviderRouter to call resolveCredential() per-request, or inject at startup?
**Options:**
- Per-request resolution (async, requires router refactor)
- Startup injection into process.env (preserves router, zero refactor)
**Selected:** Startup injection into process.env
**Notes:** User emphasized "Simplicity First" — no unnecessary async latency. Inject before ProviderRouter instantiation in auto.ts.

## Area 2: OAuth Integration Point

**Question:** Should router distinguish API key vs OAuth, or receive a unified token?
**Options:**
- Router-aware (separate code paths for API key vs OAuth)
- Unified abstraction (resolver injects into same env var regardless of auth type)
**Selected:** Unified abstraction
**Notes:** Router stays ignorant of auth method. OAuth tokens injected into the same env var the SDK reads.

## Area 3: Failure Behavior

**Question:** What happens when credential resolution fails for a provider?
**Options:**
- Silent skip
- Log warning + skip (graceful degradation)
- Hard-fail
**Selected:** Log warning + skip, EXCEPT hard-fail when user explicitly requested that provider via --provider flag
**Notes:** Graceful degradation is default. Explicit requests must fail loudly.

## Area 4: Config Wizard Alignment

**Question:** How to bridge provider IDs (openai) to env var names (OPENAI_API_KEY)?
**Options:**
- Convention-based derivation (auto-generate from provider ID)
- Static mapping object (explicit Record<ProviderId, string>)
**Selected:** Static mapping object (EnvKeyMap)
**Notes:** Explicit is better than implicit. Covers all 21 providers with zero ambiguity.

## Deferred Ideas
- ProviderRouter monolith refactor → future phase
- Per-request OAuth token refresh → Beta
- Credential encryption at rest → future security hardening

---
*Discussion: Phase 1 | 2026-05-07*
