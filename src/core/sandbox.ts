/**
 * Apohara Sandbox — Process isolation wrapper for test execution.
 * Wraps the apohara-sandbox Rust binary with seccomp-bpf + Linux namespaces.
 *
 * Sandbox confines ONLY:
 * - Test execution (bun test, vitest)
 * - Script execution (user-generated scripts)
 *
 * Outside sandbox (executed by Core):
 * - Code generation (file writing, diff staging)
 * - Dependency resolution (bun install)
 * - Git operations (git add, commit)
 * - Tool calling (API calls, file reads)
 */

import { spawn } from "../lib/spawn";
import { EventLedger } from "./ledger";
import type { EventSeverity } from "./types";

export type PermissionTier =
	| "readonly"
	| "workspace_write"
	| "danger_full_access";

export interface SandboxExecOptions {
	workdir: string;
	command: string;
	permission?: PermissionTier;
	timeout?: number; // milliseconds
	taskId?: string;
}

export interface SandboxViolation {
	syscall: string;
	path?: string;
}

export interface SandboxExecResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	violations: (SandboxViolation | string)[];
	durationMs: number;
	error?: string;
}

/**
 * Isolator: High-level sandbox execution interface.
 * Executes commands in isolated subprocess with resource limits.
 *
 * Integration point: Task execution (when agent requests code verification).
 */
export class Isolator {
	private sandboxBinaryPath: string;
	private ledger: EventLedger;

	constructor(sandboxBinaryPath?: string) {
		// Prefer an explicit path; otherwise auto-resolve (release first, then debug)
		// from the workspace target dir.
		if (sandboxBinaryPath) {
			this.sandboxBinaryPath = sandboxBinaryPath;
		} else {
			const release = "target/release/apohara-sandbox";
			const debug = "target/debug/apohara-sandbox";
			// Synchronous existsSync would simplify, but Bun.file().exists() is async.
			// Default to release; exec() will fall back to debug if release missing.
			this.sandboxBinaryPath = release;
		}
		this.ledger = new EventLedger();
	}

	/**
	 * Execute a command inside the sandbox.
	 *
	 * @param options - Execution options (workdir, command, permission tier)
	 * @returns Execution result (exit code, output, violations)
	 */
	public async exec(options: SandboxExecOptions): Promise<SandboxExecResult> {
		const {
			workdir,
			command,
			permission = "workspace_write",
			timeout = 120000,
			taskId,
		} = options;

		const startTime = Date.now();

		// Resolve the binary path with debug fallback
		let resolvedPath = this.sandboxBinaryPath;
		if (!(await Bun.file(resolvedPath).exists())) {
			const debugPath = resolvedPath.replace("/release/", "/debug/");
			if (debugPath !== resolvedPath && (await Bun.file(debugPath).exists())) {
				resolvedPath = debugPath;
			} else {
				return {
					exitCode: 1,
					stdout: "",
					stderr: `Sandbox binary not found at: ${this.sandboxBinaryPath}. Build with 'cargo build -p apohara-sandbox' (debug) or 'cargo build -p apohara-sandbox --release'.`,
					violations: [],
					durationMs: 0,
					error: "binary_not_found",
				};
			}
		}

		// Parse the command into argv. We accept either a single string (shell-style)
		// or pre-split arguments; for now we split on whitespace which is the existing
		// contract from the prior implementation.
		const commandArgv = command.trim().split(/\s+/);

		try {
			// New CLI signature: apohara-sandbox --workdir X --permission Y --timeout-ms N -- CMD ARGS
			const args = [
				resolvedPath,
				"--workdir",
				workdir,
				"--permission",
				permission,
			];
			if (timeout) {
				args.push("--timeout-ms", String(timeout));
			}
			if (taskId) {
				args.push("--task-id", taskId);
			}
			args.push("--", ...commandArgv);

			const proc = spawn(args, {
				stdout: "pipe",
				stderr: "pipe",
			});

			// Enforce timeout manually since SpawnOptions doesn't carry a timeout field
			const timeoutHandle = timeout
				? setTimeout(() => {
						try {
							(proc as unknown as { kill: () => void }).kill();
						} catch {}
					}, timeout)
				: null;

			const exitCode = await proc.exited;
			if (timeoutHandle) clearTimeout(timeoutHandle);
			const stdout = await proc.stdout.text();
			const stderr = await proc.stderr.text();

			const durationMs = Date.now() - startTime;

			// The Rust binary always prints a JSON result on stdout, even on non-zero
			// exit codes (it carries the child exit in result.exit_code separately).
			// Exit code 99 from the binary itself means "sandbox unavailable" — surface
			// it as a clear error rather than treating it as a child execution failure.
			if (stdout.trim()) {
				try {
					const result = JSON.parse(stdout);
					const execResult: SandboxExecResult = {
						exitCode: result.exit_code ?? exitCode,
						stdout: result.stdout ?? "",
						stderr: result.stderr ?? "",
						violations: result.violations ?? [],
						durationMs: result.duration_ms ?? durationMs,
						error:
							result.exit_code === 99 || result.violations?.includes("unavailable")
								? "sandbox_unavailable"
								: undefined,
					};

					await this.logExecution(taskId, execResult, permission);
					return execResult;
				} catch {
					return {
						exitCode: 1,
						stdout: "",
						stderr: `Failed to parse sandbox output: ${stdout}`,
						violations: [],
						durationMs,
						error: "parse_error",
					};
				}
			} else {
				return {
					exitCode,
					stdout: "",
					stderr: stderr || "Sandbox binary produced no output",
					violations: [],
					durationMs,
					error: "sandbox_error",
				};
			}
		} catch (err) {
			const durationMs = Date.now() - startTime;
			const errorMsg = err instanceof Error ? err.message : String(err);

			return {
				exitCode: 1,
				stdout: "",
				stderr: errorMsg,
				violations: [],
				durationMs,
				error: "execution_error",
			};
		}
	}

	/**
	 * Log sandbox execution to event ledger.
	 */
	private async logExecution(
		taskId: string | undefined,
		result: SandboxExecResult,
		permission: PermissionTier,
	): Promise<void> {
		const hasViolations = result.violations.length > 0;
		const severity: EventSeverity =
			result.error === "parse_error" || result.error === "execution_error"
				? "error"
				: hasViolations
					? "warning"
					: "info";

		// Normalize violations to structured form when possible
		const normalizedViolations = result.violations.map((v) => {
			if (typeof v === "object" && v !== null && "syscall" in v) {
				return v as SandboxViolation;
			}
			// Legacy string entry — wrap as structured with no path
			return { syscall: String(v) } satisfies SandboxViolation;
		});

		await this.ledger.log(
			"sandbox_execution",
			{
				exitCode: result.exitCode,
				violations: normalizedViolations,
				permission,
				durationMs: result.durationMs,
				hasError: !!result.error,
				violationCount: result.violations.length,
			},
			severity,
			taskId,
		);
	}

	/**
	 * Get ledger file path for this Isolator instance.
	 */
	public getEventLedgerPath(): string {
		return this.ledger.getFilePath();
	}
}
