---
plan_id: 01-auth-cli-provider-management
phase: 2
status: complete
wave: 1
completed_at: 2026-05-07
commit: c3a240c
---

# Plan 01: Auth CLI Provider Management — SUMMARY

## Status: ✅ Complete

## What Was Built

All four auth CLI capabilities from the plan were implemented in `src/commands/auth.ts`:

### Task 1 — `auth key <provider>` (API Key Input & Validation)
- Uses `@inquirer/prompts` `password()` with `mask: "*"` for secure hidden input
- Provider validation via `PROVIDER_TO_ENV_MAP` from `credentials.ts`
- Lightweight ping to `/v1/models` endpoint; **warns but saves** on failure (D-05)
- Saves under the ENV_VAR-style key (e.g., `GOOGLE_AI_STUDIO_API_KEY`) with `0o600` permissions
- Creates `~/.apohara/` directory with `{ recursive: true }` if missing

### Task 2 — `auth status [--json]` (Dashboard)
- Reads both `credentials.json` (API keys) and `oauth-*.json` (OAuth tokens)
- `--json` flag outputs parseable JSON with provider, type, and status fields
- Default output: ANSI-formatted table with Provider / Type / Status columns
- Correctly marks expired OAuth tokens as `❌ Expired`

### Task 3 — `auth login` Port Collision Fix (OAuth)
- `loginClaude()` now uses **exactly port 28563** (not a range)
- `startCallbackServer()` catches `EADDRINUSE` and hard-fails with:
  `"OAuth callback port 28563 is already in use. Please free the port (e.g., 'killall node') and try again."`
- No silent auto-increment on collision (D-10, D-11)

### Task 4 — `auth refresh` and `auth revoke`
- `refresh <provider>`: calls `resolveOAuthToken()` for OAuth providers; prints info message for API-key providers
- `revoke <provider>`: deletes `~/.apohara/oauth-${provider}.json` (if present) + removes both provider-ID and ENV_VAR-style keys from `credentials.json`. No remote calls made (D-08, D-09).

## Verification Results

| Test | Result |
|------|--------|
| `bun test tests/credentials.test.ts` | ✅ 13/13 pass |
| `bun test src/commands/api-key-validation.test.ts` | ✅ 31/31 pass |
| `bun test tests/router.test.ts` | ✅ pass |
| `bun test tests/fallback.test.ts` | ✅ pass |
| All related unit tests | ✅ 102/102 pass |

Pre-existing failures in TUI hooks and e2e dashboard tests are unrelated to this plan (missing modules in packages/tui, not auth).

## Files Modified
- `src/commands/auth.ts` — 209 insertions, 104 deletions (net ~105 new LOC)

## Commit
`c3a240c` — `feat(auth): implement auth key, status, refresh, revoke, and OAuth port collision fix`
