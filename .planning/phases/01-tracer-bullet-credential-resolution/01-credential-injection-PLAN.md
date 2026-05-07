---
phase: 1
plan_id: 01-credential-injection
title: "Credential Injection Pipeline"
wave: 1
depends_on: []
files_modified:
  - src/core/credentials.ts
  - src/core/config.ts
  - src/commands/auto.ts
autonomous: true
requirements:
  - CRED-01
  - CRED-02
---

# Plan 01: Credential Injection Pipeline

## Objective

Wire `~/.apohara/credentials.json` into the `apohara auto` execution path by fixing the key format mismatch in the credential resolver and adding a startup injection function. This closes the P0 gap where the config wizard saves credentials but the ProviderRouter never receives them.

## must_haves

### truths
- Credential resolution must follow 4-tier precedence: env vars > credentials.json > OAuth cache > anonymous
- The `ProviderRouter` internal logic MUST NOT be modified in this phase (D-03)
- Injection must happen BEFORE `ProviderRouter` instantiation (D-01)
- `process.env` is the bridge between credentials.json and the router (D-02)

### deliverables
- `injectCredentials()` function in `src/core/credentials.ts`
- Complete `ENV_KEY_MAP` in `src/core/config.ts` (all 17 unique providers)
- Startup injection call in `src/commands/auto.ts`
- `resolveCredentialSync()` understands both provider-ID and ENV_VAR-style keys

---

## Tasks

### Task 1: Expand `resolveCredentialSync()` to support ENV_VAR-style keys

<read_first>
- src/core/credentials.ts (current resolver implementation, lines 97-119)
- src/core/config.ts (getProviderKey ENV_KEY_MAP, lines 89-103)
- src/commands/config.ts (CREDENTIALS_TEMPLATE format, lines 10-16)
</read_first>

<action>
In `src/core/credentials.ts`, modify `resolveCredentialSync(provider: string)` to:

1. After the current lookup by provider ID (`parsed[provider]`), add a second lookup using ENV_VAR-style key format.
2. Use the same derivation logic as `getProviderKey()`: for most providers, `PROVIDER_ID.toUpperCase().replace(/-/g, '_') + '_API_KEY'`. For special cases, use explicit mapping.
3. Add a static `PROVIDER_TO_ENV_MAP` constant at module scope:

```typescript
const PROVIDER_TO_ENV_MAP: Record<string, string> = {
  "opencode-go": "OPENCODE_API_KEY",
  "anthropic-api": "ANTHROPIC_API_KEY",
  "gemini-api": "GOOGLE_AI_STUDIO_API_KEY",
  "deepseek": "DEEPSEEK_API_KEY",
  "deepseek-v4": "DEEPSEEK_API_KEY",
  "gemini": "GEMINI_API_KEY",
  "tavily": "TAVILY_API_KEY",
  "moonshot": "MOONSHOT_API_KEY",
  "xiaomi": "XIAOMI_API_KEY",
  "alibaba": "ALIBABA_API_KEY",
  "minimax": "MINIMAX_API_KEY",
  "deepinfra": "DEEPINFRA_API_KEY",
  "fireworks": "FIREWORKS_API_KEY",
  "zai": "ZAI_API_KEY",
  "groq": "GROQ_API_KEY",
  "kiro-ai": "KIRO_AI_API_KEY",
  "mistral": "MISTRAL_API_KEY",
  "openai": "OPENAI_API_KEY",
};
```

4. In `resolveCredentialSync()`, after the `parsed[provider]` lookup fails, try `parsed[PROVIDER_TO_ENV_MAP[provider]]`:
```typescript
// Try ENV_VAR-style key (config wizard format)
const envStyleKey = PROVIDER_TO_ENV_MAP[provider];
if (envStyleKey && parsed) {
  const envEntry = parsed[envStyleKey];
  const envKey = extractKey(envEntry);
  if (envKey) return envKey;
}
```

5. Apply the same fix to the async `resolveCredential()` function.
</action>

<acceptance_criteria>
- `resolveCredentialSync("opencode-go")` returns the value from `{"OPENCODE_API_KEY": "oc-test"}` in credentials.json
- `resolveCredentialSync("gemini-api")` returns the value from `{"GOOGLE_AI_STUDIO_API_KEY": "AIza..."}` in credentials.json
- `resolveCredentialSync("anthropic-api")` returns the value from `{"ANTHROPIC_API_KEY": "sk-ant-api03-..."}` in credentials.json
- `PROVIDER_TO_ENV_MAP` contains exactly 18 entries (all providers including `deepseek-v4` sharing `DEEPSEEK_API_KEY`)
- `src/core/credentials.ts` contains `export const PROVIDER_TO_ENV_MAP`
- Both `resolveCredential()` and `resolveCredentialSync()` have the env-style key fallback
</acceptance_criteria>

---

### Task 2: Expand `ENV_KEY_MAP` in `getProviderKey()`

<read_first>
- src/core/config.ts (current getProviderKey with 2-entry map, lines 89-103)
- src/core/credentials.ts (PROVIDER_TO_ENV_MAP from Task 1)
</read_first>

<action>
In `src/core/config.ts`, replace the inline 2-entry `ENV_KEY_MAP` inside `getProviderKey()` with an import of `PROVIDER_TO_ENV_MAP` from `credentials.ts`:

