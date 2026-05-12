//! Sandbox process runner. Takes a command + permission tier + workdir, applies
//! the appropriate seccomp profile and namespace isolation, then exec()s the
//! command. M014.1 scope: API + scaffold; real namespace setup lands in M014.3.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;

use crate::error::Result;
use crate::permission::PermissionTier;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxRequest {
    pub command: Vec<String>,
    pub workdir: PathBuf,
    pub permission: PermissionTier,
    #[serde(default, with = "humantime_serde_opt")]
    pub timeout: Option<Duration>,
    #[serde(default)]
    pub task_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
    pub violations: Vec<String>,
}

pub struct SandboxRunner;

impl SandboxRunner {
    pub fn new() -> Self {
        Self
    }

    /// Run the request to completion. M014.1 returns Unavailable on non-Linux
    /// and logs a warning on Linux (the real seccomp + namespace work is M014.2-.3).
    pub fn run(&self, req: SandboxRequest) -> Result<SandboxResult> {
        let profile = crate::profile::for_tier(req.permission);
        tracing::info!(
            profile = profile.name(),
            workdir = ?req.workdir,
            command = ?req.command,
            "sandbox runner invoked (M014.1 scaffold — no actual enforcement yet)"
        );
        // M014.2-.3: fork, setns(CLONE_NEWPID|CLONE_NEWNS), apply profile, exec.
        // For now, refuse explicitly so callers don't think they're sandboxed.
        Err(crate::error::SandboxError::Unavailable)
    }
}

impl Default for SandboxRunner {
    fn default() -> Self {
        Self::new()
    }
}

// Minimal optional-duration serde adapter — `humantime` not pulled in to keep deps small.
mod humantime_serde_opt {
    use serde::{Deserialize, Deserializer, Serializer};
    use std::time::Duration;

    pub fn serialize<S>(value: &Option<Duration>, ser: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match value {
            Some(d) => ser.serialize_some(&d.as_millis().to_string()),
            None => ser.serialize_none(),
        }
    }

    pub fn deserialize<'de, D>(de: D) -> Result<Option<Duration>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let opt = Option::<String>::deserialize(de)?;
        match opt {
            Some(s) => s
                .parse::<u64>()
                .map(Duration::from_millis)
                .map(Some)
                .map_err(serde::de::Error::custom),
            None => Ok(None),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_serde_roundtrip() {
        let req = SandboxRequest {
            command: vec!["echo".into(), "hi".into()],
            workdir: PathBuf::from("/tmp"),
            permission: PermissionTier::ReadOnly,
            timeout: Some(Duration::from_millis(5000)),
            task_id: Some("t-1".into()),
        };
        let json = serde_json::to_string(&req).unwrap();
        let back: SandboxRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(req.command, back.command);
        assert_eq!(req.permission, back.permission);
        assert_eq!(req.timeout, back.timeout);
    }

    #[test]
    fn runner_returns_unavailable_in_m014_1() {
        let runner = SandboxRunner::new();
        let req = SandboxRequest {
            command: vec!["true".into()],
            workdir: PathBuf::from("/tmp"),
            permission: PermissionTier::ReadOnly,
            timeout: None,
            task_id: None,
        };
        let err = runner.run(req).unwrap_err();
        assert!(matches!(err, crate::error::SandboxError::Unavailable));
    }
}
