//! Linux seccomp-bpf profile builder. Real syscall filtering goes here in M014.2.
//! M014.1 scope: scaffold + types that compile + tests that assert the API surface.

use crate::error::Result;
use crate::permission::PermissionTier;
use super::Profile;

pub struct LinuxProfile {
    tier: PermissionTier,
}

impl LinuxProfile {
    pub fn new(tier: PermissionTier) -> Self {
        Self { tier }
    }
}

impl Profile for LinuxProfile {
    fn install(&self) -> Result<()> {
        // M014.2 will replace this with real seccompiler::apply_filter() calls.
        // For now, we only validate the tier maps to a known profile.
        tracing::warn!(
            tier = %self.tier,
            "seccomp profile not yet implemented; falling through (M014.2 target)"
        );
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
}
