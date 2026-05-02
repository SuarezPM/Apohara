# M008 Completion Summary: Trust & Verify

## What Was Built

**Complete security foundation for autonomous code execution and self-improvement.**

Two core systems deployed:

### 1. Apohara-Sandbox (Rust)
- **Purpose:** Isolate test execution in subprocess with seccomp-bpf + Linux namespaces
- **Location:** `crates/apohara-sandbox/`
- **What it does:**
  - Executes tests (bun test, vitest, scripts) in isolated child processes
  - Blocks dangerous syscalls (execveat, ptrace, mount, etc.) → return EPERM
  - Enforces Linux namespaces: CLONE_NEWNS, CLONE_NEWPID, CLONE_NEWNET, CLONE_NEWUSER
  - Limits resources: 512MB memory, 50% CPU, 120s timeout
  - Logs all violations to event ledger
  
**Why it matters:** If agent-generated code is defective or malicious, it cannot:
- Escape the worktree directory
- Kill host processes
- Access ~/.ssh or other sensitive files
- Make network requests
- Escalate privileges

### 2. Cross-Verification Mesh (TypeScript)
- **Purpose:** 3-agent consensus for critical tasks (high/critical complexity, 3+ files)
- **Location:** `src/core/verification-mesh.ts`
- **What it does:**
  - Agent A executes with one provider (groq, openai, etc.)
  - Agent B executes same task with different provider
  - Arbiter compares outputs structurally (hash-based, no embeddings)
  - Cost circuit-breaker: if mesh exceeds 15% of session cost, disables gracefully
  - Graceful degradation: if B crashes/times out, returns A's output
  - Event ledger captures all decisions and provider selections

**Why it matters:** Catches hallucinations and execution errors:
- Identical outputs from A & B → high confidence
- Divergent outputs → arbiter selects most concise (fewer hallucinations)
- One agent fails → continue with other
- Costs spiral → disable mesh, run single agent

## Architecture Principles

### Design Decisions

- **D008-001:** Subprocess wrapper for sandbox (not NAPI) — protects orchestrator if child crashes
- **D008-002:** `clone()` with namespaces (not `unshare()`) — preserves Core's network/auth capabilities
- **D008-003:** EPERM on syscall violation (not SIGKILL) — allows code to fail gracefully
- **D008-004:** cgroups v2 (not manual reaper) — automatic cleanup on Ubuntu 26.04 XanMod
- **D008-005:** Structural comparison (AST hashes) — no heavy embeddings, deterministic
- **D008-006:** 15% cost circuit-breaker — safety valve if mesh costs spiral
- **D008-007:** Event ledger everywhere — forensics, replay, audit trail

### Boundary: What Runs Where

**Inside Sandbox:**
- Test execution (bun test, vitest)
- Generated scripts
- Code verification

**Outside Sandbox (Core controls):**
- Code generation (file writes)
- Dependency resolution (bun install)
- Git operations (git add, commit)
- Tool calling (API requests, file reads)
- Provider routing

This model ensures agents cannot poison the orchestrator while keeping Core's capabilities intact.

## Testing

### Test Coverage: 23 Tests Total

**Sandbox Escape Tests (9):**
- Cannot read /etc/passwd
- Cannot make network requests
- Cannot mount filesystems
- Cannot access ~/.ssh
- Cannot modify files outside workdir
- Cannot kill host processes
- CAN read inside workdir ✓
- CAN write inside workdir ✓
- Violations logged ✓

**Mesh Verification Tests (9):**
- Identical outputs pass
- Correct complexity filtering
- Divergent outputs arbitrated
- Conflict handling
- High complexity triggers mesh
- Low complexity skips mesh
- Cost tracking respects limits
- Event ledger captures decisions
- Arbiter uses fast providers

**Integration Tests (5):**
- Sandbox confines execution
- Blocks malicious code
- Mesh + Sandbox work together
- Event ledger consolidates traces
- Graceful degradation on failure

**Run all:** `bun test tests/e2e/{security-escape,verification-mesh,sandbox-mesh-integration}.test.ts`

## Event Ledger Integration

Both systems log to `.events/run-<timestamp>.jsonl` with structured events:

```json
// Sandbox violation
{
  "type": "sandbox_execution",
  "payload": { "exitCode": 0, "violations": [], "permission": "workspace_write" }
}

// Mesh decision
{
  "type": "verification_mesh_completed",
  "payload": { "verdict": "A", "agentAProvider": "groq", "meshCostDelta": 0.5 }
}

// Circuit breaker activated
{
  "type": "verification_mesh_circuit_breaker",
  "payload": { "projectedExtraCostPct": 18.5, "threshold": 15 }
}
```

Enables:
- Cost auditing per session
- Provider fallback analysis
- Replay deterministic execution
- Post-mortem forensics

## Configuration

Policy file: `.apohara/policy.example.yaml`

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

Copy to `~/.apohara/policy.yaml` to customize.

## Type System Updates

**src/core/types.ts:**
- Added `"arbiter"` role to `TaskRole` union
- Added "arbiter" to `ROLE_TO_PROVIDER` (groq)
- Added "arbiter" fallbacks: groq → kiro-ai → mistral → qwen3.5-plus

Preserves existing role-based routing infrastructure.

## Files Added

```
crates/apohara-sandbox/
  Cargo.toml
  src/main.rs

src/core/
  sandbox.ts (Isolator interface)
  verification-mesh.ts (VerificationMesh class)

tests/e2e/
  security-escape.test.ts (9 tests)
  verification-mesh.test.ts (9 tests)
  sandbox-mesh-integration.test.ts (5 tests)

.apohara/
  policy.example.yaml

M008-IMPLEMENTATION.md (detailed architecture doc)
M008-SUMMARY.md (this file)
```

## Files Modified

```
src/core/types.ts
  + TaskRole includes "arbiter"
  + ROLE_TO_PROVIDER["arbiter"] = "groq"
  + ROLE_FALLBACK_ORDER["arbiter"] = [...]

src/core/isolation.ts
  + Export { Isolator, SandboxExecOptions, SandboxExecResult, PermissionTier }
```

## Next Phase: M009 (Self-Improvement Loop)

Once M008 is verified:

1. **Thompson Sampling** — Activate in CapabilityManifest for exploration/exploitation tradeoff
2. **Engram Integration** — Replace Mem0 with durable agent memory
3. **First Self-Run** — Execute `apohara auto` on Apohara's own codebase

The sandbox ensures agents cannot corrupt the orchestrator. The mesh ensures outputs are validated. Together they make self-improvement safe.

## Verification Checklist

Before considering M008 complete, run:

```bash
# Build Rust sandbox
cd crates/apohara-sandbox && cargo build --release

# Run all tests
bun test tests/e2e/security-escape.test.ts
bun test tests/e2e/verification-mesh.test.ts
bun test tests/e2e/sandbox-mesh-integration.test.ts

# Verify types
bunx tsc --noEmit

# E2E: Add /health endpoint with sandbox + mesh
apohara auto "Add GET /health endpoint to Fastify server"
```

All tests pass = M008 complete and ready for M009.
