# Stack Research — Multi-Agent AI Orchestration

## Competitive Landscape

| Framework | Language | Architecture | Strengths | Weaknesses |
|-----------|----------|-------------|-----------|------------|
| **CrewAI** | Python | Role-based collaboration | Simple API, role metaphor intuitive | Python-only, limited parallelism |
| **AutoGen** (Microsoft) | Python | Dynamic multi-agent conversation | Strong memory/state, Microsoft backing | Heavy, complex setup, Python-only |
| **LangGraph** | Python | Graph-based state machines | Durable execution, fine-grained control | Steep learning curve, vendor lock-in (LangChain) |
| **Swarms** | Python | Enterprise modular orchestration | Scale-oriented, many swarm patterns | Early maturity, Python-only |
| **OpenHands** | Python | Coding agent platform | Strong IDE integration | Single-agent focus, not true swarm |
| **Aider** | Python | Git-aware pair programmer | Excellent git integration | Single model, no multi-agent |
| **Claude Code** | TypeScript | CLI coding agent | Strong reasoning, tool use | Proprietary, single provider |
| **Apohara** | TS + Rust | Swarm orchestrator + native sidecars | Multi-provider, DAG execution, local-first | Pre-v1, limited community |

## Stack Analysis

### Why TypeScript + Rust (Apohara's Choice)

**Advantages:**
- **TypeScript**: Async-first, excellent for I/O-bound LLM API orchestration, npm ecosystem for CLI tooling
- **Rust sidecars**: Tree-sitter parsing, embedding inference (Candle), and storage (redb) at native speed
- **Bun runtime**: 3-4x faster than Node.js for startup, native TypeScript support
- **Single binary**: Rust compiles to platform binaries distributed via npm optionalDependencies

**Risks:**
- FFI bridge complexity between TS and Rust (currently Unix socket JSON-RPC — good choice)
- Bun ecosystem less mature than Node.js (some npm packages may have compatibility issues)
- Two-language maintenance burden for a solo developer

### Industry Trend: Python Dominance

- 90%+ of agent frameworks are Python-only
- Apohara's TS+Rust choice is a genuine differentiator — targets developers who don't want Python in their stack
- Risk: smaller community, fewer tutorials, harder to attract contributors

## Recommended Stack Decisions

1. **Keep Bun** — Startup speed critical for CLI UX. Monitor compatibility issues
2. **Keep Unix socket bridge** — Clean process boundary between TS and Rust. Avoid FFI/NAPI complexity
3. **Defer WASM** — Not needed for v0.1.0. Rust sidecars via platform binaries is simpler
4. **MCP as integration protocol** — Industry converging on Model Context Protocol. Already implemented

## Build Order Implications

1. Credential system (P0 — everything depends on authenticated API calls)
2. Provider routing stabilization (foundation for all agent work)
3. DAG orchestrator improvements (enables parallel swarm execution)
4. Sandbox isolation (security layer, can be deferred for trusted environments)

---
*Research conducted: 2026-05-07*
