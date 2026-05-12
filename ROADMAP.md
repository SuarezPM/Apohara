# Apohara — Roadmap v2.0

> **The visual vibecoding orchestrator.**
> Multi-provider swarm + verification mesh + AMD MI300X local-first path via Apohara Context Forge.
>
> **License:** MIT
> **Status:** Active development. Single binary distribution. Tauri v2 + Bun + React + Rust sidecars.
> **Last reset:** 2026-05-11 (post-Phase-4 ship + visual pivot)

---

## 0. North Star

| Axis | Target |
|---|---|
| **Repo of the Day** | 5K stars in 60 days post-launch |
| **Acquisition zone** | $20–80M acqui-hire (Vercept playbook: Anthropic / Vercel / Cognition) |
| **v0.1 viral demo** | 90-second split-screen: 5 providers debating a refactor on DAG canvas + verification mesh resolving in vivo + green PR |
| **v0.2 stretch** | Self-improvement loop — `apohara auto "Implementá X en Apohara"` ships PR by itself |
| **Distribution** | `curl \| sh` install, single binary <15MB |

---

## 1. Mission

> Apohara transforms a natural-language objective into a swarm of LLM agents that decompose, execute, verify, and merge — visually, interactively, with cryptographically-replayable evidence at every step. The user types intent. The swarm builds the code while the user watches and steers.

---

## 2. Ecosystem — Two Products, Parallel Development

| Product | Repo | Stack | Role |
|---|---|---|---|
| **Apohara (orchestrator)** | `SuarezPM/Apohara` (this) | TypeScript/Bun + Rust + Tauri/React | Visual orchestrator. Decomposes, dispatches, verifies, merges. |
| **Apohara Context Forge** | `SuarezPM/Apohara_Context_Forge` | Python + FastAPI + vLLM | KV-cache coordinator on AMD MI300X. INV-15 safety invariant. Published paper: DOI 10.5281/zenodo.20114594. |

**Integration is loose, by design.** Apohara orchestrator talks to ContextForge over HTTP when the user has GPU. Otherwise it routes to cloud LLMs directly. The two repos ship on independent cadences.

---

## 3. Architecture v2.0 (stack frozen)

```
┌──────────────────────────────────────────────────────────────────────┐
│  APOHARA DESKTOP (Tauri v2, ~15 MB single binary)                    │
│  React 19 + Geist + @xyflow/react + Monaco + Lexical                 │
│  ├─ Objective pane    ┬─ Swarm Canvas (DAG)   ┬─ Code+Diff           │
│  └─────────────────── SSE stream from ledger ─────────────────────── │
└──────────────────────────────────────────────────────────────────────┘
                              ↕ HTTP (localhost:7331)
┌──────────────────────────────────────────────────────────────────────┐
│  APOHARA CORE (TypeScript / Bun runtime)                             │
│  Bun.serve() ──► /api/enhance · /api/run · /api/events (SSE)         │
│  ┌─ src/core/ ──────────────────────────────────────────────────┐    │
│  │ decomposer · scheduler · subagent-manager · consolidator      │    │
│  │ verification-mesh · agent-router · ledger (Phase 4 hash chain)│    │
│  │ capability-manifest · sandbox (TS wrapper)                    │    │
│  └─────────────────────────────────────────────────────────────  ┘    │
│  src/providers/router.ts — 21 providers + OAuth (Gemini)             │
└──────────────────────────────────────────────────────────────────────┘
                              ↕ Unix Domain Sockets
┌─────────────────────────────────┬────────────────────────────────────┐
│  apohara-indexer (Rust) ✅      │  apohara-sandbox (Rust) 🔴         │
│  tree-sitter + redb + Nomic BERT│  seccomp-bpf + Linux namespaces    │
│  Knowledge graph + embeddings   │  3-tier permissions                │
│  Daemon, Unix socket RPC        │  M014 build target                 │
└─────────────────────────────────┴────────────────────────────────────┘
                              ↕ HTTP (optional)
┌──────────────────────────────────────────────────────────────────────┐
│  APOHARA CONTEXT FORGE (separate repo, Python, optional)             │
│  FastAPI on :8001 + vLLM bridge + INV-15 safety gate                 │
│  When user has GPU → 60–80% token savings (measured AMD MI300X)      │
└──────────────────────────────────────────────────────────────────────┘
```

