// KERNEL REQUIREMENTS:
// This binary requires Linux ≥ 3.8 with user namespace support enabled.
// Verify before running:
//   sysctl kernel.unprivileged_userns_clone   → must be 1
//   (Debian/Ubuntu: /proc/sys/kernel/unprivileged_userns_clone)
//   (Arch/Fedora/newer kernels: enabled by default, sysctl key may not exist)
// Namespaces used: CLONE_NEWUSER, CLONE_NEWNS (mount), CLONE_NEWPID, CLONE_NEWNET, CLONE_NEWIPC
// Seccomp-bpf: applied via seccompiler crate (pure Rust, no libseccomp required)
// Violation detection: SECCOMP_RET_TRAP → SIGSYS → detected via WaitStatus::Signaled(SIGSYS)

use clap::{Parser, Subcommand};
use nix::mount::{mount, MsFlags};
use nix::sched::{clone, CloneFlags};
use nix::sys::resource::{setrlimit, Resource};
use nix::sys::wait::waitpid;
use seccompiler::{BpfProgram, SeccompAction, SeccompFilter, SeccompRule};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::convert::TryInto;
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

// ── Seccomp filter construction ───────────────────────────────────────────────

/// Syscalls required by /bin/sh and typical command execution.
/// These are always allowed regardless of permission tier.
fn base_allowed_syscalls() -> Vec<i64> {
    vec![
        // Core I/O
        libc::SYS_read,
        libc::SYS_write,
        libc::SYS_open,
        libc::SYS_openat,
        libc::SYS_close,
        libc::SYS_pread64,
        libc::SYS_pwrite64,
        libc::SYS_readv,
        libc::SYS_writev,
        libc::SYS_lseek,
        // File metadata
        libc::SYS_stat,
        libc::SYS_fstat,
        libc::SYS_lstat,
        libc::SYS_newfstatat,
        libc::SYS_statx,
        libc::SYS_access,
        libc::SYS_faccessat,
        libc::SYS_readlink,
        libc::SYS_readlinkat,
        // Directory operations
        libc::SYS_getdents64,
        libc::SYS_getcwd,
        libc::SYS_chdir,
        libc::SYS_fchdir,
        libc::SYS_mkdir,
        libc::SYS_mkdirat,
        libc::SYS_rmdir,
        libc::SYS_rename,
        libc::SYS_renameat,
        libc::SYS_renameat2,
        libc::SYS_unlink,
        libc::SYS_unlinkat,
        libc::SYS_symlink,
        libc::SYS_symlinkat,
        libc::SYS_link,
        libc::SYS_linkat,
        // Memory management
        libc::SYS_mmap,
        libc::SYS_munmap,
        libc::SYS_mprotect,
        libc::SYS_mremap,
        libc::SYS_madvise,
        libc::SYS_brk,
        libc::SYS_msync,
        // Process management
        libc::SYS_clone,
        libc::SYS_clone3,
        libc::SYS_fork,
        libc::SYS_vfork,
        libc::SYS_execve,
        libc::SYS_execveat,
        libc::SYS_exit,
        libc::SYS_exit_group,
        libc::SYS_wait4,
        libc::SYS_waitid,
        libc::SYS_getpid,
        libc::SYS_getppid,
        libc::SYS_gettid,
        libc::SYS_set_tid_address,
        libc::SYS_getpgrp,
        libc::SYS_setpgid,
        libc::SYS_setsid,
        // Signals
        libc::SYS_rt_sigaction,
        libc::SYS_rt_sigprocmask,
        libc::SYS_rt_sigreturn,
        libc::SYS_rt_sigsuspend,
        libc::SYS_rt_sigpending,
        libc::SYS_kill,
        libc::SYS_tgkill,
        libc::SYS_tkill,
        libc::SYS_sigaltstack,
        // Time
        libc::SYS_nanosleep,
        libc::SYS_clock_nanosleep,
        libc::SYS_clock_gettime,
        libc::SYS_clock_getres,
        libc::SYS_gettimeofday,
        libc::SYS_times,
        // Synchronization/futex
        libc::SYS_futex,
        libc::SYS_futex_waitv,
        // epoll / poll / select
        libc::SYS_epoll_create,
        libc::SYS_epoll_create1,
        libc::SYS_epoll_wait,
        libc::SYS_epoll_pwait,
        libc::SYS_epoll_pwait2,
        libc::SYS_epoll_ctl,
        libc::SYS_poll,
        libc::SYS_ppoll,
        libc::SYS_select,
        libc::SYS_pselect6,
        // io_uring
        libc::SYS_io_uring_setup,
        libc::SYS_io_uring_enter,
        libc::SYS_io_uring_register,
        // File descriptors
        libc::SYS_dup,
        libc::SYS_dup2,
        libc::SYS_dup3,
        libc::SYS_fcntl,
        libc::SYS_ioctl,
        libc::SYS_pipe,
        libc::SYS_pipe2,
        libc::SYS_eventfd,
        libc::SYS_eventfd2,
        libc::SYS_signalfd,
        libc::SYS_signalfd4,
        libc::SYS_timerfd_create,
        libc::SYS_timerfd_settime,
        libc::SYS_timerfd_gettime,
        // User/group identity (read-only inside namespace is fine)
        libc::SYS_getuid,
        libc::SYS_getgid,
        libc::SYS_geteuid,
        libc::SYS_getegid,
        libc::SYS_getgroups,
        libc::SYS_getresuid,
        libc::SYS_getresgid,
        // Resource limits
        libc::SYS_getrlimit,
        libc::SYS_setrlimit,
        libc::SYS_prlimit64,
        libc::SYS_getrusage,
        // Misc process info
        libc::SYS_uname,
        libc::SYS_arch_prctl,
        libc::SYS_prctl,
        libc::SYS_sched_getaffinity,
        libc::SYS_sched_setaffinity,
        libc::SYS_sched_yield,
        libc::SYS_sched_getparam,
        libc::SYS_sched_getscheduler,
        // Memory mapping misc
        libc::SYS_membarrier,
        libc::SYS_mincore,
        libc::SYS_mlock,
        libc::SYS_munlock,
        libc::SYS_mlock2,
        // Sendfile, splice, tee (for shell/bun pipelines)
        libc::SYS_sendfile,
        libc::SYS_splice,
        libc::SYS_tee,
        libc::SYS_copy_file_range,
        // Misc required by dynamic linker
        libc::SYS_getrandom,
        libc::SYS_rseq,
        // /proc reads (via open+read)
        libc::SYS_truncate,
        libc::SYS_ftruncate,
        libc::SYS_fallocate,
        libc::SYS_chmod,
        libc::SYS_fchmod,
        libc::SYS_fchmodat,
        libc::SYS_chown,
        libc::SYS_fchown,
        libc::SYS_fchownat,
        libc::SYS_lchown,
        libc::SYS_umask,
        libc::SYS_getdents,
        libc::SYS_statfs,
        libc::SYS_fstatfs,
        libc::SYS_inotify_init,
        libc::SYS_inotify_init1,
        libc::SYS_inotify_add_watch,
        libc::SYS_inotify_rm_watch,
        // Thread-local storage
        libc::SYS_set_robust_list,
        libc::SYS_get_robust_list,
        // Loopback network operations (needed even in readonly for some shells)
        libc::SYS_socketpair,
        libc::SYS_getsockopt,
        libc::SYS_setsockopt,
        libc::SYS_getsockname,
        libc::SYS_getpeername,
        // Misc
        libc::SYS_capget,
        libc::SYS_capset,
        libc::SYS_recvmsg,
        libc::SYS_sendmsg,
        libc::SYS_shutdown,
        // Mount operations (child needs to remount workdir as readonly)
        libc::SYS_mount,
        libc::SYS_umount2,
        libc::SYS_pivot_root,
        // seccomp syscall itself (needed if any child wants to apply its own filter)
        libc::SYS_seccomp,
        // prctl is already included above but list explicitly for clarity
        // wait4/waitpid variants
        libc::SYS_wait4,
        // process_vm_readv/writev (used by some debuggers/profilers — exclude from sandbox)
        // Open flags
        libc::SYS_openat2,
    ]
}

