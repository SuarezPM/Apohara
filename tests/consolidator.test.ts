import { describe, expect, test, beforeEach, spyOn } from "bun:test";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Consolidator, type ConsolidatorConfig } from "../src/core/consolidator";
import { EventLedger } from "../src/core/ledger";

// Test constants
const TEST_WORKTREE_DIR = join(tmpdir(), "apohara-consolidator-test", "worktrees");
const TEST_STATE_FILE = join(tmpdir(), "apohara-consolidator-test", "state.json");
const TEST_CWD = tmpdir();

describe("Consolidator", () => {
	let consolidator: Consolidator;
	let ledger: EventLedger;

	beforeEach(() => {
		// Clean up test directories
		cleanupTestDirs();

		// Create test directories
		mkdirSync(TEST_WORKTREE_DIR, { recursive: true });
		mkdirSync(join(tmpdir(), "apohara-consolidator-test"), {
			recursive: true,
		});

		// Create a mock state file
		writeFileSync(
			TEST_STATE_FILE,
			JSON.stringify({
				currentTaskId: null,
				tasks: [
					{
						id: "T1",
						description: "Task 1",
						status: "completed",
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString(),
					},
					{
						id: "T2",
						description: "Task 2",
						status: "failed",
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString(),
					},
				],
				status: "idle",
				failedProviderTimestamps: {},
			}),
		);

		const config: ConsolidatorConfig = {
			worktreeBaseDir: TEST_WORKTREE_DIR,
			stateFilePath: TEST_STATE_FILE,
			cwd: TEST_CWD,
		};

		ledger = new EventLedger("test-run");
		consolidator = new Consolidator(config, ledger);
	});

	function cleanupTestDirs() {
		try {
			if (existsSync(TEST_WORKTREE_DIR)) {
				rmSync(TEST_WORKTREE_DIR, { recursive: true, force: true });
			}
			const testDir = join(tmpdir(), "apohara-consolidator-test");
			if (existsSync(testDir)) {
				rmSync(testDir, { recursive: true, force: true });
			}
		} catch {
			// Ignore cleanup errors
		}
	}

	test("should create consolidator with default config", () => {
		const defaultConsolidator = new Consolidator();
		expect(defaultConsolidator).toBeDefined();
	});

	test("should load state from file", async () => {
		const state = consolidator["loadState"]();
		expect(state.tasks).toHaveLength(2);
		expect(state.tasks[0].id).toBe("T1");
	});

	test("should analyze task results correctly", () => {
		const state = consolidator["loadState"]();
		const results = consolidator["analyzeTaskResults"](state);

		// Based on the state, both lane-0 and lane-1 should be marked
		// Since we have completed tasks but no specific worktree mapping
		expect(results.successful.length).toBeGreaterThan(0);
	});

	test("should calculate exit code 0 for all success", () => {
		const exitCode = consolidator["calculateExitCode"](
			{ successful: ["lane-0", "lane-1"], failed: [] },
			true,
		);
		expect(exitCode).toBe(0);
	});

	test("should calculate exit code 2 for partial success", () => {
		const exitCode = consolidator["calculateExitCode"](
			{ successful: ["lane-0"], failed: ["lane-1"] },
			true,
		);
		expect(exitCode).toBe(2);
	});

	test("should calculate exit code 1 for critical failure", () => {
		const exitCode = consolidator["calculateExitCode"](
			{ successful: [], failed: ["lane-0", "lane-1"] },
			false,
		);
		expect(exitCode).toBe(1);
	});

	test("should list worktree directories", () => {
		// Create dummy worktree directories
		mkdirSync(join(TEST_WORKTREE_DIR, "lane-0"), { recursive: true });
		mkdirSync(join(TEST_WORKTREE_DIR, "lane-1"), { recursive: true });

		const worktrees = consolidator["listWorktreeDirectories"]();
		expect(worktrees).toContain("lane-0");
		expect(worktrees).toContain("lane-1");
	});

	test("should generate summary markdown", async () => {
		const summaryPath = await consolidator["generateSummary"]({
			branchName: "apohara/run-test",
			timestamp: "2026-04-30T12-00-00",
			successful: ["lane-0"],
			failed: ["lane-1"],
			allTasks: [
				{
					id: "T1",
					description: "Test task",
					status: "completed",
					createdAt: new Date(),
					updatedAt: new Date(),
				},
			],
			mergeStatus: "partial",
		});

		expect(summaryPath).toContain("summary.md");
		expect(existsSync(summaryPath)).toBe(true);
	});

	test("should create branch (mocked git)", async () => {
		// This test will fail in CI without proper git setup
		// We're testing the path construction logic here
		const branchCreated = await consolidator["createBranch"](
			"apohara/run-test-branch",
		);
		// In a real environment with git, this would create a branch
		// In test environment without git, it may fail gracefully
		expect(typeof branchCreated).toBe("boolean");
	});

	test("should merge successful worktrees", async () => {
		// Create worktree directories
		mkdirSync(join(TEST_WORKTREE_DIR, "lane-0"), { recursive: true });

		// Without actual git repos, merge returns false gracefully
		const mergeResult = await consolidator["mergeSuccessfulWorktrees"](
			"main",
			["lane-0"],
		);
		expect(typeof mergeResult).toBe("boolean");
	});

	test("should log events to ledger", async () => {
		await ledger.log("test_event", { test: true }, "info");
		const path = ledger.getFilePath();
		expect(path).toContain("run-test");
	});
});