### Stack decisions (locked)

| Layer | Tech | Why |
|---|---|---|
| Desktop shell | **Tauri v2** | ~8 MB bundle vs 200 MB Electron. Native FS. Web-app reusable. |
| HTTP backend | **Bun.serve()** | Already in the project. SSE primitive. No Express. |
| Frontend | **React 19** | Reuses hooks from `packages/tui` (Ink also uses React). |
| DAG visualization | **@xyflow/react** | Mature, accessible, MIT. |
| Code diff | **Monaco editor (diff mode)** | The standard. |
| Stream protocol | **Server-Sent Events** tailing JSONL ledger | Zero new persistence. Auto-reconnect. |
| Visual identity | Dark default · Geist Mono + Geist Sans · cyan/violet accents | Linear + Vercel + Raycast inspiration |

---

## 4. Current State (locked 2026-05-11)

| Component | Status | Notes |
|---|---|---|
| Phase 1: Credentials tracer-bullet | ✅ | CLW-CRED-001 fixed |
| Phase 2: Auth CLI | ✅ | Gemini OAuth working; Anthropic blocked by TOS |
| Phase 3: Vibe DAG hardening | ✅ | Real DAG, cycle detection (DFS) in decomposer.ts |
| Phase 4: Event Ledger v2 | ✅ | SHA-256 chain + genesis + verify() + `apohara replay` |
| M010: Context Compression (tree-sitter) | ✅ | In apohara-indexer |
| M011: Long-Term Memory | ✅ | redb + Nomic BERT, Mem0 removed |
| 21 providers wired | ✅ | router.ts. OAuth: Gemini only. |
| Verification Mesh (dual-arbiter) | ✅ | 647 LOC, real |
| Worktree isolation | ✅ | scheduler.ts spawns in `.claude/worktrees/` |
| TUI prototype (Ink+React) | 🟡 | `packages/tui/` — archived after M017 parity |
| apohara-indexer (Rust) | ✅ | Production: tree-sitter + redb + candle |
| apohara-sandbox (Rust) | 🔴 | 1-line stub. M014 target. |
| Test suite | 🟡 | ~610 blocks total. 60 known-broken. CI red. Phase 5 fixes this. |

---

## 5. Milestone Sequence

```
NOW ──► Phase 5 ──► M014 ──► M017 ──► M015 ──► Phase 6 (v0.1 ship)
                                                    │
                                                    ▼
                                                M013 ──► M018 ──► Phase 7 (v0.2)
```

---

## Phase 5 — Honesty Pass + Test Foundation Reset (P0, ACTIVE)

**Goal:** CI green. Tests deterministic. Repo cleaned of dead code. Single source of truth in docs.

**Why now:** every milestone after this depends on a green test loop. The current OOM crashes and 60 broken tests are existential.

| # | Task | Verify |
|---|------|--------|
| 5.1 | Mock `EmbeddingModel` via trait + feature flag. Tests use deterministic `MockEmbedding` (vector keyed off input hash). Zero BERT load in tests. | `cargo test -p apohara-indexer --lib` green in <30s, RAM <500MB |
| 5.2 | Audit the 60 known-broken tests. Classify: `KEEP` (rewrite against fresh spec), `KILL` (delete as legacy debt). | Each test has an explicit verdict in `.claude/specs/tests/PHASE_5_AUDIT.md` |
| 5.3 | Restore CI green. Root-cause the 15s fast-fail. | GitHub Actions latest run = success |
| 5.4 | Reconcile docs. Single AGENTS.md or fold into CLAUDE.md. GitNexus reindex (Clarity-Code → Apohara name drift). | `gitnexus_query "EventLedger"` returns fresh symbols |
| 5.5 | ~~Kill list~~ — INVESTIGATED 2026-05-11 and downgraded to no-op. `isolation-engine/` is wired into `src/core/isolation.ts` (worktree backend) + 3 tests. `examples/fastify-api/` is the E2E test fixture for `tests/e2e/fastify-jwt.test.ts` + install-and-run test. Both stay. `crates/apohara-sandbox/` stub gets recreated by M014.1 anyway. | n/a — empty milestone |
| 5.6 | Update CLAUDE.md to reflect Roadmap 2.0 (visual pivot, Tauri stack, Phase/M progression) | `/mcp` + `/memory` show updated context |

