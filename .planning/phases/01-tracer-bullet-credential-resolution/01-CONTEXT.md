# Phase 1: Tracer Bullet — Credential Resolution - Context

**Gathered:** 2026-05-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire `~/.apohara/credentials.json` into the `apohara auto` execution path so the ProviderRouter can authenticate with LLM providers without requiring manual `export` of environment variables. The tracer bullet must fire: config wizard saves key → `apohara auto "task"` authenticates → provider responds.

</domain>

<decisions>
## Implementation Decisions

### Wiring Strategy
- **D-01:** Inject credentials into `process.env` at startup, BEFORE `ProviderRouter` is instantiated. Do NOT refactor the router to call `resolveCredential()` per-request — that violates "Simplicity First" and adds async latency to hot paths.
- **D-02:** Injection happens in `src/cli/auto.ts` (or equivalent CLI entry point). Load `credentials.json`, iterate provider entries, and set `process.env[ENV_KEY]` only if the env var is not already set. This preserves the precedence: OS env vars > JSON file > OAuth > anonymous.
- **D-03:** The existing `ProviderRouter` internal logic remains untouched. It continues reading `process.env` as before — the credentials are simply already there by the time it runs.

### OAuth Integration
- **D-04:** The router must remain ignorant of the authentication method. `CredentialResolver` abstracts the difference: if resolving `gemini-ai` and an OAuth token is valid, inject it into the same `process.env` var that the router reads (e.g., `GEMINI_API_KEY`). The underlying SDKs accept tokens via the same auth header mechanism.

### Failure Behavior
- **D-05:** Graceful degradation. If a provider fails credential resolution, mark it as unavailable in the router's health check. Log a warning to the Event Ledger (and stdout in debug mode). Skip to next provider in fallback chain.
- **D-06:** Exception: if user ran `apohara auto "task" --provider=anthropic` and that specific provider's credential fails, hard-fail with a clear error message. Explicit provider requests must not silently degrade.

### Config Wizard ↔ Resolver Mapping
- **D-07:** Create a static TypeScript mapping object: `const EnvKeyMap: Record<ProviderId, string> = { 'openai': 'OPENAI_API_KEY', 'anthropic': 'ANTHROPIC_API_KEY', ... }`. Place it in the credential resolver module.
- **D-08:** Use `EnvKeyMap` during the startup injection phase (D-01). The config wizard writes under provider IDs (`openai`), the router reads env var names (`OPENAI_API_KEY`) — this map bridges the two.

### Agent's Discretion
- Error message format for hard-fail (D-06) — agent can design the UX
- Logging verbosity levels for credential resolution events

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Credential System
- `src/core/credentials.ts` — Contains `resolveCredential()`, `resolveCredentialSync()`, `resolveOAuthToken()`, `validateApiKeyFormat()`. The 3-tier resolution logic is already implemented here.
- `src/core/config.ts` — Contains `parseEnv()` which hardcodes `process.env.ANTHROPIC_API_KEY`, `process.env.GEMINI_API_KEY` etc. This is the code that needs the injected env vars BEFORE it runs.

### Provider Router
- `src/providers/router.ts` — The 1294-line ProviderRouter. Do NOT refactor its internals in this phase. Only ensure credentials are in `process.env` before instantiation.

### CLI Entry Point
- `src/cli/auto.ts` — The entry point for `apohara auto`. This is where the credential injection code must be added (before ProviderRouter instantiation).

### Auth/OAuth
- `src/lib/oauth/gemini.ts` — Gemini OAuth PKCE flow with `getGeminiAccessToken()`.
- `src/lib/oauth-token-store.ts` — OAuth token persistence and refresh logic.
- `src/commands/auth.ts` — Auth CLI command structure (references `credentials.json` path).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `resolveCredential(provider)` / `resolveCredentialSync(provider)` — Already implements file → env → free-tier fallback. Can be used directly in the startup injection loop.
- `validateApiKeyFormat(keyName, value)` — Key format validation for 5+ providers. Should be called during injection to catch malformed keys early.
- `resolveOAuthToken(provider)` — OAuth token resolution for claude-ai/gemini-ai. Call this during startup for OAuth providers.
- `getCredentialsPath()` — Resolves `~/.apohara/credentials.json` with XDG_CONFIG_HOME support.

### Established Patterns
- Provider IDs are kebab-case strings (`openai`, `anthropic`, `gemini-ai`, `deepseek`)
- Config uses `parseEnv()` to build a static config object from `process.env` at startup
- Router instantiation: `new ProviderRouter()` called in `decomposer.ts`, `scheduler.ts`, `agent-router.ts`

### Integration Points
- `src/cli/auto.ts` — Inject credential loading BEFORE any `ProviderRouter` instantiation
- `process.env` — The bridge between credentials.json and the router
- Event Ledger — Log credential resolution outcomes for observability

</code_context>

<specifics>
## Specific Ideas

- The injection pattern is literally: `if (credentials.openai?.apiKey && !process.env.OPENAI_API_KEY) { process.env.OPENAI_API_KEY = credentials.openai.apiKey; }` — repeated for each mapped provider
- For OAuth providers, call `resolveOAuthToken()` and inject the access token into the same env var the router expects
- The `EnvKeyMap` must cover all 21 currently registered providers

</specifics>

<deferred>
## Deferred Ideas

- **ProviderRouter refactor** — The 1294-line monolith should be decomposed, but NOT in this phase. Phase scope is wiring only.
- **Per-request credential refresh** — OAuth tokens expire. For v0.1.0, inject at startup is sufficient. Per-request refresh is a Beta enhancement.
- **Credential encryption at rest** — `credentials.json` stores keys in plaintext. Encryption is a future security hardening task.

</deferred>

---

*Phase: 1-Tracer Bullet — Credential Resolution*
*Context gathered: 2026-05-07*
