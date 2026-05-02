import { spawn } from "../lib/spawn";
import { Command } from "commander";
import { Consolidator } from "../core/consolidator";
import { TaskDecomposer } from "../core/decomposer";
import { routeTask, routeTaskWithFallback } from "../core/agent-router";
import { IsolationEngine } from "../core/isolation";
import { EventLedger } from "../core/ledger";
import { SubagentManager } from "../core/subagent-manager";
import { StateMachine } from "../core/state";
import { SummaryGenerator } from "../core/summary";
import type { DecomposedTask } from "../core/decomposer";
import { GitHubClient } from "../providers/github";
import { ProviderRouter } from "../providers/router";

export const autoCommand = new Command("auto")
	.description(
		"Automatically decompose a prompt into atomic tasks and execute them in parallel worktrees",
	)
	.argument("<prompt>", "The prompt to auto-execute")
	.option(
		"-w, --worktrees <number>",
		"Number of worktree lanes (default: 3)",
		"3",
	)
	.option(
		"-s, --simulate-failure",
		"Simulate a 429 rate limit error on the first provider for demo/testing (default: false)",
		false,
	)
	.option(
		"--no-pr",
		"Skip GitHub PR creation (useful for local-only runs)",
		false,
	)
	.action(
		async (
			prompt: string,
			options: {
				worktrees?: string;
				simulateFailure?: boolean;
				pr?: boolean;
			},
		) => {
			const worktreePoolSize = parseInt(options.worktrees || "3", 10);
			const enablePr = options.pr ?? true;

			console.log(`🚀 Starting apohara auto for: "${prompt}"`);
			console.log(`📊 Worktree pool size: ${worktreePoolSize}`);
			if (options.simulateFailure) {
				console.log(
					`⚠️  SIMULATE-FAILURE MODE ENABLED - First provider will return 429`,
				);
			}

			// 1) Initialize core components
			const stateMachine = new StateMachine();
			const ledger = new EventLedger();
			const router = new ProviderRouter({
				simulateFailure: options.simulateFailure ?? false,
			});
			const decomposer = new TaskDecomposer(router);
			const subagentManager = new SubagentManager({
				maxConcurrent: worktreePoolSize,
				timeoutMs: 120000,
				maxRetries: 3,
				backoffMs: [1000, 4000, 16000],
			});

			try {
				// 2) Load or create state
				await stateMachine.load();
				const initialState = stateMachine.get();
				console.log(
					`📁 Loaded state: ${initialState.tasks.length} existing tasks`,
				);

				await ledger.log(
					"auto_command_started",
					{ prompt, worktreePoolSize },
					"info",
				);

				// 3) Decompose the prompt into atomic tasks
				console.log("🔄 Decomposing prompt into atomic tasks...");

				// For now, since we don't have the LLM running in this test, we can:
				// Let it fail gracefully and show an error message
				// or we could bypass the LLM and provide test data
				let decompositionResult: { tasks: DecomposedTask[] };
				try {
					decompositionResult = await decomposer.decompose(prompt);
				} catch (error) {
					// If LLM fails (no API key, etc), show helpful error
					const errorMessage =
						error instanceof Error ? error.message : String(error);
					console.error(`❌ Decomposition failed: ${errorMessage}`);
					console.log("\n💡 Make sure you have configured your API keys:");
					console.log("   apohara config");
					console.log("   or set environment variables:\n");
					console.log("   OPENCODE_API_KEY=your-key-here");
					console.log("   or\n   DEEPSEEK_API_KEY=your-key-here\n");
					await ledger.log(
						"auto_command_failed",
						{ prompt, error: errorMessage },
						"error",
					);
					process.exit(1);
				}

				console.log(
					`✨ Decomposed into ${decompositionResult.tasks.length} tasks:`,
				);
				for (const task of decompositionResult.tasks) {
					const deps =
						task.dependencies.length > 0
							? ` (depends on: ${task.dependencies.join(", ")})`
							: "";
					console.log(`   - [${task.id}] ${task.description}${deps}`);
				}

				await ledger.log(
					"decomposition_completed",
					{
						taskCount: decompositionResult.tasks.length,
						tasks: decompositionResult.tasks.map((t) => t.id),
					},
					"info",
				);

				// 4) Execute tasks via SubagentManager (parallel with dependency resolution)
				console.log("▶️ Executing tasks in parallel via SubagentManager...");
				const agentResults = await subagentManager.executeAll(
					decompositionResult.tasks,
				);

				// 5) Report results
				const successCount = agentResults.filter(
					(r) => r.status === "completed",
				).length;
				const errorCount = agentResults.filter(
					(r) => r.status === "failed" || r.status === "timeout",
				).length;

				console.log("\n📋 Task Results:");
				for (const result of agentResults) {
					const statusIcon = result.status === "completed" ? "✅" : "❌";
					console.log(
						`   ${statusIcon} [${result.taskId}] ${result.status} (provider: ${result.provider}, ${result.durationMs}ms)`,
					);
				}

				console.log(
					`\n📊 Summary: ${successCount} succeeded, ${errorCount} failed, ${agentResults.length} total`,
				);

				await ledger.log(
					"auto_command_completed",
					{
						successCount,
						errorCount,
						totalTasks: agentResults.length,
						results: agentResults.map((r) => ({
							taskId: r.taskId,
							status: r.status,
							provider: r.provider,
						})),
					},
					errorCount > 0 ? "warning" : "info",
				);

				// 6) Run consolidation: create branch, merge worktrees, generate summary
				console.log("\n🔀 Running consolidation...");
				const consolidator = new Consolidator({}, ledger);
				const consolidationResult = await consolidator.run();
				await ledger.log(
					"consolidation_completed",
					{
						branch: consolidationResult.branch,
						exitCode: consolidationResult.exitCode,
						successfulWorktrees: consolidationResult.successfulWorktrees,
						failedWorktrees: consolidationResult.failedWorktrees,
					},
					consolidationResult.exitCode === 0 ? "info" : "warning",
				);

				// 7) Run Biome linting on consolidated code
				console.log("🔧 Running Biome linting...");
				const lintResult = await runBiomeLint();
				await ledger.log(
					"lint_applied",
					{
						exitCode: lintResult.exitCode,
						fixed: lintResult.fixed,
						output: lintResult.output,
					},
					lintResult.exitCode === 0 ? "info" : "warning",
				);

				// Include linting results in output
				if (lintResult.fixed > 0) {
					console.log(`   ✨ Fixed ${lintResult.fixed} issue(s)`);
				} else {
					console.log(`   ✅ No lint issues`);
				}

				// 9) Create GitHub Pull Request from consolidated branch
				console.log("🔗 Creating GitHub Pull Request...");
				const prResult = await createGitHubPullRequest(
					consolidationResult.branch,
					ledger,
					enablePr,
				);
				if (prResult) {
					await ledger.log(
						"github_pr_created",
						{
							prNumber: prResult.number,
							prUrl: prResult.htmlUrl,
							branch: consolidationResult.branch,
						},
						"info",
					);
					console.log(
						`   ✅ PR #${prResult.number} created: ${prResult.htmlUrl}`,
					);
				}

				// 10) Generate narrative summary from EventLedger and StateMachine
				console.log("📝 Generating summary...");
				// Extract runId from the main ledger to share the same event log
				const runId =
					ledger
						.getFilePath()
						.split("/")
						.pop()
						?.replace("run-", "")
						?.replace(".jsonl", "") || undefined;
				const summaryGenerator = new SummaryGenerator({ runId });
				const summaryPath = await summaryGenerator.generate();
				await ledger.log("summary_generated", { summaryPath }, "info");

				// 9) Final compact output
				console.log("\n🎉 Auto execution complete!");
				console.log(`   📂 Branch: ${consolidationResult.branch}`);
				console.log(
					`   🧹 Worktrees: ${consolidationResult.successfulWorktrees.length} merged, ${consolidationResult.failedWorktrees.length} failed`,
				);
				console.log(`   📊 Summary: ${summaryPath}`);
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				console.error(`❌ Auto command failed: ${errorMessage}`);

				await ledger.log(
					"auto_command_failed",
					{ prompt, error: errorMessage },
					"error",
				);

				process.exit(1);
			} finally {
				console.log("👋 Shutdown complete.");
			}
		},
	);

