//! Linux seccomp-bpf profile builder.
//!
//! M014.1 scope: trait + name resolution (done).
//! M014.2 scope (this commit): canonical syscall lists per tier + a stub
//! filter-build path that walks the lists. Actual BPF compilation is
//! handed to seccompiler in [`build_filter`] but installing it into the
//! current process is M014.3 — that's where the post-fork unshare happens.

use crate::error::Result;
use crate::permission::PermissionTier;
use super::Profile;
use super::syscalls;

pub struct LinuxProfile {
    tier: PermissionTier,
}

impl LinuxProfile {
    pub fn new(tier: PermissionTier) -> Self {
        Self { tier }
    }

    /// Return the full list of allowed syscalls for this tier (pure-allow only).
    /// Useful for diagnostics, dry-run plans, and tests.
    pub fn pure_allow_syscalls(&self) -> Vec<&'static str> {
        syscalls::pure_allow_for(self.tier)
    }

    /// Return the list of syscalls with argument-level constraints.
    pub fn conditional_syscalls(&self) -> Vec<(&'static str, &'static str)> {
        syscalls::conditional_for(self.tier)
    }
}

impl Profile for LinuxProfile {
    fn install(&self) -> Result<()> {
        if matches!(self.tier, PermissionTier::DangerFullAccess) {
            tracing::warn!("DangerFullAccess: no seccomp filter installed");
            return Ok(());
        }
        let pure = self.pure_allow_syscalls();
        let cond = self.conditional_syscalls();
        tracing::info!(
            tier = %self.tier,
            pure_count = pure.len(),
            cond_count = cond.len(),
            "seccomp profile plan resolved (install deferred to M014.3 child-side)"
        );
        // M014.3: this is where seccompiler::apply_filter(bpf_program) gets
        // called inside the child process after unshare(CLONE_NEWNS|CLONE_NEWPID).
        // Doing it here would block the parent's own syscalls and break the
        // orchestrator.
        Ok(())
    }

    fn name(&self) -> &str {
        match self.tier {
            PermissionTier::ReadOnly => "linux-seccomp-readonly",
            PermissionTier::WorkspaceWrite => "linux-seccomp-workspace_write",
            PermissionTier::DangerFullAccess => "linux-seccomp-passthrough",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_per_tier() {
        assert_eq!(
            LinuxProfile::new(PermissionTier::ReadOnly).name(),
            "linux-seccomp-readonly"
        );
        assert_eq!(
            LinuxProfile::new(PermissionTier::WorkspaceWrite).name(),
            "linux-seccomp-workspace_write"
        );
    }

    #[test]
    fn readonly_resolves_substantial_allowlist() {
        let p = LinuxProfile::new(PermissionTier::ReadOnly);
        let list = p.pure_allow_syscalls();
        assert!(list.len() >= 40, "expected ≥40 syscalls, got {}", list.len());
        assert!(list.contains(&"read"));
        assert!(list.contains(&"exit"));
        assert!(!list.contains(&"write"));
    }

    #[test]
    fn workspace_extends_readonly_with_write_syscalls() {
        let p = LinuxProfile::new(PermissionTier::WorkspaceWrite);
        let list = p.pure_allow_syscalls();
        assert!(list.contains(&"read"));   // inherited from ReadOnly
        assert!(list.contains(&"write"));  // tier 2 addition
        assert!(list.contains(&"mkdirat"));
    }

    #[test]
    fn danger_has_no_syscall_filter() {
        let p = LinuxProfile::new(PermissionTier::DangerFullAccess);
        assert!(p.pure_allow_syscalls().is_empty());
    }

    #[test]
    fn install_is_a_noop_for_now() {
        // Until M014.3 lands the child-side apply_filter, install() should
        // return Ok without doing anything destructive. This test guards
        // against a regression where install() starts blocking the parent.
        for tier in [
            PermissionTier::ReadOnly,
            PermissionTier::WorkspaceWrite,
            PermissionTier::DangerFullAccess,
        ] {
            let p = LinuxProfile::new(tier);
            assert!(p.install().is_ok());
        }
    }
}
