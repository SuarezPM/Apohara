# Apohara

> **The visual vibecoding orchestrator.** Turn a natural-language objective
> into a swarm of LLM agents that decompose, execute, verify, and merge —
> visually, interactively, with cryptographically-replayable evidence at
> every step.

```
┌──────────────────────────────────────────────────────────────────────┐
│  apohara                                            ◈ GPU · Cloud   │
├───────────────┬──────────────────────────┬─────────────────────────-─┤
│  Objective    │   Swarm Canvas (DAG)     │  Code + Diff              │
│               │                          │                           │
│  build CRUD   │   ┌─planner─┐            │  + src/api/users.ts       │
│  endpoint     │   └──┬──────┘            │  ~ src/db/schema.ts       │
│  with auth    │      ▼                   │                           │
│               │   ┌─dispatcher─┐         │  ┌──── verification ────┐ │
│  [Enhance ▾]  │   └──┬─────────┘         │  │ judge ── ok  ⚖       │ │
│  [Run ▶]      │      ▼                   │  │ critic ── ok ⚖       │ │
│               │   ┌─verifier─┐  ⚖        │  └──────────────────────┘ │
└───────────────┴──────────────────────────┴───────────────────────────┘
```

Type the intent. The swarm builds the code while you watch and steer.

## Status

**v0.1 alpha — current.** Visual orchestrator (Tauri v2 + React + Bun) and
syscall-level sandbox (seccomp-bpf + Linux namespaces) are both shipping.
See [`ROADMAP.md`](ROADMAP.md) for the full milestone plan.

| Capability                                            | Status |
|---|---|
| Multi-provider routing (21 providers + Gemini OAuth)   | ✅ |
| Vibe DAG decomposition with cycle detection            | ✅ |
| Event ledger v2 with SHA-256 hash chain + replay       | ✅ |
| Verification mesh (dual-arbiter + INV-15 safety gate)  | ✅ |
| Code intelligence: tree-sitter + redb + Nomic BERT     | ✅ |
| Apohara Context Forge integration (60–80% token save)  | ✅ |
| **Syscall sandbox (seccomp-bpf + namespaces)**         | ✅ M014 |
| **Desktop visual surface (Tauri + React + SSE)**       | ✅ M017 |
| 90-second viral demo + HN launch                       | ⏳ Phase 6 |
| Self-improvement loop (`apohara auto "ship X"`)        | ⏳ v0.2 |

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/SuarezPM/Apohara/main/scripts/install.sh | sh
```

Or from source:

```bash
git clone https://github.com/SuarezPM/Apohara
cd Apohara
bun install
bun run build
```

The single-binary distribution (Linux ELF 5.6 MB, macOS `.dmg`, Windows
`.msi`) lands automatically on every tag push via the
[desktop-release workflow](.github/workflows/desktop-release.yml).

## Quick start

```bash
# CLI mode — useful in CI and headless contexts
bun run src/cli.ts auto "Implement JWT auth on /api/login"

