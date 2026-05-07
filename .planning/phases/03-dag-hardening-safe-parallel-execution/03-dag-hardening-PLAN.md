# Plan: Phase 3 — DAG Hardening — Safe Parallel Execution

**Phase:** 3
**Requirements:** DAG-01, DAG-02
**Status:** Ready for execution

---

## Overview

Four implementation areas in four sequential waves. Waves 2–3 are internally parallelizable. Wave 4 is integration verification only.

---

## Wave 1 — Schema & Types (Sequential, must complete first)

### Task 1.1: Add `targetFiles` and `implicitDependencies` to `DecomposedTask`

**File:** `src/core/decomposer.ts`
**Action:** modify

**Description:** Extend the `DecomposedTask` interface with two new fields. `targetFiles` declares file ownership; `implicitDependencies` tracks edges injected by collision detection (separate from user-declared `dependencies`) for observability.

**Implementation:**

```typescript
export interface DecomposedTask {
  id: string;
  description: string;
  estimatedComplexity: "low" | "medium" | "high";
  dependencies: string[];
  role: TaskRole;
  files?: string[];
  /** Relative file paths this task will read or write. [] = no ownership = freely parallelizable. */
  targetFiles: string[];
  /** Edges injected by DAG collision detection (not declared by LLM). Subset of dependencies. */
  implicitDependencies?: string[];
  indexerContext?: IndexerContext;
}
```

**Verification:** TypeScript compiles with `bun run typecheck` (or `tsc --noEmit`). All existing tests still pass.

---

### Task 1.2: Update LLM decomposition prompt to require `targetFiles`

**File:** `src/core/decomposer.ts`
**Action:** modify

**Description:** Find the system/user prompt sent to the LLM in the `decompose()` method. Add `targetFiles` to the JSON schema and to the instruction text.

**Implementation:** In the decomposition prompt, add:

```
For each task in the JSON output, include a "targetFiles" array listing the exact relative
file paths this task will create or modify. This enables safe parallel execution — the
system will serialize tasks that would modify the same files.

Rules:
- List only files this task WRITES (not reads)
- Use relative paths from the project root (e.g. "src/auth.ts", not "/home/user/src/auth.ts")
- If a task's file output is dynamic/unknown, set "targetFiles": []
- Empty array means: freely parallelizable (no file ownership claimed)

JSON schema for each task:
{
  "id": "string",
  "description": "string",
  "estimatedComplexity": "low" | "medium" | "high",
  "dependencies": ["task-id-1"],
  "targetFiles": ["src/relative/path.ts"],
  "role": "orchestrator" | "subagent" | "validator"
}
```

Also update any JSON schema validation (zod/ajv/manual) applied to LLM output to include `targetFiles: z.array(z.string()).default([])`.

**Verification:** Run `bun test tests/decomposer.test.ts` — existing tests pass. Inspect a sample decomposition output to confirm `targetFiles` field is present.

---

## Wave 2 — Core DAG Logic (Parallelizable within wave)

### Task 2.1: Implement `injectCollisionEdges()` in decomposer

**File:** `src/core/decomposer.ts`
**Action:** modify

**Description:** Add a post-processing pass that runs after the LLM returns the initial DAG. Detects file-sharing task pairs and injects implicit dependency edges for deterministic serialization.

**Implementation:**