**Verification:** zero local OOM during `bun test` or `cargo test --lib`. CI passes. `git status` clean except intentional new files.

**Duration estimate:** 2–3 dense sessions.

---

## M014 — apohara-sandbox real (P0 v0.1 blocker)

**Goal:** A task that attempts to write outside its worktree is killed by the kernel before the write completes.

| # | Task | Verify |
|---|------|--------|
| 14.1 | Recreate `crates/apohara-sandbox/` from scratch with real Cargo deps: `seccompiler`, `nix`, `libc` | `cargo build -p apohara-sandbox` green |
| 14.2 | seccomp-bpf profile: 3-tier syscall allowlists (`ReadOnly` / `WorkspaceWrite` / `DangerFullAccess`) | Unit test: forbidden syscall → EPERM |
| 14.3 | Linux namespaces: separate mount + PID namespace per worktree, via `unshare(2)` | Integration test: process inside namespace cannot see host PIDs |
| 14.4 | Integration with `src/core/sandbox.ts` spawn — subprocess via Unix socket | E2E test: an agent given `rm -rf ~` returns EPERM, logged to ledger |
| 14.5 | Sandbox escape attempts → Event Ledger entries with `type: "security_violation"` | Replay shows violation events |
| 14.6 | Graceful fallback on non-Linux (macOS dev box, CI): warn + run with explicit user consent flag | CI passes on Linux + macOS |

**Tracer bullet:** demo recording where an agent given `rm -rf $HOME` is blocked by the kernel and the violation appears in the UI in real time.

**Duration estimate:** 3–4 sessions. Rust low-level work.

---

## M017 — apohara-desktop (Tauri + React + Bun + SSE)

**Goal:** The visual surface. Replaces both the Ink TUI prototype and the cancelled Ratatui plan.

**Tracer bullet:** type `"build a CRUD endpoint with auth"` in the Objective pane, watch the DAG appear, agents execute in canvas, verification mesh resolve a conflict, green PR appear.

| # | Task | Verify |
|---|------|--------|
| 17.1 | Bootstrap Tauri v2 in `packages/desktop/`. Bun.serve on `localhost:7331`. | `bun run desktop:dev` opens native window with React SPA |
| 17.2 | API routes: `POST /api/enhance`, `POST /api/run`, `GET /api/session/:id/events` (SSE) | curl test: SSE tail emits ledger lines as they're written |
| 17.3 | **Objective pane** (left): textarea, enhance toggle (before/after), run/pause/takeover controls | Click "Enhance" → enhanced prompt streams into pane |
| 17.4 | **Swarm Canvas** (center): DAG via `@xyflow/react` + agent lanes with progress bars, provider badge, cost ticker | DAG nodes animate in as decomposer emits events |
| 17.5 | **Code+Diff pane** (right): file tree (modified flagged), Monaco diff viewer, verification mesh panel | File appears as modified the moment an agent writes |
| 17.6 | **Top bar cost meter**: cumulative tokens, USD, run duration. GPU/Cloud mode toggle (for M015). | Cost increments live during run |
| 17.7 | Visual identity locked: dark default, Geist Mono + Geist Sans, cyan `#6EE7F7` + violet `#A78BFA` accents | Storybook for each main pane |
| 17.8 | Tauri build → single binary <15 MB Linux/macOS/Windows | `tauri build` produces verified binary, smoke-tested on all 3 OSes |
| 17.9 | Migrate useful hooks from `packages/tui/` (Ink) → `packages/desktop/` (React). Archive `packages/tui/`. | `packages/tui/` has README pointing to packages/desktop |
| 17.10 | E2E test: full visual flow with mocked providers | Playwright test reaches green PR step |

**Duration estimate:** 5–7 sessions. Biggest milestone of v0.1.

---

## M015 — ContextForge Loose Integration

**Goal:** when the user has a GPU and runs Apohara Context Forge as a sidecar, Apohara orchestrator routes through it for 60–80% token savings.

