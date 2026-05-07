# Directory Structure

> Last mapped: 2026-05-07

## Root Layout

```
Apohara/
├── src/                         # TypeScript source (CLI + core)
│   ├── cli.ts                   # Entry point — commander program
│   ├── index.test.ts            # Root test
│   ├── commands/                # CLI subcommands
│   ├── core/                    # Orchestration engine
│   ├── lib/                     # Shared utilities
│   └── providers/               # LLM provider implementations
├── packages/
│   └── tui/                     # Terminal UI dashboard (Ink + React)
│       ├── components/          # React components
│       ├── hooks/               # React hooks
│       ├── lib/                 # TUI utilities
│       └── types.ts             # Shared TUI types
├── crates/                      # Rust workspace members
│   ├── apohara-indexer/         # Code indexing daemon
│   └── apohara-sandbox/         # Sandboxed execution (placeholder)
├── isolation-engine/            # Git worktree management (Rust)
├── tests/                       # Integration + E2E tests
│   ├── e2e/                     # End-to-end tests
│   └── tui/                     # TUI integration tests
├── examples/
│   └── fastify-api/             # Example Fastify API using the router
├── config/
│   └── providers.json           # Provider registry config
├── scripts/
│   ├── postinstall.js           # npm postinstall binary extraction
│   ├── checksum.sh              # Binary integrity verification
│   └── demo-dashboard.sh        # TUI demo script
├── package.json                 # Root npm package
├── Cargo.toml                   # Rust workspace root
├── tsconfig.json                # TypeScript configuration
├── biome.json                   # Linter/formatter config
├── vitest.config.ts             # Test runner config
├── index.ts                     # Module entry (placeholder)
├── install.sh                   # Curl-based installer
├── install.ps1                  # PowerShell installer
└── README.md                    # Project documentation
```

## Key Locations

### CLI Entry Points
| File | Purpose |
|------|---------|
| `src/cli.ts` | Main CLI entry — registers all commands |
| `src/commands/auto.ts` | `apohara auto` — full orchestration pipeline |
| `src/commands/config.ts` | `apohara config` — API key setup wizard |
| `src/commands/auth.ts` | `apohara auth` — OAuth login flows |
| `src/commands/dashboard.ts` | `apohara dashboard` — launch TUI |
| `src/commands/uninstall.ts` | `apohara uninstall` — clean removal |

### Core Orchestration
| File | Purpose |
|------|---------|
| `src/core/types.ts` | Central type definitions (ProviderId, TaskRole, ModelCapability) |
| `src/core/decomposer.ts` | Prompt → subtask decomposition |
| `src/core/agent-router.ts` | Role-based task → provider routing |
| `src/core/scheduler.ts` | Parallel task execution scheduler |
| `src/core/subagent-manager.ts` | Agent lifecycle + worktree management |
| `src/core/verification-mesh.ts` | Dual-provider verification consensus |
| `src/core/consolidator.ts` | Worktree merging + PR creation |
| `src/core/state.ts` | Persistent orchestrator state |
| `src/core/ledger.ts` | JSONL event logging |
| `src/core/summary.ts` | Run report generation |
| `src/core/config.ts` | Environment + credential resolution |
| `src/core/credentials.ts` | Multi-source credential resolution |
| `src/core/capability-manifest.ts` | Provider capability scoring matrix |
| `src/core/sandbox.ts` | Sandboxed execution wrapper |
| `src/core/isolation.ts` | Git worktree isolation engine wrapper |
| `src/core/indexer-client.ts` | IPC client to Rust indexer daemon |
| `src/core/memory-injection.ts` | Memory context injection into prompts |

### Provider Implementations
| File | Purpose |
|------|---------|
| `src/providers/router.ts` | `ProviderRouter` — 20+ LLM providers unified API |
| `src/providers/github.ts` | `GitHubClient` — repository + PR management |

