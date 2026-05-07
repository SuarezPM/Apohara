import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "../lib/spawn";
import { EventLedger } from "./ledger";
import type { OrchestratorState } from "./types";

export interface ConsolidationResult {
	branch: string;
	successfulWorktrees: string[];
	failedWorktrees: string[];
	exitCode: number;
	summaryPath?: string;
}

export interface ConsolidatorConfig {
	worktreeBaseDir?: string;
	stateFilePath?: string;
	cwd?: string;
}

/**
 * Consolidation Engine orchestrates the final phase of apohara auto:
 * - Creates a branch for the run
 * - Consolidates changes from successful worktrees
 * - Generates a summary markdown
 * - Returns differentiated exit codes
 */
export class Consolidator {
	private ledger: EventLedger;
	private config: ConsolidatorConfig;
	private worktreesDir: string;
	private stateFilePath: string;

	constructor(config?: ConsolidatorConfig, ledger?: EventLedger) {
		this.ledger = ledger || new EventLedger();
		this.config = config || {};
		this.worktreesDir = this.config.worktreeBaseDir || ".apohara/worktrees";
		this.stateFilePath = this.config.stateFilePath || ".apohara/state.json";
	}

	/**
	 * Runs the full consolidation cycle:
	 * 1. Loads state to determine successful/failed worktrees
	 * 2. Creates a branch for this run
	 * 3. Merges successful worktree changes
	 * 4. Generates summary markdown
	 * 5. Returns exit code based on results
	 */
	public async run(): Promise<ConsolidationResult> {
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const branchName = `apohara/run-${timestamp}`;

		await this.ledger.log(
			"consolidation_started",
			{ branchName, timestamp },
			"info",
		);

		// Step 1: Load state to find successful worktrees
		const state = this.loadState();
		const taskResults = this.analyzeTaskResults(state);

		// Step 2: Create branch from main
		const branchCreated = await this.createBranch(branchName);
		if (!branchCreated) {
			await this.ledger.log("branch_creation_failed", { branchName }, "error");
			return {
				branch: branchName,
				successfulWorktrees: [],
				failedWorktrees: taskResults.failed,
				exitCode: 1,
			};
		}

		await this.ledger.log("branch_created", { branchName }, "info");

		// Step 3: Merge changes from successful worktrees
		const merged = await this.mergeSuccessfulWorktrees(
			branchName,
			taskResults.successful,
		);

		// Step 4: Generate summary markdown
		const summaryPath = await this.generateSummary({
			branchName,
			timestamp,
			successful: taskResults.successful,
			failed: taskResults.failed,
			allTasks: state.tasks,
			mergeStatus: merged ? "success" : "partial",
		});

		// Step 5: Determine exit code and log final event
		const exitCode = this.calculateExitCode(taskResults, merged);

		await this.ledger.log(
			"consolidation_completed",
			{
				branchName,
				exitCode,
				summaryPath,
				successfulCount: taskResults.successful.length,
				failedCount: taskResults.failed.length,
			},
			exitCode === 0 ? "info" : "warning",
		);

		return {
			branch: branchName,
			successfulWorktrees: taskResults.successful,
			failedWorktrees: taskResults.failed,
			exitCode,
			summaryPath,
		};
	}

	/**
	 * Loads the orchestrator state from disk.
	 */
	private loadState(): OrchestratorState {
		try {
			if (existsSync(this.stateFilePath)) {
				const data = readFileSync(this.stateFilePath, "utf-8");
				return JSON.parse(data) as OrchestratorState;
			}
		} catch {
			// Return empty state if file doesn't exist or is invalid
		}
		return {
			currentTaskId: null,
			tasks: [],
			status: "idle",
			failedProviderTimestamps: {},
		};
	}

