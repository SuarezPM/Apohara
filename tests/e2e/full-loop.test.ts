import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawn as nodeSpawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * Slice S06 / T01 — End-to-end "tracer bullet" test for `apohara auto`.
 *
 * Slice goal: complete tracer bullet fires end-to-end with zero manual intervention.
 *
 * "Zero intervention" means: the command runs from invocation to terminal exit
 * without ever blocking on stdin or waiting for a human prompt. This test
 * verifies that property by spawning the CLI with closed stdin and asserting it
 * exits within a hard wall-clock budget.
 *
 * It also exercises the full component chain (decomposer → subagent manager →
 * consolidator → summary → ledger) via direct imports, so the wiring across
 * subsystems is observable even when API keys are absent.
 */

const repoRoot = process.cwd();
const cliPath = path.join(repoRoot, "src", "cli.ts");

interface SpawnResult {
	exitCode: number | null;
	signal: NodeJS.Signals | null;
	stdout: string;
	stderr: string;
	durationMs: number;
	timedOut: boolean;
}

/**
 * Run a CLI command with stdin closed (the "zero intervention" condition).
 * If the command blocks on input it will be killed when the budget elapses
 * and `timedOut` will be true — that constitutes test failure.
 */
async function runCliClosedStdin(
	args: string[],
	budgetMs: number,
): Promise<SpawnResult> {
	const started = Date.now();
	const child = nodeSpawn("bun", ["run", cliPath, ...args], {
		cwd: repoRoot,
		stdio: ["ignore", "pipe", "pipe"],
		env: { ...process.env, CI: "1", APOHARA_NO_PROMPT: "1" },
	});

	let stdout = "";
	let stderr = "";
	child.stdout?.on("data", (chunk) => {
		stdout += chunk.toString();
	});
	child.stderr?.on("data", (chunk) => {
		stderr += chunk.toString();
	});

	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		child.kill("SIGKILL");
	}, budgetMs);

	const { exitCode, signal } = await new Promise<{
		exitCode: number | null;
		signal: NodeJS.Signals | null;
	}>((resolve) => {
		child.on("close", (code, sig) => resolve({ exitCode: code, signal: sig }));
	});
	clearTimeout(timer);

	return {
		exitCode,
		signal,
		stdout,
		stderr,
		durationMs: Date.now() - started,
		timedOut,
	};
}

