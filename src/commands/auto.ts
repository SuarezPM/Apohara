import { spawn } from "bun";
import { Command } from "commander";
import { Consolidator } from "../core/consolidator";
import { TaskDecomposer } from "../core/decomposer";
import { IsolationEngine } from "../core/isolation";
import { EventLedger } from "../core/ledger";
import { ParallelScheduler } from "../core/scheduler";
import { StateMachine } from "../core/state";
import { SummaryGenerator } from "../core/summary";
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
	.action(
		async (
			prompt: string,
			options: { worktrees?: string; simulateFailure?: boolean },
		) => {
			const worktreePoolSize = parseInt(options.worktrees || "3", 10);

			console.log(`🚀 Starting clarity auto for: "${prompt}"`);
			console.log(`📊 Worktree pool size: ${worktreePoolSize}`);
			if (options.simulateFailure) {
				console.log(
					`⚠️  SIMULATE-FAILURE MODE ENABLED - First provider will return 429`,
				);
			}

			// 1) Initialize core components
			const stateMachine = new StateMachine();
			const ledger = new EventLedger();
			const isolationEngine = new IsolationEngine();
			const router = new ProviderRouter({
				simulateFailure: options.simulateFailure ?? false,
			});
			const decomposer = new TaskDecomposer(router);
			const scheduler = new ParallelScheduler(
				isolationEngine,
				stateMachine,
				ledger,
				router,
				{ worktreePoolSize },
			);

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
				let decompositionResult;
				try {
					decompositionResult = await decomposer.decompose(prompt);
				} catch (error) {
					// If LLM fails (no API key, etc), show helpful error
					const errorMessage =
						error instanceof Error ? error.message : String(error);
					console.error(`❌ Decomposition failed: ${errorMessage}`);
					console.log("\n💡 Make sure your .env file has a valid API key:");
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

				// 4) Initialize scheduler and execute tasks
				console.log("🔧 Initializing worktree pool...");
				await scheduler.initialize();

				console.log("▶️ Executing tasks in parallel...");
				const results = await scheduler.executeAll(decompositionResult.tasks);

				// 5) Report results - compact output (one line per task)
				const successCount = results.filter(
					(r) => r.status === "success",
				).length;
				const errorCount = results.filter((r) => r.status === "error").length;

				// Compact terminal output: one line per task
				console.log("\n📋 Task Results:");
				for (const result of results) {
					const statusIcon = result.status === "success" ? "✅" : "❌";
					console.log(
						`   ${statusIcon} [${result.taskId}] ${result.status} (worktree: ${result.worktreeId})`,
					);
				}

				console.log(
					`\n📊 Summary: ${successCount} succeeded, ${errorCount} failed, ${results.length} total`,
				);

				await ledger.log(
					"auto_command_completed",
					{
						successCount,
						errorCount,
						totalTasks: results.length,
						results: results.map((r) => ({
							taskId: r.taskId,
							status: r.status,
							worktreeId: r.worktreeId,
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

				// 8) Generate narrative summary from EventLedger and StateMachine
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
				// 5) Clean up worktrees
				console.log("🧹 Cleaning up worktrees...");
				await scheduler.shutdown();
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
	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();

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