	/**
	 * Analyzes task results from state to determine successful vs failed.
	 */
	private analyzeTaskResults(state: OrchestratorState): {
		successful: string[];
		failed: string[];
	} {
		const successful: string[] = [];
		const failed: string[] = [];

		// Check which worktrees have completed successfully
		// Worktrees are named lane-0, lane-1, etc.
		const worktreeDirs = this.listWorktreeDirectories();

		for (const worktree of worktreeDirs) {
			// Look for tasks that completed in this worktree
			// The state tracks tasks by their status
			const worktreeTask = state.tasks.find((t) => {
				// A worktree is considered successful if its task completed
				// We use the worktree ID as a proxy
				return (
					t.id.includes(worktree.replace("lane-", "")) &&
					t.status === "completed"
				);
			});

			if (worktreeTask) {
				successful.push(worktree);
			} else {
				// Check if there are any failed tasks
				const failedTask = state.tasks.find((t) => t.status === "failed");
				if (failedTask) {
					// Only add to failed if we've seen actual failures
					if (!failed.includes(worktree)) {
						failed.push(worktree);
					}
				} else if (
					state.tasks.length > 0 &&
					state.tasks.every((t) => t.status === "completed")
				) {
					// All tasks completed, worktree is successful
					successful.push(worktree);
				}
			}
		}

		// If worktrees directory is empty or doesn't exist, assume partial success
		// based on task status
		if (worktreeDirs.length === 0 && state.tasks.length > 0) {
			const completedTasks = state.tasks.filter(
				(t) => t.status === "completed",
			);
			const failedTasks = state.tasks.filter((t) => t.status === "failed");

			// Map tasks to pseudo-worktree IDs
			for (let i = 0; i < completedTasks.length; i++) {
				successful.push(`lane-${i}`);
			}
			for (
				let i = completedTasks.length;
				i < completedTasks.length + failedTasks.length;
				i++
			) {
				failed.push(`lane-${i}`);
			}
		}

		return { successful, failed };
	}

	/**
	 * Lists all worktree directories.
	 */
	private listWorktreeDirectories(): string[] {
		try {
			if (existsSync(this.worktreesDir)) {
				const entries = readdirSync(this.worktreesDir, {
					withFileTypes: true,
				});
				return entries.filter((e) => e.isDirectory()).map((e) => e.name);
			}
		} catch {
			// Directory doesn't exist or isn't accessible
		}
		return [];
	}

	/**
	 * Creates a new branch from main.
	 */
	private async createBranch(branchName: string): Promise<boolean> {
		const cwd = this.config.cwd || process.cwd();

		// Ensure we're on main and it's up to date
		const checkoutResult = await this.git(["checkout", "main"], cwd);
		if (checkoutResult.exitCode !== 0) {
			console.error("Failed to checkout main:", checkoutResult.stderr);
			return false;
		}

		const _pullResult = await this.git(["pull", "origin", "main"], cwd);
		// Pull might fail if there are no remote changes, which is OK

		// Create and checkout the new branch
		const createResult = await this.git(["checkout", "-b", branchName], cwd);
		if (createResult.exitCode !== 0) {
			// Branch might already exist, try to checkout
			const checkoutExisting = await this.git(["checkout", branchName], cwd);
			if (checkoutExisting.exitCode !== 0) {
				console.error("Failed to create branch:", createResult.stderr);
				return false;
			}
		}

		return true;
	}

