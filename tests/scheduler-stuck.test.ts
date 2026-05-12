import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DecomposedTask } from "../src/core/decomposer";
import type { IsolationEngine, IsolationResult } from "../src/core/isolation";
import { EventLedger } from "../src/core/ledger";
import {
	actionFingerprint,
	ParallelScheduler,
	StuckDetector,
} from "../src/core/scheduler";
import { StateMachine } from "../src/core/state";
import {
	type EventLog,
	TASK_ABORTED_STUCK_EVENT,
	TASK_STUCK_EVENT,
} from "../src/core/types";

class MockIsolationEngine {
	async createWorktree(
		path: string,
		_worktreeId: string,
		_cwd?: string,
	): Promise<IsolationResult> {
		return { status: "success", message: `mock: ${path}` };
	}
	async destroyWorktree(path: string, _cwd?: string): Promise<IsolationResult> {
		return { status: "success", message: `mock: ${path}` };
	}
}

async function readEvents(filePath: string): Promise<EventLog[]> {
	const content = await readFile(filePath, "utf-8");
	return content
		.split("\n")
		.filter((l) => l.length > 0)
		.map((l) => JSON.parse(l) as EventLog);
}

describe("StuckDetector — ring buffer (M018.B unit)", () => {
	it("(a) emits no stuck signal for 6 unique actions", () => {
		const det = new StuckDetector();
		const results = [
			det.record("a:00000001"),
			det.record("b:00000002"),
			det.record("c:00000003"),
			det.record("d:00000004"),
			det.record("e:00000005"),
			det.record("f:00000006"),
		];
		for (const r of results) {
			expect(r.stuck).toBe(false);
			expect(r.shouldAbort).toBe(false);
		}
	});

	it("(b) flags stuck exactly once when the window saturates with one fingerprint", () => {
		const det = new StuckDetector();
		const fp = "tool:deadbeef";
		const flagged = [
			det.record(fp),
			det.record(fp),
			det.record(fp),
			det.record(fp),
			det.record(fp),
			det.record(fp),
		].filter((r) => r.stuck);
		expect(flagged.length).toBe(1);
	});

	it("(c) resets after agent advances with a distinct action", () => {
		const det = new StuckDetector();
		const fp = "tool:deadbeef";
		// Saturate then trip the detector.
		for (let i = 0; i < StuckDetector.STUCK_WINDOW_SIZE; i++) det.record(fp);
		// Six distinct actions overwrite the window — duplicates drop to 1/6.
		for (let i = 0; i < StuckDetector.STUCK_WINDOW_SIZE; i++) {
			det.record(`escape:${i}`);
		}
		// Saturating again with the same fingerprint should produce a NEW stuck
		// emission, proving the prior state was cleared.
		const reflagged = [
			det.record(fp),
			det.record(fp),
			det.record(fp),
			det.record(fp),
			det.record(fp),
			det.record(fp),
		].filter((r) => r.stuck);
		expect(reflagged.length).toBe(1);
	});

	it("(d) signals abort after 3 consecutive stuck windows", () => {
		const det = new StuckDetector();
		const fpA = "a:11111111";
		const fpB = "b:22222222";
		const fpC = "c:33333333";

		const trip = (fp: string): { stuck: boolean; shouldAbort: boolean } => {
			// Walk the window until the ratio first trips; return that result.
			let captured: { stuck: boolean; shouldAbort: boolean } | undefined;
			for (let i = 0; i < StuckDetector.STUCK_WINDOW_SIZE; i++) {
				const r = det.record(fp);
				if (r.stuck && captured === undefined) captured = r;
			}
			return captured ?? { stuck: false, shouldAbort: false };
		};
		// 3 distinct fingerprints, each saturating the window in turn. The
		// window stays saturated with one dominant fingerprint at every flip
		// (5/6 + a single distinct entry is still >50%), so each saturation
		// counts as a consecutive stuck window without an "escape" in between.
		// We need three separate emissions; assert on the third's shouldAbort.
		const first = trip(fpA);
		expect(first.stuck).toBe(true);
		expect(first.shouldAbort).toBe(false);

		// Re-saturate with a different fingerprint by writing 6 of fpB without
		// reset. After 6 writes the window is all-fpB, ratio 1.0 — stuck again.
		// But stuckAlreadyEmitted is sticky until ratio <= threshold. To get
		// the second emission we must flush the window with a non-stuck state
		// briefly. Use fresh alternating pattern (3+3 split = 50% which is NOT
		// > threshold), then saturate fpB.
		// 3+3 split: ratio = 0.5, threshold is strict >. So fill window with
		// 50/50 split to unset stuckAlreadyEmitted, then re-saturate.
		const halfReset = () => {
			det.record("r1:00000001");
			det.record("r2:00000002");
			det.record("r3:00000003");
			det.record("r4:00000004");
			det.record("r5:00000005");
			det.record("r6:00000006");
		};
		halfReset();
		const second = trip(fpB);
		expect(second.stuck).toBe(true);
		expect(second.shouldAbort).toBe(false);

		halfReset();
		const third = trip(fpC);
		expect(third.stuck).toBe(true);
		expect(third.shouldAbort).toBe(true);
	});

	it("(f) honours APOHARA_STUCK_ABORT_THRESHOLD env override", () => {
		const prev = process.env.APOHARA_STUCK_ABORT_THRESHOLD;
		process.env.APOHARA_STUCK_ABORT_THRESHOLD = "1";
		try {
			const det = new StuckDetector();
			expect(det.abortThreshold).toBe(1);
			const fp = "x:00000099";
			let last = { stuck: false, shouldAbort: false };
			for (let i = 0; i < StuckDetector.STUCK_WINDOW_SIZE; i++) {
				last = det.record(fp);
			}
			expect(last.stuck).toBe(true);
			expect(last.shouldAbort).toBe(true);
		} finally {
			if (prev === undefined) delete process.env.APOHARA_STUCK_ABORT_THRESHOLD;
			else process.env.APOHARA_STUCK_ABORT_THRESHOLD = prev;
		}
	});

	it("actionFingerprint hashes args deterministically and short-prefixes them", () => {
		const fp1 = actionFingerprint("Read", { path: "/foo" });
		const fp2 = actionFingerprint("Read", { path: "/foo" });
		const fp3 = actionFingerprint("Read", { path: "/bar" });
		expect(fp1).toBe(fp2);
		expect(fp1).not.toBe(fp3);
		expect(fp1.startsWith("Read:")).toBe(true);
		expect(fp1.split(":")[1].length).toBe(8);
	});
});

