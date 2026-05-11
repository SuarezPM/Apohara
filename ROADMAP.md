# Apohara — Roadmap v2

> **Orchestrator**: OMC (oh-my-claudecode) with Opus 4.7 as primary model.
> **Strategy**: Vertical MVPs (Tracer Bullets). No horizontal slicing. Every phase ships an end-to-end observable behavior.
> **Anti-patterns in force**: No OMO-Slim, No SQLite/FTS5 for memory, No Ratatui yet, No new providers until Thompson Sampling lands.

---

## Current Baseline (May 2026)

| Component | Status |
|-----------|--------|
| M010 Context Compression (Tree-sitter AST) | ✅ Complete |
| M011 Long-Term Memory (redb + Nomic BERT) | ✅ Complete — Mem0 removed, redb is sole memory |
| Phase 1 Tracer Bullet (Credentials) | ✅ Complete |
| Phase 2 Auth CLI | ✅ Complete |
| Phase 3 Vibe DAG Hardening | ✅ Complete |
| Identity unified (package, README, docs) | ✅ Complete |
| Test suite | 🟡 ~529 pass / 60 fail → fixing |
| **Phase 4 Event Ledger v2** | ✅ Complete — 4.1–4.5 done |

---

## Phase 4 — Event Ledger v2: Deterministic Replay

**Goal**: Every run is cryptographically sealed and fully replayable.

**Tracer bullet**: `apohara replay <run-id>` produces byte-identical LLM calls.

### Tasks

| # | Task | Verify | Status |
|---|------|--------|--------|
| 4.1 | SHA-256 chain: each JSONL line hashes `prev_hash + payload` | `bun test tests/ledger.test.ts` passes | ✅ |
| 4.2 | Genesis block (run-id header) with timestamp + version | First line of every `.events/*.jsonl` has `type: "genesis"` | ✅ |
| 4.3 | Tamper detection: linear scan on load, abort if hash breaks | `EventLedger.verify()` returns `brokenAt` on mutated file | ✅ |
| 4.4-pre | `llm_request` event type captures messages+provider+model before each call | `tests/replay.test.ts` "writes llm_request event" passes | ✅ |
| 4.4 | `apohara replay <run-id>` command: forces `temperature: 0` in ProviderRouter | `tests/replay.test.ts` "injects temperature:0" passes (opencode/anthropic/deepseek/openai covered, other 14 providers TODO) | ✅ |
| 4.5 | Replay dry-run mode: `--dry-run` prints the call plan without executing | Output is deterministic JSON (sorted keys, stable across invocations) | ✅ |

**OMC execution**: `/ultrawork` for 4.1–4.3 (parallelizable), sequential for 4.4–4.5.

---

## M012 — Real-Time TUI: Event Ledger Hydration

**Goal**: Mission dashboard shows live swarm progress and cost as events stream in.

**Tracer bullet**: Run `apohara auto "build X"` and watch agents appear in the TUI with cost counters updating in real time.

### Tasks

| # | Task | Verify |
|---|------|--------|
| 12.1 | `LedgerWatcher` polls `.events/` dir, emits typed events via EventEmitter | `packages/tui/lib/ledger-watcher.ts` unit tests pass |
| 12.2 | `useLedger` hook consumes LedgerWatcher, exposes `runs[]` + `activeRun` | Hook tests pass with jsdom env |
| 12.3 | `AgentStatus` component hydrates from `useLedger` (replaces static mock data) | Visual: agents appear/disappear in real time |
| 12.4 | `AgentCostTable` shows live token cost per agent per provider | Cost increments visible during run |
| 12.5 | Dashboard auto-scrolls to active run, freezes on completed | E2E: `bun test tests/e2e/dashboard.test.ts` passes |

**OMC execution**: Design pass with `architect` agent first, then `/ultrawork` for 12.1–12.5.

---

## M013 — Thompson Sampling: Autonomous Provider Calibration

**Goal**: ProviderRouter learns which LLM is best for each task role (research, codegen, verification) from historical runs.

**Tracer bullet**: After 20 runs, `router.getBestProvider("codegen")` returns a different result than the hardcoded default, backed by real success/cost data.

### Tasks

| # | Task | Verify |
|---|------|--------|
| 13.1 | `CapabilityManifest` stores per-provider success/failure counts per role in redb | Persists across daemon restarts |
| 13.2 | Thompson Sampling implementation: Beta distribution sampling per provider/role | Unit test: distribution converges after N trials |
| 13.3 | ProviderRouter queries CapabilityManifest before routing | Sampling is used when data exists, fallback otherwise |
| 13.4 | Event Ledger records routing decisions with provider + outcome | Replay can reconstruct manifests |
| 13.5 | `apohara stats` command: prints per-role provider rankings | Human-readable table |

**Depends on**: Phase 4 (ledger must record outcomes before sampling can learn).

---

## M014 — Sandbox Enforcement: seccomp-bpf Hardening

**Goal**: No worktree can touch the host filesystem outside its designated path under any circumstance.

**Tracer bullet**: A task that attempts to write to `~/.ssh` is killed by the kernel before the write completes.

### Tasks

| # | Task | Verify |
|---|------|--------|
| 14.1 | `apohara-sandbox` applies `seccomp-bpf` profile on worktree spawn | Rust test: syscall outside allowlist returns EPERM |
| 14.2 | Linux namespace isolation: separate mount + PID namespace per worktree | `isolation.test.ts` passes |
| 14.3 | Permission levels enforced: ReadOnly / WorkspaceWrite / DangerFullAccess | Each level tested with an attempted violation |
| 14.4 | Sandbox escape attempts logged to Event Ledger | Entry with `type: "security_violation"` appears |
| 14.5 | Graceful sandbox unavailable path (non-Linux / CI): warn + continue | CI tests pass without sandbox |

**Note**: Rust work. Use `opus` model via OMC for `14.1`–`14.3`.

---

## Execution Order

```
Phase 4 (active now)
    └─ M012 (unblocked after 4.1-4.3, can start TUI while 4.4-4.5 finish)
        └─ M013 (unblocked after Phase 4 complete — needs ledger outcomes)
            └─ M014 (independent, can run in parallel with M013)
```

---

## OMC Orchestration Protocol

For each milestone:
1. **`/ralplan`** — consensus planning before first commit
2. **`/ultrawork`** — parallel execution of independent tasks within the milestone  
3. **`gitnexus_impact`** — mandatory before touching any hub symbol
4. **`bun test`** — zero failures before milestone declared complete
5. **`gitnexus_detect_changes`** — scope verification before commit

Primary model: **Opus 4.7** for architecture, complex implementation, Rust.
Secondary: **Sonnet 4.6** for tests, docs, small fixes.
