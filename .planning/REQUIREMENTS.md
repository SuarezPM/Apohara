# Requirements — Apohara v0.1.0

## v1 Requirements

### Phase Alfa — Stabilization (P0/P1)

#### Credentials
- [ ] **CRED-01**: Wire CredentialResolver into `auto.ts` → ProviderRouter execution path so it reads `~/.apohara/credentials.json` before falling back to env vars
- [ ] **CRED-02**: Implement 4-tier credential resolution order: credentials.json → env vars → OAuth cache → free-tier anonymous

#### Authentication
- [ ] **AUTH-01**: Implement `apohara auth login <provider>` — OAuth PKCE flow with ephemeral callback server
- [ ] **AUTH-02**: Implement `apohara auth key <provider>` — API key validation with ping
- [ ] **AUTH-03**: Implement `apohara auth status` — Provider status table (tier, model, latency, cost)
- [ ] **AUTH-04**: Implement `apohara auth refresh <provider>` — Force OAuth token refresh
- [ ] **AUTH-05**: Implement `apohara auth revoke <provider>` — Invalidate and delete credential

### Phase Beta — Swarm Execution

#### Event Ledger
- [ ] **LEDGER-01**: Add SHA-256 hashes to Event Ledger entries for deterministic replay
- [ ] **LEDGER-02**: Implement replay mode — re-execute historical runs at temperature 0

#### DAG Orchestrator
- [ ] **DAG-01**: Implement topological sort with file-collision detection in task decomposer
- [ ] **DAG-02**: Implement backpressure when worktree pool is full

#### TUI Dashboard
- [ ] **TUI-01**: Add real-time cost display per agent in dashboard
- [ ] **TUI-02**: Add swarm block visualization (which agent is touching which files)

## Deferred — Phase Gamma

#### Provider Routing (Thompson Sampling)
- [ ] **ROUTE-01**: Implement Thompson Sampling in Capability Manifest for autonomous provider learning
- [ ] **ROUTE-02**: Implement 5% canary traffic allocation for provider exploration
- [ ] **ROUTE-03**: Implement exponential moving average score updates from real execution outcomes

#### Sandbox Isolation
- [ ] **SANDBOX-01**: Implement seccomp-bpf sandbox in `apohara-sandbox` crate
- [ ] **SANDBOX-02**: Implement 3-tier permission system (ReadOnly, WorkspaceWrite, DangerFullAccess)

#### Verification Mesh
- [ ] **MESH-02**: Implement configurable verification policy (which tasks trigger mesh)

## Out of Scope

- **MEMORY-01** — ~~Replace Mem0 with Engram~~. **Already shipped.** Long-term memory uses native redb Rust daemon + Nomic BERT embeddings. No migration needed.
- **MESH-01** — ~~AST signature injection~~. **Already completed and tested.**
- **Ratatui terminal renderer** — Deferred to Phase Delta. Ink TUI has 108 passing tests.
- **Provider expansion to 40+** — Stabilize 21 first.
- **IDE integration** — CLI-first. Not competing with Cursor/VS Code.
- **Cloud CI/CD** — Local executor only.

## Traceability

| REQ-ID | Phase | Plan | Status |
|--------|-------|------|--------|
| CRED-01 | Alfa | — | Pending |
| CRED-02 | Alfa | — | Pending |
| AUTH-01 | Alfa | — | Pending |
| AUTH-02 | Alfa | — | Pending |
| AUTH-03 | Alfa | — | Pending |
| AUTH-04 | Alfa | — | Pending |
| AUTH-05 | Alfa | — | Pending |
| LEDGER-01 | Beta | — | Pending |
| LEDGER-02 | Beta | — | Pending |
| DAG-01 | Beta | — | Pending |
| DAG-02 | Beta | — | Pending |
| TUI-01 | Beta | — | Pending |
| TUI-02 | Beta | — | Pending |
| ROUTE-01 | Gamma | — | Deferred |
| ROUTE-02 | Gamma | — | Deferred |
| ROUTE-03 | Gamma | — | Deferred |
| SANDBOX-01 | Gamma | — | Deferred |
| SANDBOX-02 | Gamma | — | Deferred |
| MESH-02 | Gamma | — | Deferred |

---
*Last updated: 2026-05-07*