	/**
	 * Merges changes from successful worktrees into the consolidation branch.
	 * Uses `git merge --no-commit --no-ff` + conflict detection before committing.
	 * On conflict: aborts, logs, and marks the worktree for sequential retry.
	 */
	private async mergeSuccessfulWorktrees(
		stagingBranch: string,
		successfulWorktrees: string[],
	): Promise<boolean> {
		if (successfulWorktrees.length === 0) {
			return false;
		}

		const cwd = this.config.cwd || process.cwd();
		let allMerged = true;

		for (const worktree of successfulWorktrees) {
			const worktreePath = join(this.worktreesDir, worktree);

			if (!existsSync(worktreePath)) {
				console.warn(`Worktree ${worktree} not found, skipping`);
				continue;
			}

			// Safety guard: ensure we're on the consolidation branch before each merge
			const branchGuard = await this.git(
				["symbolic-ref", "--short", "HEAD"],
				cwd,
			);
			const currentBranch = branchGuard.stdout.trim();
			if (currentBranch !== stagingBranch) {
				console.error(
					`[Consolidator] Branch guard failed: expected '${stagingBranch}', got '${currentBranch}'. Skipping merge for ${worktree}.`,
				);
				await this.ledger.log(
					"branch_guard_failed",
					{ worktree, expected: stagingBranch, actual: currentBranch },
					"error",
				);
				allMerged = false;
				continue;
			}

			// Attempt no-commit, no-ff merge for safe conflict detection
			const mergeResult = await this.git(
				["merge", "--no-commit", "--no-ff", worktreePath],
				cwd,
			);

			if (mergeResult.exitCode === 0) {
				// Clean merge — commit with a structured message
				const commitResult = await this.git(
					[
						"commit",
						"-m",
						`merge(consolidate): integrate ${worktree} into ${stagingBranch}`,
					],
					cwd,
				);
				if (commitResult.exitCode !== 0) {
					// Commit failed (e.g. nothing to commit — working tree already up to date)
					// This is acceptable; reset merge state and continue
					await this.git(["merge", "--abort"], cwd).catch(() => {});
					console.warn(
						`[Consolidator] Commit skipped for ${worktree}: ${commitResult.stderr.trim()}`,
					);
				} else {
					await this.ledger.log("worktree_merged", { worktree, stagingBranch }, "info");
				}
			} else {
				// Non-zero exit — detect conflict markers
				const unmergedResult = await this.git(
					["ls-files", "--unmerged"],
					cwd,
				);

				const conflictingFiles = (unmergedResult.stdout ?? "")
					.split("\n")
					.filter(Boolean)
					.map((line) => line.split("\t")[1])
					.filter(Boolean)
					// Deduplicate (ls-files emits one line per stage: 1, 2, 3)
					.filter((v, i, arr) => arr.indexOf(v) === i);

				// Abort merge to restore a clean working tree
				await this.git(["merge", "--abort"], cwd);

				const hasConflict = conflictingFiles.length > 0;

				await this.ledger.log(
					"consolidation_conflict",
					{
						worktree,
						stagingBranch,
						conflictingFiles,
						hasConflict,
						mergeStderr: mergeResult.stderr.trim(),
						note: hasConflict
							? "targetFiles declaration gap — task should have been serialized by DAG collision detection"
							: "merge failed for non-conflict reason (check mergeStderr)",
					},
					"error",
				);

				console.warn(
					`[Consolidator] Merge ${hasConflict ? "conflict" : "error"} from ${worktree}: ` +
					(hasConflict ? conflictingFiles.join(", ") : mergeResult.stderr.trim()),
				);

				allMerged = false;

				// Trigger sequential retry hook (full recovery loop is a future phase)
				await this.retrySequential(worktree);
			}
		}

		return allMerged;
	}

	/**
	 * Sequential retry hook invoked when a worktree merge fails due to conflict.
	 * Phase 3 scope: moves conflicting worktree to a /recovery/ directory to isolate it
	 * and prevent further corruption, then logs the event.
	 */
	private async retrySequential(worktreeId: string): Promise<void> {
		const source = join(this.worktreesDir, worktreeId);
		const baseDir = this.config.cwd || process.cwd();
		const recoveryDir = join(baseDir, ".apohara", "recovery", new Date().toISOString().replace(/[:.]/g, "-"));
		const destination = join(recoveryDir, worktreeId);

		try {
			await mkdir(recoveryDir, { recursive: true });
			if (existsSync(source)) {
				await rename(source, destination);
			}

			await this.ledger.log(
				"sequential_retry_triggered",
				{
					worktreeId,
					reason: "merge_conflict",
					recoveryPath: destination,
					note: "Isolated for manual review to prevent state corruption.",
				},
				"warning",
			);
		} catch (err) {
			await this.ledger.log(
				"recovery_move_failed",
				{ worktreeId, error: (err as Error).message },
				"error",
			);
		}

		console.warn(
			`[Consolidator] Conflict in ${worktreeId} — isolated to ${destination} for manual review`,
		);
	}

