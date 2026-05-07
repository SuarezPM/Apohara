# Architecture

> Last mapped: 2026-05-07

## Architecture Pattern

**Multi-agent AI orchestrator** with role-based task routing, parallel execution, and verification mesh.

```
User Prompt
    │
    ▼
┌─────────────┐
│  CLI Layer  │  ← commander (src/cli.ts)
│  (commands) │
└──────┬──────┘
       │
       ▼
┌──────────────────┐
│  Task Decomposer │  ← LLM-powered prompt → subtasks
│  (decomposer.ts) │
└──────┬───────────┘
       │  DecomposedTask[]
       ▼
┌──────────────────────────┐
│    Agent Router          │  ← Role-based model selection
│    (agent-router.ts)     │     with fallback chains
└──────┬───────────────────┘
       │
       ▼
┌──────────────────────────┐
│  Parallel Scheduler      │  ← Dependency-aware parallelism
│  (scheduler.ts)          │     with worktree isolation
└──────┬───────────────────┘
       │
  ┌────┴────┐
  │ Workers │  ← Git worktrees for isolation
  └────┬────┘
       │
       ▼
┌──────────────────────────┐
│  Verification Mesh       │  ← Dual-provider consensus
│  (verification-mesh.ts)  │     A/B verification + arbiter
└──────┬───────────────────┘
       │
       ▼
┌──────────────────────────┐
│  Consolidator            │  ← Merge worktrees, generate PR
│  (consolidator.ts)       │
└──────────────────────────┘
```

## Core Layers

### 1. CLI Layer (`src/commands/`)
Entry point for all user interactions:
- `auto` — Main orchestration command (decompose → schedule → execute → consolidate)
- `config` — Interactive API key configuration wizard
- `auth` — OAuth PKCE flows (Claude/Gemini)
- `dashboard` — Launch TUI dashboard
- `uninstall` — Clean removal

### 2. Orchestration Core (`src/core/`)
The brain of the system:

| Module | Role |
|--------|------|
| `decomposer.ts` | Decomposes user prompts into `DecomposedTask[]` via LLM |
| `agent-router.ts` | Routes tasks to providers by role (research/planning/execution/verification) |
| `scheduler.ts` | Parallel task execution with dependency graph awareness |
| `subagent-manager.ts` | Higher-level agent coordination with worktree management |
| `verification-mesh.ts` | Dual-provider code verification with arbiter consensus |
| `consolidator.ts` | Merges completed worktrees into a single branch |
| `state.ts` | Persistent state machine (tasks, status, provider cooldowns) |
| `ledger.ts` | Append-only event log (JSONL) for audit trail |
| `summary.ts` | Generates markdown run reports with token/cost analytics |

### 3. Provider Layer (`src/providers/`)
Handles all LLM API communication:

| Module | Role |
|--------|------|
| `router.ts` | `ProviderRouter` — unified LLM API with 20+ providers |
| `github.ts` | `GitHubClient` — PR creation, auth, repo detection |

### 4. Library Layer (`src/lib/`)
Shared utilities:

| Module | Role |
|--------|------|
| `spawn.ts` | Process spawning with stdout/stderr collection |
| `git.ts` | Git remote URL parsing and repository detection |
| `sanitize.ts` | API key redaction for logs (regex-based) |
| `mcp-client.ts` | MCP protocol client + multi-server registry |
| `mem0-client.ts` | Mem0 memory API client |
| `inngest-client.ts` | Inngest workflow dispatch client |
| `oauth-pkce.ts` | OAuth PKCE utilities (verifier, challenge, token) |
| `oauth-token-store.ts` | Persistent OAuth token storage |
| `paths.ts` | XDG-compliant path resolution |

### 5. TUI Layer (`packages/tui/`)
Terminal dashboard built with Ink + React:

| Module | Role |
|--------|------|
| `components/Dashboard.tsx` | Main layout with header/footer |
| `components/TaskList.tsx` | Real-time task status display |
| `components/CostTable.tsx` | Provider cost breakdown |
| `components/AgentStatus.tsx` | Per-agent status indicators |
| `hooks/useDashboard.tsx` | State management (useReducer + Context) |
| `lib/ledger-watcher.ts` | Filesystem polling for JSONL events |
| `lib/run-manager.ts` | Multi-run aggregation |
| `lib/event-parser.ts` | JSONL line parser |

### 6. Native Layer (Rust)

| Crate | Binary | Role |
|-------|--------|------|
| `apohara-indexer` | `apohara-indexer` | Code indexing daemon (tree-sitter + embeddings + dependency graph) |
| `apohara-sandbox` | `apohara-sandbox` | Sandboxed code execution (placeholder) |
| `isolation-engine` | `isolation-engine` | Git worktree management (create/destroy) |

## Data Flow

### Task Execution Flow
```
1. User → CLI "auto" command
2. TaskDecomposer.decompose(prompt) → DecomposedTask[]
   - Enriches with memory (Mem0 + Indexer)
   - Injects MCP context
   - Cycle detection on dependency graph
3. ParallelScheduler.executeAll(tasks)
   - Topological sort by dependencies
   - Each task gets an isolated git worktree
   - ProviderRouter.completion(request) for LLM calls
   - Provider fallback on error (cooldown-aware)
4. VerificationMesh.execute(task)
   - Primary + secondary provider execute same task
   - Arbiter resolves conflicts
   - Cost estimation per verification
5. Consolidator.run()
   - Merges successful worktrees into target branch
   - Generates markdown summary
   - Creates GitHub PR
```

### Event Flow
```
Every significant action → EventLedger.log() → JSONL file
TUI: LedgerWatcher polls JSONL → EventParser → RunManager → React state → Dashboard
```

## Key Abstractions

### `ProviderRouter`
Central LLM gateway. Normalizes 20+ provider APIs into a single `completion(request)` interface. Handles:
- Provider-specific request formatting (Anthropic Messages, OpenAI Chat, Gemini, Tavily)
- Automatic fallback with configurable cooldown (30s default)
- Health tracking (failure counts, circuit-breaker pattern)
- Event logging for cost/token analytics

### `StateMachine`
Persistent state (JSON file) tracking:
- Current task, all tasks with statuses
- Orchestrator status (idle/running/paused/error)
- Provider failure timestamps for cooldown

### `IndexerClient`
Unix socket JSON-RPC client to the Rust indexer daemon:
- Auto-spawns daemon if not running
- Reconnection with exponential backoff
- Event emitter for connection state changes

### `VerificationMesh`
Dual-execution consensus system:
- Executes task on two providers independently
- Compares outputs (hash-based dedup)
- Arbiter LLM resolves conflicts
- Supports file signature context from indexer

## Design Decisions

1. **Bun for dev, Node for prod** — Fast dev iteration with Bun, broad compatibility via Node target
2. **Rust for performance-critical paths** — Parsing, embeddings, git worktree ops compiled to native
3. **Unix sockets for IPC** — Low-overhead communication between TS and Rust processes
4. **JSONL event log** — Append-only, parseable by TUI in real-time, no database needed
5. **Role-based routing** — Tasks classified by role → best provider selected, not hardcoded
6. **Git worktrees for isolation** — Parallel task execution without merge conflicts
