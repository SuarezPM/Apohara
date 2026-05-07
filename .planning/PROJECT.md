# Apohara

## What This Is

Apohara ("El que crea" en guaraní) is a multi-agent AI orchestration framework distributed as a single binary. It takes a high-level natural language objective, decomposes it into a DAG of atomic tasks, routes each task to the optimal LLM provider, executes them in isolated Git worktrees, verifies results via cross-provider consensus, and merges everything back — with zero human intervention. It is the first "operating system for vibecoding."

## Core Value

**One command, zero intervention:** The user writes what they want to build; Apohara's swarm handles everything from decomposition to merge. If any provider fails, the system recovers automatically. The user never sees a broken state.

## Requirements

### Validated

<!-- Shipped and confirmed working — inferred from existing codebase -->

- ✓ **CLI entry point** — `apohara auto`, `config`, `auth`, `dashboard`, `uninstall` commands — existing
- ✓ **Task Decomposer** — LLM-powered prompt→DAG decomposition with roles and dependencies — existing
- ✓ **Agent Router** — Role-based provider selection with fallback chains (research/planning/execution/verification) — existing
- ✓ **Provider Router** — 21 providers unified API with automatic fallback and cooldown — existing
- ✓ **Parallel Scheduler** — Dependency-aware parallel execution with worktree isolation — existing
- ✓ **Subagent Manager** — 5 agents in parallel, timeouts, retries with exponential backoff — existing
- ✓ **Git Worktree Isolation** — Each agent executes in `.apohara/worktrees/lane-N/` — existing
- ✓ **Event Ledger** — Append-only JSONL event log with severity levels — existing
- ✓ **Credential Store** — `~/.apohara/credentials.json` with interactive config wizard — existing
- ✓ **OAuth PKCE** — Gemini OAuth flow with token storage — existing
- ✓ **Verification Mesh** — Dual-provider consensus with arbiter for critical tasks — existing
- ✓ **Consolidator** — Merge worktrees into target branch, generate PR — existing
- ✓ **Run Summary** — Markdown report with token/cost analytics — existing
- ✓ **API Key Sanitization** — Regex-based redaction for 15+ key patterns in logs — existing
- ✓ **TUI Dashboard** — Ink + React 19 terminal UI with task list, cost table, agent status — existing (108 tests passing)
- ✓ **Indexer Daemon** — Rust-based tree-sitter parser + nomic embeddings + redb storage — existing
- ✓ **Indexer Client** — Unix socket JSON-RPC with auto-spawn and reconnection — existing
- ✓ **Capability Manifest** — Provider capability scoring matrix by task type — existing (static scores)
- ✓ **MCP Bridge** — JSON-RPC stdio client with multi-server registry — existing
- ✓ **Mem0 Client** — Memory storage and retrieval for task decisions — existing
- ✓ **Platform Binaries** — npm optionalDependencies for darwin/linux/windows arm64/x64 — existing
- ✓ **Postinstall Hook** — Platform-specific binary extraction — existing

### Active

<!-- Current scope: Alfa completion + Beta initialization -->

