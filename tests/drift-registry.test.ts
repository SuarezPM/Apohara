import { describe, expect, test } from "bun:test";
import {
	type DriftClassification,
	DriftRegistry,
} from "../src/core/drift-registry.js";
import type { DriftEvent } from "../src/core/types.js";

function ev(overrides: Partial<DriftEvent> = {}): DriftEvent {
	return {
		kind: "tool_args_diff",
		expected: {},
		observed: {},
		severity: "info",
		timestamp: 1_700_000_000_000,
		...overrides,
	};
}

describe("DriftRegistry — M018 Pattern E", () => {
	describe("classify by severity", () => {
		test("severity=info → innocuous", () => {
			expect(DriftRegistry.classify(ev({ severity: "info" }))).toBe(
				"innocuous",
			);
		});

		test("severity=warning → recoverable", () => {
			expect(DriftRegistry.classify(ev({ severity: "warning" }))).toBe(
				"recoverable",
			);
		});

		test("severity=error → aborting", () => {
			expect(DriftRegistry.classify(ev({ severity: "error" }))).toBe(
				"aborting",
			);
		});
	});

	describe("classify by kind overrides", () => {
		test("file_scope_violation always aborts even when severity=info", () => {
			expect(
				DriftRegistry.classify(
					ev({ kind: "file_scope_violation", severity: "info" }),
				),
			).toBe("aborting");
		});

		test("file_scope_violation aborts even when severity=warning", () => {
			expect(
				DriftRegistry.classify(
					ev({ kind: "file_scope_violation", severity: "warning" }),
				),
			).toBe("aborting");
		});

		test("off_plan_tool with read-only tool → innocuous (overrides warning)", () => {
			expect(
				DriftRegistry.classify(
					ev({
						kind: "off_plan_tool",
						severity: "warning",
						observed: { toolName: "read" },
					}),
				),
			).toBe("innocuous");
		});

		test("off_plan_tool with 'grep' tool → innocuous (overrides error)", () => {
			expect(
				DriftRegistry.classify(
					ev({
						kind: "off_plan_tool",
						severity: "error",
						observed: { toolName: "grep" },
					}),
				),
			).toBe("innocuous");
		});

		test("off_plan_tool with mutating tool (write) → severity drives result", () => {
			expect(
				DriftRegistry.classify(
					ev({
						kind: "off_plan_tool",
						severity: "warning",
						observed: { toolName: "write" },
					}),
				),
			).toBe("recoverable");
		});

		test("off_plan_tool reads the 'tool' alias too", () => {
			expect(
				DriftRegistry.classify(
					ev({
						kind: "off_plan_tool",
						severity: "warning",
						observed: { tool: "ls" },
					}),
				),
			).toBe("innocuous");
		});

		test("off_plan_tool is case-insensitive on tool names", () => {
			expect(
				DriftRegistry.classify(
					ev({
						kind: "off_plan_tool",
						severity: "warning",
						observed: { toolName: "GREP" },
					}),
				),
			).toBe("innocuous");
		});
	});

	describe("record + list", () => {
		test("records events per task and returns classification", () => {
			const r = new DriftRegistry();
			const cls: DriftClassification = r.record(
				"t1",
				ev({ severity: "error" }),
			);
			expect(cls).toBe("aborting");
			expect(r.list("t1")).toHaveLength(1);
		});

		test("appends multiple events for the same task", () => {
			const r = new DriftRegistry();
			r.record("t1", ev({ kind: "tool_args_diff" }));
			r.record("t1", ev({ kind: "off_plan_tool" }));
			r.record("t1", ev({ kind: "unexpected_completion" }));
			expect(r.list("t1")).toHaveLength(3);
		});

		test("isolates events per task", () => {
			const r = new DriftRegistry();
			r.record("t1", ev({}));
			r.record("t2", ev({}));
			r.record("t2", ev({}));
			expect(r.list("t1")).toHaveLength(1);
			expect(r.list("t2")).toHaveLength(2);
		});

		test("list() returns empty array for unknown task", () => {
			const r = new DriftRegistry();
			expect(r.list("nope")).toHaveLength(0);
		});

		test("clear() removes a task's drift log", () => {
			const r = new DriftRegistry();
			r.record("t1", ev({}));
			r.record("t2", ev({}));
			r.clear("t1");
			expect(r.list("t1")).toHaveLength(0);
			expect(r.list("t2")).toHaveLength(1);
		});

		test("taskIds() reflects current registry contents", () => {
			const r = new DriftRegistry();
			r.record("a", ev({}));
			r.record("b", ev({}));
			r.clear("a");
			expect(r.taskIds()).toEqual(["b"]);
		});
	});
});
