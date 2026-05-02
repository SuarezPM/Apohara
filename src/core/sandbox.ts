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

export type PermissionTier = "readonly" | "workspace_write" | "danger_full_access";

export interface SandboxExecOptions {
  workdir: string;
  command: string;
  permission?: PermissionTier;
  timeout?: number; // milliseconds
  taskId?: string;
}

export interface SandboxExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  violations: string[];
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

  constructor(sandboxBinaryPath = "target/release/apohara-sandbox") {
    this.sandboxBinaryPath = sandboxBinaryPath;
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

    try {
      // Invoke the Rust sandbox binary
      const proc = spawn(
        [
          this.sandboxBinaryPath,
          "exec",
          "--workdir",
          workdir,
          "--command",
          command,
          "--permission",
          permission,
        ],
        {
          stdout: "pipe",
          stderr: "pipe",
          timeout,
        }
      );

      const exitCode = await proc.exited;
      const stdout = await proc.stdout.text();
      const stderr = await proc.stderr.text();

      const durationMs = Date.now() - startTime;

      if (exitCode === 0 && stdout.trim()) {
        // Parse JSON result from Rust binary
        try {
          const result = JSON.parse(stdout);
          const execResult: SandboxExecResult = {
            exitCode: result.exit_code,
            stdout: result.stdout,
            stderr: result.stderr,
            violations: result.sandbox_violations || [],
            durationMs: result.duration_ms || durationMs,
            error: result.error,
          };

          // Log to event ledger
          await this.logExecution(taskId, execResult, permission);

          return execResult;
        } catch (e) {
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
        // Binary execution failed
        return {
          exitCode: exitCode,
          stdout: "",
          stderr: stderr || "Sandbox binary failed",
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
    permission: PermissionTier
  ): Promise<void> {
    const severity: EventSeverity =
      result.exitCode === 0 ? "info" : "warning";

    await this.ledger.log(
      "sandbox_execution",
      {
        exitCode: result.exitCode,
        violations: result.violations,
        permission,
        durationMs: result.durationMs,
        hasError: !!result.error,
      },
      severity,
      taskId,
      {
        sandboxPermission: permission,
        sandboxViolations: result.violations.length,
        sandboxDurationMs: result.durationMs,
      }
    );
  }

  /**
   * Get ledger file path for this Isolator instance.
   */
  public getEventLedgerPath(): string {
    return this.ledger.getFilePath();
  }
}