	/**
	 * Generates a summary markdown file.
	 */
	private async generateSummary(params: {
		branchName: string;
		timestamp: string;
		successful: string[];
		failed: string[];
		allTasks: OrchestratorState["tasks"];
		mergeStatus: "success" | "partial";
	}): Promise<string> {
		const summaryDir = join(".apohara", "runs", params.timestamp);
		const summaryPath = join(summaryDir, "summary.md");

		// Ensure directory exists
		await mkdir(summaryDir, { recursive: true });

		// Build markdown content
		const statusEmoji = params.mergeStatus === "success" ? "✅" : "⚠️";
		const _duration = "N/A"; // Could track from ledger

		const content = `# Apohara Auto Run Summary

**Branch:** \`${params.branchName}\`
**Timestamp:** ${params.timestamp}
**Status:** ${statusEmoji} ${params.mergeStatus}

---

## Task Results

| Worktree | Status |
|----------|--------|
${params.successful.map((w) => `| ${w} | ✅ Success |`).join("\n")}
${params.failed.map((w) => `| ${w} | ❌ Failed |`).join("\n")}

---

## Tasks Executed

${params.allTasks.map((t) => `- **${t.id}**: ${t.status} - ${t.description}`).join("\n") || "No tasks recorded"}

---

## Summary

This run executed ${params.allTasks.length} task(s) across ${params.successful.length + params.failed.length} worktree lane(s).
- Successful: ${params.successful.length}
- Failed: ${params.failed.length}

The changes have been consolidated into branch \`${params.branchName}\`.
`;

		await writeFile(summaryPath, content, "utf-8");

		await this.ledger.log(
			"summary_generated",
			{ summaryPath, taskCount: params.allTasks.length },
			"info",
		);

		return summaryPath;
	}

	/**
	 * Calculates the exit code based on consolidation results.
	 * - 0: All worktrees succeeded
	 * - 2: Partial success (some worktrees had failures)
	 * - 1: Error (branch creation or critical merge failure)
	 */
	private calculateExitCode(
		taskResults: { successful: string[]; failed: string[] },
		mergeSucceeded: boolean,
	): number {
		if (!mergeSucceeded && taskResults.successful.length === 0) {
			return 1; // Critical error
		}
		if (taskResults.failed.length > 0 || !mergeSucceeded) {
			return 2; // Partial success
		}
		return 0; // Complete success
	}

	/**
	 * Executes a git command and returns the result.
	 */
	private async git(
		args: string[],
		cwd?: string,
	): Promise<{ exitCode: number; stdout: string; stderr: string }> {
		const proc = spawn(["git", ...args], {
			stdout: "pipe",
			stderr: "pipe",
			cwd: cwd || process.cwd(),
		});

		const exitCode = await proc.exited;
		const stdout = await proc.stdout.text();
		const stderr = await proc.stderr.text();

		return { exitCode, stdout, stderr };
	}
}

/**
 * Entry point for CLI execution.
 * Returns the exit code directly for shell use.
 */
export async function main(): Promise<number> {
	const consolidator = new Consolidator();
	const result = await consolidator.run();

	console.log(`\n Consolidation complete:`);
	console.log(`  Branch: ${result.branch}`);
	console.log(`  Successful worktrees: ${result.successfulWorktrees.length}`);
	console.log(`  Failed worktrees: ${result.failedWorktrees.length}`);
	console.log(`  Exit code: ${result.exitCode}`);

	if (result.summaryPath) {
		console.log(`  Summary: ${result.summaryPath}`);
	}

	return result.exitCode;
}
