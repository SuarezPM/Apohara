# Architecture Research — Multi-Agent AI Orchestration

## Industry Patterns

### 1. Sequential Pipeline
Linear execution: Agent A → Agent B → Agent C. Simple, deterministic, easy to debug.
- **Use case**: Simple workflows with clear ordering
- **Apohara relevance**: Used for verification chain (executor → verifier → arbiter)

### 2. Hierarchical (Orchestrator-Worker)
Supervisor decomposes tasks, delegates to specialized workers, synthesizes results.
- **Use case**: Complex tasks with distinct domains
- **Apohara relevance**: **This is Apohara's primary pattern** (Scheduler → SubagentManager → agents)

### 3. Peer-to-Peer (Swarm/Collaborative)
Agents operate as equals, negotiate or debate to reach solutions.
- **Use case**: Subjective tasks, creative exploration
- **Apohara relevance**: Cross-verification mesh uses this for consensus

### 4. Hybrid
Centralized strategic control + decentralized tactical execution.
- **Apohara relevance**: DAG orchestrator (centralized) + worktree agents (decentralized)

## Component Boundaries (Apohara-Specific)

```
┌─────────────────────────────────────────────────┐
│                    CLI Layer                      │
│  apohara auto | config | auth | dashboard        │
├─────────────────────────────────────────────────┤
│              Orchestration Core                   │
│  TaskDecomposer → Scheduler → SubagentManager    │
│       ↕               ↕              ↕            │
│  AgentRouter    ProviderRouter    Worktrees       │
├─────────────────────────────────────────────────┤
│              Intelligence Layer                   │
│  CapabilityManifest  VerificationMesh  Ledger    │
├─────────────────────────────────────────────────┤
│              Infrastructure Layer                 │
│  CredentialResolver  MCPBridge  Mem0/Engram       │
├─────────────────────────────────────────────────┤
│              Native Sidecars (Rust)               │
│  apohara-indexer (tree-sitter, redb, candle)     │
│  apohara-sandbox (seccomp-bpf) [placeholder]     │
└─────────────────────────────────────────────────┘
```

## Data Flow

1. **User input** → CLI parses objective
2. **Decomposition** → LLM breaks objective into DAG of atomic tasks
3. **Routing** → AgentRouter assigns provider roles (research/plan/execute/verify)
4. **Scheduling** → Scheduler resolves dependencies, dispatches parallel waves
5. **Execution** → SubagentManager runs agents in isolated worktrees
6. **Verification** → Cross-verification mesh validates critical outputs
7. **Consolidation** → Merge worktrees → PR → summary report

## Provider Routing Architecture (Industry Best Practices)

| Pattern | Description | Apohara Status |
|---------|-------------|----------------|
| **AI Gateway** | Central proxy for all LLM calls (Portkey, Bifrost) | ProviderRouter serves this role |
| **Automated Fallback** | Switch to backup on 5xx/429 errors | ✅ Implemented with cooldowns |
| **Latency Thresholds** | Treat slow responses as failures | ⚠️ Not implemented — worth adding |
| **Cost-Based Routing** | Cheap models for routine, frontier for complex | ⚠️ Partially (role-based, not cost-aware) |
| **Thompson Sampling** | Bayesian exploration/exploitation for model selection | 🔴 Not implemented — key differentiator |

## Consensus & Verification (Industry Best Practices)

| Pattern | Description | Apohara Status |
|---------|-------------|----------------|
| **LLM Debate** | Agents critique each other's solutions | ⚠️ Partial — verification mesh |
| **Majority Voting** | Multiple agents vote on correctness | 🔴 Not implemented |
| **Specialized Reviewers** | Security, Performance, Style agents | 🔴 Not implemented — future |
| **BFT for critical decisions** | Byzantine Fault Tolerance for high-stakes | 🔴 Overkill for v0.1.0 |

## Suggested Build Order

1. **Credentials** — Foundation for everything (can't route without auth)
2. **Provider Routing stabilization** — Health tracking, latency thresholds
3. **DAG improvements** — Topological sort, backpressure, file-collision detection
4. **Thompson Sampling** — Move from static to learned capability scores
5. **Verification mesh hardening** — AST signature injection, configurable policy
6. **Event Ledger v2** — SHA-256 hashes for replay determinism
7. **Sandbox** — Independent track, seccomp-bpf in Rust crate

---
*Research conducted: 2026-05-07*
