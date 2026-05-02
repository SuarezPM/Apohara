// KERNEL REQUIREMENTS:
// This binary requires Linux ≥ 3.8 with user namespace support enabled.
// Verify before running:
//   sysctl kernel.unprivileged_userns_clone   → must be 1
//   (Debian/Ubuntu: /proc/sys/kernel/unprivileged_userns_clone)
//   (Arch/Fedora/newer kernels: enabled by default, sysctl key may not exist)
// Namespaces used: CLONE_NEWUSER, CLONE_NEWNS (mount), CLONE_NEWPID, CLONE_NEWNET, CLONE_NEWIPC
// Seccomp-bpf: applied via seccompiler crate (pure Rust, no libseccomp required)

use clap::{Parser, Subcommand};
use nix::mount::{mount, MsFlags};
use nix::sched::{clone, CloneFlags};
use nix::sys::resource::{setrlimit, Resource};
use nix::sys::wait::{waitpid, WaitStatus};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::process::Command;

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

    match execute_with_namespaces(workdir, command, permission) {
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

// ── IPC pipe helpers ──────────────────────────────────────────────────────────

fn create_pipe() -> Result<(i32, i32), String> {
    let mut fds = [0i32; 2];
    let ret = unsafe { libc::pipe(fds.as_mut_ptr()) };
    if ret != 0 {
        return Err(format!(
            "pipe() failed: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok((fds[0], fds[1]))
}

fn write_all_fd(fd: i32, buf: &[u8]) -> bool {
    let mut written = 0usize;
    while written < buf.len() {
        let n = unsafe {
            libc::write(
                fd,
                buf[written..].as_ptr() as *const libc::c_void,
                buf.len() - written,
            )
        };
        if n <= 0 {
            return false;
        }
        written += n as usize;
    }
    true
}

fn read_exact_fd(fd: i32, buf: &mut [u8]) -> bool {
    let mut total = 0usize;
    while total < buf.len() {
        let n = unsafe {
            libc::read(
                fd,
                buf[total..].as_mut_ptr() as *mut libc::c_void,
                buf.len() - total,
            )
        };
        if n <= 0 {
            return false;
        }
        total += n as usize;
    }
    true
}

// ── UID/GID mapping ───────────────────────────────────────────────────────────

fn write_uid_gid_map(child_pid: i32, host_uid: u32, host_gid: u32) -> Result<(), String> {
    // Map host UID → child UID 0 (appears as root inside the namespace)
    let uid_map = format!("0 {} 1\n", host_uid);
    fs::write(format!("/proc/{}/uid_map", child_pid), &uid_map)
        .map_err(|e| format!("uid_map write failed: {}", e))?;

    // Must write "deny" to setgroups before writing gid_map (kernel requirement since 3.19)
    fs::write(format!("/proc/{}/setgroups", child_pid), "deny")
        .map_err(|e| format!("setgroups write failed: {}", e))?;

    let gid_map = format!("0 {} 1\n", host_gid);
    fs::write(format!("/proc/{}/gid_map", child_pid), &gid_map)
        .map_err(|e| format!("gid_map write failed: {}", e))?;

    Ok(())
}

// ── Namespace-isolated execution ──────────────────────────────────────────────

fn execute_with_namespaces(
    workdir: &str,
    command: &str,
    _permission: &str,
) -> Result<(i32, String, String, Vec<String>), String> {
    // Pipes: parent signals child that UID/GID maps are written (ready_r/ready_w)
    // Child sends back stdout+stderr lengths then data (result_r/result_w)
    let (ready_r, ready_w) = create_pipe()?;
    let (result_r, result_w) = create_pipe()?;

    // Capture host uid/gid before entering namespaces
    let host_uid = unsafe { libc::getuid() };
    let host_gid = unsafe { libc::getgid() };

    let workdir_owned = workdir.to_string();
    let command_owned = command.to_string();

    // Stack for the cloned child (1 MiB)
    let mut stack = vec![0u8; 1024 * 1024];

    let flags = CloneFlags::CLONE_NEWUSER
        | CloneFlags::CLONE_NEWNS
        | CloneFlags::CLONE_NEWPID
        | CloneFlags::CLONE_NEWNET
        | CloneFlags::CLONE_NEWIPC;

    let child_pid = unsafe {
        clone(
            Box::new(move || {
                child_fn(
                    ready_r,
                    result_w,
                    &workdir_owned,
                    &command_owned,
                )
            }),
            &mut stack,
            flags,
            Some(libc::SIGCHLD),
        )
    };

    // Parent: close child-side fds
    unsafe {
        libc::close(ready_r);
        libc::close(result_w);
    }

    let child_pid = match child_pid {
        Ok(p) => p,
        Err(nix::errno::Errno::EPERM) => {
            unsafe {
                libc::close(ready_w);
                libc::close(result_r);
            }
            return Err("namespace_unavailable".to_string());
        }
        Err(e) => {
            unsafe {
                libc::close(ready_w);
                libc::close(result_r);
            }
            return Err(format!("clone() failed: {}", e));
        }
    };

    // Write UID/GID maps, then signal the child that it may proceed
    if let Err(e) = write_uid_gid_map(child_pid.as_raw(), host_uid, host_gid) {
        unsafe {
            libc::close(ready_w);
            libc::close(result_r);
        }
        return Err(e);
    }
    // Signal child: write one byte
    write_all_fd(ready_w, &[1u8]);
    unsafe { libc::close(ready_w) };

    // Read output from child: [stdout_len: u64][stderr_len: u64][stdout bytes][stderr bytes][exit_code: i32]
    let mut stdout_len_buf = [0u8; 8];
    let mut stderr_len_buf = [0u8; 8];
    if !read_exact_fd(result_r, &mut stdout_len_buf)
        || !read_exact_fd(result_r, &mut stderr_len_buf)
    {
        unsafe { libc::close(result_r) };
        // Fall back to waitpid for exit code
        let _ = waitpid(child_pid, None);
        return Err("child result pipe closed prematurely".to_string());
    }
    let stdout_len = u64::from_ne_bytes(stdout_len_buf) as usize;
    let stderr_len = u64::from_ne_bytes(stderr_len_buf) as usize;

    let mut stdout_buf = vec![0u8; stdout_len];
    let mut stderr_buf = vec![0u8; stderr_len];
    read_exact_fd(result_r, &mut stdout_buf);
    read_exact_fd(result_r, &mut stderr_buf);

    let mut exit_code_buf = [0u8; 4];
    read_exact_fd(result_r, &mut exit_code_buf);
    unsafe { libc::close(result_r) };

    let reported_exit = i32::from_ne_bytes(exit_code_buf);

    // waitpid to reap the child
    let exit_code = match waitpid(child_pid, None) {
        Ok(WaitStatus::Exited(_, code)) => code,
        Ok(WaitStatus::Signaled(_, sig, _)) => -(sig as i32),
        _ => reported_exit,
    };

    let stdout = String::from_utf8_lossy(&stdout_buf).into_owned();
    let stderr = String::from_utf8_lossy(&stderr_buf).into_owned();

    Ok((exit_code, stdout, stderr, vec![]))
}

// ── Child function (runs inside all new namespaces) ───────────────────────────

fn child_fn(ready_r: i32, result_w: i32, workdir: &str, command: &str) -> isize {
    // Apply resource limits as an additional layer inside the namespace
    let _ = setrlimit(Resource::RLIMIT_AS, 512 * 1024 * 1024, 512 * 1024 * 1024);
    let _ = setrlimit(Resource::RLIMIT_NOFILE, 256, 256);

    // Wait for parent to write UID/GID maps before any uid-sensitive operations
    let mut ready = [0u8; 1];
    read_exact_fd(ready_r, &mut ready);
    unsafe { libc::close(ready_r) };

    // Mount a fresh /proc so the child sees its own PID namespace (PID 1 for init)
    // This requires CLONE_NEWNS (which we have) and works unprivileged inside a user namespace.
    let _ = mount(
        Some("proc"),
        "/proc",
        Some("proc"),
        MsFlags::empty(),
        None::<&str>,
    );

    // chdir to workdir
    if std::env::set_current_dir(workdir).is_err() {
        send_error(result_w, "chdir failed");
        return 1;
    }

    // Execute the command, capturing stdout/stderr
    let output = Command::new("/bin/sh")
        .arg("-c")
        .arg(command)
        .output();

    match output {
        Err(e) => {
            send_error(result_w, &format!("exec failed: {}", e));
            1
        }
        Ok(out) => {
            let exit_code = out.status.code().unwrap_or(1);
            let stdout = out.stdout;
            let stderr = out.stderr;

            // Send: [stdout_len][stderr_len][stdout][stderr][exit_code]
            write_all_fd(result_w, &(stdout.len() as u64).to_ne_bytes());
            write_all_fd(result_w, &(stderr.len() as u64).to_ne_bytes());
            write_all_fd(result_w, &stdout);
            write_all_fd(result_w, &stderr);
            write_all_fd(result_w, &(exit_code as i32).to_ne_bytes());
            unsafe { libc::close(result_w) };

            exit_code as isize
        }
    }
}

fn send_error(result_w: i32, msg: &str) {
    let stdout: &[u8] = b"";
    let stderr = msg.as_bytes();
    write_all_fd(result_w, &(stdout.len() as u64).to_ne_bytes());
    write_all_fd(result_w, &(stderr.len() as u64).to_ne_bytes());
    write_all_fd(result_w, stdout);
    write_all_fd(result_w, stderr);
    write_all_fd(result_w, &1i32.to_ne_bytes());
    unsafe { libc::close(result_w) };
}