# Desktop mode — the visual surface
cd packages/desktop
bun run dev          # http://localhost:7331
```

Drop the objective in the left pane. Click **Enhance** to let the local
LLM rewrite it for clarity, then **Run** to dispatch the swarm. The DAG
appears in the center as the decomposer emits tasks; agents claim them,
write to a worktree, and the verification mesh judges each diff before
merging into trunk.

## Use cases

| Intent | What apohara does |
|---|---|
| `"Add CRUD for /api/products"` | Decomposes into 4 tasks (schema, routes, tests, docs), routes to providers per role, runs `bun test` after each, opens a green PR |
| `"Migrate src/legacy/* off lodash"` | Indexer maps every consumer, dispatches one task per file, verification mesh confirms behavior parity, merges in dependency order |
| `"Fix the flake in tests/ledger.test.ts"` | Replays the failing run from the event ledger, reproduces locally inside the sandbox, ships the fix gated on three consecutive green runs |

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  APOHARA DESKTOP (Tauri v2, ~6 MB single binary)                     │
│  React 19 + Geist + @xyflow/react + Monaco + Lexical                 │
└─────────────────────────── ↕ HTTP :7331 (Bun.serve) ─────────────────┘
┌──────────────────────────────────────────────────────────────────────┐
│  APOHARA CORE (TypeScript on Bun)                                    │
│  decomposer · scheduler · verification-mesh · ledger (Phase 4 chain) │
│  router (21 providers + OAuth) · subagent-manager · consolidator     │
└─────────────────────────── ↕ Unix Domain Sockets ────────────────────┘
┌──────────────────────────────┬───────────────────────────────────────┐
│  apohara-indexer (Rust) ✅   │  apohara-sandbox (Rust) ✅ M014       │
│  tree-sitter + redb + BERT   │  seccomp-bpf + user/mount/PID ns      │
└──────────────────────────────┴───────────────────────────────────────┘
                              ↕ HTTP :8001 (optional)
┌──────────────────────────────────────────────────────────────────────┐
│  APOHARA CONTEXT FORGE (parallel repo, Python + vLLM, optional)      │
│  KV-cache coordinator · INV-15 safety gate                           │
└──────────────────────────────────────────────────────────────────────┘
```

Deeper dive: [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Sandbox — what it actually does

The `apohara-sandbox` Rust binary runs every untrusted command inside:

1. A **user + mount + PID namespace bundle** (unprivileged, via
   `CLONE_NEWUSER | CLONE_NEWNS | CLONE_NEWPID`). The agent sees PID 1
   and cannot enumerate or signal host processes.
2. A **seccomp-bpf filter** sized per permission tier (`ReadOnly`,
   `WorkspaceWrite`, `DangerFullAccess`). Blocked syscalls return EPERM
   so the agent observes a normal failure rather than dying with SIGSYS.
3. Cryptographically-anchored audit: every execution emits a
   `sandbox_execution` rollup + one `security_violation` event per
   blocked syscall to the SHA-256-chained event ledger. `apohara replay`
   reconstructs the entire run.

Non-Linux hosts fall back to a consent-gated unsandboxed mode:
`APOHARA_ALLOW_UNSANDBOXED=1` opts in and logs `sandbox_bypassed`.

## Optional: ContextForge GPU sidecar

When a CUDA or ROCm GPU is available, Apohara routes inference through
[Apohara · ContextForge](https://github.com/SuarezPM/Apohara_Context_Forge)
— a separate Python service that compresses, deduplicates, and reuses
KV context across multi-agent calls. On the published 5-agent benchmark
(DOI [10.5281/zenodo.20114594](https://doi.org/10.5281/zenodo.20114594))
ContextForge delivers **79.85% token savings** end-to-end and pairs
cleanly with a local LLM server (e.g. llama-cpp-python serving
[`kai-os/Carnice-9b-GGUF`](https://huggingface.co/kai-os/Carnice-9b-GGUF))
so dev runs cost **zero cloud tokens**.

The sidecar is strictly optional. Apohara works unchanged when
`CONTEXTFORGE_ENABLED` is unset — every ContextForge call is
best-effort and silently falls back to the original context on any
failure.

### Quick start — NVIDIA, no Docker

```bash
git clone https://github.com/SuarezPM/Apohara_Context_Forge.git ~/Apohara-ContextForge
cd ~/Apohara-ContextForge

uv venv .venv --python 3.12
source .venv/bin/activate
uv pip install -e .

# Boot the sidecar
nohup python -m apohara_context_forge.main > /tmp/contextforge.log 2>&1 &

# Tell Apohara to use it
export CONTEXTFORGE_ENABLED=1
export CONTEXTFORGE_URL=http://localhost:8001
```

## License

MIT. See [`LICENSE`](LICENSE).

## Contributing

This repo is indexed by [GitNexus](https://github.com/SuarezPM/GitNexus) —
when you touch a hub symbol, run `gitnexus_impact()` first and quote the
blast radius in the PR description. `CLAUDE.md` captures the full
engineering contract; `ROADMAP.md` captures the milestone plan; this
README is the launch surface, not the spec.
