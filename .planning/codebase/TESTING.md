# Testing

> Last mapped: 2026-05-07

## Test Frameworks

| Component | Framework | Config |
|-----------|-----------|--------|
| TypeScript (core) | Vitest 4.1.5 | `vitest.config.ts` |
| TUI (React) | Vitest + Testing Library + JSDOM | `packages/tui/vitest.config.ts` |
| Rust | Built-in `#[test]` + `#[cfg(test)]` | Inline in source files |

## Test Structure

### TypeScript Tests

#### Location Pattern
Tests follow a **dual-location** pattern:
1. **Co-located** in `src/core/` — unit tests alongside source
2. **Dedicated `tests/` directory** — integration + E2E tests

```
src/core/
├── agent-router.test.ts         # Co-located unit test
├── capability-manifest.test.ts
├── config.test.ts
├── decomposer.test.ts
├── subagent-manager.test.ts

tests/
├── auto-shutdown.test.ts        # Integration tests
├── build.test.ts
├── cli.test.ts
├── consolidator.test.ts
├── credentials.test.ts
├── decomposer.test.ts
├── fallback.test.ts
├── git.test.ts
├── github.test.ts
├── indexer-client.test.ts
├── inngest.test.ts
├── isolation.test.ts
├── mcp-bridge.test.ts
├── mem0.test.ts
├── memory-injection.test.ts
├── router.test.ts
├── sanitize.test.ts
├── scheduler.test.ts
├── state.test.ts
├── subagent-manager.test.ts
├── summary.test.ts
├── verification-mesh.test.ts
├── e2e/
│   ├── dashboard.test.ts        # E2E: TUI dashboard
│   ├── fastify-jwt.test.ts      # E2E: Fastify API example
│   ├── install-and-run.test.ts  # E2E: npm install + run
│   └── run-swarm-demo.sh        # E2E: swarm demo script
└── tui/
    └── dashboard.test.ts        # TUI integration test
```

### TUI Tests

Co-located with components and hooks:
```
packages/tui/
├── components/
│   ├── Dashboard.test.tsx
│   ├── AgentStatus.test.tsx
│   ├── CostTable.test.tsx
│   ├── ProgressBar.test.tsx
│   ├── TaskList.test.tsx
│   └── Timer.test.tsx
├── hooks/
│   ├── useDashboard.test.tsx
│   ├── useCostTable.test.tsx
│   ├── useTaskList.test.tsx
│   └── useResponsiveMode.test.tsx
├── lib/
│   ├── event-parser.test.ts
│   ├── ledger-watcher.test.ts
│   └── run-manager.test.ts
├── cli.test.tsx
└── integration.test.tsx
```

### Rust Tests

Inline `#[cfg(test)]` modules within source files:
```
crates/apohara-indexer/src/
├── parser.rs          # 22 tests (parsing, imports, exports)
├── db.rs              # 10 tests (CRUD, search, memory)
├── indexer.rs         # 3 tests (creation, embedding, memory)
├── dependency.rs      # 12 tests (graph, blast radius, cycles)
├── embeddings.rs      # 3 tests (dimension, empty, long string)
├── server.rs          # 5 tests (ping, RPC errors, memory)

crates/apohara-indexer/tests/
├── indexer_persistence.rs  # Integration test
└── memory_integration.rs   # Memory integration test
```

## Vitest Configuration

### Root (`vitest.config.ts`)
```typescript
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: [
      "src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}",
      "tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}",
    ],
    exclude: [
      "node_modules",
      "src/tui/**",       // Excluded — TUI has own config
      "packages/**",       // Excluded — packages have own config
      "tests/tui/**",      // Excluded
    ],
  },
});
```

### TUI Package (`packages/tui/vitest.config.ts`)
Separate config with JSDOM environment for React component testing.

## Test Coverage

### Module Coverage Map

| Module | Test Files | Coverage Level |
|--------|-----------|---------------|
| `providers/router.ts` (1294 lines) | `tests/router.test.ts` | Integration tests |
| `core/decomposer.ts` (414 lines) | `src/core/decomposer.test.ts`, `tests/decomposer.test.ts` | Unit + integration |
| `core/agent-router.ts` (386 lines) | `src/core/agent-router.test.ts` | Unit tests |
| `core/scheduler.ts` (416 lines) | `tests/scheduler.test.ts` | Integration tests |
| `core/subagent-manager.ts` (603 lines) | `src/core/subagent-manager.test.ts`, `tests/subagent-manager.test.ts` | Unit + integration |
| `core/verification-mesh.ts` (633 lines) | `tests/verification-mesh.test.ts` | Integration tests |
| `core/consolidator.ts` (428 lines) | `tests/consolidator.test.ts` | Integration tests |
| `core/state.ts` (112 lines) | `tests/state.test.ts` | Unit tests |
| `core/summary.ts` (663 lines) | `tests/summary.test.ts` | Unit tests |
| `core/capability-manifest.ts` (353 lines) | `src/core/capability-manifest.test.ts` | Unit tests |
| `core/credentials.ts` (409 lines) | `tests/credentials.test.ts` | Unit tests |
| `lib/sanitize.ts` (225 lines) | `tests/sanitize.test.ts` | Unit tests |
| `lib/git.ts` (179 lines) | `tests/git.test.ts` | Unit tests |
| `lib/mem0-client.ts` (195 lines) | `tests/mem0.test.ts` | Integration tests |
| `lib/mcp-client.ts` (236 lines) | `tests/mcp-bridge.test.ts` | Integration tests |
| `lib/inngest-client.ts` (174 lines) | `tests/inngest.test.ts` | Integration tests |
| `lib/oauth/gemini.ts` | `src/lib/oauth/gemini.test.ts` | Unit tests |
| `lib/oauth-pkce.ts` | `src/lib/oauth-pkce.test.ts` | Unit tests |
| `providers/github.ts` (483 lines) | `tests/github.test.ts` | Integration tests |
| `commands/auto.ts` (553 lines) | `tests/e2e-auto.test.ts` | E2E tests |
| TUI components | 6 component test files | Unit tests (React Testing Library) |
| TUI hooks | 4 hook test files | Unit tests |
| TUI lib | 3 lib test files | Unit tests |
| Rust parser | 22 inline tests | Unit tests |
| Rust db | 10 inline tests | Unit tests |
| Rust dependency | 12 inline tests | Unit tests |

## Testing Patterns

### Mocking
- **No mocking framework** detected (no jest/sinon)
- Tests likely use constructor injection for testability
- Optional dependencies (`?:` params) allow nil injection

### Test Naming
```typescript
// Pattern: describe("Module") + it("should behavior")
// Or: test("behavior description")
```

### E2E Tests
- Shell-based demo scripts (`run-swarm-demo.sh`)
- Full pipeline tests (`e2e-auto.test.ts`)
- Install verification (`install-and-run.test.ts`)
- API integration (`fastify-jwt.test.ts`)

### Rust Test Fixtures
```
crates/apohara-indexer/tests/fixtures/
├── fixture.ts          # TypeScript test fixture
├── fixture.rs          # Rust test fixture
├── imports.ts          # TypeScript import fixture
└── imports.rs          # Rust import fixture
```

## Running Tests

```bash
# TypeScript tests (root)
bunx vitest run

# TUI tests
cd packages/tui && bunx vitest run

# Rust tests
cargo test --workspace

# Specific test file
bunx vitest run tests/router.test.ts
```
