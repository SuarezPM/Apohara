import { Command } from "commander";
import { TaskDecomposer } from "../core/decomposer";
import { EventLedger } from "../core/ledger";
import { IsolationEngine } from "../core/isolation";
import { ParallelScheduler } from "../core/scheduler";
import { StateMachine } from "../core/state";
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
	.action(async (prompt: string, options: { worktrees?: string; simulateFailure?: boolean }) => {
		const worktreePoolSize = parseInt(options.worktrees || "3", 10);

		console.log(`🚀 Starting clarity auto for: "${prompt}"`);
		console.log(`📊 Worktree pool size: ${worktreePoolSize}`);
		if (options.simulateFailure) {
			console.log(`⚠️  SIMULATE-FAILURE MODE ENABLED - First provider will return 429`);
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
			{ worktreePoolSize },
		);

		try {
			// 2) Load or create state
			await stateMachine.load();
			const initialState = stateMachine.get();
			console.log(`📁 Loaded state: ${initialState.tasks.length} existing tasks`);

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
				console.error(
					`❌ Decomposition failed: ${errorMessage}`,
				);
				console.log(
					"\n💡 Make sure your .env file has a valid API key:",
				);
				console.log("   OPENCODE_API_KEY=your-key-here");
				console.log(
					"   or\n   DEEPSEEK_API_KEY=your-key-here\n",
				);
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
				{ taskCount: decompositionResult.tasks.length, tasks: decompositionResult.tasks.map(t => t.id) },
				"info",
			);

			// 4) Initialize scheduler and execute tasks
			console.log("🔧 Initializing worktree pool...");
			await scheduler.initialize();

			console.log("▶️ Executing tasks in parallel...");
			const results = await scheduler.executeAll(decompositionResult.tasks);

			// 5) Report results
			const successCount = results.filter(
				(r) => r.status === "success",
			).length;
			const errorCount = results.filter((r) => r.status === "error").length;

			console.log(`\n📊 Execution complete:`);
			console.log(`   ✅ Success: ${successCount}`);
			console.log(`   ❌ Errors: ${errorCount}`);
			console.log(`   📝 Total tasks: ${results.length}`);

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

			// 6) Log final state to ledger with worktree assignment
			const finalState = stateMachine.get();
			for (const task of finalState.tasks) {
				await ledger.log(
					"task_recorded",
					{
						taskId: task.id,
						status: task.status,
						worktreeId: task.id, // In a real implementation, we'd track which worktree was used
					},
					"info",
					task.id,
				);
			}

			console.log(`\n📝 Event ledger: ${ledger.getFilePath()}`);
			console.log("✅ Auto execution complete!");
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
	});