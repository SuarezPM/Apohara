---
phase: 3
phase_name: "DAG Hardening — Safe Parallel Execution"
created: "2026-05-07"
---

# Discussion Log — Phase 3: DAG Hardening

## Session Summary

All four gray areas resolved in a single pass. User answered with high precision and complete technical rationale. No follow-up questions needed.

**Governing invariants confirmed:**
- Goal-Driven Execution: zero human intervention during swarm runs
- Simplicity First: use existing tools (Git, LLM intent) over custom implementations

---

## Area A — File-Collision Detection Shape

**Options presented:**
1. Explicit LLM declaration (`targetFiles: string[]` per task)
2. Detect at worktree-merge time (post-execution)
3. Static path heuristics from task description text

**Decision:** Option 1 — Explicit LLM declaration

**User reasoning:** Option 2 burns compute on doomed tasks. Option 3 is too fragile. The LLM already reads repo structure via the Context Engine — it's the best entity to declare blast radius. Cognitive load pushed to the planner (where it belongs).

---

## Area B — Collision Response

**Options presented:**
1. Automatically serialize — inject implicit `depends_on` edge
2. Hard-fail, require re-decomposition
3. Interactive prompt to user

**Decision:** Option 1 — Implicit edge injection with deterministic tie-breaking

**User reasoning:** Hard-fail and interactive prompt both violate the Zero-Human-Intervention invariant. The swarm must fix its own topology. Tie-breaker: sort by task index / alphabetical ID for determinism.

---

## Area C — Backpressure Behavior

**Options presented:**
1. Block/pause — hold in queue until slot frees
2. Queue with timeout — block up to N seconds then fail
3. Reject immediately — caller must retry

**Decision:** Option 1 — Patient async worker pool (p-limit or custom)

**User reasoning:** Rejection forces retry logic onto callers. Timeout introduces LLM-latency-dependent race conditions (LLM latency is highly variable). The swarm should patiently execute as capacity allows.

---

## Area D — Consolidator Corruption Detection

**Options presented:**
1. Structural check — verify all tasks contributed output
2. Hash-based chunk scanner for conflicting file regions
3. Git merge + scan for `<<<<<<<` conflict markers

**Decision:** Option 3 — Git-native merge conflict detection

**User reasoning:** Git already implements mathematically correct line-by-line conflict resolution. A custom hash-based scanner is textbook over-engineering. Simplicity First.

**Fallback defined:** Conflict detected → `git merge --abort` → mark task `failed: merge_conflict` → retry sequentially via Graceful Degradation loop. Conflict at this stage signals a gap in `targetFiles` declaration (Decision A).

---

## Deferred Ideas

_None raised during this session._