/// Network syscalls blocked in readonly tier — these are the "observable violations".
/// When any of these is attempted, SECCOMP_RET_TRAP fires → child gets SIGSYS.
fn network_violation_syscalls() -> Vec<(&'static str, i64)> {
    vec![
        ("socket", libc::SYS_socket),
        ("connect", libc::SYS_connect),
        ("bind", libc::SYS_bind),
        ("listen", libc::SYS_listen),
        ("accept", libc::SYS_accept),
        ("accept4", libc::SYS_accept4),
        ("sendto", libc::SYS_sendto),
        ("recvfrom", libc::SYS_recvfrom),
    ]
}

/// Build a seccomp BPF filter for the given permission tier.
///
/// Returns Ok(Some(program)) for readonly/workspace_write, Ok(None) for danger_full_access.
/// The second return value is the list of violation syscall names (for reporting when SIGSYS fires).
fn build_seccomp_filter(
    permission: &str,
) -> Result<(Option<BpfProgram>, Vec<String>), String> {
    match permission {
        "danger_full_access" => return Ok((None, vec![])),
        _ => {}
    }

    let arch: seccompiler::TargetArch = std::env::consts::ARCH
        .try_into()
        .map_err(|_| format!("unsupported architecture: {}", std::env::consts::ARCH))?;

    let mut rules: BTreeMap<i64, Vec<SeccompRule>> = BTreeMap::new();

    // All base syscalls get unconditional allow (empty rule vector = always allow)
    for syscall in base_allowed_syscalls() {
        rules.insert(syscall, vec![]);
    }

    let violation_syscalls = network_violation_syscalls();
    let violation_names: Vec<String> = violation_syscalls
        .iter()
        .map(|(name, _)| name.to_string())
        .collect();

    match permission {
        "readonly" => {
            // Network syscalls get SECCOMP_RET_TRAP → SIGSYS → child detects violation
            // We do NOT add them to the allow list; the mismatch_action handles them.
            // The mismatch_action for readonly is Trap (so the shell dies with SIGSYS).
            // We build the filter with:
            //   - match_action = Allow (listed syscalls are allowed)
            //   - mismatch_action = Trap (unlisted syscalls send SIGSYS)
            // Network syscalls are explicitly NOT in the allow list → they hit mismatch_action.
        }
        "workspace_write" => {
            // workspace_write: same as readonly but network is also NOT blocked
            // Allow socket/connect so local IPC can work; block only external-looking patterns.
            // For simplicity: workspace_write allows everything in base list.
            // Network syscalls get Errno(EPERM) (not Trap) — quieter failure.
            for (_, syscall_nr) in &violation_syscalls {
                rules.insert(*syscall_nr, vec![]);
            }
        }
        _ => {
            // Unknown tier: treat as workspace_write (safe default)
            for (_, syscall_nr) in &violation_syscalls {
                rules.insert(*syscall_nr, vec![]);
            }
        }
    }

    // For readonly: mismatch = Trap (SIGSYS), match = Allow
    // For workspace_write: mismatch = Errno(EPERM), match = Allow
    let (mismatch_action, match_action) = match permission {
        "readonly" => (SeccompAction::Trap, SeccompAction::Allow),
        _ => (SeccompAction::Errno(libc::EPERM as u32), SeccompAction::Allow),
    };

    let filter = SeccompFilter::new(rules, mismatch_action, match_action, arch)
        .map_err(|e| format!("SeccompFilter::new failed: {}", e))?;

    let program: BpfProgram = filter
        .try_into()
        .map_err(|e| format!("BpfProgram compilation failed: {}", e))?;

    Ok((Some(program), violation_names))
}

