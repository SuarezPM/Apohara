# Phase 1: Tracer Bullet — Credential Resolution - Research

**Researched:** 2026-05-07
**Status:** Complete

---

## Research Areas

### 1. The Severed Wire — Root Cause Analysis

**Finding:** The credential resolution pipeline is fully implemented in `src/core/credentials.ts` but **never called from the main execution path**. The wire is severed at the CLI entry point.

**Evidence chain:**

| Component | File | State |
|-----------|------|-------|
| Credential Resolver | `src/core/credentials.ts` | ✅ Fully implemented — `resolveCredential()`, `resolveCredentialSync()`, `resolveOAuthToken()` |
| Config Parser | `src/core/config.ts` | ⚠️ Reads `process.env` directly via `parseEnv()` at module load time |
| Config `getProviderKey()` | `src/core/config.ts:89-103` | ✅ **Partially wired** — calls `resolveCredentialSync()` as fallback |
| ProviderRouter constructor | `src/providers/router.ts:191-209` | ✅ Calls `getProviderKey()` for each provider |
| Auto CLI entry | `src/commands/auto.ts:72-74` | ❌ Instantiates `ProviderRouter` with NO pre-injection of credentials |

**Critical Discovery:** The situation is MORE nuanced than the original bug report suggested:

1. `config.ts` already imports `resolveCredentialSync` and exposes `getProviderKey()`
2. `getProviderKey()` checks `process.env` FIRST, then falls back to `resolveCredentialSync()`
3. The `ProviderRouter` constructor already calls `getProviderKey()` for each provider

**So the credentials.json fallback path partially exists in `getProviderKey()`, but there's a key mismatch problem:**

### 2. The Key Mismatch Problem

**Finding:** `credentials.json` uses ENV_VAR-style keys (from the config wizard template), but `resolveCredentialSync()` expects provider-ID-style keys.

**Config wizard writes:**
```json
{
  "OPENCODE_API_KEY": "oc-...",
  "DEEPSEEK_API_KEY": "sk-...",
  "ANTHROPIC_API_KEY": "sk-ant-api03-...",
  "OPENAI_API_KEY": "sk-...",
  "GOOGLE_AI_STUDIO_API_KEY": "AIza..."
}
```

**`resolveCredentialSync(provider)` reads:**
```typescript
const entry = parsed[provider];  // looks for "opencode-go", "anthropic-api", etc.
```

The resolver searches for `parsed["opencode-go"]` but the file contains `parsed["OPENCODE_API_KEY"]`. **This is the actual bug.** Even though the wiring exists, the key names don't match.

### 3. ProviderRouter Instantiation Points

**Finding:** The router is instantiated in 4 code paths. All must have credentials available before construction.

| Location | File | Line | How |
|----------|------|------|-----|
| Auto command | `src/commands/auto.ts` | 72 | `new ProviderRouter({simulateFailure})` |
| Decomposer | `src/core/decomposer.ts` | 57 | `new ProviderRouter()` (fallback) |
| Scheduler | `src/core/scheduler.ts` | 42 | `new ProviderRouter()` (fallback) |
| SubagentManager | `src/core/subagent-manager.ts` | 144 | `new ProviderRouter()` |
| AgentRouter | `src/core/agent-router.ts` | 244 | `new ProviderRouter()` (fallback) |

**Impact:** Because `getProviderKey()` is called in the ProviderRouter constructor, fixing the key mismatch in `resolveCredentialSync()` automatically fixes ALL instantiation sites — no per-site injection needed.

### 4. Existing `getProviderKey()` Analysis

```typescript
// src/core/config.ts:89-103
export function getProviderKey(provider: string): string | null {
    const ENV_KEY_MAP: Record<string, string> = {
        "anthropic-api": "ANTHROPIC_API_KEY",
        "gemini-api": "GOOGLE_AI_STUDIO_API_KEY",
    };
    const envKey = ENV_KEY_MAP[provider] ?? (provider.toUpperCase().replace(/-/g, "_") + "_API_KEY");
    const envValue = process.env[envKey];
    if (envValue && envValue.length > 0) {
        return envValue;
    }
    return resolveCredentialSync(provider);
}
```

**Observation:** This function already has a partial `ENV_KEY_MAP` (only 2 entries). It correctly derives the env var name from the provider ID. The fallback to `resolveCredentialSync()` exists but fails because of the key mismatch in the credentials file.

### 5. Resolution Strategy — Two Options

#### Option A: Fix `resolveCredentialSync()` to understand BOTH key formats ← Recommended

Make the credential resolver try the provider ID key first (`opencode-go`), then the ENV_VAR-style key (`OPENCODE_API_KEY`), using the same mapping logic as `getProviderKey()`.

**Pros:**
- Minimal code change (adds ~10 lines to `resolveCredentialSync()`)
- Fixes ALL downstream consumers automatically
- Preserves the existing `getProviderKey()` → `resolveCredentialSync()` chain
- No changes needed to `auto.ts` or any other call site

**Cons:**
- The credential resolver needs to know about the ENV_VAR mapping (slight coupling)

