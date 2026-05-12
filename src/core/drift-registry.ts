import type { DriftEvent } from "./types.js";

export type DriftClassification = "innocuous" | "recoverable" | "aborting";

const READ_ONLY_TOOLS = new Set([
	"read",
	"ls",
	"grep",
	"find",
	"tree",
	"cat",
	"head",
	"tail",
]);

/**
 * M018.E — Pattern E: drift reconciliation registry.
 *
 * Records per-task drift events and classifies each one as innocuous,
 * recoverable, or aborting. Stateless classifier — same input always yields
 * the same classification, so it is safe to call from replay paths.
 *
 * Wiring into the subagent loop is a follow-up (M018.E.2) behind the
 * `APOHARA_DRIFT_DETECTION=1` opt-in flag. The registry itself is pure
 * append + classify, so it has no side effects on the run until wired.
 */
export class DriftRegistry {
	private events = new Map<string, DriftEvent[]>();

	record(taskId: string, event: DriftEvent): DriftClassification {
		const list = this.events.get(taskId) ?? [];
		list.push(event);
		this.events.set(taskId, list);
		return DriftRegistry.classify(event);
	}

	list(taskId: string): readonly DriftEvent[] {
		return this.events.get(taskId) ?? [];
	}

	clear(taskId: string): void {
		this.events.delete(taskId);
	}

	taskIds(): readonly string[] {
		return [...this.events.keys()];
	}

	static classify(event: DriftEvent): DriftClassification {
		// File scope violations always abort. Self-reported severity cannot
		// wave through a scope breach.
		if (event.kind === "file_scope_violation") return "aborting";

		// Read-only tool usage off-plan is innocuous regardless of severity.
		if (event.kind === "off_plan_tool") {
			const tool = readToolName(event.observed);
			if (tool && READ_ONLY_TOOLS.has(tool.toLowerCase())) {
				return "innocuous";
			}
		}

		switch (event.severity) {
			case "error":
				return "aborting";
			case "warning":
				return "recoverable";
			default:
				return "innocuous";
		}
	}
}

function readToolName(observed: unknown): string | null {
	if (typeof observed !== "object" || observed === null) return null;
	const obj = observed as Record<string, unknown>;
	const name = obj.toolName ?? obj.tool;
	return typeof name === "string" ? name : null;
}
