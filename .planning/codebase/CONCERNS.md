# Technical Concerns

> Last mapped: 2026-05-07

## Architecture Concerns

### 1. Monolithic Provider Router (HIGH)
**File**: `src/providers/router.ts` (1294 lines)
**Issue**: Single file handles 20+ LLM providers with individual `callXxx()` methods. This is the largest TS file in the codebase and will grow with each new provider.
**Impact**: Difficult to maintain, test individual providers in isolation, or add new providers without touching the central file.
**Suggestion**: Extract each provider into its own file under `src/providers/` implementing a common interface, then register them in the router.

### 2. Sandbox Crate is Placeholder (LOW)
**File**: `crates/apohara-sandbox/src/main.rs` (1 line — `fn main() {}`)
**Issue**: The sandbox binary is referenced by `src/core/sandbox.ts` but the Rust implementation is empty.
**Impact**: The `Isolator` class in TypeScript references a binary path that does nothing. Sandboxed execution is not functional.
**Suggestion**: Either implement the sandbox or remove the dead code path.

### 3. Hardcoded Provider Capability Scores
**Files**: `src/core/types.ts`, `src/core/capability-manifest.ts`, `config/providers.json`
**Issue**: Provider capabilities are hardcoded in three places with no mechanism for dynamic updates based on actual performance.
**Impact**: Scores become stale as models improve or degrade. No feedback loop.
**Suggestion**: Consider tracking actual success/failure rates to adjust routing dynamically.

## Code Quality

### 4. No TODO/FIXME Markers (GOOD ✅)
The codebase scan found **0 TODO/FIXME/HACK/XXX** markers across all TypeScript and Rust source. This is clean.

### 5. Large Parser File (MEDIUM)
**File**: `crates/apohara-indexer/src/parser.rs` (1476 lines)
**Issue**: Handles both TypeScript and Rust parsing with many `extract_*` and `parse_*` functions. Extensive but well-tested (22 tests).
**Impact**: Adding new language support would further bloat this file.
**Suggestion**: Split into `parser/typescript.rs` and `parser/rust.rs` modules.

### 6. Duplicate Type Definitions
**Files**: `src/core/types.ts` (TS) and `packages/tui/types.ts` (TUI)
**Issue**: TUI re-imports types from core but also defines its own `Run`, `DashboardState`, `DashboardAction` types. Some overlap exists.
**Impact**: Minor — TUI types extend core types appropriately. Could diverge over time.

## Security

### 7. API Key Handling (MEDIUM)
**File**: `src/lib/sanitize.ts`
**Strength**: Comprehensive regex-based redaction covering 15+ key patterns.
**Concern**: Redaction is opt-in (requires `wrapConsole()` call). If not called, raw keys could appear in logs.
**Mitigation**: `containsApiKey()` and `countApiKeys()` validators exist for proactive checking.

### 8. Unix Socket IPC (LOW)
**File**: `crates/apohara-indexer/src/server.rs`
**Issue**: The indexer daemon listens on `/tmp/apohara-indexer.sock` which is world-readable.
**Impact**: Any local process can send JSON-RPC commands to the indexer.
**Suggestion**: Consider per-user socket paths (e.g., `$XDG_RUNTIME_DIR/apohara-indexer.sock`) or add auth tokens.

### 9. Credentials File Permissions (LOW)
**File**: `src/core/credentials.ts`
**Issue**: Reads from `~/.apohara/credentials.json` but no explicit file permission checks (e.g., ensuring 0600).
**Suggestion**: Warn if credentials file has overly permissive permissions.

## Performance

### 10. Synchronous Credential Resolution (MEDIUM)
**File**: `src/core/credentials.ts`
**Issue**: `resolveCredentialSync()` reads files synchronously. Called during provider initialization which could block the event loop.
**Impact**: Minor in CLI context, but problematic if used in server scenarios.

### 11. No Connection Pooling for LLM APIs
**File**: `src/providers/router.ts`
**Issue**: Each `callXxx()` creates a fresh `fetch()` request. No HTTP keep-alive or connection reuse.
**Impact**: Higher latency for sequential API calls to the same provider.
**Suggestion**: Use a shared `fetch` agent with keep-alive for frequently-used providers.

### 12. Embedding Model Cold Start
**File**: `crates/apohara-indexer/src/embeddings.rs`
**Issue**: `EmbeddingModel::new()` downloads and loads the model from HuggingFace on first use.
**Impact**: First indexing operation has significant latency (model download + load). Subsequent operations use cached model.
**Mitigation**: Auto-shutdown timeout (55s) means the model may be unloaded between sessions.

## Reliability

### 13. Provider Cooldown is In-Memory
**Files**: `src/providers/router.ts`, `src/core/state.ts`
**Issue**: Provider failure timestamps are tracked in `StateMachine` (persisted to disk), but `ProviderRouter` also has its own in-memory `failureTimestamps` map. These can diverge.
**Impact**: After a restart, the router's in-memory cooldown state is lost while the state file retains it (or vice versa).
**Suggestion**: Unify to a single source of truth.

### 14. Indexer Client Reconnection
**File**: `src/core/indexer-client.ts`
**Issue**: Implements reconnection with exponential backoff, but the `connect()` method may auto-spawn the daemon which has race conditions if multiple clients try simultaneously.
**Impact**: Possible duplicate daemon instances.

## Documentation

### 15. Minimal README (LOW)
**File**: `README.md` (15 lines)
**Issue**: The README contains only `bun init` boilerplate. No project description, architecture overview, setup instructions, or usage examples.
**Impact**: Poor onboarding experience for new developers.

### 16. Missing API Documentation
**Issue**: No JSDoc, no generated API docs, no architecture diagrams outside this codebase map.
**Mitigation**: TypeScript types are self-documenting, and test files serve as usage examples.

## Technical Debt Summary

| Priority | Count | Categories |
|----------|-------|-----------|
| HIGH | 1 | Monolithic provider router |
| MEDIUM | 4 | Large parser, sync credentials, provider cooldown divergence, hardcoded scores |
| LOW | 5 | Placeholder sandbox, socket security, file permissions, README, API docs |
| GOOD | 1 | No TODO/FIXME markers |
