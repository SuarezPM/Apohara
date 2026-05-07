---
phase: 3
phase_name: "DAG Hardening — Safe Parallel Execution"
created: "2026-05-07"
status: context_captured
---

# Phase 3 Context: DAG Hardening — Safe Parallel Execution

## Domain

The swarm safely executes parallel tasks without file collisions or pool exhaustion. This phase implements the core of the Vibe DAG architecture: topological sort with collision detection, implicit edge injection for serialization, async backpressure in the worker pool, and Git-native conflict detection at consolidation.

**Governing principles:** Goal-Driven Execution (zero human intervention during a run), Simplicity First (leverage existing tools over custom implementations).

---

## Decisions

### A — File-Collision Detection: LLM-Declared `targetFiles`

**Decision:** The LLM explicitly declares file ownership during decomposition.

**Implementation contract:**
- `DecomposedTask` schema in `src/core/decomposer.ts` MUST include `targetFiles: string[]` — a list of relative file paths the task will read or write.
- The decomposition prompt must instruct the LLM to enumerate `targetFiles` for every task based on its understanding of the repository structure (already provided via the Context Engine / indexer).
- This field is **required** — tasks without `targetFiles` must default to `[]` (no owned files) and are free to parallelize.

**Rationale:** Detecting collisions at merge time (post-execution) wastes compute on doomed tasks. Static path heuristics from task description text are fragile. The LLM is already the best entity to predict blast radius — it reads the repo structure and generates the task intent.

---

### B — Collision Response: Implicit Edge Injection (Automatic Serialization)

**Decision:** When two tasks collide on files, the DAG is automatically mutated to serialize them — no human intervention, no hard failure.

**Implementation contract:**
- In `src/core/decomposer.ts`, after the LLM returns the initial DAG, run a **post-processing pass** before returning `DecompositionResult`.
- Algorithm: For every pair `(X, Y)` where no dependency edge exists between them: if `intersection(X.targetFiles, Y.targetFiles).length > 0`, inject an implicit `depends_on` edge.
- **Tie-breaker:** Sort by task index (or alphabetical task ID) to ensure deterministic serialization. If tasks X and Y collide and `X.id < Y.id`, then `Y.depends_on` gains `X.id`.
- The injected edge must be flagged as `implicit: true` in the DAG representation (for observability/logging).

**Rationale:** Hard-failing on collision violates the Zero-Human-Intervention invariant. Interactive prompts violate it entirely. The swarm must fix its own topology and keep running.

---

### C — Backpressure: Block and Queue (Async Worker Pool)

**Decision:** When all worktree lanes are occupied, subsequent tasks block in an async queue until a slot frees — no timeout, no rejection.

**Implementation contract:**
- In `src/core/scheduler.ts`, the `executeAll()` method must implement an **async worker pool pattern**.
- Recommended implementation: `p-limit` (already a transitive dep of many bun projects) or a custom `AsyncQueue` with `maxConcurrency = config.maxWorktrees` (default: 5).
- Task dispatch: `await limiter(() => scheduleTask(task))` — the task awaits naturally until a worktree slot is released by a completing task's `completeTask()` call.
- No timeouts on the wait — LLM latency is highly variable; timeouts would produce spurious failures.

**Rationale:** Immediate rejection forces unnecessary retry logic onto the caller. Timeouts introduce LLM-latency-dependent race conditions. Patient queuing is the correct default for a deterministic DAG executor.

---

### D — Consolidator Corruption Detection: Git Merge Conflict Markers

**Decision:** Leverage Git's native merge for conflict detection — do not implement custom chunk diffing.

**Implementation contract:**
- In `src/core/consolidator.ts`, when a task completes, attempt `git merge <worktree-branch> --no-commit --no-ff` into the staging branch.
- If `git merge` exits non-zero **and** the working tree contains `<<<<<<<` markers, a conflict is confirmed.
- **Fallback action on conflict:**
  1. Abort the merge: `git merge --abort`
  2. Mark the failing task as `status: "failed"` with `reason: "merge_conflict"`
  3. Trigger the Graceful Degradation / Recovery loop to retry the task **sequentially** (non-parallel, no worktree isolation) so Git can apply it cleanly after the conflicting task has merged.
- This is the **last line of defense** — the DAG post-processing in Decision B should have prevented this. A conflict at consolidation time signals a gap in `targetFiles` declaration that must be logged.

**Rationale:** Git implements mathematically correct, line-by-line merge conflict detection. Writing a custom hash-based chunk scanner is textbook over-engineering that duplicates Git's proven algorithm.

---

## Code Context

### Files to Modify

| File | What changes |
|------|-------------|
| `src/core/decomposer.ts` | Add `targetFiles: string[]` to `DecomposedTask`; add post-processing pass for collision detection + edge injection |
| `src/core/scheduler.ts` | Replace bare `Promise.all` in `executeAll()` with async worker pool (p-limit or custom); add queue observable for observability |
| `src/core/consolidator.ts` | Add Git merge attempt + conflict marker scan + fallback recovery trigger |
| `src/core/types.ts` | Extend `DecomposedTask` with `targetFiles: string[]` and optional `implicit: boolean` on dependency edges |

### Existing Assets (Reuse)

- `decomposer.ts → detectCycle()` — DFS cycle detection already exists; collision detection is a separate pass that runs alongside it
- `scheduler.ts → findAvailableWorktree()` — already finds free slots; backpressure wraps this with a queue
- `scheduler.ts → getPoolSize()` — returns active count; use for queue depth telemetry
- `isolation.ts → IsolationEngine` — worktree create/destroy unchanged; collision logic is above this layer

### Tests to Check

- `tests/decomposer.test.ts` — extend with collision detection and edge injection cases
- `tests/scheduler.test.ts` — extend with pool-full backpressure scenarios
- `tests/e2e-swarm-integration.test.ts` — success criterion 3: 10-task DAG with 3 parallel waves, zero merge conflicts

---

## Canonical Refs

| Ref | Purpose |
|-----|---------|
| `src/core/decomposer.ts` | Primary target — `DecomposedTask` schema + post-processing pass |
| `src/core/scheduler.ts` | Primary target — `executeAll()` worker pool refactor |
| `src/core/consolidator.ts` | Primary target — Git merge + conflict fallback |
| `src/core/types.ts` | Shared types — extend `DecomposedTask` |
| `src/core/isolation.ts` | Worktree engine — read-only reference, interface unchanged |
| `.planning/REQUIREMENTS.md` | Requirements DAG-01, DAG-02 |

---

## Requirements Coverage

| Requirement | Decision |
|-------------|----------|
| DAG-01: Topological sort with file-collision detection | Decision A (targetFiles) + Decision B (edge injection) |
| DAG-02: Backpressure when worktree pool is full | Decision C (async worker pool) |
| Success criterion 3: 10-task DAG, 3 waves, zero merge conflicts | Decision B (serialization) + Decision D (Git merge check) |
| Success criterion 4: Zero silent data corruption | Decision D (Git merge markers + abort+retry) |
