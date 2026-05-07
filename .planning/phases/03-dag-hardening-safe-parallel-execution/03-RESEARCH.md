# Research: Phase 3 — DAG Hardening

## RESEARCH COMPLETE

---

## 1. p-limit vs Custom AsyncQueue

### Recommendation: `p-limit`

`p-limit` is fully compatible with Bun runtime (ESM, no Node.js-specific APIs). It is the simplest correct solution.

**Install:**
```bash
bun add p-limit
```

**API pattern:**
```typescript
import pLimit from 'p-limit';

const limit = pLimit(config.maxWorktrees); // default: 5

async function executeAll(tasks: DecomposedTask[]): Promise<TaskExecutionResult[]> {
  const promises = tasks.map(task =>
    limit(() => scheduleTask(task))
  );
  return Promise.all(promises);
}
```

`p-limit` uses a queue internally — when all `maxWorktrees` slots are occupied, new calls are held in the queue and dispatched as slots free. This is exactly the "block and queue" behavior from Decision C.

### Custom AsyncQueue (fallback if p-limit unavailable)

```typescript
class AsyncQueue {
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly maxConcurrency: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrency) {
      await new Promise<void>(resolve => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}
```

**Decision:** Use `p-limit` — smaller surface area, battle-tested, Bun-compatible.

---

## 2. Topological Sort / Edge Injection Algorithm

### File-Collision Detection Pass

Run after LLM returns initial DAG, before returning `DecompositionResult`.

**Algorithm (O(n²) pair comparison — acceptable for 5–20 task DAGs):**

```typescript
function injectCollisionEdges(tasks: DecomposedTask[]): DecomposedTask[] {
  // Sort tasks by ID for deterministic tie-breaking
  const sorted = [...tasks].sort((a, b) => a.id.localeCompare(b.id));

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const taskA = sorted[i]; // lower ID = higher priority
      const taskB = sorted[j]; // higher ID = will depend on A

      const filesA = new Set(taskA.targetFiles ?? []);
      const filesB = taskB.targetFiles ?? [];
      const collision = filesB.some(f => filesA.has(f));

      if (!collision) continue;

      // Check if edge already exists (either direction)
      const alreadyLinked =
        taskB.depends_on?.includes(taskA.id) ||
        taskA.depends_on?.includes(taskB.id);

      if (!alreadyLinked) {
        // Inject: B depends on A (A has lower sort index)
        taskB.depends_on = [...(taskB.depends_on ?? []), taskA.id];
        taskB.implicit_deps = [...(taskB.implicit_deps ?? []), taskA.id];
        // Log for observability
        console.log(`[DAG] Injected implicit edge: ${taskB.id} → ${taskA.id} (collision on: ${filesB.filter(f => filesA.has(f)).join(', ')})`);
      }
    }
  }

  return sorted;
}
```

### Cycle Detection Integration

