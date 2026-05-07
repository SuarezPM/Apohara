# Technology Stack

> Last mapped: 2026-05-07

## Languages

| Language | Usage | Version/Edition |
|----------|-------|-----------------|
| TypeScript | Primary — CLI, core orchestration, providers, TUI | `^5` (peer dep) |
| Rust | Native binaries — indexer, sandbox, isolation engine | Edition 2021 |
| JavaScript (Node.js) | Postinstall scripts, distribution shims | `>=22` (engines) |

## Runtimes

| Runtime | Purpose |
|---------|---------|
| **Bun** | Development runtime, build tool (`bun build`, `bun run`) |
| **Node.js ≥22** | Production target for CLI (`--target node`) |
| **Tokio** | Async runtime for Rust indexer daemon |

## Package Managers

- **bun** — Primary (uses `bun.lock`)
- **npm** — Distribution target (`package-lock.json` present)

## Build System

| Component | Tool | Config |
|-----------|------|--------|
| TypeScript → JS | `bun build src/cli.ts --target node --outdir dist` | `tsconfig.json` |
| Rust workspace | `cargo build --release` | `Cargo.toml` (workspace) |
| Lint/Format | Biome 2.4.13 | `biome.json` |
| Tests (TS) | Vitest 4.1.5 | `vitest.config.ts` |
| Tests (TUI) | Vitest + Testing Library + JSDOM | `packages/tui/vitest.config.ts` |

## Core Dependencies

### TypeScript (root `package.json`)

| Dependency | Version | Purpose |
|------------|---------|---------|
| `commander` | `^14.0.3` | CLI argument parsing |
| `zod` | `^4.4.1` | Runtime schema validation |

### TUI Package (`packages/tui/package.json`)

| Dependency | Version | Purpose |
|------------|---------|---------|
| `ink` | `^7.0.1` | React-based terminal UI framework |
| `react` | `^19.2.5` | Component rendering (Ink backend) |
| `@testing-library/react` | `^16.3.2` | Component testing (dev) |
| `jsdom` | `^29.1.1` | DOM simulation for tests (dev) |

### Rust — `apohara-indexer` Crate

| Dependency | Version | Purpose |
|------------|---------|---------|
| `tree-sitter` | `0.24` | Source code parsing (TS, Rust) |
| `tree-sitter-typescript` | `0.23` | TypeScript grammar |
| `tree-sitter-rust` | `0.23` | Rust grammar |
| `candle-core/nn/transformers` | `0.10.2` | Local ML inference (embeddings) |
| `tokenizers` | `0.23.1` | HuggingFace tokenizers |
| `hf-hub` | `0.5.0` | Model download from HuggingFace |
| `redb` | `2.2` | Embedded key-value database |
| `tokio` | `1` (full) | Async runtime |
| `serde` / `serde_json` | `1.0.x` | Serialization |
| `anyhow` / `thiserror` | latest | Error handling |
| `uuid` | `1` (v4) | Unique identifiers |
| `bincode` | `1.3` | Binary serialization for DB storage |
| `clap` | `4.6.1` | CLI arg parsing (isolation engine) |

### Rust — `isolation-engine` Crate

| Dependency | Version | Purpose |
|------------|---------|---------|
| `clap` | `4.6.1` | CLI argument parsing with derive |
| `serde` / `serde_json` | `1.0.x` | JSON I/O |

### Rust — `apohara-sandbox` Crate

Minimal crate — no external dependencies. Placeholder for future sandboxing logic.

## Configuration

| File | Purpose |
|------|---------|
| `tsconfig.json` | TypeScript compiler settings (ESM, `module: "nodenext"`, strict) |
| `biome.json` | Linter + formatter (tabs, single quotes, recommended rules) |
| `vitest.config.ts` | Test runner config (node env, globals, excludes TUI) |
| `config/providers.json` | Provider registry (models, costs, rate limits, capability scores) |
| `packages/tui/tsconfig.json` | TUI-specific TS config |

## Distribution

- **npm package** — `apohara` (version 0.1.0)
- **Platform-specific binaries** via `optionalDependencies`:
  - `@apohara/cli-darwin-arm64`
  - `@apohara/cli-darwin-x64`
  - `@apohara/cli-linux-x64`
  - `@apohara/cli-linux-arm64`
  - `@apohara/cli-win32-x64`
- **Postinstall script** (`scripts/postinstall.js`) extracts correct binary
- **Install script** (`install.sh`) — curl-based installer for direct use
