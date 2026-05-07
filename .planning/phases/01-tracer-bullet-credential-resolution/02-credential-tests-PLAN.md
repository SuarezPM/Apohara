---
phase: 1
plan_id: 02-credential-tests
title: "Credential Resolution Verification Tests"
wave: 2
depends_on:
  - 01-credential-injection
files_modified:
  - tests/credentials.test.ts
autonomous: true
requirements:
  - CRED-01
  - CRED-02
---

# Plan 02: Credential Resolution Verification Tests

## Objective

Add integration tests that verify the full tracer bullet path: credentials.json → `injectCredentials()` → `process.env` → `getProviderKey()` → `ProviderRouter` construction. Validate the 4-tier credential precedence (CRED-02) and the key format bridging (CRED-01).

## must_haves

### truths
- Tests must validate 4-tier precedence: env vars > credentials.json > OAuth > anonymous
- Tests must confirm `injectCredentials()` does NOT overwrite existing env vars
- Tests must validate `resolveCredentialSync()` understands ENV_VAR-style keys from the config wizard
- All 510+ existing tests must still pass

### deliverables
- New test cases in `tests/credentials.test.ts` covering the injection pipeline
- Green test suite (`bun test` exits 0)

---

## Tasks

### Task 1: Add `injectCredentials()` test cases

<read_first>
- tests/credentials.test.ts (existing test structure and patterns)
- src/core/credentials.ts (injectCredentials signature, PROVIDER_TO_ENV_MAP)
</read_first>

<action>
Add the following test cases to `tests/credentials.test.ts`:

**Test: `injectCredentials() loads keys from credentials.json into process.env`**
- Write `{"DEEPSEEK_API_KEY": "sk-test-inject"}` to temp credentials path
- Clear `process.env.DEEPSEEK_API_KEY`
- Call `injectCredentials()`
- Assert `process.env.DEEPSEEK_API_KEY === "sk-test-inject"`
- Assert return value `injected >= 1`

**Test: `injectCredentials() does NOT overwrite existing env vars`**
- Write `{"DEEPSEEK_API_KEY": "sk-from-json"}` to temp credentials path
- Set `process.env.DEEPSEEK_API_KEY = "sk-from-env"`
- Call `injectCredentials()`
- Assert `process.env.DEEPSEEK_API_KEY === "sk-from-env"` (unchanged)
- Assert return value `skipped >= 1`

**Test: `injectCredentials() handles missing file gracefully`**
- Ensure no credentials file exists
- Call `injectCredentials()`
- Assert return value `{ injected: 0, skipped: 0, providers: [] }`

**Test: `injectCredentials() handles empty/invalid values`**
- Write `{"DEEPSEEK_API_KEY": "", "OPENCODE_API_KEY": "oc-valid"}` to temp credentials path
- Clear both env vars
- Call `injectCredentials()`
- Assert `process.env.DEEPSEEK_API_KEY` is undefined (empty value skipped)
- Assert `process.env.OPENCODE_API_KEY === "oc-valid"`
</action>

<acceptance_criteria>
- `tests/credentials.test.ts` contains at least 4 new test cases for `injectCredentials`
- `bun test tests/credentials.test.ts` exits 0
- `grep -c "injectCredentials" tests/credentials.test.ts` returns at least 4
</acceptance_criteria>

---

### Task 2: Add `resolveCredentialSync` ENV_VAR-style key test

<read_first>
- tests/credentials.test.ts (existing resolveCredentialSync tests)
- src/core/credentials.ts (PROVIDER_TO_ENV_MAP, resolveCredentialSync with new logic)
</read_first>

<action>
Add test cases that verify `resolveCredentialSync()` can read ENV_VAR-style keys from the credentials file:

**Test: `resolveCredentialSync reads ENV_VAR-style keys from credentials.json`**
- Write `{"ANTHROPIC_API_KEY": "sk-ant-api03-test"}` to temp credentials path
- Clear `process.env.ANTHROPIC_API_KEY`
- Call `resolveCredentialSync("anthropic-api")`
- Assert result === `"sk-ant-api03-test"`

**Test: `resolveCredentialSync reads GOOGLE_AI_STUDIO_API_KEY for gemini-api`**
- Write `{"GOOGLE_AI_STUDIO_API_KEY": "AIzaTestKey12345678901234567890123456"}` to temp credentials path
- Clear `process.env.GOOGLE_AI_STUDIO_API_KEY`
- Call `resolveCredentialSync("gemini-api")`
- Assert result === `"AIzaTestKey12345678901234567890123456"`

**Test: `resolveCredentialSync prefers provider-ID key over ENV_VAR key`**
- Write `{"opencode-go": "provider-id-key", "OPENCODE_API_KEY": "env-var-key"}` to temp credentials path
- Clear `process.env.OPENCODE_API_KEY`
- Call `resolveCredentialSync("opencode-go")`
- Assert result === `"provider-id-key"` (provider-ID format has priority in JSON)
</action>

<acceptance_criteria>
- `tests/credentials.test.ts` contains at least 3 new tests for ENV_VAR-style key resolution
- `bun test tests/credentials.test.ts` exits 0
- Tests verify both `ANTHROPIC_API_KEY` and `GOOGLE_AI_STUDIO_API_KEY` non-standard mappings
</acceptance_criteria>

---

### Task 3: Add 4-tier precedence integration test

<read_first>
- tests/credentials.test.ts (existing test structure)
- src/core/credentials.ts (resolveCredentialSync, injectCredentials)
- src/core/config.ts (getProviderKey)
</read_first>

<action>
Add a comprehensive precedence test:

**Test: `4-tier precedence: env var > credentials.json > free-tier > null`**
- Write `{"DEEPSEEK_API_KEY": "from-json"}` to temp credentials path
- Set `process.env.DEEPSEEK_API_KEY = "from-env"`
- Call `getProviderKey("deepseek")` → assert returns `"from-env"` (env wins)
- Delete `process.env.DEEPSEEK_API_KEY`
- Call `getProviderKey("deepseek")` → assert returns `"from-json"` (JSON fallback)
- Call `getProviderKey("kiro-ai")` → assert returns `"anonymous"` (free tier)
- Call `getProviderKey("nonexistent-provider")` → assert returns `null` (not found)
</action>

<acceptance_criteria>
- `tests/credentials.test.ts` contains a "4-tier precedence" test
- Test verifies all 4 tiers in sequence
- `bun test tests/credentials.test.ts` exits 0
</acceptance_criteria>

---

## Verification

```bash
# Full test suite
bun test

# Specific credential tests
bun test tests/credentials.test.ts
```

Both must exit 0. Test count should increase by 7-10 new test cases above the baseline 510.

---

*Plan: 02-credential-tests | Wave: 2 | Depends on: 01-credential-injection | Phase: 1*