describe("ParallelScheduler — stuck detector integration (M018.B)", () => {
	let scheduler: ParallelScheduler;
	let ledger: EventLedger;
	let stateMachine: StateMachine;
	let ledgerDir: string;
	let ledgerPath: string;

	beforeEach(async () => {
		ledgerDir = await mkdtemp(join(tmpdir(), "apohara-stuck-"));
		ledgerPath = join(ledgerDir, "run-stuck.jsonl");
		ledger = new EventLedger("stuck-test", { filePath: ledgerPath });
		stateMachine = new StateMachine();
		scheduler = new ParallelScheduler(
			new MockIsolationEngine() as unknown as IsolationEngine,
			stateMachine,
			ledger,
			undefined,
			{ worktreePoolSize: 1 },
		);
		await scheduler.initialize();
	});

	afterEach(async () => {
		await scheduler.shutdown();
		await rm(ledgerDir, { recursive: true, force: true });
	});

	it("(e) emits task_stuck with the correct shape on saturation", async () => {
		const task: DecomposedTask = {
			id: "stuck-task",
			description: "loops",
			estimatedComplexity: "low",
			dependencies: [],
		};
		await scheduler.scheduleTask(task);

		const args = { path: "/repeat" };
		let lastResult = { shouldAbort: false };
		for (let i = 0; i < StuckDetector.STUCK_WINDOW_SIZE; i++) {
			lastResult = await scheduler.recordAgentAction(task.id, "Read", args);
		}
		expect(lastResult.shouldAbort).toBe(false);

		const events = await readEvents(ledgerPath);
		const stuckEvents = events.filter((e) => e.type === TASK_STUCK_EVENT);
		expect(stuckEvents.length).toBe(1);

		const ev = stuckEvents[0];
		expect(ev.severity).toBe("warning");
		expect(ev.taskId).toBe("stuck-task");
		expect(ev.payload.taskId).toBe("stuck-task");
		expect(ev.payload.windowSize).toBe(StuckDetector.STUCK_WINDOW_SIZE);
		expect(ev.payload.duplicateThreshold).toBe(
			StuckDetector.DUPLICATE_THRESHOLD,
		);
		expect(typeof ev.payload.fingerprint).toBe("string");
		expect((ev.payload.fingerprint as string).startsWith("Read:")).toBe(true);
		// Hash chain field carried through.
		expect(typeof ev.hash).toBe("string");
		expect(ev.hash?.length).toBe(64);
	});

	it("emits task_aborted_stuck and returns shouldAbort=true after threshold trips", async () => {
		const prev = process.env.APOHARA_STUCK_ABORT_THRESHOLD;
		process.env.APOHARA_STUCK_ABORT_THRESHOLD = "1";
		try {
			const task: DecomposedTask = {
				id: "abort-task",
				description: "loops then aborts",
				estimatedComplexity: "low",
				dependencies: [],
			};
			await scheduler.scheduleTask(task);

			let lastResult = { shouldAbort: false };
			for (let i = 0; i < StuckDetector.STUCK_WINDOW_SIZE; i++) {
				lastResult = await scheduler.recordAgentAction(task.id, "Read", {
					path: "/loop",
				});
			}
			expect(lastResult.shouldAbort).toBe(true);

			const events = await readEvents(ledgerPath);
			const abortEvents = events.filter(
				(e) => e.type === TASK_ABORTED_STUCK_EVENT,
			);
			expect(abortEvents.length).toBe(1);
			expect(abortEvents[0].severity).toBe("error");
			expect(abortEvents[0].payload.taskId).toBe("abort-task");
			expect(abortEvents[0].payload.abortThreshold).toBe(1);
		} finally {
			if (prev === undefined) delete process.env.APOHARA_STUCK_ABORT_THRESHOLD;
			else process.env.APOHARA_STUCK_ABORT_THRESHOLD = prev;
		}
	});
});
