# Code Conventions

> Last mapped: 2026-05-07

## Style & Formatting

### Biome Configuration (`biome.json`)
- **Indent**: Tabs
- **Quote style**: Single quotes (JS/TS)
- **Linter**: Enabled, recommended rules
- **Formatter**: Enabled
- **VCS**: Git-aware (uses `.gitignore`)
- **Assist**: Auto-organize imports on save

### TypeScript Settings (`tsconfig.json`)
- **Target**: `ES2022`
- **Module**: `nodenext` / `NodeNext` resolution
- **Strict mode**: Enabled
- **JSX**: `react-jsx`
- **Isolated modules**: Enabled
- **Skip lib check**: Enabled

## Naming Patterns

### TypeScript
```typescript
// Types and interfaces — PascalCase
export type TaskRole = "research" | "planning" | "execution" | "verification";
export interface ModelCapability { ... }

// Union types — PascalCase with string literals
export type ProviderId = "groq" | "deepseek" | "anthropic-api" | ...;

// Classes — PascalCase
export class ProviderRouter { ... }
export class TaskDecomposer { ... }

// Functions — camelCase
export function getModelById(id: ProviderId): ModelCapability | undefined { ... }

// Constants — SCREAMING_SNAKE_CASE
export const MODELS: ModelCapability[] = [ ... ];
export const ROLE_TO_PROVIDER: Record<TaskRole, ProviderId> = { ... };

// Private methods — no prefix, enforced by TypeScript visibility
private fallback(fromProvider?: ProviderId): ProviderId { ... }

// Files — kebab-case
agent-router.ts, memory-injection.ts, oauth-pkce.ts
```

### Rust
```rust
// Structs — PascalCase
pub struct Indexer { ... }
pub struct DependencyGraph { ... }

// Functions — snake_case
pub fn parse_file(path: &Path) -> Result<ParseResult> { ... }

// Constants — SCREAMING_SNAKE_CASE
const DEFAULT_SOCKET_PATH: &str = "/tmp/apohara-indexer.sock";

// Modules — snake_case files
mod indexer;
mod dependency;
```

### React (TUI)
```tsx
// Components — PascalCase (file + export)
export function Dashboard({ children, startedAt }: DashboardProps) { ... }

// Hooks — use prefix, PascalCase
export function useDashboard() { ... }
export function useActiveRun(): Run | undefined { ... }

// Props — PascalCase + "Props" suffix
interface DashboardProps { ... }
```

## Error Handling Patterns

### TypeScript — Try/Catch with Graceful Fallback
```typescript
// Pattern: try-catch with fallback provider
async callProvider(provider: ProviderId, messages: LLMMessage[]): Promise<LLMResponse> {
  try {
    return await this.callGroq(messages);
  } catch (error) {
    await this.recordProviderFailure(provider);
    throw error;  // Re-throw for caller to handle fallback
  }
}

// Pattern: isRetryableError guard
private isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes("rate limit") || msg.includes("timeout") || ...;
  }
  return false;
}
```

### Rust — anyhow + thiserror
```rust
// Module-level errors via thiserror
#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    #[error("Unsupported language: {0:?}")]
    UnsupportedLanguage(PathBuf),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

// Function-level via anyhow::Result
pub fn index_file(&self, path: &Path) -> Result<()> { ... }
```

## Module Organization

### Export Pattern
- **Named exports** exclusively — no default exports
- **Types co-located** with implementation OR in dedicated `types.ts`
- **Re-exports** via `lib.rs` (Rust) for public API surface

### Import Pattern
```typescript
// Relative imports with .js extension (ESM compat)
import { autoCommand } from "./commands/auto.js";
import { routeTask } from "../core/agent-router.js";

// Type imports when only types are needed
import type { ProviderId, TaskRole } from "./types.js";
```

### Dependency Direction
```
commands → core → lib
commands → providers
core → providers (ProviderRouter)
core → lib
TUI → core/types (shared types only)
```
No circular dependencies. `types.ts` is the shared foundation.

## Code Patterns

### Class-Based Services with Optional Dependencies
```typescript
// Constructor injection with optional dependencies
export class TaskDecomposer {
  constructor(
    router?: ProviderRouter,
    indexerClient?: IndexerClient | null,
  ) { ... }
}

// "isConfigured()" guard for optional integrations
if (this.mem0Client.isConfigured()) {
  await this.mem0Client.storeTaskDecision(taskId, decision);
}
```

### Async/Await Everywhere
- All I/O operations are `async`
- No callback patterns
- `Promise.allSettled()` for parallel independent tasks
- `Promise.race()` for timeout patterns

### JSONL Event Logging
```typescript
// Structured logging to append-only file
await this.ledger.log("task.start", { taskId, description }, "info", taskId, {
  provider: selectedProvider,
  model: modelName,
  role: task.role,
});
```

### Config Resolution Order
```
1. Environment variable (e.g., GROQ_API_KEY)
2. Credentials file (~/.apohara/credentials.json)
3. OAuth token store (for supported providers)
4. null (provider unavailable)
```

## Documentation Style

- **No JSDoc** — TypeScript types serve as documentation
- **Inline comments** — sparse, used for non-obvious logic
- **No TODO/FIXME** in source (0 found in codebase scan)
- **Rust doc comments** (`///`) on public API functions
- **Test descriptions** serve as behavior documentation
