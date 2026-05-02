# Apohara: Architecture & LLM Engineer Onboarding

This document provides comprehensive context for AI agents and LLM engineers working on the **Apohara** project. It outlines the vision, architecture, technical stack, and core patterns to ensure you can contribute effectively without needing to reverse-engineer the entire repository.

---

## 1. Vision & Core Value

**Apohara** is an advanced AI agent harness designed to orchestrate multiple LLMs (21+ providers) to execute software development tasks autonomously. 

Its core loop:
1. A user describes a goal in natural language.
2. Apohara decomposes it into atomic tasks.
3. Tasks are executed in parallel across isolated Git worktrees.
4. The optimal LLM provider is dynamically selected based on the specific task role (Planning, Coding, Verification, Research).
5. Code is produced, verified, and merged back without human intervention.

**Key Differentiators:**
- **Extreme Resilience:** Uses a Rust-based `IsolationEngine` to sandbox work and a durable State Machine (`.clarity/state.json`) that survives power cuts and OOM errors.
- **Deep Fallback Chains:** If a provider fails, the router falls back to the next best provider based on a `Capability Manifest`.
- **Agent-First Observability:** Every action is recorded in an append-only JSONL Event Ledger (`.events/run-*.jsonl`), enabling deterministic replays and cost tracking.

---

## 2. Technical Stack

- **Runtime:** Bun (primary) & Node.js >= 22 (compatibility target). *Rule: Always use `bun run`, `bun test`, `bun build`.*
- **Language:** TypeScript (`strict: true`, `target: ESNext`).
- **CLI Framework:** Commander (`commander`).
- **Dashboard / TUI:** Ink & React (`ink`, `react` 19) for terminal user interfaces.
- **Testing:** `bun:test` for unit/integration; `vitest` with `jsdom` for TUI component testing.
- **Isolation Engine:** Rust (packaged as prebuilt OS-specific binaries via `optionalDependencies` and a `postinstall.js` script).
- **Auth/Web:** Native Node HTTP/Fetch, OAuth 2.0 PKCE.
- **Demo Subsystem:** Fastify + `@fastify/jwt` (used for E2E verification of the harness).

---

## 3. Core Architecture & Execution Flow

The system operates as a pipeline:

1. **TaskDecomposer:** Uses a "planning" LLM (e.g., Moonshot/Gemini) to break down a prompt into atomic tasks.
2. **ParallelScheduler:** Manages concurrency (default 3-5 workers).
3. **IsolationEngine (Rust):** Checks out a temporary Git worktree for each task (`.apohara/worktrees/lane-*`) to prevent state collision during parallel execution.
4. **SubagentManager:** Wraps execution with a 120s timeout and a 3-retry exponential backoff.
5. **ProviderRouter & AgentRouter:** 
   - Consults the `CAPABILITY_MANIFEST` to find the best provider for the role.
   - Executes the prompt.
   - Handles `429 Too Many Requests` or timeouts by automatically switching to the next provider in the fallback chain.
6. **Consolidator:** Merges the isolated worktrees back to the main branch upon success.

---

## 4. Provider & Authentication System (Fase Gamma - M007)

Apohara supports 21+ LLM providers via a unified interface, but implements rigorous, distinct authentication flows depending on provider constraints.

### The Capability Manifest (`src/core/capability-manifest.ts`)
The absolute source of truth for routing. Providers are scored from `0.0` to `1.0` on tasks like `research`, `planning`, `codegen`, and `verification`. 

### Authentication Patterns (`src/lib/oauth/` & `src/commands/auth.ts`)
- **OAuth 2.0 PKCE (Desktop App Pattern):** 
  - Used for `gemini-cli` and `antigravity`.
  - Apohara spins up an ephemeral localhost server (`8085` or `51121`), opens the browser, captures the code, and exchanges it.
  - Implements auto-refresh with a 5-minute buffer.
  - Uses `readline` as a fallback for remote environments (Codespaces, VMs) where the local browser cannot reach the remote localhost callback.
- **API Keys (Paid/Standard Providers):**
  - Used for `opencode-go`, `anthropic-api`, `groq`, `deepseek`, etc.
  - Handled via `apohara auth key <provider>`.
  - Translates canonical IDs to ENV vars using an `ENV_KEY_MAP` (e.g., `gemini-api` -> `GOOGLE_AI_STUDIO_API_KEY`).
  - Stored securely in `~/.apohara/credentials.json` with `0o600` permissions.
- **Important Note on Anthropic:** Claude OAuth for third-party tools was blocked by Anthropic in Feb 2026. The system explicitly blocks `auth login claude` and redirects users to use API keys (`sk-ant-api03-*`).

---

## 5. Project Structure

```text
├── binaries/              # Precompiled Rust Isolation Engine binaries
├── config/                # Global configurations (e.g., providers.json)
├── isolation-engine/      # Rust source code for the git worktree manager
├── scripts/               # CI/CD and postinstall scripts (checksums, binary fetch)
├── src/
│   ├── cli.ts             # CLI Entry point (compiled to dist/cli.js)
│   ├── commands/          # Commander subcommands (auto, auth, config, dashboard)
│   ├── core/              # The "Brain" (Router, Scheduler, Ledger, State, Decomposer)
│   ├── lib/               # Utilities (OAuth PKCE, Config Wizard, Git wrapper, Spawn)
│   ├── providers/         # API integration layers (Anthropic, OpenAI compat)
│   └── tui/               # Ink-based Dashboard and UI components
├── tests/                 # Unit, Integration, and E2E tests
└── .gsd/                  # GSD Agent metadata (Decisions, Requirements, Milestones)
```

---

## 6. Critical Engineering Guidelines (GSD Knowledge)

When contributing to this codebase, adhere strictly to these rules:

1. **No Circular Dependencies in Auth:** Token stores (e.g., `credentials.ts`) must be lazy-loaded. Eager evaluation causes cyclic import crashes with the Config Wizard.
2. **Event Ledger Integrity:** Never log raw API keys to `console.log` or the `.events/*.jsonl` files. Use `sanitizeKey()` (which outputs `****1234`).
3. **Rust Fallbacks:** The IPC calls to the Rust binary must have retries. If the binary fails, the system falls back to basic `spawn` Git commands to ensure autonomy isn't broken by a missing binary.
4. **TUI Testing:** You **cannot** use `bun test` for Ink/React components because Bun lacks a native `jsdom` equivalent. Always use `vitest` for the `src/tui/` directory.
5. **ESM Compatibility:** `postinstall.js` and other scripts run in `"type": "module"`. You cannot use `__dirname` directly; you must use `fileURLToPath(import.meta.url)`.
6. **Graceful Degradation:** If a provider fails, **do not crash the process**. Log the failure to the ledger, emit a console warning (`⚠ {provider} {error} → reasignando a {alternate}...`), and call the next provider in the chain.

---
*Generated by GSD Auto-Mode.*