#### Option B: Add startup injection in `auto.ts` per CONTEXT.md decisions (D-01, D-02)

Pre-load credentials.json, iterate entries, inject into `process.env`.

**Pros:**
- Matches the original architectural decision from discuss-phase
- Explicit, visible injection point

**Cons:**
- Only fixes the `auto.ts` path — decomposer.ts, scheduler.ts, etc. still broken if called independently
- Requires a full `EnvKeyMap` (21 providers)
- More code than Option A

#### Recommendation: **Hybrid approach**

1. Fix `resolveCredentialSync()` to understand both key formats (Option A core fix)
2. Add a lightweight `injectCredentials()` function in `credentials.ts` that pre-populates `process.env` at startup (Option B for D-01/D-02 compliance)
3. Call `injectCredentials()` from `auto.ts` before router instantiation

This satisfies the CONTEXT.md decisions (D-01 through D-03) while also fixing the root cause.

### 6. Config Wizard → credentials.json Format

The config wizard (`src/commands/config.ts`) uses `CREDENTIALS_TEMPLATE`:

```typescript
const CREDENTIALS_TEMPLATE = {
    OPENCODE_API_KEY: "",
    DEEPSEEK_API_KEY: "",
    ANTHROPIC_API_KEY: "",
    OPENAI_API_KEY: "",
    GOOGLE_AI_STUDIO_API_KEY: "",
};
```

This is the canonical format for `~/.apohara/credentials.json`. The resolver MUST support these keys.

### 7. Complete Provider → EnvVar Mapping (Required for CRED-02)

Based on `config.ts` `envSchema` and `router.ts` constructor:

| Provider ID | Env Var Name | Notes |
|-------------|-------------|-------|
| `opencode-go` | `OPENCODE_API_KEY` | Primary execution |
| `anthropic-api` | `ANTHROPIC_API_KEY` | Direct Anthropic API |
| `gemini-api` | `GOOGLE_AI_STUDIO_API_KEY` | ⚠️ Non-standard mapping |
| `deepseek` | `DEEPSEEK_API_KEY` | |
| `deepseek-v4` | `DEEPSEEK_API_KEY` | Same key as deepseek |
| `gemini` | `GEMINI_API_KEY` | |
| `tavily` | `TAVILY_API_KEY` | Research tool |
| `moonshot` | `MOONSHOT_API_KEY` | Kimi |
| `xiaomi` | `XIAOMI_API_KEY` | MiMo |
| `alibaba` | `ALIBABA_API_KEY` | Qwen |
| `minimax` | `MINIMAX_API_KEY` | |
| `deepinfra` | `DEEPINFRA_API_KEY` | |
| `fireworks` | `FIREWORKS_API_KEY` | |
| `zai` | `ZAI_API_KEY` | GLM |
| `groq` | `GROQ_API_KEY` | |
| `kiro-ai` | N/A | Free tier, no key |
| `mistral` | `MISTRAL_API_KEY` | |
| `openai` | `OPENAI_API_KEY` | |

**Special cases:**
- `gemini-api` → `GOOGLE_AI_STUDIO_API_KEY` (non-standard, needs explicit mapping)
- `kiro-ai` → Free tier, always returns "anonymous"
- `deepseek-v4` shares the same API key as `deepseek`

### 8. Test Infrastructure

- **Existing:** `tests/credentials.test.ts` — 5 test cases covering file resolution, env fallback, free-tier, and null
- **Test count baseline:** 510 core tests must pass post-change
- **Test runner:** Bun (`bun test`)

### 9. Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Breaking 510 existing tests | HIGH | Run full test suite before/after |
| `parseEnv()` running before injection | MEDIUM | `injectCredentials()` called before `import { config }` evaluates |
| OAuth token injection timing | LOW | OAuth resolution is async; startup injection is sync fallback |
| credentials.json not found | NONE | Already handled — `resolveCredentialSync` returns null gracefully |

### 10. Validation Architecture

**Tracer Bullet Test Sequence:**
1. Write test credentials to `~/.apohara/credentials.json` (isolated temp dir)
2. Clear `process.env` of all API key vars
3. Call `injectCredentials()`
4. Verify `process.env.ANTHROPIC_API_KEY` === value from JSON
5. Instantiate `ProviderRouter`
6. Verify router has the injected key (via `getProviderKey()`)
7. Verify 4-tier precedence: env var > JSON > OAuth > anonymous

---

## Summary

The credential resolution bug is a **key format mismatch** between the config wizard output (ENV_VAR style) and the credential resolver input (provider-ID style). The fix requires:

1. **Expanding the key lookup** in `resolveCredentialSync()` to try both formats
2. **Adding `injectCredentials()`** function for startup pre-population
3. **Calling it from `auto.ts`** before router instantiation
4. **Expanding `ENV_KEY_MAP`** in `getProviderKey()` to cover all 17 unique providers

Files to modify: `src/core/credentials.ts`, `src/core/config.ts`, `src/commands/auto.ts`
Files to add: None (all changes fit in existing modules)
Estimated scope: ~80 lines changed across 3 files

---
*Researched: 2026-05-07 | Phase: 1-Tracer Bullet — Credential Resolution*
