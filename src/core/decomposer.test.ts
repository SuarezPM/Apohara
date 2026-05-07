import { describe, test, expect, vi, beforeEach } from "vitest";
import { TaskDecomposer, type DecomposedTask, type DecompositionResult } from "./decomposer";
import type { TaskRole } from "./types";

// Mock the routeTaskWithFallback function - it returns { provider, response }
vi.mock("./agent-router", () => ({
	routeTaskWithFallback: vi.fn(),
}));

import { routeTaskWithFallback } from "./agent-router";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockRouteTaskWithFallback = routeTaskWithFallback as any;

describe("TaskDecomposer", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// Test 1: files field serialization/deserialization
	test("files field is preserved through decomposition round-trip", async () => {
		const mockLLMResponse = {
			content: JSON.stringify({
				tasks: [
					{
						id: "setup-deps",
						description: "Install project dependencies",
						estimatedComplexity: "low",
						dependencies: [],
						role: "execution",
						files: ["package.json", "bun.lockb"],
					},
					{
						id: "impl-core",
						description: "Implement core functionality",
						estimatedComplexity: "high",
						dependencies: ["setup-deps"],
						role: "execution",
						files: ["src/core/handler.ts", "src/types.ts", "tests/core.test.ts"],
					},
				],
			}),
			usage: { inputTokens: 100, outputTokens: 200 },
		};

		mockRouteTaskWithFallback.mockResolvedValue({
			provider: "gemini",
			response: mockLLMResponse,
		});

		const decomposer = new TaskDecomposer();
		const result = await decomposer.decompose("Build a task manager");

		expect(result.tasks).toHaveLength(2);
		// Tasks are sorted by ID in injectCollisionEdges
		const setupTask = result.tasks.find(t => t.id === "setup-deps")!;
		const implTask = result.tasks.find(t => t.id === "impl-core")!;
		
		expect(setupTask.files).toEqual(["package.json", "bun.lockb"]);
		expect(implTask.files).toEqual([
			"src/core/handler.ts",
			"src/types.ts",
			"tests/core.test.ts",
		]);
	});

	// Test 2: dependency cycle detection with clear error
	test("throws descriptive error when dependency cycle is detected", async () => {
		const mockLLMResponse = {
			content: JSON.stringify({
				tasks: [
					{
						id: "task-a",
						description: "Task A",
						estimatedComplexity: "medium",
						dependencies: ["task-c"], // Cycle: A -> C -> B -> A
						role: "execution",
						files: [],
					},
					{
						id: "task-b",
						description: "Task B",
						estimatedComplexity: "medium",
						dependencies: ["task-a"],
						role: "execution",
						files: [],
					},
					{
						id: "task-c",
						description: "Task C",
						estimatedComplexity: "medium",
						dependencies: ["task-b"],
						role: "execution",
						files: [],
					},
				],
			}),
			usage: { inputTokens: 100, outputTokens: 200 },
		};

		mockRouteTaskWithFallback.mockResolvedValue({
			provider: "gemini",
			response: mockLLMResponse,
		});

		const decomposer = new TaskDecomposer();
		await expect(decomposer.decompose("Test cycle")).rejects.toThrow(
			/Dependency cycle detected/,
		);
	});

	// Test 3: role defaults to execution when invalid
	test("defaults role to execution when invalid role is provided", async () => {
		const mockLLMResponse = {
			content: JSON.stringify({
				tasks: [
					{
						id: "invalid-role-task",
						description: "Task with invalid role",
						estimatedComplexity: "medium",
						dependencies: [],
						role: "invalid-role" as TaskRole,
						files: [],
					},
					{
						id: "missing-role-task",
						description: "Task without role field",
						estimatedComplexity: "low",
						dependencies: [],
						// role field omitted entirely
						files: [],
					},
				],
			}),
			usage: { inputTokens: 100, outputTokens: 200 },
		};

		mockRouteTaskWithFallback.mockResolvedValue({
			provider: "gemini",
			response: mockLLMResponse,
		});

		const decomposer = new TaskDecomposer();
		const result = await decomposer.decompose("Test role defaults");

		expect(result.tasks[0].role).toBe("execution");
		expect(result.tasks[1].role).toBe("execution");
	});

	// Test 4: empty files array handling
	test("handles empty files array correctly", async () => {
		const mockLLMResponse = {
			content: JSON.stringify({
				tasks: [
					{
						id: "no-files-task",
						description: "Task with no files",
						estimatedComplexity: "low",
						dependencies: [],
						role: "verification",
						files: [] as string[],
					},
					{
						id: "missing-files-task",
						description: "Task missing files field",
						estimatedComplexity: "medium",
						dependencies: ["no-files-task"],
						role: "verification",
						// files field completely missing
					},
				],
			}),
			usage: { inputTokens: 100, outputTokens: 200 },
		};

		mockRouteTaskWithFallback.mockResolvedValue({
			provider: "gemini",
			response: mockLLMResponse,
		});

		const decomposer = new TaskDecomposer();
		const result = await decomposer.decompose("Test empty files");

		expect(result.tasks[0].files).toEqual([]);
		expect(result.tasks[1].files).toEqual([]);
		expect(Array.isArray(result.tasks[0].files)).toBe(true);
	});

	// Test 5: LLM response parse errors produce helpful messages
	test("provides helpful error message when LLM response cannot be parsed", async () => {
		const mockLLMResponse = {
			content: "This is not valid JSON at all { broken: json",
			usage: { inputTokens: 100, outputTokens: 200 },
		};

		mockRouteTaskWithFallback.mockResolvedValue({
			provider: "gemini",
			response: mockLLMResponse,
		});

		const decomposer = new TaskDecomposer();
		await expect(decomposer.decompose("Test parse error")).rejects.toThrow(
			/Failed to parse LLM decomposition response/,
		);
	});

	test("provides helpful error message for non-object JSON response", async () => {
		const mockLLMResponse = {
			content: "Just a plain string response",
			usage: { inputTokens: 100, outputTokens: 200 },
		};

		mockRouteTaskWithFallback.mockResolvedValue({
			provider: "gemini",
			response: mockLLMResponse,
		});

		const decomposer = new TaskDecomposer();
		await expect(decomposer.decompose("Test parse error")).rejects.toThrow(
			/Failed to parse LLM decomposition response/,
		);
	});

	test("validates that tasks array exists in parsed response", async () => {
		const mockLLMResponse = {
			content: JSON.stringify({
				notTasks: "this is wrong",
			}),
			usage: { inputTokens: 100, outputTokens: 200 },
		};

		mockRouteTaskWithFallback.mockResolvedValue({
			provider: "gemini",
			response: mockLLMResponse,
		});

		const decomposer = new TaskDecomposer();
		await expect(decomposer.decompose("Test missing tasks")).rejects.toThrow(
			/Invalid decomposition: missing tasks array/,
		);
	});

	// Additional test: cycle detection with self-referencing dependency
	test("detects self-referencing dependency as cycle", async () => {
		const mockLLMResponse = {
			content: JSON.stringify({
				tasks: [
					{
						id: "self-cycle",
						description: "Task that depends on itself",
						estimatedComplexity: "low",
						dependencies: ["self-cycle"], // Direct self-reference
						role: "execution",
						files: [],
					},
				],
			}),
			usage: { inputTokens: 100, outputTokens: 200 },
		};

		mockRouteTaskWithFallback.mockResolvedValue({
			provider: "gemini",
			response: mockLLMResponse,
		});

		const decomposer = new TaskDecomposer();
		await expect(decomposer.decompose("Test self cycle")).rejects.toThrow(
			/Dependency cycle detected/,
		);
	});

	// Additional test: estimatedFiles field mapping
	test("maps estimatedFiles to files when files is empty", async () => {
		const mockLLMResponse = {
			content: JSON.stringify({
				tasks: [
					{
						id: "mapped-task",
						description: "Task using estimatedFiles field",
						estimatedComplexity: "medium",
						dependencies: [],
						role: "execution",
						estimatedFiles: ["src/mapped.ts", "tests/mapped.test.ts"],
					},
				],
			}),
			usage: { inputTokens: 100, outputTokens: 200 },
		};

		mockRouteTaskWithFallback.mockResolvedValue({
			provider: "gemini",
			response: mockLLMResponse,
		});

		const decomposer = new TaskDecomposer();
		const result = await decomposer.decompose("Test field mapping");

		// Should map estimatedFiles to files
		expect(result.tasks[0].files).toEqual([
			"src/mapped.ts",
			"tests/mapped.test.ts",
		]);
	});

	// Test: Invalid dependency reference error
	test("throws error when task references non-existent dependency", async () => {
		const mockLLMResponse = {
			content: JSON.stringify({
				tasks: [
					{
						id: "valid-task",
						description: "Valid task",
						estimatedComplexity: "low",
						dependencies: ["non-existent-task"],
						role: "execution",
						files: [],
					},
				],
			}),
			usage: { inputTokens: 100, outputTokens: 200 },
		};

		mockRouteTaskWithFallback.mockResolvedValue({
			provider: "gemini",
			response: mockLLMResponse,
		});

		const decomposer = new TaskDecomposer();
		await expect(decomposer.decompose("Test invalid dep")).rejects.toThrow(
			/has invalid dependency/,
		);
	});

	// Test: Markdown-wrapped JSON parsing
	test("parses JSON wrapped in markdown code blocks", async () => {
		const mockLLMResponse = {
			content: "```json\n" + JSON.stringify({
				tasks: [
					{
						id: "markdown-task",
						description: "Task in markdown",
						estimatedComplexity: "low",
						dependencies: [],
						role: "research",
						files: ["src/research.ts"],
					},
				],
			}) + "\n```",
			usage: { inputTokens: 100, outputTokens: 200 },
		};

		mockRouteTaskWithFallback.mockResolvedValue({
			provider: "gemini",
			response: mockLLMResponse,
		});

		const decomposer = new TaskDecomposer();
		const result = await decomposer.decompose("Test markdown parse");

		expect(result.tasks).toHaveLength(1);
		expect(result.tasks[0].id).toBe("markdown-task");
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// DAG Hardening — Phase 3: injectCollisionEdges() unit tests
// These tests exercise the collision detection pass via the public decompose()
// API with controlled LLM mock output.
// ─────────────────────────────────────────────────────────────────────────────
describe("injectCollisionEdges (via decompose)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	/**
	 * Helper: mock LLM to return a given task array, then call decompose().
	 */
	async function decomposeWith(
		tasks: Array<{
			id: string;
			description?: string;
			estimatedComplexity?: string;
			dependencies?: string[];
			role?: string;
			files?: string[];
			targetFiles?: string[];
		}>,
	) {
		const mockRouteTaskWithFallback = (await import("./agent-router"))
			.routeTaskWithFallback as ReturnType<typeof vi.fn>;
		mockRouteTaskWithFallback.mockResolvedValue({
			provider: "gemini",
			response: {
				content: JSON.stringify({
					tasks: tasks.map((t) => ({
						id: t.id,
						description: t.description ?? "desc",
						estimatedComplexity: t.estimatedComplexity ?? "low",
						dependencies: t.dependencies ?? [],
						role: t.role ?? "execution",
						files: t.files ?? [],
						targetFiles: t.targetFiles ?? [],
					})),
				}),
				usage: { inputTokens: 10, outputTokens: 10 },
			},
		});

		const decomposer = new TaskDecomposer(undefined, null);
		return decomposer.decompose("test prompt");
	}

	test("injects implicit edge when two tasks share a targetFile", async () => {
		const result = await decomposeWith([
			{
				id: "task-b",
				targetFiles: ["src/auth.ts", "src/router.ts"],
			},
			{
				id: "task-a",
				targetFiles: ["src/auth.ts"],
			},
		]);

		// After sort: task-a (lower id) runs first, task-b waits for it
		const taskB = result.tasks.find((t) => t.id === "task-b")!;
		expect(taskB.dependencies).toContain("task-a");
		expect(taskB.implicitDependencies).toContain("task-a");
	});

	test("does NOT inject edge when targetFiles are completely disjoint", async () => {
		const result = await decomposeWith([
			{ id: "task-a", targetFiles: ["src/auth.ts"] },
			{ id: "task-b", targetFiles: ["src/router.ts"] },
		]);

		const taskA = result.tasks.find((t) => t.id === "task-a")!;
		const taskB = result.tasks.find((t) => t.id === "task-b")!;
		expect(taskA.dependencies).toEqual([]);
		expect(taskB.dependencies).toEqual([]);
	});

	test("does NOT inject duplicate edge when dependency already declared explicitly", async () => {
		const result = await decomposeWith([
			{ id: "task-a", targetFiles: ["src/auth.ts"] },
			{
				id: "task-b",
				targetFiles: ["src/auth.ts"],
				dependencies: ["task-a"], // already declared
			},
		]);

		const taskB = result.tasks.find((t) => t.id === "task-b")!;
		const taskADeps = taskB.dependencies.filter((d) => d === "task-a");
		expect(taskADeps).toHaveLength(1); // no duplicate
	});

	test("freely parallelizes tasks with empty targetFiles", async () => {
		const result = await decomposeWith([
			{ id: "task-a", targetFiles: [] },
			{ id: "task-b", targetFiles: [] },
		]);

		const taskA = result.tasks.find((t) => t.id === "task-a")!;
		const taskB = result.tasks.find((t) => t.id === "task-b")!;
		expect(taskA.dependencies).toEqual([]);
		expect(taskB.dependencies).toEqual([]);
	});

	test("gracefully defaults missing targetFiles to [] without throwing", async () => {
		// LLM omits targetFiles field entirely on one task
		const mockRouteTaskWithFallback = (await import("./agent-router"))
			.routeTaskWithFallback as ReturnType<typeof vi.fn>;
		mockRouteTaskWithFallback.mockResolvedValue({
			provider: "gemini",
			response: {
				content: JSON.stringify({
					tasks: [
						{
							id: "no-target",
							description: "Missing targetFiles",
							estimatedComplexity: "low",
							dependencies: [],
							role: "execution",
							files: [],
							// targetFiles intentionally omitted
						},
					],
				}),
				usage: { inputTokens: 10, outputTokens: 10 },
			},
		});

		const decomposer = new TaskDecomposer(undefined, null);
		const result = await decomposer.decompose("test graceful");

		expect(result.tasks[0].targetFiles).toEqual([]);
	});

	test("deterministic tie-breaking: lower task ID always runs first", async () => {
		// z-task and a-task both claim the same file
		const result = await decomposeWith([
			{ id: "z-task", targetFiles: ["src/shared.ts"] },
			{ id: "a-task", targetFiles: ["src/shared.ts"] },
		]);

		// a-task (lower ID alphabetically) should run first — z-task waits
		const zTask = result.tasks.find((t) => t.id === "z-task")!;
		const aTask = result.tasks.find((t) => t.id === "a-task")!;
		expect(zTask.dependencies).toContain("a-task");
		expect(aTask.dependencies).not.toContain("z-task");
	});

	test("injected edges are flagged in implicitDependencies but not the original dependencies field when not already present", async () => {
		const result = await decomposeWith([
			{ id: "task-a", targetFiles: ["src/config.ts"] },
			{ id: "task-b", targetFiles: ["src/config.ts"] },
		]);

		const taskB = result.tasks.find((t) => t.id === "task-b")!;
		// The edge appears in BOTH dependencies (for execution ordering)
		// AND implicitDependencies (for observability/logging)
		expect(taskB.dependencies).toContain("task-a");
		expect(taskB.implicitDependencies).toContain("task-a");
	});
});