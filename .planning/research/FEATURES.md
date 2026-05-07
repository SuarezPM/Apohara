# Features Research — Multi-Agent AI Orchestration

## Table Stakes (Users expect these or leave)

| Feature | Complexity | Apohara Status |
|---------|-----------|----------------|
| Task Decomposition (prompt → subtasks) | Medium | ✅ Implemented |
| State Management (context across agents) | Medium | ✅ Event Ledger |
| Tool Integration (MCP/function calling) | Medium | ✅ MCP Bridge |
| Communication & Handoffs (agent → agent) | Medium | ✅ Subagent Manager |
| Error Recovery & Retries | Low | ✅ Exponential backoff |
| Credential Management | Low | ⚠️ P0 Bug — not wired |
| CLI Interface | Low | ✅ Commander-based |
| Logging & Observability | Medium | ✅ Event Ledger |

## Differentiators (Competitive advantage)

| Feature | Complexity | Apohara Status | Priority |
|---------|-----------|----------------|----------|
| **DAG-based parallel execution** | High | ✅ Basic (needs topological sort improvements) | Beta |
| **Multi-provider routing with fallback** | High | ✅ 21 providers | Stabilize in Alfa |
| **Sandbox isolation (seccomp-bpf)** | Very High | 🔴 Placeholder crate | Gamma |
| **Cross-verification mesh** | High | ✅ Basic (needs AST signature injection) | Beta |
| **Thompson Sampling for provider selection** | High | 🔴 Not implemented (static scores) | Beta |
| **Deterministic replay via Event Ledger** | Medium | 🔴 Needs SHA-256 hashes | Beta |
| **TUI Dashboard (real-time)** | Medium | ✅ Ink + React (108 tests) | Enhance in Beta |
| **Human-in-the-loop checkpoints** | Medium | 🔴 Not implemented | Beta |
| **Local-first embedding search** | High | ✅ Rust indexer (tree-sitter + nomic) | Stable |

## Anti-Features (Deliberately NOT building)

| Anti-Feature | Rationale |
|-------------|-----------|
| Cloud-hosted execution | Local-first is core value. No SaaS dependency |
| IDE plugin/extension | CLI-native. Not competing with Cursor/Copilot |
| Visual workflow builder | Target audience is terminal-native developers |
| Agent marketplace | Complexity trap. Built-in roles are sufficient |
| Conversation mode | Apohara is task-execution, not chatbot |

## Dependencies Between Features

```
Credentials (P0) → Provider Routing → DAG Execution → Verification Mesh
                                    ↘ Thompson Sampling
                                    ↘ TUI Dashboard (real-time cost)
Event Ledger (hashes) → Deterministic Replay
Sandbox → seccomp-bpf crate (independent track)
```

---
*Research conducted: 2026-05-07*
