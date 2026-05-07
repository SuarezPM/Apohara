# Phase 2: Auth CLI — Provider Management - Research

**Gathered:** 2026-05-07

## Goal
Determine the technical approach for implementing `auth key`, `auth login` (port collision fixes), `auth status` (tabular), `auth refresh`, and `auth revoke` subcommands in `src/commands/auth.ts`. Ensure alignment with the interactive input requirements and existing code patterns.

## Technical Analysis

### 1. `auth key <provider>` (API Key Input)
- **Input Mechanism:** Use `@inquirer/prompts` (e.g., `password` prompt) to hide input from the terminal history.
- **Storage:** Read/write to `~/.apohara/credentials.json` (respecting `XDG_CONFIG_HOME`). This requires reading the JSON, updating the specific provider key using `PROVIDER_TO_ENV_MAP` or direct provider name, and saving back with `0o600` permissions.
- **Validation (Ping):** A lightweight `fetch` to a standard endpoint like `/v1/models` for each provider. We need a small mapping of provider to validation endpoint. If the fetch fails (non-200), we still save the key but print an ANSI-colored warning.

### 2. `auth login <provider>` (OAuth Updates)
- **Port Collision (D-10, D-11):** Currently, `src/commands/auth.ts` uses `findAvailablePort(28563, 28599)`. This must be replaced with a hardcoded port attempt (e.g., exactly `28563`). If `server.listen()` throws `EADDRINUSE`, catch it and hard-fail with an actionable message.

### 3. `auth status [--json]` (Dashboard)
- **Data Aggregation:** We need to collect status for all providers. `src/core/credentials.ts` has `getOAuthTokenInfo()` and `getProviderKey()`. 
- **Tabular Output:** Use standard ANSI escape codes or a simple CLI table library (if already in dependencies) to print a clean tabular view. The table should include: Provider, Type (OAuth/Key), Status (Valid/Expired/Missing), and Details.
- **JSON Output:** If `--json` is passed, `console.log(JSON.stringify(data, null, 2))` and skip the ANSI table formatting.

### 4. `auth refresh <provider>`
- **Mechanism:** For OAuth providers, invoke the refresh handler (e.g., trigger the token store's refresh logic manually). If it's an API key provider, print an error or no-op since API keys don't refresh.

### 5. `auth revoke <provider>`
- **Mechanism:** 
  - Delete `~/.apohara/oauth-${provider}.json` if it exists.
  - Load `~/.apohara/credentials.json`, delete the keys mapping to the provider (both literal name and `PROVIDER_TO_ENV_MAP` key), and write it back.

## Codebase Integration Points
- **`src/commands/auth.ts`**: The main file to update. Add `.command("key <provider>")`, `.command("refresh <provider>")`, `.command("revoke <provider>")`. Update `.command("status")` and `.command("login")`.
- **`src/core/credentials.ts`**: May need helpers to list all configured providers and their types, or to perform the credential JSON mutation safely.

## Dependencies Needed
- `@inquirer/prompts` for secure terminal input (if not already present).

## Risks & Edge Cases
- **Missing credentials.json:** When saving a key, the directory and file might not exist. Ensure `fs.mkdir(..., { recursive: true })` and default to `{}` if file is missing.
- **Malformed credentials.json:** If the file is manually edited and broken, warn the user instead of crashing silently.
- **Interactive Prompts in CI:** `auth key` relies on `@inquirer/prompts`. It will fail in non-TTY environments, which is expected (D-03 states CI uses env vars).

## RESEARCH COMPLETE