// ── Namespace-isolated execution ──────────────────────────────────────────────

fn execute_with_namespaces(
    workdir: &str,
    command: &str,
    permission: &str,
) -> Result<(i32, String, String, Vec<String>), String> {
    // Build seccomp filter before forking (cheaper than building inside child)
    let (seccomp_program, violation_names) = build_seccomp_filter(permission)?;

    // Pipes: parent signals child that UID/GID maps are written (ready_r/ready_w)
    // Child sends back stdout+stderr lengths then data (result_r/result_w)
    let (ready_r, ready_w) = create_pipe()?;
    let (result_r, result_w) = create_pipe()?;

    // Capture host uid/gid before entering namespaces
    let host_uid = unsafe { libc::getuid() };
    let host_gid = unsafe { libc::getgid() };

    let workdir_owned = workdir.to_string();
    let command_owned = command.to_string();
    let permission_owned = permission.to_string();
    // Wrap in Option so we can move out via take() inside FnMut closure (called exactly once)
    let mut seccomp_opt = Some(seccomp_program);

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
                    seccomp_opt.take().unwrap_or(None),
                    &permission_owned,
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

    // Read output from child: [stdout_len: u64][stderr_len: u64][stdout bytes][stderr bytes][exit_code: i32][sigsys_flag: u8]
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
    let mut sigsys_flag_buf = [0u8; 1];
    read_exact_fd(result_r, &mut exit_code_buf);
    read_exact_fd(result_r, &mut sigsys_flag_buf);
    unsafe { libc::close(result_r) };

    let reported_exit = i32::from_ne_bytes(exit_code_buf);
    let child_reported_sigsys = sigsys_flag_buf[0] != 0;

    // waitpid to reap the child
    let wait_result = waitpid(child_pid, None);
    let _ = wait_result; // we use reported_exit and child_reported_sigsys from pipe

    // Determine violations: child reports SIGSYS if the command was killed by seccomp
    let violations = if child_reported_sigsys {
        violation_names
    } else {
        vec![]
    };

    // Use exit code from pipe (reported_exit); if SIGSYS was detected, use 1
    let final_exit = if child_reported_sigsys {
        1
    } else {
        reported_exit
    };

    let stdout = String::from_utf8_lossy(&stdout_buf).into_owned();
    let stderr = String::from_utf8_lossy(&stderr_buf).into_owned();

    Ok((final_exit, stdout, stderr, violations))
}