1. Add import: `import { resolveCredentialSync, PROVIDER_TO_ENV_MAP } from "./credentials.js";`
2. Replace the local `ENV_KEY_MAP` with `PROVIDER_TO_ENV_MAP`:
```typescript
export function getProviderKey(provider: string): string | null {
    const envKey = PROVIDER_TO_ENV_MAP[provider] ?? (provider.toUpperCase().replace(/-/g, "_") + "_API_KEY");
    const envValue = process.env[envKey];
    if (envValue && envValue.length > 0) {
        return envValue;
    }
    return resolveCredentialSync(provider);
}
```

This eliminates the duplicate partial mapping and ensures consistency.
</action>

<acceptance_criteria>
- `src/core/config.ts` imports `PROVIDER_TO_ENV_MAP` from `./credentials.js`
- `getProviderKey("gemini-api")` checks `process.env.GOOGLE_AI_STUDIO_API_KEY` (not derived generic)
- `getProviderKey("opencode-go")` checks `process.env.OPENCODE_API_KEY`
- The local `ENV_KEY_MAP` constant no longer exists inside `getProviderKey()`
- `bun test tests/credentials.test.ts` passes
</acceptance_criteria>

---

### Task 3: Create `injectCredentials()` startup function

<read_first>
- src/core/credentials.ts (PROVIDER_TO_ENV_MAP, resolveCredentialSync, getCredentialsPath)
- src/core/config.ts (envSchema keys for reference)
</read_first>

<action>
In `src/core/credentials.ts`, add a new exported function `injectCredentials()`:

```typescript
/**
 * Pre-populates process.env with credentials from ~/.apohara/credentials.json.
 * Called at CLI startup BEFORE ProviderRouter instantiation.
 * Respects precedence: existing env vars are NOT overwritten.
 * Returns the count of injected credentials for logging.
 */
export function injectCredentials(): { injected: number; skipped: number; providers: string[] } {
    const parsed = readCredentialsFileSync();
    if (!parsed) {
        return { injected: 0, skipped: 0, providers: [] };
    }

    let injected = 0;
    let skipped = 0;
    const providers: string[] = [];

    for (const [envKey, rawValue] of Object.entries(parsed)) {
        // Skip non-string values and empty strings
        const value = extractKey(rawValue);
        if (!value) continue;

        // Only inject if the env var is not already set
        if (!process.env[envKey] || process.env[envKey]!.length === 0) {
            process.env[envKey] = value;
            injected++;
            providers.push(envKey);
        } else {
            skipped++;
        }
    }

    return { injected, skipped, providers };
}
```

This function:
- Reads `~/.apohara/credentials.json` synchronously
- Iterates all entries (which use ENV_VAR-style keys from the config wizard)
- Sets `process.env[KEY]` only if not already set (preserving OS env var precedence)
- Returns stats for logging
</action>

<acceptance_criteria>
- `src/core/credentials.ts` contains `export function injectCredentials()`
- Function returns `{ injected: number; skipped: number; providers: string[] }`
- Function does NOT overwrite existing `process.env` values (precedence preserved)
- Function handles missing credentials file gracefully (returns `{ injected: 0, skipped: 0, providers: [] }`)
- `grep -c "injectCredentials" src/core/credentials.ts` returns at least 2 (declaration + export)
</acceptance_criteria>

---

### Task 4: Wire `injectCredentials()` into `auto.ts` startup

<read_first>
- src/commands/auto.ts (full file — identify injection point before ProviderRouter instantiation, line 72)
- src/core/credentials.ts (injectCredentials signature from Task 3)
</read_first>

<action>
In `src/commands/auto.ts`:

1. Add import at top of file:
```typescript
import { injectCredentials } from "../core/credentials.js";
```

2. Inside the `.action()` callback, BEFORE the ProviderRouter instantiation (before line 72), add:
```typescript
            // 0) Inject credentials from ~/.apohara/credentials.json into process.env
            // This bridges the config wizard output to the ProviderRouter's env-based auth.
            // Existing OS environment variables take precedence (not overwritten).
            const credResult = injectCredentials();
            if (credResult.injected > 0) {
                console.log(`🔑 Loaded ${credResult.injected} credential(s) from config: ${credResult.providers.join(", ")}`);
            }
```

This ensures credentials are in `process.env` before `new ProviderRouter()` on line 72 reads them via `getProviderKey()`.
</action>

<acceptance_criteria>
- `src/commands/auto.ts` imports `injectCredentials` from `../core/credentials.js`
- `injectCredentials()` is called BEFORE `new ProviderRouter(` in the action handler
- The injection log line uses emoji `🔑` prefix
- `grep -n "injectCredentials" src/commands/auto.ts` shows the import and the call
- `grep -n "new ProviderRouter" src/commands/auto.ts` shows a line number AFTER the `injectCredentials()` call line
</acceptance_criteria>

---

## Verification

### Tracer Bullet Test (Manual)
```bash
# 1. Save a test credential
mkdir -p ~/.apohara
echo '{"DEEPSEEK_API_KEY": "sk-test-key-12345"}' > ~/.apohara/credentials.json

# 2. Clear env var
unset DEEPSEEK_API_KEY

# 3. Run (should show "🔑 Loaded 1 credential(s)")
bun run src/cli.ts auto "test prompt" 2>&1 | head -5

# 4. Clean up
rm ~/.apohara/credentials.json
```

### Automated Test
```bash
bun test
```
All 510+ existing tests must pass. No new test files required for this plan (credential test coverage already exists in `tests/credentials.test.ts`).

---

*Plan: 01-credential-injection | Wave: 1 | Phase: 1*
