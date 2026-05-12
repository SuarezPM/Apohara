# ADR-001 — Drift reconciliation registry

- **Status**: Accepted
- **Date**: 2026-05-12
- **Milestone**: M018 — GSD2 patterns adoption (Pattern E)

## Context

Apohara's subagent loop executes tool calls driven by a planner-decomposed task list. Agents occasionally diverge from the planner's expected next step — picking a different tool, supplying different args, touching files outside the task scope, or declaring completion early.

Today that divergence is invisible during the run:

- The verification mesh catches some classes, but only after the agent has already committed work.
- `.events/run-*.jsonl` records every tool call but does not classify drift; users must read raw JSONL.
- The M018.B `StuckDetector` catches repetitive divergence (same fingerprint N times) but never single-step drift.

We need a first-class drift abstraction: a per-task log of where the agent went off-plan, classified by severity, with hooks the scheduler and verification mesh can reuse.

GSD2 (`gsd-build/gsd-2`, MIT, 7K stars) ships an equivalent (`DriftRegistry` + `DriftEvent`). We adopt the shape with Apohara-specific classifications and ledger event names.

## Decision

Introduce `DriftRegistry` (`src/core/drift-registry.ts`) — a stateless classifier plus a per-task append-only event log:

- `record(taskId, event: DriftEvent): DriftClassification` — appends and classifies.
- `static classify(event)` → `"innocuous" | "recoverable" | "aborting"`.
- `list(taskId)`, `clear(taskId)`, `taskIds()` — round out the surface.

`DriftEvent` lives in `src/core/types.ts` with the shape `{ kind, expected, observed, severity, timestamp }`. Two new ledger events join the vocabulary: `drift_recovered` and `drift_aborted`.

### Classification rules

1. `kind === "file_scope_violation"` → always `aborting`. Self-reported severity cannot wave through a scope breach.
2. `kind === "off_plan_tool"` and `observed.toolName ∈ {read, ls, grep, find, tree, cat, head, tail}` → `innocuous` (read-only divergence never blocks the run).
3. Otherwise: `severity=info → innocuous`, `severity=warning → recoverable`, `severity=error → aborting`.

### Behavior contract

- **Innocuous** drift: log only. The agent proceeds.
- **Recoverable** drift: emit `drift_recovered` ledger event (severity `warning`). The agent proceeds.
- **Aborting** drift: emit `drift_aborted` (severity `error`). The scheduler's existing abort path terminates the task.

## Drivers

- **Observability**: agent divergence must be visible at runtime, not only post-mortem.
- **Composability**: the registry must be usable by both the subagent-manager loop and external auditors (`apohara state`, ledger replay tooling).
- **Safety**: `file_scope_violation` overrides severity hints — a scope breach is never waved through because the agent self-labeled it `info`.
- **Replay determinism**: classification is a pure function of the event, so replay reproduces the same decisions.

## Alternatives considered

1. **Inline drift handling in `subagent-manager`** — rejected. Drift is cross-cutting; centralizing it lets the verification mesh and replay tooling share one classifier.
2. **Severity-only classifier** — rejected. `file_scope_violation` must abort regardless of self-reported severity, and read-only divergence should never block.
3. **Pluggable classifier (strategy registry)** — rejected for v1. The static classifier covers the GSD2 parity case; we can swap in a strategy registry if Apohara grows custom drift kinds.
4. **Persist drift to the ledger as the source of truth (no in-memory map)** — rejected. The ledger is append-only; a per-task log needs fast `list(taskId)` access for the abort decision. We log the classified outcome to the ledger but keep the raw events in memory.

## Consequences

- **New module**: `src/core/drift-registry.ts` (~80 LOC, no external deps beyond `types.ts`).
- **Type vocabulary growth**: `DriftEvent`, `DriftKind`, two ledger event names in `types.ts`.
- **Wiring is deferred** to `M018.E.2`: Pattern A's `Subagent` adapter exposes the tool-call hook point, but threading drift into the live tool-call path is a separate change.
- **Replay determinism unaffected**: until wiring lands, `DriftRegistry` has no side effects beyond in-memory appends.
- **Feature flag**: when wired, the hook will be gated by `APOHARA_DRIFT_DETECTION=1` for the first 2 weeks to validate the false-positive rate before defaulting on.

## Follow-ups

- `M018.E.2` — wire `DriftRegistry.record()` into the subagent-manager tool-call path behind `APOHARA_DRIFT_DETECTION=1` opt-in.
- Surface drift counts in `apohara state --json`: `drift: { innocuous, recoverable, aborting }`.
- Add `apohara drift <runId>` CLI that pretty-prints the drift log for a finished run.
- Extend the verification mesh to read `DriftRegistry.list(taskId)` and weight verifier votes by drift density.
