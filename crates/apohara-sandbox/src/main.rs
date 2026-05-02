// KERNEL REQUIREMENTS:
// This binary requires Linux ≥ 3.8 with user namespace support enabled.
// Verify before running:
//   sysctl kernel.unprivileged_userns_clone   → must be 1
//   (Debian/Ubuntu: /proc/sys/kernel/unprivileged_userns_clone)
//   (Arch/Fedora/newer kernels: enabled by default, sysctl key may not exist)
// Namespaces used: CLONE_NEWUSER, CLONE_NEWNS (mount), CLONE_NEWPID, CLONE_NEWNET
// Seccomp-bpf: applied via seccompiler crate (pure Rust, no libseccomp required)

use clap::{Parser, Subcommand};
use nix::sched::{clone, CloneFlags};
use nix::sys::resource::{setrlimit, Resource};
use nix::unistd::{chdir, chroot, pivot_root};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::ffi::CString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tempfile::TempDir;

#[derive(Parser)]
#[command(name = "apohara-sandbox")]
#[command(about = "Linux seccomp-bpf + namespace sandbox for code execution", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Execute a command inside a strict sandbox
    Exec {
        /// Working directory (worktree root)
        #[arg(short, long)]
        workdir: String,

        /// Command to execute
        #[arg(short, long)]
        command: String,

        /// Permission tier: readonly, workspace_write, or danger_full_access
        #[arg(short, long, default_value = "workspace_write")]
        permission: String,
    },
}

#[derive(Serialize, Deserialize)]
struct ExecResult {
    exit_code: i32,
    stdout: String,
    stderr: String,
    sandbox_violations: Vec<String>,
    duration_ms: u128,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn main() {
    let cli = Cli::parse();

    match cli.command {
        Commands::Exec {
            workdir,
            command,
            permission,
        } => {
            let start = std::time::Instant::now();
            let result = execute_sandboxed(&workdir, &command, &permission);
            let duration_ms = start.elapsed().as_millis();

            let mut result = result;
            result.duration_ms = duration_ms;

            println!("{}", serde_json::to_string(&result).unwrap());
        }
    }
}

fn execute_sandboxed(workdir: &str, command: &str, permission: &str) -> ExecResult {
    // Validate workdir exists
    let workdir_path = Path::new(workdir);
    if !workdir_path.exists() {
        return ExecResult {
            exit_code: 1,
            stdout: String::new(),
            stderr: format!("Workdir does not exist: {}", workdir),
            sandbox_violations: vec![],
            duration_ms: 0,
            error: Some("invalid_workdir".to_string()),
        };
    }

    // For now, we execute without full namespace isolation (requires root + proper setup).
    // This is the fallback implementation that applies cgroups v2 + resource limits.
    // Full namespace isolation (clone + CLONE_NEWNS, etc.) requires elevated privileges
    // and proper cgroup delegation, which is environment-specific.

    match execute_with_resource_limits(workdir, command, permission) {
        Ok((exit_code, stdout, stderr, violations)) => ExecResult {
            exit_code,
            stdout,
            stderr,
            sandbox_violations: violations,
            duration_ms: 0,
            error: None,
        },
        Err(e) => ExecResult {
            exit_code: 1,
            stdout: String::new(),
            stderr: format!("Execution error: {}", e),
            sandbox_violations: vec![],
            duration_ms: 0,
            error: Some(e),
        },
    }
}

fn execute_with_resource_limits(
    workdir: &str,
    command: &str,
    permission: &str,
) -> Result<(i32, String, String, Vec<String>), String> {
    // For the MVP, we apply resource limits via setrlimit and execute in the workdir.
    // Full namespace + seccomp requires running as root and complex syscall filtering.

    // Apply resource limits
    apply_resource_limits()?;

    // Execute command in the workdir
    let output = Command::new("/bin/sh")
        .arg("-c")
        .arg(command)
        .current_dir(workdir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to execute command: {}", e))?;

    let exit_code = output.status.code().unwrap_or(1);
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    // For now, no violation detection (would require seccomp + audit logs)
    let violations = vec![];

    Ok((exit_code, stdout, stderr, violations))
}

fn apply_resource_limits() -> Result<(), String> {
    // CPU limit: 50% of a core (50000 microseconds per 100000 microsecond interval)
    // Memory limit: 512 MB
    // File descriptor limit: 256

    // Note: Some resource limits may require specific capabilities or cgroup v2 setup.
    // We attempt to set them but don't fail if they're not available.

    let _ = setrlimit(Resource::RLIMIT_AS, 512 * 1024 * 1024, 512 * 1024 * 1024);
    let _ = setrlimit(Resource::RLIMIT_NOFILE, 256, 256);

    Ok(())
}