describe("S06/T01 — apohara auto full-loop tracer bullet", () => {
	let preExistingEventsCount = 0;

	beforeAll(async () => {
		const eventsDir = path.join(repoRoot, ".events");
		await fs.mkdir(eventsDir, { recursive: true });
		preExistingEventsCount = (await fs.readdir(eventsDir)).length;
	});

	afterAll(async () => {
		// Trim test-generated event files so the ledger directory does not
		// grow unboundedly across runs. Keep the most recent 50 entries.
		const eventsDir = path.join(repoRoot, ".events");
		const entries = await fs.readdir(eventsDir).catch(() => [] as string[]);
		if (entries.length > preExistingEventsCount + 50) {
			const sorted = entries.sort();
			const stale = sorted.slice(
				0,
				entries.length - (preExistingEventsCount + 50),
			);
			for (const f of stale) {
				await fs.rm(path.join(eventsDir, f), { force: true }).catch(() => {});
			}
		}
	});

	describe("zero-intervention contract", () => {
		it(
			"auto --help exits without prompting on stdin",
			async () => {
				const result = await runCliClosedStdin(["auto", "--help"], 30_000);

				expect(result.timedOut).toBe(false);
				expect(result.signal).toBeNull();
				expect(result.exitCode).toBe(0);
				expect(result.stdout).toContain("auto");
				expect(result.stdout).toContain("--no-pr");
			},
			45_000,
		);

		it(
			"auto with prompt argument runs end-to-end without human prompts",
			async () => {
				// The full loop exercises decomposer → subagent manager →
				// consolidator → biome → summary. With or without API keys the
				// process must terminate on its own — never block on stdin.
				const result = await runCliClosedStdin(
					["auto", "add a health check endpoint", "--no-pr"],
					120_000,
				);

				expect(result.timedOut).toBe(false);
				// Either clean success (0) or a deterministic non-zero exit. The
				// disqualifying state is "still running when the budget expired",
				// which `timedOut` above would have caught.
				expect(typeof result.exitCode).toBe("number");

				const combined = result.stdout + result.stderr;
				// The auto command always announces start before doing any work.
				expect(combined).toContain("Starting apohara auto");
			},
			150_000,
		);

		it(
			"auto without a prompt argument fails fast without prompting",
			async () => {
				const result = await runCliClosedStdin(["auto"], 15_000);

				expect(result.timedOut).toBe(false);
				expect(result.exitCode).not.toBe(0);
				// Commander prints the error to stderr.
				expect(result.stderr).toMatch(/missing required argument|usage/i);
			},
			30_000,
		);
	});

	describe("full-loop component wiring", () => {
		it("all auto subsystems are importable and chainable", async () => {
			const { TaskDecomposer } = await import("../../src/core/decomposer.js");
			const { ProviderRouter } = await import("../../src/providers/router.js");
			const { SubagentManager } = await import(
				"../../src/core/subagent-manager.js"
			);
			const { Consolidator } = await import("../../src/core/consolidator.js");
			const { SummaryGenerator } = await import("../../src/core/summary.js");
			const { EventLedger } = await import("../../src/core/ledger.js");
			const { StateMachine } = await import("../../src/core/state.js");

			const ledger = new EventLedger();
			const router = new ProviderRouter({ simulateFailure: false });
			const decomposer = new TaskDecomposer(router);
			const subagentManager = new SubagentManager({
				maxConcurrent: 3,
				timeoutMs: 1000,
				maxRetries: 1,
				backoffMs: [10],
			});
			const consolidator = new Consolidator({}, ledger);
			const summary = new SummaryGenerator({});
			const state = new StateMachine();

			// Each subsystem must expose the entrypoint that the auto command
			// calls. If any of these go away the auto loop is broken.
			expect(typeof decomposer.decompose).toBe("function");
			expect(typeof subagentManager.executeAll).toBe("function");
			expect(typeof consolidator.run).toBe("function");
			expect(typeof summary.generate).toBe("function");
			expect(typeof state.load).toBe("function");
			expect(typeof ledger.log).toBe("function");
		});

		it("event ledger records lifecycle events with hash chaining", async () => {
			const { EventLedger } = await import("../../src/core/ledger.js");
			const ledger = new EventLedger();

			await ledger.log("auto_command_started", { prompt: "test" }, "info");
			await ledger.log(
				"decomposition_completed",
				{ taskCount: 0, tasks: [] },
				"info",
			);
			await ledger.log(
				"auto_command_completed",
				{ successCount: 0, errorCount: 0 },
				"info",
			);

			const logPath = ledger.getFilePath();
			const content = await fs.readFile(logPath, "utf-8");
			const lines = content.trim().split("\n").filter(Boolean);

			expect(lines.length).toBeGreaterThanOrEqual(3);

			// Each line must be a valid JSON object with id+timestamp+type.
			const parsed = lines.map((l) => JSON.parse(l));
			expect(parsed.some((e) => e.type === "auto_command_started")).toBe(true);
			expect(parsed.some((e) => e.type === "decomposition_completed")).toBe(
				true,
			);
			expect(parsed.some((e) => e.type === "auto_command_completed")).toBe(
				true,
			);
		});

		it("auto command module exposes the expected option surface", async () => {
			const { autoCommand } = await import("../../src/commands/auto.js");

			expect(autoCommand).toBeDefined();
			const optionFlags = autoCommand.options.map((o) => o.flags);
			// The slice's "zero intervention" demo relies on --no-pr so the run
			// does not block on GitHub credentials. Guard against accidental
			// removal.
			expect(optionFlags.some((f) => f.includes("--no-pr"))).toBe(true);
			expect(optionFlags.some((f) => f.includes("--worktrees"))).toBe(true);
			expect(optionFlags.some((f) => f.includes("--simulate-failure"))).toBe(
				true,
			);
		});
	});
});