After edge injection, run existing `detectCycle()`. A cyclic collision (A and B both declare each other's files AND both depend on each other) would be caught here. This is a degenerate LLM output — log it and hard-fail with a clear message.

### Kahn's Algorithm (BFS) for topological order

```typescript
function topoSort(tasks: DecomposedTask[]): DecomposedTask[] {
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>();

  tasks.forEach(t => {
    inDegree.set(t.id, 0);
    adjList.set(t.id, []);
  });

  tasks.forEach(t => {
    (t.depends_on ?? []).forEach(dep => {
      adjList.get(dep)!.push(t.id);
      inDegree.set(t.id, (inDegree.get(t.id) ?? 0) + 1);
    });
  });

  const queue: string[] = [];
  inDegree.forEach((deg, id) => { if (deg === 0) queue.push(id); });

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
    throw new Error('[DAG] Cycle detected after edge injection — LLM produced irreconcilable file ownership');
  }

  return result;
}
```

---

## 3. Git Merge in Subprocess

### Bun subprocess pattern

```typescript
import { spawnSync } from 'bun';

interface MergeResult {
  success: boolean;
  hasConflicts: boolean;
  conflictingFiles: string[];
}

async function mergeWorktreeBranch(
  stagingBranch: string,
  worktreeBranch: string,
  cwd: string
): Promise<MergeResult> {
  // Ensure we're on staging branch
  const checkout = spawnSync(['git', 'checkout', stagingBranch], { cwd });
  if (checkout.exitCode !== 0) {
    throw new Error(`Cannot checkout staging branch: ${stagingBranch}`);
  }

  // Attempt merge (--no-commit --no-ff to stage without committing)
  const merge = spawnSync(
    ['git', 'merge', '--no-commit', '--no-ff', worktreeBranch],
    { cwd }
  );

  if (merge.exitCode === 0) {
    // Clean merge — commit it
    spawnSync(['git', 'commit', '-m', `merge(worktree): integrate ${worktreeBranch}`], { cwd });
    return { success: true, hasConflicts: false, conflictingFiles: [] };
  }

  // Non-zero exit — check for conflict markers
  const unmerged = spawnSync(['git', 'ls-files', '--unmerged'], { cwd });
  const conflictingFiles = unmerged.stdout
    .toString()
    .split('\n')
    .filter(Boolean)
    .map(line => line.split('\t')[1])
    .filter(Boolean);

  const hasConflicts = conflictingFiles.length > 0;

  // Abort merge to restore clean state
  spawnSync(['git', 'merge', '--abort'], { cwd });

  return { success: false, hasConflicts, conflictingFiles };
}
```

### Detached HEAD guard

```typescript
function assertOnBranch(branch: string, cwd: string): void {
  const result = spawnSync(['git', 'symbolic-ref', '--short', 'HEAD'], { cwd });
  const current = result.stdout.toString().trim();
  if (current !== branch) {
    throw new Error(`[Consolidator] Expected branch ${branch}, got ${current}. Refusing to merge.`);
  }
}
```

### Fallback sequential retry trigger

```typescript
if (!mergeResult.success && mergeResult.hasConflicts) {
  await ledger.append({
    type: 'MERGE_CONFLICT',
    taskId: task.id,
    worktreeBranch,
    conflictingFiles: mergeResult.conflictingFiles,
    reason: 'collision_detection_gap', // targetFiles declaration was incomplete
  });

  // Mark task failed
  task.status = 'failed';
  task.failureReason = 'merge_conflict';

  // Trigger sequential retry (no worktree isolation)
  await retrySequential(task);
}
```

---

## 4. LLM Prompt for `targetFiles`

### JSON Schema Enforcement

Add `targetFiles` to the decomposition JSON schema passed to the LLM:

```typescript
const decompositionSchema = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'description', 'depends_on', 'targetFiles'],
        properties: {
          id: { type: 'string' },
          description: { type: 'string' },
          depends_on: { type: 'array', items: { type: 'string' } },
          targetFiles: {
            type: 'array',
            items: { type: 'string' },
            description: 'Relative file paths this task will read or write. Empty array if unknown.'
          }
        }
      }
    }
  }
};
```

### Prompt instruction snippet

```
For each task, declare targetFiles: the exact relative file paths the task will modify.
This is critical for safe parallel execution — the system serializes tasks that would
modify the same files. Be precise: list only files this task writes, not files it reads.
If a task touches an entire directory, list the specific files, not the directory path.
If you cannot predict the files (e.g., a dynamic file generator), set targetFiles: [].
```

### Key insight

Tasks with `targetFiles: []` are treated as safe to parallelize. This is the correct default for dynamic generators or tasks whose output is unknown at decomposition time.

---

## 5. Test Strategy

### Unit: Collision detection + edge injection

```typescript
// tests/decomposer.test.ts
describe('injectCollisionEdges', () => {
  it('injects implicit edge when tasks share a file', () => {
    const tasks = [
      { id: 'task-a', targetFiles: ['src/auth.ts'], depends_on: [] },
      { id: 'task-b', targetFiles: ['src/auth.ts', 'src/router.ts'], depends_on: [] },
    ];
    const result = injectCollisionEdges(tasks);
    const taskB = result.find(t => t.id === 'task-b')!;
    expect(taskB.depends_on).toContain('task-a');
    expect(taskB.implicit_deps).toContain('task-a');
  });

  it('does not inject edge when files are disjoint', () => {
    const tasks = [
      { id: 'task-a', targetFiles: ['src/auth.ts'], depends_on: [] },
      { id: 'task-b', targetFiles: ['src/router.ts'], depends_on: [] },
    ];
    const result = injectCollisionEdges(tasks);
    expect(result.find(t => t.id === 'task-b')!.depends_on).toEqual([]);
  });

  it('does not inject duplicate edge if already explicitly declared', () => {
    const tasks = [
      { id: 'task-a', targetFiles: ['src/auth.ts'], depends_on: [] },
      { id: 'task-b', targetFiles: ['src/auth.ts'], depends_on: ['task-a'] },
    ];
    const result = injectCollisionEdges(tasks);
    const deps = result.find(t => t.id === 'task-b')!.depends_on;
    expect(deps.filter(d => d === 'task-a').length).toBe(1); // no duplicate
  });
});
```

### Unit: Backpressure (mock delayed tasks)

```typescript
// tests/scheduler.test.ts
it('pauses dispatch when pool is full', async () => {
  const config: SchedulerConfig = { maxWorktrees: 2 };
  const scheduler = new ParallelScheduler(undefined, undefined, undefined, undefined, config);
  const executionOrder: string[] = [];
  let resolveTask1: () => void;

  const mockTask = (id: string, delay = 0) => ({
    id,
    execute: () => new Promise<void>(res => {
      setTimeout(() => { executionOrder.push(id); res(); }, delay);
    })
  });

  // Start 3 tasks with pool size 2
  // Third should wait until first completes
  await scheduler.executeAll([mockTask('t1', 100), mockTask('t2', 100), mockTask('t3', 0)]);
  // t3 must start after t1 or t2 completes
  expect(executionOrder.indexOf('t3')).toBeGreaterThan(0);
});
```

### Unit: Git merge conflict detection (without real repo)

```typescript
// tests/consolidator.test.ts — mock spawnSync
jest.mock('bun', () => ({
  spawnSync: jest.fn().mockImplementation((args) => {
    if (args.includes('merge')) return { exitCode: 1, stdout: Buffer.from('') };
    if (args.includes('ls-files')) return { exitCode: 0, stdout: Buffer.from('100644 abc 1\tsrc/auth.ts\n') };
    if (args.includes('abort')) return { exitCode: 0 };
    return { exitCode: 0, stdout: Buffer.from('') };
  })
}));

it('detects merge conflict and triggers sequential retry', async () => {
  const consolidator = new Consolidator();
  const result = await consolidator.mergeWorktreeBranch('main', 'task-branch-1', '/repo');
  expect(result.success).toBe(false);
  expect(result.hasConflicts).toBe(true);
  expect(result.conflictingFiles).toContain('src/auth.ts');
});
```

---

## 6. Edge Cases

| Edge Case | Handling |
|-----------|----------|
| `targetFiles: []` | Treat as no file ownership — free to parallelize with anything |
| Cyclic collision (A→B→A after injection) | `detectCycle()` catches it; hard-fail with message listing the cycle |
| `maxWorktrees: 0` | Guard in `SchedulerConfig` constructor: `throw new Error('maxWorktrees must be ≥ 1')` |
| Git detached HEAD during merge | `assertOnBranch()` guard throws before merge attempt |
| LLM returns non-relative paths (absolute or URLs) | Normalize in `injectCollisionEdges()`: strip leading `/` or cwd prefix; warn if URL |
| Two tasks with identical `targetFiles` AND explicit dependency | Skip injection (already linked) — no duplicate edges |
| Task with 50+ targetFiles | O(n²) still fine at 20 tasks × 50 files; n=tasks not files |

---

## Validation Architecture

For Nyquist validation of each success criterion:

| Criterion | Validation Method |
|-----------|------------------|
| SC1: Collision detected, tasks serialized | Unit test: `injectCollisionEdges` with overlapping `targetFiles` → verify `depends_on` mutated |
| SC2: Backpressure pauses at pool limit | Unit test: 3 tasks, pool=2, verify 3rd task starts only after 1st completes |
| SC3: 10-task DAG, 3 waves, zero conflicts | Integration test: `executeAll` with 10 mocked tasks in 3 dependency waves → verify no merge failures |
| SC4: Zero silent corruption | Integration test: inject a mock conflict in `mergeWorktreeBranch` → verify task marked `failed`, `merge --abort` called, retry triggered |

All four criteria have concrete, automatable test vectors. No manual inspection required.