| # | Task | Verify |
|---|------|--------|
| 15.1 | New provider `contextforge-vllm` in `src/providers/router.ts`. HTTP client to ContextForge endpoints. | `apohara auto "X"` with sidecar running succeeds |
| 15.2 | Apohara → ContextForge call sequence: `register_context` before inference, `get_optimized_context` for shared handles | Token count from sidecar < cloud-only count |
| 15.3 | New ledger event type: `contextforge_savings` with measured token delta | Event appears in `.events/*.jsonl` |
| 15.4 | **INV-15 transfer**: port the safety gate concept to `src/core/verification-mesh.ts`. When risk > τ on judge agent, force fresh context. | Unit test mirroring INV-15 paper's 9-tuple sweep |
| 15.5 | UI toggle in cost meter: "GPU mode (ContextForge)" vs "Cloud mode". Shows live savings %. | Toggle switches routing, UI reflects mode |
| 15.6 | Documentation: how users deploy ContextForge sidecar (Docker compose snippet in README) | `docker-compose up` + `apohara auto` works end-to-end |

**Duration estimate:** 2–3 sessions.

---

## Phase 6 — v0.1 Ship

| # | Task | Verify |
|---|------|--------|
| 6.1 | Binary <15 MB for Linux (x64/ARM), macOS (ARM/x86), Windows (x64). | `curl -L install.apohara.dev \| sh` lands working binary |
| 6.2 | **90-second viral demo video**: split-screen of 5 providers + DAG + verification mesh + green PR. | Video published, ready for HN/Twitter |
| 6.3 | README rewrite + ARCHITECTURE.md + landing page on github.io | Pages live, README has hero diagram + demo video |
| 6.4 | HN launch + Twitter thread + arXiv link to INV-15 paper | Coordinated drop |
| 6.5 | 50 beta users onboarded via Discord | Discord live with channels |
| 6.6 | Release `v0.1.0` on GitHub, Homebrew formula, `curl \| sh` script | `brew install suarezpm/tap/apohara` works |

**Duration:** 1–2 sessions release engineering after M015.

---

## M013 — Thompson Sampling (post-v0.1)

| # | Task | Verify |
|---|------|--------|
| 13.1 | `CapabilityManifest` persists per-provider success/failure counts per role in redb | Survives daemon restart |
| 13.2 | Thompson Sampling: Beta distribution per provider/role | Unit test: distribution converges after N trials |
| 13.3 | ProviderRouter queries CapabilityManifest before routing. 5% traffic exploration. | After 20 runs, `router.getBestProvider("codegen")` differs from hardcoded |
| 13.4 | New dimension `kv_share_friendliness` — learns when ContextForge helps which task types | Manifest reflects per-task-type GPU mode hit rate |
| 13.5 | `apohara stats` command: prints per-role provider rankings | Human-readable table |

**Duration:** 2 sessions.

---

## M018 — GSD2 Patterns Adoption (incremental, ongoing)

GSD2 (`gsd-build/gsd-2`, MIT, 7K stars, active) has battle-tested patterns Apohara should inherit. Apply opportunistically when refactoring the relevant module:

| Pattern (GSD2 file) | Where to apply in Apohara |
|---|---|
| `AutoOrchestrationModule` + 8 adapter contracts | `src/core/subagent-manager.ts` |
| `STUCK_WINDOW_SIZE = 6` ring-buffer stuck detector | scheduler.ts run loop |
| `worktree-manager.ts` lifecycle verbs (`adoptOrphanWorktree`, `restoreToProjectRoot`) | `.claude/worktrees/` formalization |
| Model resolver with auth-aware fallback | `agent-router.ts` |
| Drift reconciliation registry (ADR-017) | recovery in scheduler |
| `gsd headless query` JSON state | new `apohara state --json` command for CI |

Not a blocking milestone. Stolen incrementally.

---

## Phase 7 — v0.2 Self-Improvement Loop

**Tracer bullet:** `apohara auto "Implementá Thompson Sampling en apohara"` produces a working PR autonomously.

| # | Task | Verify |
|---|------|--------|
| 7.1 | Apohara reads its own repo successfully via apohara-indexer | `apohara auto "X en apohara"` finds relevant files |
| 7.2 | **Nimbalyst-style markdown-as-spec**: plans/tasks live as `.apohara/specs/*.md` with frontmatter; agents read them. | Agent reads spec, updates state on completion |
| 7.3 | Public Discord onboarding scales to 500 users | Discord active |
| 7.4 | Release `v0.2.0` | GitHub release + announcement |

---

## 6. Backlog (post-v0.2)

