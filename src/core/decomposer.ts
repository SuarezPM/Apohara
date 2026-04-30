import { type LLMMessage, ProviderRouter } from "../providers/router";
import { routeTaskWithFallback } from "./agent-router";
import type { TaskRole } from "./types";

export interface DecomposedTask {
	id: string;
	description: string;
	estimatedComplexity: "low" | "medium" | "high";
	dependencies: string[];
	role: TaskRole;
	files?: string[];
}

export interface DecompositionResult {
	tasks: DecomposedTask[];
	originalPrompt: string;
}

export class TaskDecomposer {
	private router: ProviderRouter;

	constructor(router?: ProviderRouter) {
		this.router = router || new ProviderRouter();
	}

	/**
	 * Decomposes a high-level prompt into atomic tasks using an LLM.
	 */
	public async decompose(prompt: string): Promise<DecompositionResult> {
		const messages: LLMMessage[] = [
			{
				role: "system",
				content: `You are a task decomposition engine. Given a user request, break it down into atomic, actionable tasks.

Output format: Return a JSON object with a "tasks" array. Each task must have:
- id: A short kebab-case identifier (e.g., "setup-deps", "impl-core")
- description: Clear description of what to do
- estimatedComplexity: "low", "medium", or "high"
- dependencies: Array of task IDs that must complete before this one
- role: One of "research", "planning", "execution", or "verification". 
  - "research": Tasks that gather information, search docs, or explore codebase
  - "planning": Tasks that decompose milestones, create plans, or design architecture
  - "execution": Tasks that implement code, write files, or modify the codebase
  - "verification": Tasks that test, review, audit, or validate implementations
- files: Array of file paths likely to be created or modified (e.g., "src/main.ts", "tests/integration.test.ts"). Be specific but reasonable. Empty array if no files needed.

Rules:
- Tasks should be independently implementable when dependencies are met
- Prefer many small tasks over few large ones
- Include setup, implementation, and verification tasks
- Dependencies must reference valid task IDs

Example:
{
  "tasks": [
    {
      "id": "setup-project",
      "description": "Initialize project structure and dependencies",
      "estimatedComplexity": "low",
      "dependencies": [],
      "role": "execution",
      "files": ["package.json", "tsconfig.json", "src/index.ts"]
    },
    {
      "id": "impl-core",
      "description": "Implement the core functionality",
      "estimatedComplexity": "high",
      "dependencies": ["setup-project"],
      "role": "execution",
      "files": ["src/core/handler.ts", "src/types.ts"]
    }
  ]
}`,
			},
			{
				role: "user",
				content: `Decompose this request into tasks: ${prompt}`,
			},
		];

		// Use agent-router for role-based provider selection
		// Decomposition is a "planning" task, which maps to Gemini
		const result = await routeTaskWithFallback("planning", { messages }, this.router);
		const response = result.response;

		// Parse the LLM response - it should be JSON
		let parsed: { tasks: DecomposedTask[] };
		try {
			// Try to extract JSON from the response (LLM might wrap it in markdown)
			const content = response.content.trim();
			const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) ||
				content.match(/```\s*([\s\S]*?)```/) || [null, content];
			const jsonStr = jsonMatch[1] || content;
			parsed = JSON.parse(jsonStr) as { tasks: DecomposedTask[] };
		} catch (_error) {
			throw new Error(
				`Failed to parse LLM decomposition response: ${response.content}`,
			);
		}

		// Validate the structure
		if (!parsed.tasks || !Array.isArray(parsed.tasks)) {
			throw new Error("Invalid decomposition: missing tasks array");
		}

		// Validate dependencies reference existing tasks
		const taskIds = new Set(parsed.tasks.map((t) => t.id));
		for (const task of parsed.tasks) {
			for (const dep of task.dependencies) {
				if (!taskIds.has(dep)) {
					throw new Error(`Task ${task.id} has invalid dependency: ${dep}`);
				}
			}
			// Default role to "execution" if not provided (backwards compatibility)
			if (!task.role) {
				task.role = "execution";
			}
			// Validate role is a valid TaskRole
			if (!["research", "planning", "execution", "verification"].includes(task.role)) {
				task.role = "execution";
			}
			// Handle estimated files gracefully - default to empty array if missing or invalid
			if (!task.files || !Array.isArray(task.files)) {
				task.files = [];
			}
			// Map estimatedFiles to files if LLM uses different field name
			if ((task as any).estimatedFiles && !task.files?.length) {
				task.files = (task as any).estimatedFiles;
			}
		}

		// Detect dependency cycles using DFS
		const cycle = this.detectCycle(parsed.tasks);
		if (cycle) {
			throw new Error(
				`Dependency cycle detected: ${cycle.join(" -> ")}. ` +
				"Please ensure dependencies form a DAG (Directed Acyclic Graph).",
			);
		}

		return {
			tasks: parsed.tasks,
			originalPrompt: prompt,
		};
	}

	/**
	 * Detects cycles in the dependency graph using DFS.
	 * Returns the cyclic path if a cycle is found, otherwise null.
	 */
	private detectCycle(tasks: DecomposedTask[]): string[] | null {
		const graph = new Map<string, string[]>();
		for (const task of tasks) {
			graph.set(task.id, task.dependencies);
		}

		const visited = new Set<string>();
		const recursionStack = new Set<string>();
		const path: string[] = [];

		const dfs = (taskId: string, currentPath: string[]): string[] | null => {
			visited.add(taskId);
			recursionStack.add(taskId);
			currentPath.push(taskId);

			const deps = graph.get(taskId) || [];
			for (const dep of deps) {
				if (!visited.has(dep)) {
					const cycle = dfs(dep, currentPath);
					if (cycle) return cycle;
				} else if (recursionStack.has(dep)) {
					// Found a cycle - return path from the cycle start to the end
					const cycleStart = currentPath.indexOf(dep);
					return [...currentPath.slice(cycleStart), dep];
				}
			}

			recursionStack.delete(taskId);
			currentPath.pop();
			return null;
		};

		for (const task of tasks) {
			if (!visited.has(task.id)) {
				const cycle = dfs(task.id, []);
				if (cycle) return cycle;
			}
		}

		return null;
	}
}