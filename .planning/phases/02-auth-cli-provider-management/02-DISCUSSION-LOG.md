# Phase 2: Auth CLI — Provider Management - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-07
**Phase:** 2-Auth CLI — Provider Management
**Areas discussed:** API Key Input & Validation, Status Dashboard Format, Revocation Depth, OAuth Callback Server Port Collisions

---

## API Key Input & Validation

| Option | Description | Selected |
|--------|-------------|----------|
| Interactive only | Strictly interactive hidden prompts | ✓ |
| CLI flags | Allow passing keys via `--key=...` | |

**User's choice:** Strictly interactive hidden prompts.
**Notes:** Do not support CLI flags to avoid writing keys to bash history. Validate with a lightweight ping (warn on failure, do not block). Support reading from `process.env` for CI/CD automation.

---

## Status Dashboard Format

| Option | Description | Selected |
|--------|-------------|----------|
| Plain-text | Clean ANSI-colored text table | ✓ |
| TUI | Ink/React TUI | |
| JSON | `--json` flag | ✓ |

**User's choice:** Plain-text table by default with a `--json` flag.
**Notes:** Do not use Ink for this command; configuration commands should be instantaneous and pipeable.

---

## Revocation Depth

| Option | Description | Selected |
|--------|-------------|----------|
| Local only | Delete from local file/cache | ✓ |
| Remote call | Call provider revocation endpoint | |

**User's choice:** Local teardown only.
**Notes:** Avoid inconsistent provider behavior and network dependencies. Delete the token/key from `~/.apohara/credentials.json` and clear local cache.

---

## OAuth Callback Server Port Collisions

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-increment | Find next free port | |
| Hard-fail | Fail with explicit instructions | ✓ |

**User's choice:** Hard-fail with explicit instructions.
**Notes:** OAuth providers require exact registered redirect URIs. Catch `EADDRINUSE` and print an actionable message.

---

## The Agent's Discretion

- ANSI color choices and styling for table and warnings.

## Deferred Ideas

- None.
