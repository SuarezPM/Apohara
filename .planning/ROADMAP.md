# Roadmap — Apohara v0.1.0

## Overview

**13 active requirements** | **6 phases** | **Mode: Vertical MVP (Tracer Bullet)**

Each phase delivers an end-to-end user-observable capability. No horizontal layers. The tracer bullet fires first, then we expand its caliber.

---

### Phase 1: Tracer Bullet — Credential Resolution
**Goal:** Fix the severed execution path so `apohara auto "task"` can authenticate with LLM providers end-to-end.
**Mode:** mvp
**Requirements:** CRED-01, CRED-02
**Success Criteria:**
1. User runs `apohara config` wizard, saves API key to `~/.apohara/credentials.json`
2. User runs `apohara auto "create hello world"` and the ProviderRouter authenticates using stored credential
3. 4-tier resolution works: credentials.json → env vars → OAuth cache → anonymous
4. Existing 510 core tests still pass

### Phase 2: Auth CLI — Provider Management
**Goal:** User can manage provider credentials from the terminal without editing JSON files.
**Mode:** mvp
**Requirements:** AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05
**Success Criteria:**
1. `apohara auth key openai` prompts for API key, validates with ping, stores in credentials.json
2. `apohara auth login gemini` launches OAuth PKCE flow, stores token
3. `apohara auth status` displays table of all configured providers with tier/model/latency
4. `apohara auth refresh` and `apohara auth revoke` work for OAuth providers
5. All auth subcommands are discoverable via `apohara auth --help`

### Phase 3: DAG Hardening — Safe Parallel Execution
**Goal:** The swarm can safely execute parallel tasks without file collisions or pool exhaustion.
**Mode:** mvp
**Requirements:** DAG-01, DAG-02
**Success Criteria:**
1. Task decomposer detects when two subtasks target the same files and serializes them
2. Worktree pool backpressure pauses new task dispatch when all 5 lanes are occupied
3. A 10-task DAG with 3 parallel waves executes without merge conflicts
4. Consolidator reports zero silent data corruption on parallel runs

### Phase 4: Event Ledger v2 — Deterministic Replay
**Goal:** Every swarm run is reproducible. User can replay a historical run and get the same outcome.
**Mode:** mvp
**Requirements:** LEDGER-01, LEDGER-02
**Success Criteria:**
1. Every ledger entry includes SHA-256 hash linking to its predecessor (chain integrity)
2. `apohara replay <run-id>` re-executes a historical run at temperature 0
3. Replay output matches original output for deterministic tasks
4. Tampered ledger entries are detected and flagged

### Phase 5: TUI Mission Control — Swarm Visibility
**Goal:** User can observe the swarm in real-time: which agents are running, what they cost, what files they touch.
**Mode:** mvp
**Requirements:** TUI-01, TUI-02
**Success Criteria:**
1. Dashboard shows per-agent cost accumulation in real-time during `apohara auto` execution
2. Swarm block visualization shows which agent is modifying which files
3. Dashboard updates at ≤500ms intervals without flickering
4. Existing 108 TUI tests still pass after enhancements

### Phase 6: Integration Verification — Full Loop
**Goal:** The complete tracer bullet fires: objective → decompose → route → execute → verify → merge → report.
**Mode:** mvp
**Requirements:** (cross-cutting verification of all prior phases)
**Success Criteria:**
1. `apohara auto "add a health check endpoint to the API"` completes end-to-end with zero manual intervention
2. Credential resolution, auth, DAG execution, verification mesh, and consolidation all work in sequence
3. Run summary includes cost breakdown, token usage, and provider performance metrics
4. Event ledger for the full run is replayable

---

## Deferred — Phase Gamma (Future Milestone)

| REQ-ID | Feature | Reason for Deferral |
|--------|---------|-------------------|
| ROUTE-01 | Thompson Sampling | Requires stable provider routing baseline first |
| ROUTE-02 | Canary traffic allocation | Depends on ROUTE-01 |
| ROUTE-03 | EMA score updates | Depends on ROUTE-01 |
| SANDBOX-01 | seccomp-bpf sandbox | Independent track, not blocking v0.1.0 |
| SANDBOX-02 | 3-tier permissions | Depends on SANDBOX-01 |
| MESH-02 | Configurable verification policy | Nice-to-have, current mesh works for v0.1.0 |

---
*Created: 2026-05-07 | Mode: Vertical MVP (Tracer Bullet)*