### Shared Libraries
| File | Purpose |
|------|---------|
| `src/lib/spawn.ts` | Child process spawning |
| `src/lib/git.ts` | Git remote URL parsing |
| `src/lib/sanitize.ts` | API key redaction |
| `src/lib/mcp-client.ts` | MCP protocol client |
| `src/lib/mem0-client.ts` | Mem0 API client |
| `src/lib/inngest-client.ts` | Inngest workflow client |
| `src/lib/oauth-pkce.ts` | OAuth PKCE crypto |
| `src/lib/oauth-token-store.ts` | OAuth token persistence |
| `src/lib/oauth/gemini.ts` | Google OAuth implementation |
| `src/lib/paths.ts` | XDG path resolution |

### Rust — Indexer Daemon
| File | Purpose |
|------|---------|
| `crates/apohara-indexer/src/main.rs` | Daemon entry point |
| `crates/apohara-indexer/src/server.rs` | Unix socket JSON-RPC server |
| `crates/apohara-indexer/src/indexer.rs` | Indexing logic (text, files, embeddings) |
| `crates/apohara-indexer/src/parser.rs` | Tree-sitter parsing (TS + Rust, 1476 lines) |
| `crates/apohara-indexer/src/embeddings.rs` | Nomic-embed-text-v1.5 local inference |
| `crates/apohara-indexer/src/db.rs` | redb key-value storage |
| `crates/apohara-indexer/src/dependency.rs` | File dependency graph (blast radius) |
| `crates/apohara-indexer/src/index.rs` | HNSW-like vector index |
| `crates/apohara-indexer/src/lib.rs` | Crate re-exports |

### Rust — Isolation Engine
| File | Purpose |
|------|---------|
| `isolation-engine/src/main.rs` | Git worktree create/destroy CLI |

### TUI Dashboard
| File | Purpose |
|------|---------|
| `packages/tui/app.tsx` | App root |
| `packages/tui/cli.tsx` | TUI CLI entry point |
| `packages/tui/components/Dashboard.tsx` | Main dashboard layout |
| `packages/tui/components/TaskList.tsx` | Task status display |
| `packages/tui/components/CostTable.tsx` | Cost breakdown table |
| `packages/tui/components/AgentStatus.tsx` | Agent indicators |
| `packages/tui/components/ProgressBar.tsx` | Progress visualization |
| `packages/tui/components/Timer.tsx` | Elapsed time counter |
| `packages/tui/hooks/useDashboard.tsx` | Dashboard state management |
| `packages/tui/hooks/useTaskList.tsx` | Task list hook |
| `packages/tui/hooks/useCostTable.tsx` | Cost table hook |
| `packages/tui/hooks/useResponsiveMode.tsx` | Terminal width adaptation |
| `packages/tui/lib/ledger-watcher.ts` | JSONL file watcher |
| `packages/tui/lib/run-manager.ts` | Multi-run aggregation |
| `packages/tui/lib/event-parser.ts` | Event line parser |
| `packages/tui/types.ts` | TUI type definitions |

## Naming Conventions

| Pattern | Convention | Example |
|---------|-----------|---------|
| TypeScript files | kebab-case | `agent-router.ts`, `oauth-pkce.ts` |
| Rust files | snake_case | `indexer.rs`, `dependency.rs` |
| Test files | `*.test.ts` / `*.test.tsx` co-located OR in `tests/` | `decomposer.test.ts` |
| React components | PascalCase files + exports | `Dashboard.tsx`, `TaskList.tsx` |
| React hooks | `use` prefix, PascalCase | `useDashboard.tsx` |
| Types | PascalCase, co-located in `types.ts` | `ProviderId`, `TaskRole` |
| Constants | SCREAMING_SNAKE_CASE | `ROLE_TO_PROVIDER`, `MODELS` |
| Classes | PascalCase | `ProviderRouter`, `TaskDecomposer` |
| Functions | camelCase | `routeTask()`, `validateToken()` |
| Directories | kebab-case | `apohara-indexer`, `isolation-engine` |

## File Size Distribution

| Range | Files | Notable |
|-------|-------|---------|
| >1000 lines | 3 | `parser.rs` (1476), `router.ts` (1294), `db.rs` (753) |
| 500-1000 lines | 5 | `server.rs`, `summary.ts`, `verification-mesh.ts`, `subagent-manager.ts`, `auto.ts` |
| 200-500 lines | 10 | Most core modules |
| <200 lines | ~30 | Lib utilities, hooks, components |