/**
 * Runs Biome linting on the consolidated code with autofix.
 * Returns the exit code and count of fixed issues.
 */
async function runBiomeLint(): Promise<{
	exitCode: number;
	fixed: number;
	output: string;
}> {
	const proc = spawn(["biome", "check", "--fix", ".", "--verbose"], {
		stdout: "pipe",
		stderr: "pipe",
	});

	const exitCode = await proc.exited;
	const stdout = await proc.stdout.text();
	const stderr = await proc.stderr.text();

	// Parse the output to find number of fixed issues
	// Biome outputs things like "Fixed 5 issues"
	const fixedMatch =
		stdout.match(/Fixed (\d+) issues?/) || stderr.match(/Fixed (\d+) issues?/);
	const fixed = fixedMatch ? parseInt(fixedMatch[1], 10) : 0;

	return {
		exitCode,
		fixed,
		output: stdout + stderr,
	};
}

/**
 * Creates a GitHub Pull Request from the consolidated branch.
 * Returns null if PR creation fails or GitHub is not configured.
 */
async function createGitHubPullRequest(
	headBranch: string,
	ledger: EventLedger,
	enablePr: boolean = true,
): Promise<{
	number: number;
	htmlUrl: string;
} | null> {
	// Check if PR creation is disabled via --no-pr flag
	if (!enablePr) {
		await ledger.log(
			"github_pr_skipped",
			{ reason: "user opted out via --no-pr flag" },
			"info",
		);
		console.log("   ⏭️  Skipped PR creation: --no-pr flag set");
		return null;
	}

	const github = new GitHubClient();

	// Get repository info from remote
	const repoInfo = await github.getRepositoryFromRemote();
	if (!repoInfo?.repoInfo) {
		await ledger.log(
			"github_pr_skipped",
			{ reason: "Could not detect repository from git remote" },
			"warning",
		);
		console.log("   ⚠️  Skipped PR creation: no GitHub remote detected");
		return null;
	}

	// Validate token
	const tokenValidation = github.validateToken();
	if (!tokenValidation.valid) {
		await ledger.log(
			"github_pr_skipped",
			{ reason: tokenValidation.error },
			"warning",
		);
		console.log(`   ⚠️  Skipped PR creation: ${tokenValidation.error}`);
		return null;
	}

	try {
		const pr = await github.createPullRequest({
			owner: repoInfo.owner,
			repo: repoInfo.repo,
			title: `Auto: ${headBranch}`,
			body: `Changes consolidated from Clarity auto execution.\n\nBranch: ${headBranch}`,
			head: headBranch,
			base: repoInfo.repoInfo.defaultBranch,
		});

		return {
			number: pr.number,
			htmlUrl: pr.htmlUrl,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await ledger.log("github_pr_error", { error: message }, "error");
		console.log(`   ⚠️  Failed to create PR: ${message}`);
		return null;
	}
}
