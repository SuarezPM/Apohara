import { describe, it, expect, beforeEach, vi } from "bun:test";
import { injectCollisionEdges, type DecomposedTask } from "../src/core/decomposer";
import { ParallelScheduler } from "../src/core/scheduler";
import { Consolidator } from "../src/core/consolidator";
import { IsolationEngine } from "../src/core/isolation";
import { StateMachine } from "../src/core/state";
import { EventLedger } from "../src/core/ledger";
import { join } from "node:path";
import { existsSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";

// Helper to create tasks
function makeTask(id: string, targetFiles: string[] = [], deps: string[] = []): DecomposedTask {
	return {
		id,
		description: `Task ${id}`,
		estimatedComplexity: "low",
		dependencies: deps,
		role: "execution",
		targetFiles,
		implicitDependencies: [],
	};
}

describe("Phase 3: DAG Hardening & Safe Parallel Execution", () => {
	
	describe("1. Collision Detection (injectCollisionEdges)", () => {
		it("should serialize tasks that share targetFiles", () => {
			const tasks = [
				makeTask("task-b", ["src/core.ts"]),
				makeTask("task-a", ["src/core.ts"]),
			];
			
			// injectCollisionEdges sorts by ID: task-a (lower) should run first, task-b should wait
			const result = injectCollisionEdges(tasks);
			
			const taskA = result.find(t => t.id === "task-a")!;
			const taskB = result.find(t => t.id === "task-b")!;
			
			expect(taskB.dependencies).toContain("task-a");
			expect(taskB.implicitDependencies).toContain("task-a");
			expect(taskA.dependencies).not.toContain("task-b");
		});
		
		it("should not inject edges if no files overlap", () => {
			const tasks = [
				makeTask("task-a", ["src/a.ts"]),
				makeTask("task-b", ["src/b.ts"]),
			];
			
			const result = injectCollisionEdges(tasks);
			
			expect(result.find(t => t.id === "task-b")!.dependencies).not.toContain("task-a");
		});
		
		it("should respect existing dependency edges", () => {
			// task-a depends on task-b explicitly
			const tasks = [
				makeTask("task-a", ["src/shared.ts"], ["task-b"]),
				makeTask("task-b", ["src/shared.ts"]),
			];
			
			const result = injectCollisionEdges(tasks);
			
			const taskA = result.find(t => t.id === "task-a")!;
			const taskB = result.find(t => t.id === "task-b")!;
			
			// Existing edge A -> B should be preserved, no B -> A injected despite ID order
			expect(taskA.dependencies).toContain("task-b");
			expect(taskB.dependencies).not.toContain("task-a");
		});

		it("should handle empty targetFiles gracefully", () => {
			const tasks = [
				makeTask("task-a", []),
				makeTask("task-b", ["src/any.ts"]),
			];
			
			const result = injectCollisionEdges(tasks);
			expect(result.find(t => t.id === "task-b")!.dependencies).not.toContain("task-a");
		});
	});

	describe("2. Scheduler Backpressure (p-limit)", () => {
		let scheduler: ParallelScheduler;
		const POOL_SIZE = 2;

		beforeEach(async () => {
			const mockIsolation = {
				createWorktree: vi.fn().mockResolvedValue({ status: "success" }),
				destroyWorktree: vi.fn().mockResolvedValue({ status: "success" }),
			} as unknown as IsolationEngine;

			scheduler = new ParallelScheduler(
				mockIsolation,
				new StateMachine(),
				new EventLedger("backpressure-test"),
				undefined,
				{ worktreePoolSize: POOL_SIZE }
			);
			await scheduler.initialize();
		});

		it("should never exceed worktreePoolSize concurrent tasks", async () => {
			const tasks = [
				makeTask("t1"),
				makeTask("t2"),
				makeTask("t3"),
				makeTask("t4"),
			];

			let activeCountAtMax = 0;
			const taskPromises: Promise<void>[] = [];
			
			// Mock scheduleTask to delay completion
			vi.spyOn(scheduler, "scheduleTask").mockImplementation(async (task) => {
				const currentActive = scheduler.getActiveTasks().size + 1; // +1 because we're about to add it
				activeCountAtMax = Math.max(activeCountAtMax, currentActive);
				
				// Keep it "active" for a bit
				await new Promise(r => setTimeout(r, 20));
				
				// Manually simulate scheduling success in the mock
				// Note: scheduler.scheduleTask usually adds to activeTasks
				return `lane-${task.id}`;
			});

			// We need to mock completeTask too since executeAll calls it
			vi.spyOn(scheduler, "completeTask").mockImplementation(async () => {
				// No-op to avoid clearing activeTasks too fast in the test logic
			});

			// Trigger execution
			const executionPromise = scheduler.executeAll(tasks);
			
			await new Promise(r => setTimeout(r, 50)); // Wait for some tasks to start
			
			expect(activeCountAtMax).toBeLessThanOrEqual(POOL_SIZE);
			
			await executionPromise.catch(() => {});
		});
	});

	describe("3. Consolidator Conflict Isolation", () => {
		const TEST_DIR = join(tmpdir(), "apohara-phase3-test");
		const WORKTREES_DIR = join(TEST_DIR, "worktrees");
		const STATE_FILE = join(TEST_DIR, "state.json");
		
		beforeEach(async () => {
			if (existsSync(TEST_DIR)) await rm(TEST_DIR, { recursive: true, force: true });
			mkdirSync(TEST_DIR, { recursive: true });
			mkdirSync(WORKTREES_DIR, { recursive: true });
			writeFileSync(STATE_FILE, JSON.stringify({ tasks: [], status: "idle" }));
		});

		it("should move conflicting worktrees to recovery directory", async () => {
			const consolidator = new Consolidator({
				worktreeBaseDir: WORKTREES_DIR,
				stateFilePath: STATE_FILE,
				cwd: TEST_DIR
			});

			// Create a fake worktree directory
			const laneDir = join(WORKTREES_DIR, "lane-conflict");
			mkdirSync(laneDir, { recursive: true });
			writeFileSync(join(laneDir, "conflict.txt"), "some changes");

			// Mock git to simulate conflict
			vi.spyOn(consolidator as any, "git").mockImplementation(async (args: string[]) => {
				const cmd = args.join(" ");
				if (cmd.includes("symbolic-ref")) return { exitCode: 0, stdout: "apohara/run-test", stderr: "" };
				if (cmd.includes("merge --no-commit")) return { exitCode: 1, stdout: "", stderr: "CONFLICT" };
				if (cmd.includes("ls-files --unmerged")) return { exitCode: 0, stdout: "1\tfile.ts", stderr: "" };
				if (cmd.includes("merge --abort")) return { exitCode: 0, stdout: "", stderr: "" };
				return { exitCode: 0, stdout: "", stderr: "" };
			});

			// Run merge logic (internal call)
			await (consolidator as any).mergeSuccessfulWorktrees("apohara/run-test", ["lane-conflict"]);

			// Check if lane-conflict was moved to .apohara/recovery
			const recoveryBase = join(TEST_DIR, ".apohara", "recovery");
			expect(existsSync(recoveryBase)).toBe(true);
			
			const recoveryRuns = readdirSync(recoveryBase);
			expect(recoveryRuns.length).toBeGreaterThan(0);
			
			// Find the lane-conflict in one of the recovery runs
			let found = false;
			for (const run of recoveryRuns) {
				if (existsSync(join(recoveryBase, run, "lane-conflict"))) {
					found = true;
					break;
				}
			}
			expect(found).toBe(true);
			
			// Source should be gone
			expect(existsSync(laneDir)).toBe(false);
		});
	});
});
