# M014.2 — Seccomp profile research notes (partial)

**Source:** MiniMax 2.7, 2m 52s research, dispatched 2026-05-12. Full original
output exceeded the tmux pane buffer (set to 50 lines pre-session). What
survives in this doc is the tail of the response — the seccompiler code
sketch and "common mistakes" section. The per-syscall allowlist per tier
scrolled out of the buffer and would need to be re-prompted.

**Action for next session:** re-dispatch the research with tmux history-limit
set to ≥ 5000 BEFORE the prompt is sent, so the full per-tier syscall list
is captured.

---

## Seccompiler Rust skeleton (recovered from pane tail)

```rust
// Tier 1: ReadOnly
let readonly_rules = vec![
    // openat: only O_RDONLY + stable flags
    SeccompRule::new(
        vec![
            SeccompCondition::arg(1, SeccompCompare::Ne, libc::O_WRONLY as u64),
            SeccompCondition::arg(1, SeccompCompare::Ne, libc::O_RDWR as u64),
            SeccompCondition::arg(
                1,
                SeccompCompare::Ne,
                (libc::O_CREAT | libc::O_TRUNC) as u64,
            ),
        ],
        "openat",
    ).unwrap(),

    // write: fd > 2 (not stdin/stdout) — for ReadOnly only stderr-style
    // diagnostics are allowed; binary outputs go through allowed pipe fds.
    SeccompRule::new(
        vec![
            SeccompCondition::arg(0, SeccompCompare::Gt, 2u64),
        ],
        "write",
    ).unwrap(),

    // ... rest of allowlist (read, pread64, fstat, newfstatat, statx,
    //     close, lseek, mmap, munmap, brk, mprotect, rt_sigprocmask,
    //     rt_sigaction, exit, exit_group, clock_gettime, getpid,
    //     gettid, getppid, getrandom, prctl, etc.)
];

let filter = SeccompFilter::new(
    readonly_rules,
    SeccompAction::KillProcess, // fail-closed default
    Architecture::from("x86_64").unwrap(),
).unwrap();
```

## Workspace-Write additions (from pane mid-stream, before it scrolled)

The middle of the response mentioned these as WORKSPACE_WRITE-only syscalls:
- `mkdirat` — create directories within workdir
- `linkat` — hard link within workdir
- `symlinkat` — create symlink within workdir
- `renameat`, `renameat2` — rename within workdir
- `unlinkat` — delete file or empty directory
- `ftruncate` — truncate file (conditional)
- `truncate` — truncate by path (conditional)
- `chmod` — change mode within workdir
- `fchmodat` — fchmodat variant
- `utimensat`, `futimens` — change timestamps
- `fcntl` — add `F_SETFL` with `O_WRONLY|O_CREAT|O_TRUNC`

The path-confinement enforcement (within workdir) cannot be done purely in
seccomp-bpf — seccomp can only see syscall args, not resolved paths. The
workdir confinement comes from the mount namespace (M014.3), not seccomp.

## Common mistakes to avoid (recovered from pane tail)

1. **Allowing `execve` / `execveat` in any tier** — even with a binary
   allowlist, the allowlist itself can be escaped if the LLM can write to
   a whitelisted path's contents (drop in a malicious binary at the
   allowlisted name).
2. **Forgetting `clock_gettime64` / `clock_settime64`** — `clock_gettime` is
   the 32-bit compat call; `clock_gettime64` is the 64-bit native call.
   Both must be allowed on x86_64 if 32-bit binaries can be invoked via
   compat mode.
3. **Allowing `ptrace`** — even `PTRACE_TRACEME` in a sandbox is dangerous
   because `ptrace(PTRACE_PEEKTEXT, ...)` reads process memory. Block
   unconditionally.
4. **Allowing `eventfd`** — combined with fork, useful for covert
   signaling between processes. Block unconditionally.
5. **Conditional flag checks with `&` instead of exact comparison** — use
   `SeccompCompare::Eq` for flag equality, not mask-and-compare, because
   `O_RDONLY` equals 0 and any mask-based approach breaks for it.

## Architectural caveat

Path confinement (e.g., "writes only within /work/lane-3/") cannot be
enforced in seccomp-bpf because BPF programs only see syscall arguments,
not resolved kernel paths. The intended layered defense:

- **seccomp (M014.2)**: gate which syscalls can run at all.
- **mount namespace (M014.3)**: gate where the syscalls can reach. Each
  worktree gets its own private mount namespace pivoted to that directory.
- **PID namespace (M014.3)**: gate which processes are visible — sandboxed
  agents see only their own PID tree.

Together: a `write()` syscall is allowed (seccomp), but it can only
target paths inside the agent's pivoted mount namespace, and `kill(other_pid)`
fails because the agent can't see the host's PID space.

## Next steps for M014.2 implementation

1. Hard-code the ReadOnly allowlist as `pub const READONLY_SYSCALLS: &[&str]`
   in `src/profile/linux.rs`.
2. Build `SeccompFilter` in `LinuxProfile::install()` using `seccompiler::apply_filter`.
3. Unit test: spawn child, install filter, attempt blocked syscall, assert
   EPERM (or SIGKILL via KillProcess default).
4. Add `arch_detect()` helper — currently x86_64-only; M014.6 adds aarch64.
5. Re-prompt MiniMax for the **full per-tier syscall list** with bigger
   tmux history buffer.
