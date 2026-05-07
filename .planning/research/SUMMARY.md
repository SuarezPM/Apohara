# Research Summary — Apohara

## Stack Verdict

Apohara's **TypeScript + Rust** hybrid is a genuine differentiator in a Python-dominated landscape. The Bun runtime provides fast startup, Rust sidecars handle compute-intensive tasks (parsing, embeddings, storage), and the Unix socket JSON-RPC bridge keeps clean process boundaries. **No changes recommended** — the stack choice is sound.

**Key insight:** 90%+ of competing frameworks (CrewAI, AutoGen, LangGraph, Swarms) are Python-only. Apohara targets the underserved TS/Rust developer segment.

## Table Stakes Audit

| Feature | Status | Gap? |
|---------|--------|------|
| Task Decomposition | ✅ | No |
| State Management | ✅ Event Ledger | No |
| Tool Integration | ✅ MCP Bridge | No |
| Agent Communication | ✅ Subagent Manager | No |
| Error Recovery | ✅ Retries + backoff | No |
| **Credential Management** | **⚠️ P0 Bug** | **YES — blocks everything** |
| CLI Interface | ✅ | No |
| Observability | ✅ Basic | Enhance in Beta |

**Critical gap:** Credential resolution is broken. This is the only table-stakes feature that isn't fully operational.

## Top Differentiators (Competitive Moat)

1. **Multi-provider DAG execution** — No competitor does parallel, provider-diverse task execution with automatic failover
2. **Thompson Sampling** — Bayesian provider selection that learns from outcomes (not implemented yet — key Beta deliverable)
3. **Cross-verification mesh** — Consensus verification across providers (partial — needs AST signatures)
4. **Local-first privacy** — All heavy compute (parsing, embeddings) on user's machine. Competitors require cloud APIs
5. **Single binary distribution** — npm + platform-specific Rust binaries. Zero setup friction

## Watch Out For (Top 3 Pitfalls)

1. **Specification Ambiguity (41% of MAS failures):** Tasks need structured success criteria, not just descriptions. Add `successCriteria` to task schema.
2. **Race Conditions in Worktrees:** Worktree isolation helps, but consolidation (merge) is the danger zone. File-collision detection in DAG decomposer is critical.
3. **Monolith Trap:** `router.ts` at 1294 lines is the #1 technical debt. Extract per-provider adapters before it becomes unmanageable.

## Build Order Recommendation

```
Phase Alfa (close out):
  1. Wire CredentialResolver → P0 bug fix
  2. Implement auth subcommands
  3. Stabilize provider routing

Phase Beta (initialize):
  1. DAG improvements (topological sort, file-collision detection)
  2. Thompson Sampling in Capability Manifest
  3. Cross-verification mesh hardening
  4. Event Ledger v2 (SHA-256 hashes)
  5. TUI enhancements (real-time cost, agent visualization)

Phase Gamma (future):
  1. Sandbox (seccomp-bpf)
  2. Deterministic replay
  3. Provider expansion (Ollama, OpenRouter)
```

## Research Confidence

| Dimension | Confidence | Notes |
|-----------|-----------|-------|
| Stack | High | Well-validated choices, clear competitive advantage |
| Features | High | Table stakes covered, differentiators identified |
| Architecture | High | Matches industry best practices (hierarchical + DAG) |
| Pitfalls | High | MAST taxonomy well-documented, Apohara-specific risks mapped |

---
*Synthesized: 2026-05-07*