```typescript
/**
 * Post-processing pass: detect tasks that share targetFiles and inject
 * implicit dependency edges to serialize them.
 * 
 * Algorithm: O(n²) pair comparison — acceptable for 5-20 task DAGs.
 * Tie-breaker: alphabetical task ID (lower ID = higher priority = runs first).
 */
function injectCollisionEdges(tasks: DecomposedTask[]): DecomposedTask[] {
  // Sort by id for deterministic tie-breaking
  const sorted = [...tasks].sort((a, b) => a.id.localeCompare(b.id));

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const taskA = sorted[i]; // lower ID → higher priority
      const taskB = sorted[j]; // higher ID → will wait for A

      const filesA = new Set(taskA.targetFiles ?? []);
      if (filesA.size === 0) continue; // no files claimed → freely parallelizable

      const collidingFiles = (taskB.targetFiles ?? []).filter(f => filesA.has(f));
      if (collidingFiles.length === 0) continue;

      // Check if a dependency edge already exists in either direction
      const alreadyLinked =
        taskB.dependencies.includes(taskA.id) ||
        taskA.dependencies.includes(taskB.id);

      if (!alreadyLinked) {
        // Inject: B depends on A
        taskB.dependencies = [...taskB.dependencies, taskA.id];
        taskB.implicitDependencies = [...(taskB.implicitDependencies ?? []), taskA.id];

        console.log(
          `[DAG] Collision detected — injected edge: ${taskB.id} waits for ${taskA.id}` +
          ` (shared files: ${collidingFiles.join(', ')})`
        );
      }
    }
  }

  return sorted;
}
```

**Integration point:** Call `injectCollisionEdges(tasks)` inside `decompose()` AFTER parsing LLM JSON and BEFORE calling `detectCycle()`. The full post-processing sequence:

```typescript
let tasks = parsedLLMOutput.tasks;
tasks = injectCollisionEdges(tasks);       // Step 1: inject collision edges
const cycle = this.detectCycle(tasks);     // Step 2: detect cycles (catches irreconcilable conflicts)
if (cycle) {
  throw new Error(`[DAG] Irreconcilable cycle detected after collision resolution: ${cycle.join(' → ')}. LLM produced conflicting targetFiles declarations.`);
}
```

**Verification:**
```bash
bun test tests/decomposer.test.ts
```
New test cases (add in Task 3.1):
- Two tasks sharing `src/auth.ts` → `taskB.dependencies` contains `taskA.id`
- Two tasks with disjoint files → no edge injected
- Tasks with `targetFiles: []` → never collide

---

### Task 2.2: Implement p-limit backpressure in `executeAll()`

**File:** `src/core/scheduler.ts`
**Action:** modify

**Description:** Replace the current task dispatch mechanism in `executeAll()` with a `p-limit`-based async worker pool. Tasks wait in queue when all `worktreePoolSize` lanes are occupied.

**Pre-requisite:** `bun add p-limit`

**Implementation:**

At the top of `scheduler.ts`:
```typescript
import pLimit from 'p-limit';
```

Replace the `executeAll()` body:

```typescript
public async executeAll(tasks: DecomposedTask[]): Promise<TaskExecutionResult[]> {
  if (this.config.worktreePoolSize < 1) {
    throw new Error('[Scheduler] worktreePoolSize must be ≥ 1');
  }

  const limit = pLimit(this.config.worktreePoolSize);

  // Build a map for dependency resolution
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const completedTasks = new Set<string>();
  const results: TaskExecutionResult[] = [];

  // Sort tasks topologically so dependencies complete first
  // (topoSort uses Kahn's algorithm on the dependencies graph)
  const ordered = topoSort(tasks);

  const promises = ordered.map(task =>
    limit(async () => {
      // Wait for all dependencies to complete before dispatching
      // p-limit handles the concurrency cap; this loop handles ordering
      while (!this.checkDependencies(task.dependencies, completedTasks)) {
        await new Promise(r => setTimeout(r, 50)); // poll every 50ms
      }

      const result = await this.scheduleTask(task);
      if (result) {
        completedTasks.add(task.id);
        results.push({ taskId: task.id, status: 'success', worktreeId: result, output: '' });
      }
      return result;
    })
  );

  await Promise.all(promises);
  return results;
}
```

