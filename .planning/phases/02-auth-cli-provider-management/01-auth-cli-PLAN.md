---
phase: 2
plan_id: 01-auth-cli-provider-management
title: "Auth CLI — Provider Management"
wave: 1
depends_on: []
files_modified:
  - src/commands/auth.ts
  - src/core/credentials.ts
autonomous: true
requirements:
  - AUTH-01
  - AUTH-02
  - AUTH-03
  - AUTH-04
  - AUTH-05
---

# Plan 01: Auth CLI Provider Management

## Objective

Build `apohara auth` CLI capabilities to manage API keys and OAuth PKCE flows, provide an `auth status` dashboard, and refresh/revoke commands. This focuses on interactive configuration and status reporting, ensuring secure credential management.

## must_haves

### truths
- Interactive prompts for API keys must hide input to protect bash history (D-01, D-02).
- Validation failures should warn, not block storage (D-05).
- Port collisions for OAuth callback servers must hard-fail with actionable messages (D-10, D-11).
- Revocation performs local teardown only (D-08, D-09).

### deliverables
- `auth key <provider>` command for adding API keys securely.
- `auth status [--json]` command for displaying provider configuration and health.
- Fixed `auth login <provider>` command handling port collisions securely.
- `auth refresh <provider>` command to refresh credentials locally.
- `auth revoke <provider>` command to wipe credentials locally.

---

## Tasks

### Task 1: Add `auth key <provider>` (API Key Input & Validation)

<read_first>
- src/commands/auth.ts
- src/core/credentials.ts
</read_first>

<action>
1. Add `.command("key <provider>")` to `authCommand` in `src/commands/auth.ts`.
2. Use `@inquirer/prompts` to securely prompt for the key (using type `password`).
3. Add a ping validation to a common endpoint like `/v1/models` to verify the key. If it fails, log a warning but continue saving.
4. Load `~/.apohara/credentials.json`, map the provider using `PROVIDER_TO_ENV_MAP` (from `src/core/credentials.ts`), set the key, and save. Use `0o600` permissions.
5. Create necessary directories gracefully (`fs.mkdir(..., { recursive: true })`).
</action>

<acceptance_criteria>
- Command `apohara auth key gemini` securely prompts for an API key.
- Entering a key triggers a basic validation check. If validation fails, it warns but saves anyway.
- The key is correctly saved in `~/.apohara/credentials.json` under `GOOGLE_AI_STUDIO_API_KEY`.
- No raw keys are logged or printed directly in normal flow.
</acceptance_criteria>

---

### Task 2: Add `auth status [--json]` (Dashboard)

<read_first>
- src/commands/auth.ts
- src/core/credentials.ts
</read_first>

<action>
1. Update `.command("status")` in `src/commands/auth.ts` to accept an optional `--json` flag.
2. Gather status across all known providers. Check `credentials.json` for manual keys and `.apohara/oauth-*.json` for OAuth tokens.
3. If `--json` is provided, print raw JSON containing providers, types, and statuses.
4. Otherwise, print a clean tabular representation using ANSI colors (Provider, Type, Status).
</action>

<acceptance_criteria>
- `apohara auth status` outputs an ANSI-colored table summarizing all configured providers and their validity.
- `apohara auth status --json` outputs valid parseable JSON.
</acceptance_criteria>

---

### Task 3: Fix `auth login` Port Collision (OAuth Updates)

<read_first>
- src/commands/auth.ts (specifically `loginClaude()` or PKCE flow parts)
</read_first>

<action>
1. Replace `findAvailablePort(28563, 28599)` with an attempt to bind exactly to `28563`.
2. Wrap `server.listen(28563)` in error handling to catch `EADDRINUSE`.
3. If it throws `EADDRINUSE`, hard-fail with the message: "Error: OAuth callback port 28563 is already in use. Please free the port (e.g., 'killall node') and try again."
</action>

<acceptance_criteria>
- `apohara auth login claude` uses exactly port 28563.
- If port 28563 is busy, it fails cleanly with the required actionable error message instead of auto-incrementing.
</acceptance_criteria>

---

### Task 4: Add `auth refresh` and `auth revoke`

<read_first>
- src/commands/auth.ts
- src/core/credentials.ts
</read_first>

<action>
1. Add `.command("refresh <provider>")`. For OAuth, trigger a refresh of the token. For manual API keys, print a message indicating API keys do not need manual refresh.
2. Add `.command("revoke <provider>")`. 
   - Delete `~/.apohara/oauth-${provider}.json` if it exists.
   - Remove the relevant key from `credentials.json` (both the literal provider name and mapped `PROVIDER_TO_ENV_MAP` key) and save.
</action>

<acceptance_criteria>
- `apohara auth refresh <provider>` correctly identifies OAuth vs Key providers and handles them.
- `apohara auth revoke <provider>` successfully wipes local configurations and files associated with the provider, completely unauthenticating it locally.
- No remote revocation calls are made.
</acceptance_criteria>

---

## Verification

### Tracer Bullet Test (Manual)

```bash
# 1. Test Key input
apohara auth key deepseek

# 2. Test status table and JSON
apohara auth status
apohara auth status --json

# 3. Test OAuth port collision
# (In another terminal, run: `nc -l 28563`)
apohara auth login claude # Should fail gracefully

# 4. Test revocation
apohara auth revoke deepseek
apohara auth status # Should show deepseek missing
```

### Automated Test
```bash
bun test
```
All existing tests must pass. Ensure `bun test tests/auth.test.ts` covers or is skipped gracefully.

---

*Plan: 01-auth-cli-provider-management | Wave: 1 | Phase: 2*
