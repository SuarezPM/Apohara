import { describe, it, expect, beforeEach, vi } from "bun:test";
import { TaskDecomposer, type DecompositionResult } from "../src/core/decomposer";
import { ProviderRouter, type LLMResponse } from "../src/providers/router";

// NOTE: We intentionally do NOT mock ProviderRouter here because we need
// to test the real integration between TaskDecomposer and ProviderRouter
// The mock was causing issues with other test files that import the real class

describe("TaskDecomposer Integration", () => {
	let decomposer: TaskDecomposer;
	let mockRouter: ProviderRouter;
	let mockCompletion: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		mockCompletion = vi.fn();
		mockRouter = {
			completion: mockCompletion,
		} as unknown as ProviderRouter;
		decomposer = new TaskDecomposer(mockRouter);
	});

	it("should decompose a prompt into atomic tasks", async () => {
		// Mock LLM response
		const mockLLMResponse: LLMResponse = {
			content: JSON.stringify({
				tasks: [
					{
						id: "setup-deps",
						description: "Install project dependencies",
						estimatedComplexity: "low",
						dependencies: [],
					},
					{
						id: "impl-auth",
						description: "Implement authentication logic",
						estimatedComplexity: "high",
						dependencies: ["setup-deps"],
					},
					{
						id: "write-tests",
						description: "Write unit tests for auth",
						estimatedComplexity: "medium",
						dependencies: ["impl-auth"],
					},
				],
			}),
			usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
			costUsd: 0.002,
			provider: "opencode-go",
			model: "test-model",
			durationMs: 500,
		};

		(mockRouter.completion as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
			mockLLMResponse,
		);

		const result = await decomposer.decompose("Build authentication system");

		expect(result).toBeDefined();
		expect(result.originalPrompt).toBe("Build authentication system");
		expect(result.tasks).toHaveLength(3);
		expect(result.tasks[0].id).toBe("setup-deps");
		expect(result.tasks[0].dependencies).toEqual([]);
		expect(result.tasks[1].dependencies).toContain("setup-deps");
	});

	it("should handle JSON wrapped in markdown code blocks", async () => {
		const mockLLMResponse: LLMResponse = {
			content: `\`\`\`json
{
  "tasks": [
    {
      "id": "init-project",
      "description": "Initialize project",
      "estimatedComplexity": "low",
      "dependencies": []
    }
  ]
}
\`\`\`
`,
			usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
			costUsd: 0.001,
			provider: "deepseek",
			model: "deepseek-coder",
			durationMs: 300,
		};

		(mockRouter.completion as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
			mockLLMResponse,
		);

		const result = await decomposer.decompose("Initialize project");

		expect(result.tasks).toHaveLength(1);
		expect(result.tasks[0].id).toBe("init-project");
	});

	it("should validate task dependencies reference valid task IDs", async () => {
		const mockLLMResponse: LLMResponse = {
			content: JSON.stringify({
				tasks: [
					{
						id: "task-a",
						description: "Task A",
						estimatedComplexity: "low",
						dependencies: ["nonexistent-task"],
					},
				],
			}),
			usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
			costUsd: 0.001,
			provider: "opencode-go",
			model: "test",
			durationMs: 100,
		};

		(mockRouter.completion as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
			mockLLMResponse,
		);

		await expect(decomposer.decompose("Test")).rejects.toThrow(
			"has invalid dependency",
		);
	});

	it("should throw when LLM response has invalid structure", async () => {
		const mockLLMResponse: LLMResponse = {
			content: "This is not JSON",
			usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
			costUsd: 0.001,
			provider: "test",
			model: "test",
			durationMs: 100,
		};

		(mockRouter.completion as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
			mockLLMResponse,
		);

		await expect(decomposer.decompose("Test")).rejects.toThrow(
			"Failed to parse",
		);
	});

	it("should throw when response is missing tasks array", async () => {
		const mockLLMResponse: LLMResponse = {
			content: JSON.stringify({ other: "data" }),
			usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
			costUsd: 0.001,
			provider: "test",
			model: "test",
			durationMs: 100,
		};

		(mockRouter.completion as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
			mockLLMResponse,
		);

		await expect(decomposer.decompose("Test")).rejects.toThrow(
			"missing tasks array",
		);
	});

	it("should accept all complexity levels", async () => {
		const mockLLMResponse: LLMResponse = {
			content: JSON.stringify({
				tasks: [
					{ id: "low", description: "Low", estimatedComplexity: "low", dependencies: [] },
					{ id: "medium", description: "Medium", estimatedComplexity: "medium", dependencies: [] },
					{ id: "high", description: "High", estimatedComplexity: "high", dependencies: [] },
				],
			}),
			usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
			costUsd: 0.001,
			provider: "test",
			model: "test",
			durationMs: 100,
		};

		(mockRouter.completion as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
			mockLLMResponse,
		);

		const result = await decomposer.decompose("Test all levels");

		expect(result.tasks[0].estimatedComplexity).toBe("low");
		expect(result.tasks[1].estimatedComplexity).toBe("medium");
		expect(result.tasks[2].estimatedComplexity).toBe("high");
	});
});