Add `topoSort()` utility (Kahn's BFS):

```typescript
function topoSort(tasks: DecomposedTask[]): DecomposedTask[] {
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>();

  tasks.forEach(t => {
    inDegree.set(t.id, 0);
    adjList.set(t.id, []);
  });

  tasks.forEach(t => {
    (t.dependencies ?? []).forEach(dep => {
      adjList.get(dep)?.push(t.id);
      inDegree.set(t.id, (inDegree.get(t.id) ?? 0) + 1);
    });
  });

  const queue = [...inDegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  const result: DecomposedTask[] = [];
  const taskMap = new Map(tasks.map(t => [t.id, t]));

  while (queue.length > 0) {
    const id = queue.shift()!;
    result.push(taskMap.get(id)!);
    adjList.get(id)!.forEach(neighbor => {
      const newDeg = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    });
  }

  if (result.length !== tasks.length) {
    throw new Error('[Scheduler] Cycle detected in task graph — cannot execute');
  }

  return result;
}
```

Update `checkDependencies()` signature to accept the `completedTasks` set:

```typescript
private checkDependencies(dependencies: string[], completed: Set<string>): boolean {
  return dependencies.every(dep => completed.has(dep));
}
```

**Verification:**
```bash
bun test tests/scheduler.test.ts
```
New test cases (add in Task 3.2):
- 3 tasks, pool=2: third task starts only after first completes
- All tasks complete with correct dependency ordering

---

### Task 2.3: Add Git merge conflict detection to Consolidator

**File:** `src/core/consolidator.ts`
**Action:** modify

**Description:** Wrap the per-worktree merge step with conflict detection. A non-zero `git merge` exit code + unmerged files = conflict. Response: abort, mark failed, log, trigger sequential retry.

**Implementation:**

Add a `mergeWithConflictDetection()` method to `Consolidator`:

```typescript
private async mergeWithConflictDetection(
  worktreeId: string,
  worktreeBranch: string,
  stagingBranch: string,
): Promise<{ success: boolean; conflictingFiles?: string[] }> {
  // Guard: ensure we're on the staging branch before merging
  const branchCheck = await spawn(
    ['git', 'symbolic-ref', '--short', 'HEAD'],
    { cwd: this.config.cwd }
  );
  const currentBranch = branchCheck.stdout?.trim();
  if (currentBranch !== stagingBranch) {
    throw new Error(
      `[Consolidator] Expected branch '${stagingBranch}', got '${currentBranch}'. Refusing merge.`
    );
  }

  // Attempt merge
  const mergeResult = await spawn(
    ['git', 'merge', '--no-commit', '--no-ff', worktreeBranch],
    { cwd: this.config.cwd }
  );

  if (mergeResult.exitCode === 0) {
    // Clean merge — commit it
    await spawn(
      ['git', 'commit', '-m', `merge(worktree): integrate ${worktreeId} (${worktreeBranch})`],
      { cwd: this.config.cwd }
    );
    return { success: true };
  }

  // Non-zero exit — check for conflict markers
  const unmergedResult = await spawn(
    ['git', 'ls-files', '--unmerged'],
    { cwd: this.config.cwd }
  );
  const conflictingFiles = (unmergedResult.stdout ?? '')
    .split('\n')
    .filter(Boolean)
    .map(line => line.split('\t')[1])
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i); // deduplicate

  // Abort merge to restore clean state
  await spawn(['git', 'merge', '--abort'], { cwd: this.config.cwd });

  // Log conflict to EventLedger
  await this.ledger.log(
    'consolidation_conflict',
    {
      worktreeId,
      worktreeBranch,
      conflictingFiles,
      note: 'targetFiles declaration gap — task should have been serialized by DAG collision detection',
    },
    'error',
  );

  return { success: false, conflictingFiles };
}
```

Update the worktree merge loop in `run()` to call `mergeWithConflictDetection()` instead of a bare `git merge`. On conflict:

```typescript
const mergeOutcome = await this.mergeWithConflictDetection(worktreeId, branch, stagingBranch);
if (!mergeOutcome.success) {
  failedWorktrees.push(worktreeId);
  // Trigger sequential retry: re-run without worktree isolation
  await this.retrySequential(worktreeId);
} else {
  successfulWorktrees.push(worktreeId);
}
```

Add `retrySequential()` stub (full implementation in the recovery loop — out of scope for this phase, but the hook must exist):

```typescript
private async retrySequential(worktreeId: string): Promise<void> {
  // Graceful Degradation / Recovery loop hook (Phase 3 scope: log + mark)
  // Full sequential retry implementation is in the recovery loop (future phase)
  await this.ledger.log(
    'sequential_retry_triggered',
    { worktreeId, reason: 'merge_conflict' },
    'warn',
  );
  console.warn(`[Consolidator] Sequential retry triggered for ${worktreeId} — recovery loop not yet implemented`);
}
```

**Verification:**
```bash
bun test tests/consolidator.test.ts
```
New test cases (add in Task 3.3):
- Mock `spawn()` to return exit code 1 + `ls-files --unmerged` output → verify `merge --abort` called + conflict logged
- Mock clean merge → verify commit called, no abort

---

## Wave 3 — Tests (Parallelizable within wave)

### Task 3.1: Unit tests for collision detection + edge injection

**File:** `tests/decomposer.test.ts` (or `src/core/decomposer.test.ts`)
**Action:** modify

**Description:** Add test suite covering `injectCollisionEdges()` and the full `decompose()` post-processing pipeline.

**Implementation:**

```typescript
describe('injectCollisionEdges', () => {
  it('injects implicit edge when tasks share a targetFile', () => {
    const tasks: DecomposedTask[] = [
      { id: 'task-b', description: '', estimatedComplexity: 'low', dependencies: [], role: 'subagent', targetFiles: ['src/auth.ts', 'src/router.ts'] },
      { id: 'task-a', description: '', estimatedComplexity: 'low', dependencies: [], role: 'subagent', targetFiles: ['src/auth.ts'] },
    ];
    const result = injectCollisionEdges(tasks);
    // After sort: task-a (lower id) runs first, task-b depends on task-a
    const taskB = result.find(t => t.id === 'task-b')!;
    expect(taskB.dependencies).toContain('task-a');
    expect(taskB.implicitDependencies).toContain('task-a');
  });

  it('does not inject edge when targetFiles are disjoint', () => {
    const tasks: DecomposedTask[] = [
      { id: 'task-a', description: '', estimatedComplexity: 'low', dependencies: [], role: 'subagent', targetFiles: ['src/auth.ts'] },
      { id: 'task-b', description: '', estimatedComplexity: 'low', dependencies: [], role: 'subagent', targetFiles: ['src/router.ts'] },
    ];
    const result = injectCollisionEdges(tasks);
    expect(result.find(t => t.id === 'task-b')!.dependencies).toEqual([]);
  });

  it('does not inject duplicate edge if already explicitly declared', () => {
    const tasks: DecomposedTask[] = [
      { id: 'task-a', description: '', estimatedComplexity: 'low', dependencies: [], role: 'subagent', targetFiles: ['src/auth.ts'] },
      { id: 'task-b', description: '', estimatedComplexity: 'low', dependencies: ['task-a'], role: 'subagent', targetFiles: ['src/auth.ts'] },
    ];
    const result = injectCollisionEdges(tasks);
    const deps = result.find(t => t.id === 'task-b')!.dependencies;
    expect(deps.filter(d => d === 'task-a')).toHaveLength(1);
  });

  it('freely parallelizes tasks with empty targetFiles', () => {
    const tasks: DecomposedTask[] = [
      { id: 'task-a', description: '', estimatedComplexity: 'low', dependencies: [], role: 'subagent', targetFiles: [] },
      { id: 'task-b', description: '', estimatedComplexity: 'low', dependencies: [], role: 'subagent', targetFiles: [] },
    ];
    const result = injectCollisionEdges(tasks);
    expect(result.find(t => t.id === 'task-b')!.dependencies).toEqual([]);
  });
});
```

**Verification:** `bun test tests/decomposer.test.ts` — all new tests pass.

---

### Task 3.2: Unit tests for p-limit backpressure

**File:** `tests/scheduler.test.ts` (or `src/core/scheduler.test.ts`)
**Action:** modify

**Description:** Add test cases that verify the pool cap blocks concurrent execution correctly.

**Implementation:**

```typescript
describe('ParallelScheduler — backpressure', () => {
  it('respects worktreePoolSize cap', async () => {
    const concurrentPeak = { value: 0 };
    let maxConcurrent = 0;
    const POOL_SIZE = 2;

    const mockScheduleTask = jest.fn().mockImplementation(async () => {
      concurrentPeak.value++;
      maxConcurrent = Math.max(maxConcurrent, concurrentPeak.value);
      await new Promise(r => setTimeout(r, 50));
      concurrentPeak.value--;
      return 'lane-0';
    });

    const scheduler = new ParallelScheduler(
      undefined, undefined, undefined, undefined,
      { worktreePoolSize: POOL_SIZE }
    );
    (scheduler as any).scheduleTask = mockScheduleTask;

    const tasks: DecomposedTask[] = Array.from({ length: 5 }, (_, i) => ({
      id: `task-${i}`,
      description: '',
      estimatedComplexity: 'low' as const,
      dependencies: [],
      role: 'subagent' as const,
      targetFiles: [],
    }));

    await scheduler.executeAll(tasks);
    expect(maxConcurrent).toBeLessThanOrEqual(POOL_SIZE);
  });

  it('throws when worktreePoolSize is 0', () => {
    const scheduler = new ParallelScheduler(
      undefined, undefined, undefined, undefined,
      { worktreePoolSize: 0 }
    );
    const tasks: DecomposedTask[] = [{ id: 't1', description: '', estimatedComplexity: 'low', dependencies: [], role: 'subagent', targetFiles: [] }];
    expect(() => scheduler.executeAll(tasks)).rejects.toThrow('worktreePoolSize must be ≥ 1');
  });
});
```

**Verification:** `bun test tests/scheduler.test.ts` — all new tests pass.

---

### Task 3.3: Unit tests for consolidator merge conflict detection

**File:** `tests/consolidator.test.ts` (or `src/core/consolidator.test.ts`)
**Action:** modify

**Description:** Add tests for conflict detection path using mocked `spawn()`.

**Implementation:**

```typescript
// Mock spawn to simulate conflict
jest.mock('../lib/spawn', () => ({
  spawn: jest.fn(),
}));

describe('Consolidator — merge conflict detection', () => {
  beforeEach(() => {
    const { spawn } = require('../lib/spawn');
    spawn.mockReset();
  });

  it('detects merge conflict and aborts', async () => {
    const { spawn } = require('../lib/spawn');
    spawn
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'main' })       // symbolic-ref
      .mockResolvedValueOnce({ exitCode: 1, stdout: '' })            // git merge (fails)
      .mockResolvedValueOnce({ exitCode: 0, stdout: '100644 abc 1\tsrc/auth.ts\n' }) // ls-files --unmerged
      .mockResolvedValueOnce({ exitCode: 0 });                       // git merge --abort

    const consolidator = new Consolidator({ cwd: '/repo' });
    const result = await (consolidator as any).mergeWithConflictDetection('lane-0', 'task-branch', 'main');

    expect(result.success).toBe(false);
    expect(result.conflictingFiles).toContain('src/auth.ts');
    // Verify abort was called
    const abortCall = spawn.mock.calls.find((c: string[]) => c[0].includes('--abort'));
    expect(abortCall).toBeDefined();
  });

  it('succeeds and commits clean merge', async () => {
    const { spawn } = require('../lib/spawn');
    spawn
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'main' })  // symbolic-ref
      .mockResolvedValueOnce({ exitCode: 0 })                  // git merge succeeds
      .mockResolvedValueOnce({ exitCode: 0 });                 // git commit

    const consolidator = new Consolidator({ cwd: '/repo' });
    const result = await (consolidator as any).mergeWithConflictDetection('lane-0', 'task-branch', 'main');

    expect(result.success).toBe(true);
  });
});
```

**Verification:** `bun test tests/consolidator.test.ts` — all new tests pass.

---

## Wave 4 — Integration Verification

### Task 4.1: Install p-limit dependency

**Action:** shell command
**Command:**
```bash
bun add p-limit
```

**Verification:** `cat package.json | grep p-limit` — dependency present.

---

### Task 4.2: Full test suite

**Action:** shell command
**Command:**
```bash
bun test
```

**Acceptance:** All tests pass. Specifically:
- `tests/decomposer.test.ts` — collision detection + edge injection cases pass
- `tests/scheduler.test.ts` — backpressure pool cap enforced, pool=0 throws
- `tests/consolidator.test.ts` — conflict detection + abort + clean merge both pass

---

### Task 4.3: TypeScript type check

**Action:** shell command
**Command:**
```bash
bun run typecheck 2>/dev/null || npx tsc --noEmit
```

**Acceptance:** Zero type errors. `targetFiles: string[]` accepted everywhere `DecomposedTask` is used.

---

### Task 4.4: Success criteria manual verification

Confirm each success criterion against test output:

| Criterion | Test | Expected |
|-----------|------|----------|
| SC1: Collision detected, tasks serialized | `injectCollisionEdges` unit test | `taskB.dependencies` contains `taskA.id` |
| SC2: Backpressure pauses at pool limit | Backpressure unit test | `maxConcurrent ≤ worktreePoolSize` |
| SC3: 10-task DAG, 3 waves, zero conflicts | `topoSort` + integration test | All 10 tasks complete, no merge errors |
| SC4: Zero silent corruption | Consolidator conflict test | Conflict detected, abort called, ledger entry written |

---

## Threat Model

```xml
<threat_model>

### T1: Malformed LLM output — missing targetFiles
**Threat:** LLM returns tasks without `targetFiles` field (ignores prompt instruction).
**Mitigation:** Schema validation with `z.array(z.string()).default([])`. Missing field defaults to `[]` (freely parallelizable). No crash. Tasks without file ownership declarations are conservatively treated as safe to parallelize — the Git merge conflict detector (Decision D) is the last line of defense.
**Residual risk:** Low. Worst case: two tasks that should have been serialized run in parallel; Git merge catches the conflict.

### T2: Cycle injection via crafted task IDs
**Threat:** Adversarial/buggy LLM output where after collision edge injection, A depends on B AND B depends on A.
**Mitigation:** `detectCycle()` (DFS, already exists) runs immediately after `injectCollisionEdges()`. If a cycle is found, `decompose()` throws with the cycle listed. The swarm never executes a cyclic DAG.
**Residual risk:** None — hard fail before execution.

### T3: Git working tree corruption during merge
**Threat:** `git merge --abort` fails, leaving the working tree in a conflicted state.
**Mitigation:** `assertOnBranch()` guard runs before every merge. If `symbolic-ref` returns wrong branch, the merge is skipped entirely. If `merge --abort` fails (exit code non-zero), log the failure and stop further merges — do not proceed in a corrupted state. The entire consolidation is marked failed; user intervention required.
**Residual risk:** Low. Requires a git-level failure (disk full, permission error) on top of a merge conflict.

</threat_model>
```

---

## Commit Strategy

| Wave | Commit message |
|------|---------------|
| Wave 1 | `feat(dag): add targetFiles and implicitDependencies to DecomposedTask` |
| Wave 2 | `feat(dag): implement collision detection, edge injection, p-limit backpressure, and conflict-safe consolidation` |
| Wave 3 | `test(dag): add unit tests for collision detection, backpressure, and merge conflict detection` |
| Wave 4 | `chore(dag): install p-limit; verify all success criteria` |