- `apohara-compressor` Rust crate if benchmarking shows TS bottleneck
- Expand providers 21 → 40+
- OAuth: Anthropic, OpenAI, Antigravity, GitHub Copilot
- iOS companion (Nimbalyst pattern)
- Collab server (paid SaaS, Cloudflare Workers + Durable Objects)
- Apohara MCP server (third-party tool integration)

---

## 7. Kill List (revised 2026-05-11 after investigation)

| Item | Verdict | When |
|---|---|---|
| ~~`isolation-engine/`~~ | **KEEP** — wired into `src/core/isolation.ts` (worktree backend) + 3 tests. Will be folded into apohara-sandbox during M014 when it makes sense. | n/a |
| `crates/apohara-sandbox/` (1-line stub) | recreate from scratch | M014.1 |
| ~~`examples/fastify-api/`~~ | **KEEP** — E2E test fixture for `tests/e2e/fastify-jwt.test.ts` + `tests/e2e/install-and-run.test.ts`. It's the canonical "Apohara installs and runs a Bun project" verifier. | n/a |
| `packages/tui/` (Ink+React prototype) | archive after M017 parity | M017.9 |
| 60 known-broken tests | audit → keep & rewrite or kill | Phase 5.2 |
| **Ratatui pivot** (was M016) | **cancelled in favor of Tauri+React (M017)** | Already, 2026-05-11 |

**Investigation note 2026-05-11**: The original kill list (drafted in the user-confirmed scope earlier today) included `isolation-engine/` and `examples/fastify-api/` as dead code. A pre-deletion grep found 4 + 3 active references respectively. Both stay. Phase 5.5 is a no-op as a result. The lesson: never trust "looks like a stub" without grepping for consumers.

---

## 8. Patterns Inherited from the Ecosystem

| Source | Pattern | Target |
|---|---|---|
| Apohara Context Forge | INV-15 safety invariant — when KV reuse corrupts judge agents | `verification-mesh.ts` (M015.4) |
| Apohara Context Forge | KV/token sharing across multi-agent prompts | Apply to cloud prompt-caching via `router.ts` (M015) |
| GSD2 | AutoOrchestrationModule contracts + drift reconciliation | `subagent-manager.ts` (M018) |
| GSD2 | STUCK_WINDOW_SIZE ring buffer | scheduler run loop (M018) |
| Nimbalyst | Plans/tasks as markdown frontmatter in repo, agent-readable | v0.2 (Phase 7.2) |
| Linear / Vercel / Raycast | Visual identity language | M017.7 |

---

## 9. Risks & Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Tauri v2 learning curve | M | Start with bootstrap session (M017.1), small scope |
| Test reset cost in time | H | Phase 5 budgeted explicitly; don't skip |
| ContextForge integration depends on parallel repo | M | Loose integration design — Apohara works without it |
| Sandbox M014 is non-trivial Rust | H | Budget 3–4 sessions; use existing `seccompiler` crate; non-Linux fallback |
| Visual UI iteration cost | M | Designer agent already produced spec; Storybook per pane reduces churn |
| OOM regression in tests | H | Phase 5.1 mocks BERT entirely; eliminates root cause |

---

## 10. Success Metrics

| Phase | Star count | Active users | Notable signal |
|---|---|---|---|
| Phase 5 done | n/a | n/a | CI green for 30 days |
| v0.1 ship | 500 → 1K | 50 beta | 1 viral demo with 100K+ views |
| v0.2 ship | 5K | 500 | INV-15 paper cited externally |
| Months 6–9 | 10K+ | 2K+ | Acquisition outreach window (Anthropic / Vercel / Cognition) |

---

## 11. OMC Orchestration Protocol (preserved from v1)

For each milestone:
1. `/ralplan` — consensus planning before first commit
2. `/ultrawork` — parallel execution of independent tasks within the milestone
3. `gitnexus_impact` — mandatory before touching any hub symbol
4. `bun test tests/<file>.test.ts` — single file at a time per CLAUDE.md §8.1 OOM rule
5. `gitnexus_detect_changes` — scope verification before commit

Primary model: **Opus 4.7** for architecture, complex implementation, Rust.
Secondary: **Sonnet 4.6** for tests, docs, small fixes.

---

*Document drafted 2026-05-11. Replaces ROADMAP v1 (May 2 master + post-Phase-4 update). Source of truth going forward.*