- [ ] **CRED-01**: Wire CredentialResolver into main execution path (`auto.ts` → ProviderRouter) so it reads `~/.apohara/credentials.json` before env vars
- [ ] **CRED-02**: Implement 4-tier credential resolution order: credentials.json → env vars → OAuth cache → free-tier anonymous
- [ ] **AUTH-01**: Implement `apohara auth login <provider>` — OAuth PKCE flow with ephemeral callback server
- [ ] **AUTH-02**: Implement `apohara auth key <provider>` — API key validation with ping
- [ ] **AUTH-03**: Implement `apohara auth status` — Provider status table (tier, model, latency, cost)
- [ ] **AUTH-04**: Implement `apohara auth refresh <provider>` — Force OAuth token refresh
- [ ] **AUTH-05**: Implement `apohara auth revoke <provider>` — Invalidate and delete credential
- [ ] **ROUTE-01**: Implement Thompson Sampling in Capability Manifest for autonomous provider learning
- [ ] **ROUTE-02**: Implement 5% canary traffic allocation for provider exploration
- [ ] **ROUTE-03**: Implement exponential moving average score updates from real execution outcomes
- [ ] **MESH-01**: Implement AST signature injection in cross-verification arbiter
- [ ] **MESH-02**: Implement configurable verification policy (which tasks trigger mesh)
- [ ] **LEDGER-01**: Add SHA-256 hashes to Event Ledger entries for deterministic replay
- [ ] **LEDGER-02**: Implement replay mode — re-execute historical runs at temperature 0
- [ ] **SANDBOX-01**: Implement seccomp-bpf sandbox in `apohara-sandbox` crate (currently placeholder)
- [ ] **SANDBOX-02**: Implement 3-tier permission system (ReadOnly, WorkspaceWrite, DangerFullAccess)
- [ ] **DAG-01**: Implement topological sort with file-collision detection in task decomposer
- [ ] **DAG-02**: Implement backpressure when worktree pool is full
- [ ] **TUI-01**: Add real-time cost display per agent in dashboard
- [ ] **TUI-02**: Add swarm block visualization (which agent is touching which files)
- [ ] **MEMORY-01**: Replace Mem0 with Engram (local-first SQLite + FTS5, MIT, no API keys)

### Out of Scope

- **Ratatui terminal renderer** — Deferred to Phase Gamma/Delta. Current Ink TUI has 108 passing tests. Rebuilding violates "Simplicity First"
- **40+ providers** — Stabilize 21 first. Quality over quantity. Thompson Sampling must prove itself on current roster
- **IDE integration** — Apohara is CLI-first. Not competing with Cursor/VS Code
- **Cloud CI/CD pipeline** — Local executor only. Not a hosted service
- **Mobile app** — Terminal-native tool
- **Ollama/OpenRouter expansion** — Deferred until routing is mathematically proven on existing providers
- **GPU-accelerated rendering** — Future Ratatui feature, not v0.1.0

## Context

- **Brownfield project** — v0.1.0 codebase exists with 510 core + 108 TUI tests
- **One-person company** + AI swarm (no freelancers in this phase)
- **Budget**: $500 USD for API credits and tools
- **Target cost per task**: < $0.50 USD average
- **Legal strategy**: Write-Only Room — never read AGPL/unlicensed source code. MIT license. Clean IP
- **GSD1** is the workflow execution protocol for planning and phase management
- **Current branch**: `apohara/run-2026-05-03T15-36-35-000Z`

## Constraints

- **Stack**: TypeScript (Bun) + Rust. No Python, no Electron, no cloud dependencies for core
- **Binary size**: < 50MB single binary target
- **Startup time**: < 300ms for v0.1.0
- **License**: MIT only. Dependencies must have permissive licenses (MIT/Apache 2.0)
- **Privacy**: Local-first. Heavy computation (parsing, embeddings) stays on user's machine
- **Compatibility**: Node.js ≥22, Linux primary, macOS secondary, Windows tertiary

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Ink TUI over Ratatui shell | 108 tests passing, Simplicity First. Ratatui deferred to Gamma/Delta | — Pending |
| Stabilize 21 providers over expanding to 40 | Quality > quantity. Prove Thompson Sampling first | — Pending |
| Wire CredentialResolver as P0 | Without working credentials, swarm can't execute real tasks | — Pending |
| GSD1 as workflow protocol | Proven phase execution framework, integrates naturally | — Pending |
| Replace Mem0 with Engram | Local-first (SQLite+FTS5), MIT license, no API keys needed | — Pending |
| Write-Only Room legal strategy | Never read AGPL/unlicensed code. Maximizes IP cleanliness for acquisition | ✓ Good |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-07 after initialization*