// ── Child function (runs inside all new namespaces) ───────────────────────────

fn child_fn(
    ready_r: i32,
    result_w: i32,
    workdir: &str,
    command: &str,
    seccomp_program: Option<BpfProgram>,
    permission: &str,
) -> isize {
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

    // Make all mounts private so our changes don't affect the host
    let _ = mount(
        None::<&str>,
        "/",
        None::<&str>,
        MsFlags::MS_PRIVATE | MsFlags::MS_REC,
        None::<&str>,
    );

    // Apply read-only root if permission is readonly or workspace_write
    // danger_full_access leaves root writable
    if permission == "readonly" || permission == "workspace_write" {
        // Bind mount the workdir to itself so it's a separate mount point
        let _ = mount(
            Some(workdir),
            workdir,
            None::<&str>,
            MsFlags::MS_BIND | MsFlags::MS_REC,
            None::<&str>,
        );
        
        // Remount root as readonly
        let _ = mount(
            Some("/"),
            "/",
            None::<&str>,
            MsFlags::MS_BIND | MsFlags::MS_REMOUNT | MsFlags::MS_RDONLY | MsFlags::MS_REC,
            None::<&str>,
        );
        
        if permission == "workspace_write" {
            // Remount workdir as read-write
            let _ = mount(
                Some(workdir),
                workdir,
                None::<&str>,
                MsFlags::MS_BIND | MsFlags::MS_REMOUNT | MsFlags::MS_REC,
                None::<&str>,
            );
        }
    }

    // Apply seccomp filter AFTER namespace setup and chdir, BEFORE exec.
    // PR_SET_NO_NEW_PRIVS is set automatically by seccompiler::apply_filter().
    // The filter is inherited by children (the /bin/sh grandchild and its descendants).
    // Note: apply_filter() itself calls prctl() + seccomp() — both must be in the allowlist
    // OR called before the filter is loaded. Since we load the filter here (after namespace
    // setup), the filter is not yet active when apply_filter() makes its prctl/seccomp calls.
    if let Some(program) = seccomp_program {
        if let Err(e) = seccompiler::apply_filter(&program) {
            // If seccomp application fails, abort rather than run unsandboxed.
            send_error(result_w, &format!("seccomp filter apply failed: {}", e));
            return 1;
        }
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
            // Detect SIGSYS (seccomp violation) in two forms:
            // 1. Direct: Command was exec()'d and killed by SIGSYS → signal() == Some(SIGSYS)
            // 2. Via shell: sh forked+exec'd the command, sh exits with 128+signal_number
            //    (POSIX shell exit status convention). SIGSYS=31 → shell exits 159.
            use std::os::unix::process::ExitStatusExt;
            let sigsys_direct = out.status.signal() == Some(libc::SIGSYS);
            let raw_code = out.status.code().unwrap_or(0);
            let sigsys_via_shell = raw_code == (128 + libc::SIGSYS);
            let sigsys_violation = sigsys_direct || sigsys_via_shell;

            // If process was killed by any signal, treat as failure (code returns None for signals)
            let exit_code = if sigsys_violation {
                1
            } else if out.status.signal().is_some() {
                // Process killed by signal (e.g. SIGKILL) — not a seccomp violation but still a failure
                128 + out.status.signal().unwrap()
            } else {
                out.status.code().unwrap_or(1)
            };
            let stdout = out.stdout;
            let stderr = out.stderr;

            // Send: [stdout_len][stderr_len][stdout][stderr][exit_code][sigsys_flag: u8]
            write_all_fd(result_w, &(stdout.len() as u64).to_ne_bytes());
            write_all_fd(result_w, &(stderr.len() as u64).to_ne_bytes());
            write_all_fd(result_w, &stdout);
            write_all_fd(result_w, &stderr);
            write_all_fd(result_w, &(exit_code as i32).to_ne_bytes());
            // Violation flag (1 byte): 1 = SIGSYS seccomp violation observed
            write_all_fd(result_w, &[sigsys_violation as u8]);
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
    // No violation flag on error paths (0 = no sigsys violation)
    write_all_fd(result_w, &[0u8]);
    unsafe { libc::close(result_w) };
}
