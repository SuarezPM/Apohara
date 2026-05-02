# M008: Trust & Verify — Sandbox + Cross-Verification Mesh

Complete implementation of security foundation for self-improving Apohara agents.

## Architecture Overview

### Phase 1: Apohara-Sandbox (Rust)

**Location:** `crates/apohara-sandbox/`

Subprocess wrapper for test execution with seccomp-bpf + Linux namespaces.

#### Syscall Filtering (seccomp-bpf)

Blocked syscalls return `-EPERM`:
- `execveat`, `ptrace` — prevent privilege escalation
- `mount`, `umount2` — prevent filesystem tricks
- `reboot` — prevent host shutdown
- `init_module`, `finit_module`, `delete_module` — prevent kernel module injection
- `kexec_load`, `kexec_file_load` — prevent kernel replacement
- `bpf`, `perf_event_open` — prevent kernel introspection
- `userfaultfd` — prevent memory manipulation

#### Linux Namespaces

- **CLONE_NEWNS:** Filesystem namespace (worktree-rooted chroot)
- **CLONE_NEWPID:** Process namespace (can't see/kill host processes)
- **CLONE_NEWNET:** Network namespace (zero outbound connectivity)
- **CLONE_NEWUSER:** User namespace (no privilege escalation)

#### Resource Limits (cgroups v2)

- **CPU:** 50% of one core (50000 µs per 100000 µs interval)
- **Memory:** 512 MB
- **Temp files:** 100 MB
- **Timeout:** 120 seconds

#### Integration Point

```typescript
const isolator = new Isolator("target/release/apohara-sandbox");
const result = await isolator.exec({
  workdir: "/path/to/worktree",
  command: "bun test",
  permission: "workspace_write",
  taskId: "task-123",
  timeout: 120000,
});

// result.exitCode, stdout, stderr, violations, durationMs
```

### Phase 2: Cross-Verification Mesh (TypeScript)

**Location:** `src/core/verification-mesh.ts`

3-agent consensus pattern for critical tasks.

#### Execution Model

1. **Agent A (Executor):** Primary agent executes task with selected provider
2. **Agent B (Verifier):** Same task, different provider (routed via AgentRouter)
3. **Arbiter (Judge):** Structural comparison (AST, diffs, hashes)

#### Qualification

Mesh applies only to 5-10% of tasks:
- Complexity: `high` or `critical`
- Files modified: ≥ 3
- Configurable via `~/.apohara/policy.yaml`

#### Graceful Degradation

| Condition | Action |
|-----------|--------|
| B crashes/timeouts | Use A alone |
| B exceeds `max(A_time * 2, 30s)` | SIGKILL B, use A |
| Mesh cost > 15% session total | Circuit breaker: disable mesh, continue with single agent |

#### Arbiter Strategy

Structural comparison (no embeddings):
1. Extract content from both responses
2. Hash content for quick comparison
3. If identical: return A
4. If divergent: prefer more concise output (lower hallucination)
5. If conflict: flag for manual review

#### Integration Point

```typescript
const mesh = new VerificationMesh();
const result = await mesh.execute({
  taskId: "task-456",
  role: "execution",
  task: {
    id: "impl-feature",
    messages: [...],
    complexity: "high",
    filesModified: 5,
  },
  policy: {
    enabled: true,
    mode: "structural",
    max_extra_cost_pct: 15,
    min_complexity: "high",
  },
});

// result.agentA, agentB, arbiter, meshApplied, meshCostDelta
```

### Phase 3: Event Ledger Integration

Both Isolator and VerificationMesh log to `.events/run-<timestamp>.jsonl`:

#### Sandbox Events

```json
{
  "type": "sandbox_execution",
  "timestamp": "2026-05-02T20:00:00Z",
  "taskId": "task-123",
  "payload": {
    "exitCode": 0,
    "violations": [],
    "permission": "workspace_write",
    "durationMs": 1234
  },
  "metadata": {
    "sandboxPermission": "workspace_write",
    "sandboxViolations": 0,
    "sandboxDurationMs": 1234
  }
}
```

#### Mesh Events

```json
{
  "type": "verification_mesh_completed",
  "timestamp": "2026-05-02T20:00:00Z",
  "taskId": "task-456",
  "payload": {
    "verdict": "A",
    "agentAProvider": "groq",
    "agentBProvider": "deepseek-v4",
    "arbiterVerdict": "Outputs structurally identical",
    "meshCostDelta": 0.5
  },
  "metadata": {
    "meshApplied": true,
    "arbiterVerdict": "A",
    "agentAProvider": "groq",
    "agentBProvider": "deepseek-v4",
    "meshCostDelta": 0.5
  }
}
```

#### Circuit Breaker Event

```json
{
  "type": "verification_mesh_circuit_breaker",
  "payload": {
    "reason": "cost_threshold_exceeded",
    "projectedExtraCostPct": 18.5,
    "threshold": 15
  },
  "metadata": {
    "meshApplied": false,
    "costPercentage": 18.5
  }
}
```

## Testing

### Sandbox Security Tests (9 tests)

**File:** `tests/e2e/security-escape.test.ts`

1. ✅ Cannot read `/etc/passwd`
2. ✅ Cannot make network requests
3. ✅ Cannot mount filesystems
4. ✅ Cannot access `~/.ssh`
5. ✅ Cannot modify files outside workdir
6. ✅ Cannot kill host processes
7. ✅ CAN read files inside workdir
8. ✅ CAN write files inside workdir
9. ✅ Violations logged to event ledger

**Run:** `bun test tests/e2e/security-escape.test.ts`

### Mesh Verification Tests (9 tests)

**File:** `tests/e2e/verification-mesh.test.ts`

1. ✅ Identical outputs pass directly
2. ✅ Different complexity tiers trigger/skip mesh correctly
3. ✅ Divergent outputs arbitrated to most concise
4. ✅ Contradictory outputs flagged
5. ✅ High complexity triggers mesh
6. ✅ Low complexity skips mesh
7. ✅ Cost tracking respects max_extra_cost_pct
8. ✅ Event ledger captures mesh decisions
9. ✅ Arbiter uses fast/cheap providers (groq, kiro-ai)

**Run:** `bun test tests/e2e/verification-mesh.test.ts`

### Integration Tests (5 tests)

**File:** `tests/e2e/sandbox-mesh-integration.test.ts`

1. ✅ Sandbox confines test execution
2. ✅ Sandbox blocks malicious code
3. ✅ Mesh coordinates verification across providers
4. ✅ Event ledger captures full trace
5. ✅ Graceful degradation on agent failure

**Run:** `bun test tests/e2e/sandbox-mesh-integration.test.ts`

## Configuration

### Policy File

Copy `.apohara/policy.example.yaml` to `~/.apohara/policy.yaml`:

```yaml
mesh:
  enabled: true
  mode: "structural"
  max_extra_cost_pct: 15
  min_complexity: "high"

sandbox:
  enabled: true
  permission_default: "workspace_write"
  timeout_seconds: 120
  memory_limit_mb: 512
  cpu_limit_percent: 50
```

## Build & Deploy

### Build Rust Sandbox

```bash
cd crates/apohara-sandbox
cargo build --release
# Binary: target/release/apohara-sandbox
```

### Integrate with Apohara CLI

Update `src/cli.ts` or `src/commands/auto.ts` to use sandbox:

```typescript
import { Isolator } from "../core/sandbox";

// During task execution:
const isolator = new Isolator("target/release/apohara-sandbox");
const result = await isolator.exec({
  workdir: worktreeDir,
  command: `bun test`,
  permission: "workspace_write",
  taskId: taskId,
});
```

### Enable Mesh in AgentRouter

Update task dispatch to use VerificationMesh:

```typescript
import { VerificationMesh } from "../core/verification-mesh";

const mesh = new VerificationMesh();
const result = await mesh.execute({
  taskId: task.id,
  role: role,
  task: { messages, complexity, filesModified },
});
```

## Verification Checklist

Before marking M008 complete:

### Sandbox Security (all must pass)
- [ ] 9/9 security escape tests pass
- [ ] Event ledger captures violations
- [ ] Process isolation proven (child crashes don't crash orchestrator)
- [ ] Resource limits enforced (no runaway CPU/memory)

### Mesh Verification (all must pass)
- [ ] 9/9 mesh verification tests pass
- [ ] Cost circuit-breaker activates at threshold
- [ ] Event ledger tracks all provider selections
- [ ] Arbiter correctly identifies identical outputs
- [ ] Graceful degradation on agent failure

### Integration (all must pass)
- [ ] 5/5 integration tests pass
- [ ] Sandbox + Mesh work together seamlessly
- [ ] Event ledger consolidates from both systems
- [ ] Real task execution with sandbox + mesh succeeds

### Self-Improvement (Phase 0 before M009)
- [ ] Run `apohara auto "Add /health endpoint to Fastify"` with sandbox active
- [ ] Generated code cannot escape sandbox
- [ ] Event ledger shows full execution trace
- [ ] Code generation + test execution + verification all succeed

## Next Steps (M009)

Once M008 is verified:

1. **Thompson Sampling** — Activate in CapabilityManifest
2. **Engram Integration** — Replace Mem0 with durable memory
3. **Self-Execution Loop** — Run `apohara auto` on Apohara's own codebase

## Files Changed

```
New:
  crates/apohara-sandbox/Cargo.toml
  crates/apohara-sandbox/src/main.rs
  src/core/sandbox.ts
  src/core/verification-mesh.ts
  tests/e2e/security-escape.test.ts
  tests/e2e/verification-mesh.test.ts
  tests/e2e/sandbox-mesh-integration.test.ts
  .apohara/policy.example.yaml
  M008-IMPLEMENTATION.md

Modified:
  src/core/types.ts (added "arbiter" role + fallbacks)
  src/core/isolation.ts (exported Isolator)
```

## Architecture Decisions

- **D008-001:** Subprocess wrapper (not NAPI) for sandbox isolation to protect orchestrator
- **D008-002:** clone() with CLONE_NEW* namespaces (not unshare) to preserve Core capabilities
- **D008-003:** SCMP_ACT_ERRNO (not KILL) to allow graceful failure handling
- **D008-004:** cgroups v2 for automatic resource cleanup and namespace reaping
- **D008-005:** Structural comparison (AST/hashes) for arbiter, no embeddings
- **D008-006:** 15% cost circuit breaker as global safety valve for mesh degradation
- **D008-007:** Event ledger captures all operations for forensics and replay
