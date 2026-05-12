//! Apohara Sandbox — syscall-level isolation for worktree agents.
//!
//! Three permission tiers exposed via [`PermissionTier`]:
//! - `ReadOnly`: open(2) read-only, stat/fstat, exit. No write, no fork, no network.
//! - `WorkspaceWrite`: ReadOnly + write/create/unlink within the worktree path.
//! - `DangerFullAccess`: bypass (requires `--i-know-what-im-doing` at the orchestrator).
//!
//! On Linux, enforcement is via seccomp-bpf (per-syscall allowlist) plus mount + PID
//! namespaces (per-worktree isolation). On other platforms, the sandbox is a no-op
//! and the runner returns an [`SandboxError::Unavailable`] that the orchestrator can
//! gate behind explicit user consent.
//!
//! M014.1 scope (this milestone): scaffold + Cargo deps + compiling skeleton.
//! M014.2-.6 will fill in the seccomp profiles, namespace setup, ledger integration.

pub mod error;
pub mod permission;
pub mod profile;
pub mod runner;

pub use error::SandboxError;
pub use permission::PermissionTier;
pub use runner::{SandboxRunner, SandboxRequest, SandboxResult};
