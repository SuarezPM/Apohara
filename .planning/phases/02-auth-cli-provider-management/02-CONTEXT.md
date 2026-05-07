# Phase 2: Auth CLI — Provider Management - Context

**Gathered:** 2026-05-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Build `apohara auth` CLI capabilities to manage API keys and OAuth PKCE flows, provide an `auth status` dashboard, and refresh/revoke commands. This phase focuses entirely on the CLI interface to configure credentials correctly so that they are saved for the ProviderRouter.

</domain>

<decisions>
## Implementation Decisions

### API Key Input & Validation
- **D-01:** Strictly interactive hidden prompts for API keys (using `@inquirer/prompts` or Node's readline with muted output).
- **D-02:** Do not support passing keys via CLI flags (`--key=...`) to prevent keys from being stored in bash history.
- **D-03:** For CI/CD automation, the system supports reading directly from `process.env`. The CLI command itself must remain strictly interactive.
- **D-04:** Attempt a lightweight ping (e.g., fetching `/v1/models`) when a user enters a key.
- **D-05:** Warn, do not block: If validation fails (e.g., 429, 503, network error), save the key anyway and print a warning. The ProviderRouter will handle runtime health checks.

### Status Dashboard Format
- **D-06:** Default to a clean, ANSI-colored plain-text table output directly to stdout for `apohara auth status`. Do not use the Ink/React TUI (Ink is reserved for live Swarm Execution).
- **D-07:** Support an `apohara auth status --json` flag to dump the array of providers, configured tiers, and health status in raw JSON for CI/CD pipelines and `jq`.

### Revocation Depth
- **D-08:** Revocation (`apohara auth revoke`) performs a local teardown only.
- **D-09:** Delete the token/key from `~/.apohara/credentials.json` and clear any local OAuth cache (e.g., OS keyring). Do not attempt to call remote provider revocation endpoints to maintain simplicity and avoid inconsistent provider behavior.

### OAuth Callback Server Port Collisions
- **D-10:** Hard-fail on port collisions. Do not auto-increment the port.
- **D-11:** If the registered port (e.g., 4096) results in an `EADDRINUSE` error, immediately hard-fail and print an actionable error message (e.g., "Error: OAuth callback port 4096 is already in use. Please free the port (e.g., 'killall node') and try again.").

### The Agent's Discretion
- ANSI color choices and specific layout for the plain-text status table.
- Exact styling of the prompt/warning messages.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Auth System
- `src/commands/auth.ts` — Contains the existing `authCommand` structure and `loginClaude()` / `getOAuthCredentialsPath()`. This is where the subcommands `key`, `status`, `refresh`, and `revoke` must be added.
- `src/core/credentials.ts` — Contains the logic to resolve and map keys. This might be used by the `status` command to verify what is currently available.

### Configuration
- `src/core/config.ts` — Defines the `CREDENTIALS_TEMPLATE` schema that `auth key` will write to.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `loginClaude()` and related OAuth flows in `src/commands/auth.ts` demonstrate how PKCE flows and local callback servers are currently structured.
- `src/core/credentials.ts` contains `validateApiKeyFormat()` which can be used alongside the network ping validation.

### Established Patterns
- Interactive prompts should align with existing patterns (if any) or use standard `@inquirer/prompts`.
- ANSI colors for CLI output should match existing tools used in the project (e.g., chalk or native util.inspect colors).

### Integration Points
- `src/commands/auth.ts` is the main entry point where Commander.js subcommands for `key`, `status`, `refresh`, and `revoke` need to be wired up.
- The `~/.apohara/credentials.json` file is where keys must be serialized.

</code_context>

<specifics>
## Specific Ideas

- For `apohara auth status --json`, ensure the output is well-formed JSON without any additional text.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-Auth CLI — Provider Management*
*Context gathered: 2026-05-07*
