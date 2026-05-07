# Pitfalls Research — Multi-Agent AI Orchestration

## Critical Pitfalls (Domain-Specific)

### 1. Specification Ambiguity (41% of MAS failures)

**What goes wrong:** Vague role definitions cause agents to duplicate work, interpret tasks differently, or produce conflicting outputs. The MAST taxonomy identifies this as the #1 failure category.

**Warning signs:**
- Agents produce overlapping outputs
- Task decomposition yields ambiguous subtask descriptions
- Verification step can't determine if task was "done correctly"

**Prevention strategy:**
- Enforce structured task specs (JSON schema, not natural language prose)
- Each atomic task must have: input contract, output contract, success criteria
- Apohara's `TaskDecomposition` type already has `description`, `role`, `dependencies` — add `successCriteria` field

**Phase mapping:** Beta (DAG improvements)

### 2. Race Conditions in Worktree Execution

**What goes wrong:** Multiple agents modify the same files. Agent A reads a file, Agent B modifies it, Agent A writes back stale version. In traditional systems this takes microseconds; with LLM inference, the critical section extends to *minutes*.

**Warning signs:**
- Merge conflicts during consolidation
- Silent data corruption (no crash, just wrong output)
- Inconsistent code across worktrees

**Prevention strategy:**
- File-collision detection in DAG decomposition (detect overlapping file targets before execution)
- Distributed locks per file path during worktree execution
- Idempotent agent operations (re-runnable without side effects)
- Apohara's worktree isolation already helps — but consolidation is the danger zone

**Phase mapping:** Beta (DAG-01 file-collision detection)

### 3. Context Window Overflow

**What goes wrong:** Agent context fills with tool outputs, conversation history, retrieved documents. Early critical instructions are silently dropped. "Lost in the Middle" effect degrades accuracy even within the window limit.

**Warning signs:**
- Agent "forgets" initial instructions in long execution chains
- Quality degrades on tasks 4+ in a sequence
- Agent starts hallucinating file paths or function names

**Prevention strategy:**
- Context engineering: tiered context (stable system prompt vs. variable task context)
- Compaction/summarization of long histories between agent steps
- Split complex tasks into agents with limited, focused scope (Apohara already does this well)
- Monitor effective context usage per agent call

**Phase mapping:** Beta (agent context management)

### 4. Verification Gaps (No "Done" Checker)

**What goes wrong:** No explicit verification that a task was completed correctly before passing results downstream. Agents get stuck in loops, fail silently, or proceed with corrupted data.

**Warning signs:**
- Agents report "success" but output is wrong
- Downstream agents fail because upstream output format changed
- No clear termination criteria

**Prevention strategy:**
- Every task must have testable success criteria
- Verification mesh must run after every critical task (not just occasionally)
- Structured output validation (schema check, not just "looks right")
- Timeout + circuit breaker for verification loops

**Phase mapping:** Beta (MESH-01, MESH-02)

### 5. Provider Reliability Assumptions

**What goes wrong:** Assuming a provider will always be available. Rate limits, outages, model deprecations, and silent quality degradation in production.

**Warning signs:**
- Sudden 429/503 spikes from a provider
- Model behavior changes after provider update
- Cost spikes from falling back to expensive providers

**Prevention strategy:**
- Multi-provider routing with automatic failback (Apohara has this ✅)
- Thompson Sampling to detect quality degradation over time
- Cost caps per task and per run
- Health tracking with cooldown periods (Apohara has this ✅)

**Phase mapping:** Alfa (stabilize existing), Beta (Thompson Sampling)

### 6. The Monolith Trap (ProviderRouter)

**What goes wrong:** Core component grows into an unmanageable monolith. Apohara's `router.ts` is already 1294 lines — this is a known concern from the codebase map.

**Warning signs:**
- Single file > 500 lines handling multiple concerns
- Every new provider requires touching the same file
- Testing requires mocking the entire router

**Prevention strategy:**
- Extract provider-specific logic into per-provider adapters
- Separate routing logic from HTTP client logic
- Use a registry pattern (provider registers itself, router discovers)

**Phase mapping:** Alfa/Beta (refactor is important but not P0)

### 7. Observability Black Holes

**What goes wrong:** Token-level logging shows "successful" API calls but downstream business outcomes are corrupted. Can't trace *why* an agent made a decision.

**Warning signs:**
- "It worked in testing but fails in production"
- Can't reproduce bugs because execution is non-deterministic
- No way to understand why agent chose one approach over another

**Prevention strategy:**
- State-based observability (track intent flow across agent handoffs)
- Event Ledger with SHA-256 hashes for deterministic replay
- Structured decision logging (not just "agent called API")

**Phase mapping:** Beta (LEDGER-01, LEDGER-02)

## Severity Summary

| Pitfall | Severity | Apohara Exposure | Mitigation Phase |
|---------|----------|-----------------|------------------|
| Specification Ambiguity | Critical | Medium — tasks lack success criteria | Beta |
| Race Conditions | Critical | Low — worktree isolation helps | Beta |
| Context Window Overflow | High | Medium — no compaction yet | Beta |
| Verification Gaps | High | Medium — mesh exists but incomplete | Beta |
| Provider Reliability | Medium | Low — fallback chains exist | Alfa+Beta |
| Monolith Trap | Medium | High — router.ts is 1294 lines | Alfa/Beta |
| Observability Gaps | Medium | Medium — ledger exists but no replay | Beta |

---
*Research conducted: 2026-05-07*
