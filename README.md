# Apohara

Apohara is a local-first multi-agent LLM orchestration framework. It turns natural-language intent into atomic tasks, executes each task inside an isolated git worktree, and merges the result back into the trunk only after verification passes.

## Quick start

```bash
bun install
bun run index.ts
```

## Architecture

Apohara is a TypeScript/Bun orchestrator coupled to two Rust sidecars:

- **apohara-indexer** — code intelligence backed by `redb` for storage and on-device embeddings for semantic search.
- **apohara-sandbox** — task execution sandbox using `seccomp-bpf` to confine agent processes at the syscall level.

The orchestrator plans, dispatches, and verifies; the sidecars handle the heavy and untrusted work.