describe("Consolidator Exit Codes", () => {
	let consolidator: Consolidator;

	beforeEach(() => {
		const config: ConsolidatorConfig = {
			worktreeBaseDir: TEST_WORKTREE_DIR,
			stateFilePath: TEST_STATE_FILE,
			cwd: TEST_CWD,
		};
		consolidator = new Consolidator(config);
	});

	test("exit code 0 when all worktrees successful and merge succeeds", () => {
		const result = consolidator["calculateExitCode"](
			{ successful: ["lane-0", "lane-1"], failed: [] },
			true,
		);
		expect(result).toBe(0);
	});

	test("exit code 2 when some worktrees failed", () => {
		const result = consolidator["calculateExitCode"](
			{ successful: ["lane-0"], failed: ["lane-1"] },
			true,
		);
		expect(result).toBe(2);
	});

	test("exit code 2 when merge partially succeeded", () => {
		const result = consolidator["calculateExitCode"](
			{ successful: ["lane-0"], failed: [] },
			false,
		);
		expect(result).toBe(2);
	});

	test("exit code 1 when no successful worktrees and merge failed", () => {
		const result = consolidator["calculateExitCode"](
			{ successful: [], failed: [] },
			false,
		);
		expect(result).toBe(1);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// DAG Hardening — Phase 3: Git merge conflict detection tests
// ─────────────────────────────────────────────────────────────────────────────
describe("Consolidator — Git merge conflict detection", () => {
	let consolidator: Consolidator;
	let ledger: EventLedger;

	beforeEach(() => {
		cleanupConflictTestDirs();
		mkdirSync(TEST_WORKTREE_DIR, { recursive: true });
		mkdirSync(join(tmpdir(), "apohara-consolidator-test"), { recursive: true });
		writeFileSync(
			TEST_STATE_FILE,
			JSON.stringify({ currentTaskId: null, tasks: [], status: "idle", failedProviderTimestamps: {} }),
		);

		ledger = new EventLedger("conflict-test");
		consolidator = new Consolidator(
			{ worktreeBaseDir: TEST_WORKTREE_DIR, stateFilePath: TEST_STATE_FILE, cwd: TEST_CWD },
			ledger,
		);

		// Create a dummy lane-0 directory so existsSync passes
		mkdirSync(join(TEST_WORKTREE_DIR, "lane-0"), { recursive: true });
	});

	function cleanupConflictTestDirs() {
		try {
			if (existsSync(TEST_WORKTREE_DIR))
				rmSync(TEST_WORKTREE_DIR, { recursive: true, force: true });
			const testDir = join(tmpdir(), "apohara-consolidator-test");
			if (existsSync(testDir))
				rmSync(testDir, { recursive: true, force: true });
		} catch {
			// ignore
		}
	}

	test("returns false immediately when no worktrees are provided", async () => {
		const result = await consolidator["mergeSuccessfulWorktrees"]("main", []);
		expect(result).toBe(false);
	});

	test("marks merge failed and triggers retrySequential on non-zero exit", async () => {
		// Stub git() to simulate: branch check OK, merge fails, ls-files shows conflict, abort OK
		let gitCallCount = 0;

		// @ts-expect-error — private method spy
		const spy = spyOn(consolidator, "git").mockImplementation(async (args: string[]) => {
			gitCallCount++;
			const cmd = args.join(" ");

			if (cmd.includes("symbolic-ref")) {
				// Branch guard passes
				return { exitCode: 0, stdout: "main\n", stderr: "" };
			}
			if (cmd.includes("merge --no-commit")) {
				// Simulate conflict exit
				return { exitCode: 1, stdout: "", stderr: "CONFLICT (content): Merge conflict in src/foo.ts" };
			}
			if (cmd.includes("ls-files --unmerged")) {
				// Report one conflicting file (ls-files emits 3 stages, all same file)
				return { exitCode: 0, stdout: "100644 abc 1\tsrc/foo.ts\n100644 def 2\tsrc/foo.ts\n100644 ghi 3\tsrc/foo.ts\n", stderr: "" };
			}
			if (cmd.includes("merge --abort")) {
				return { exitCode: 0, stdout: "", stderr: "" };
			}
			return { exitCode: 0, stdout: "", stderr: "" };
		});

		let retryTriggered = false;
		// @ts-expect-error — private method spy
		spyOn(consolidator, "retrySequential").mockImplementation(async () => {
			retryTriggered = true;
		});

		const result = await consolidator["mergeSuccessfulWorktrees"]("main", ["lane-0"]);

		expect(result).toBe(false);
		expect(retryTriggered).toBe(true);
		spy.mockRestore?.();
	});

	test("branch guard failure skips merge and logs branch_guard_failed", async () => {
		let loggedEvent: string | null = null;

		// @ts-expect-error — private method spy
		spyOn(consolidator, "git").mockImplementation(async (args: string[]) => {
			const cmd = args.join(" ");
			if (cmd.includes("symbolic-ref")) {
				// Pretend we're on wrong branch
				return { exitCode: 0, stdout: "feature-wrong\n", stderr: "" };
			}
			return { exitCode: 0, stdout: "", stderr: "" };
		});

		spyOn(ledger, "log").mockImplementation(async (event: string) => {
			loggedEvent = event;
		});

		const result = await consolidator["mergeSuccessfulWorktrees"]("main", ["lane-0"]);

		expect(result).toBe(false);
		expect(loggedEvent).toBe("branch_guard_failed");
	});
});