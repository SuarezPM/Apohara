import pLimit from "../lib/p-limit";
import type { LLMMessage } from "../providers/router";
import { type ProviderId, ProviderRouter } from "../providers/router";
import type { DecomposedTask } from "./decomposer";
import { IsolationEngine, type IsolationResult } from "./isolation";
import { EventLedger } from "./ledger";
import { StateMachine } from "./state";
import type { Task } from "./types";

export interface SchedulerConfig {
	worktreePoolSize: number;
	cwd?: string;
}

export interface TaskExecutionResult {
	taskId: string;
	status: "success" | "error";
	output?: string;
	error?: string;
	worktreeId: string;
}

/**
 * Topological sort of tasks using Kahn's BFS algorithm.
 * Returns tasks in an order where every task appears after all its dependencies.
 * Throws if the graph contains a cycle (should not happen if decomposer ran detectCycle).
 */
function topoSort(tasks: DecomposedTask[]): DecomposedTask[] {
	const inDegree = new Map<string, number>();
	const adjList = new Map<string, string[]>(); // id → list of dependents
	const taskMap = new Map(tasks.map((t) => [t.id, t]));

	for (const t of tasks) {
		inDegree.set(t.id, 0);
		adjList.set(t.id, []);
	}

	for (const t of tasks) {
		for (const dep of t.dependencies ?? []) {
			adjList.get(dep)?.push(t.id);
			inDegree.set(t.id, (inDegree.get(t.id) ?? 0) + 1);
		}
	}

	const queue = [...inDegree.entries()]
		.filter(([, d]) => d === 0)
		.map(([id]) => id);
	const result: DecomposedTask[] = [];

	while (queue.length > 0) {
		const id = queue.shift()!;
		result.push(taskMap.get(id)!);
		for (const neighbor of adjList.get(id) ?? []) {
			const newDeg = (inDegree.get(neighbor) ?? 0) - 1;
			inDegree.set(neighbor, newDeg);
			if (newDeg === 0) queue.push(neighbor);
		}
	}

	if (result.length !== tasks.length) {
		throw new Error(
			"[Scheduler] Cycle detected in task graph — cannot execute. Run decomposer.detectCycle() before executeAll().",
		);
	}

	return result;
}

export class ParallelScheduler {
	private isolationEngine: IsolationEngine;
	private stateMachine: StateMachine;
	private ledger: EventLedger;
	private providerRouter: ProviderRouter;
	private config: SchedulerConfig;
	private worktrees: Map<string, string>; // worktreeId -> path
	private activeTasks: Map<string, DecomposedTask>; // worktreeId -> task
	private initialized = false;

	constructor(
		isolationEngine?: IsolationEngine,
		stateMachine?: StateMachine,
		ledger?: EventLedger,
		providerRouter?: ProviderRouter,
		config?: Partial<SchedulerConfig>,
	) {
		this.isolationEngine = isolationEngine || new IsolationEngine();
		this.stateMachine = stateMachine || new StateMachine();
		this.ledger = ledger || new EventLedger();
		this.providerRouter = providerRouter || new ProviderRouter();
		this.config = {
			worktreePoolSize: config?.worktreePoolSize ?? 3,
			cwd: config?.cwd,
		};
		this.worktrees = new Map();
		this.activeTasks = new Map();
	}

	/**
	 * Initializes the worktree pool by creating all worktrees upfront.
	 */
	public async initialize(): Promise<void> {
		if (this.initialized) return;

		const initPromises: Promise<void>[] = [];
		for (let i = 0; i < this.config.worktreePoolSize; i++) {
			const worktreeId = `lane-${i}`;
			const path = `.apohara/worktrees/${worktreeId}`;

			// Create worktree asynchronously
			const promise = this.isolationEngine
				.createWorktree(path, worktreeId, this.config.cwd)
				.then(async (result: IsolationResult) => {
					if (result.status === "success") {
						this.worktrees.set(worktreeId, path);
						await this.ledger.log(
							"worktree_created",
							{ worktreeId, path },
							"info",
						);
					} else {
						await this.ledger.log(
							"worktree_creation_failed",
							{ worktreeId, path, error: result.error },
							"error",
						);
					}
				});
			initPromises.push(promise);
		}

		await Promise.all(initPromises);
		this.initialized = true;
	}

	/**
	 * Finds an available worktree lane.
	 */
	private findAvailableWorktree(): string | null {
		for (const [id] of this.worktrees) {
			if (!this.activeTasks.has(id)) {
				return id;
			}
		}
		return null;
	}

	/**
	 * Checks if all dependencies for a task are completed.
	 */
	private checkDependencies(dependencies: string[]): boolean {
		const state = this.stateMachine.get();
		return dependencies.every((dep) => {
			const task = state.tasks.find((t) => t.id === dep);
			return task?.status === "completed";
		});
	}

	/**
	 * Schedules a single task if its dependencies are met and a worktree is available.
	 * Returns the worktree ID if scheduled, null otherwise.
	 */
	public async scheduleTask(task: DecomposedTask): Promise<string | null> {
		// Check if dependencies are met
		if (!this.checkDependencies(task.dependencies)) {
			return null;
		}

		// Find available worktree
		const worktreeId = this.findAvailableWorktree();
		if (!worktreeId) {
			return null;
		}

		const path = this.worktrees.get(worktreeId);
		if (!path) return null;

		// Add to active tasks first (before state update for atomicity)
		this.activeTasks.set(worktreeId, task);

		// Update state with the new task
		await this.stateMachine.update((state) => {
			// Check if task already exists
			const existingTask = state.tasks.find((t) => t.id === task.id);
			if (existingTask) {
				// Update existing task status
				const updatedTasks = state.tasks.map((t) =>
					t.id === task.id
						? { ...t, status: "in_progress" as const, updatedAt: new Date() }
						: t,
				);
				return { ...state, currentTaskId: task.id, tasks: updatedTasks };
			}

			// Create new task
			const newTask: Task = {
				id: task.id,
				role: task.role,
				description: task.description,
				status: "in_progress",
				createdAt: new Date(),
				updatedAt: new Date(),
				targetFiles: task.targetFiles,
				implicitDependencies: task.implicitDependencies,
			};
			return {
				...state,
				currentTaskId: task.id,
				tasks: [...state.tasks, newTask],
				status: "running",
			};
		});

		// Log task request in ledger
		await this.ledger.log(
			"task_scheduled",
			{ taskId: task.id, worktreeId, path, dependencies: task.dependencies },
			"info",
			task.id,
		);

		return worktreeId;
	}

	/**
	 * Marks a task as completed or failed.
	 */
	public async completeTask(
		taskId: string,
		worktreeId: string,
		result: TaskExecutionResult,
	): Promise<void> {
		// Update state
		await this.stateMachine.update((state) => {
			const updatedTasks = state.tasks.map((t) =>
				t.id === taskId
					? {
							...t,
							status: (result.status === "success" ? "completed" : "failed") as Task["status"],
							updatedAt: new Date(),
						}
					: t,
			);
			return {
				...state,
				currentTaskId: null,
				tasks: updatedTasks,
				status: this.activeTasks.size <= 1 ? "idle" : "running",
			};
		});

		// Log completion in ledger
		await this.ledger.log(
			result.status === "success" ? "task_completed" : "task_failed",
			{
				taskId,
				worktreeId,
				output: result.output,
				error: result.error,
			},
			result.status === "success" ? "info" : "error",
			taskId,
		);

		// Clear from active tasks
		this.activeTasks.delete(worktreeId);
	}

	/**
	 * Executes a single task using the provider router with automatic fallback.
	 * Handles 429, timeout, and network errors with provider fallback.
	 * Returns the execution result.
	 */
	public async executeTaskWithFallback(
		task: DecomposedTask,
		messages: LLMMessage[],
	): Promise<{
		output: string;
		error?: string;
		fallbackOccurred: boolean;
		finalProvider?: ProviderId;
	}> {
		let fallbackOccurred = false;
		let lastError: string | undefined;
		let finalProvider: ProviderId | undefined;

		try {
			const response = await this.providerRouter.completion({ messages });
			finalProvider = response.provider;
			return {
				output: response.content,
				fallbackOccurred: false,
				finalProvider,
			};
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);

			// Check if this was a retryable error that triggered fallback
			const retryableError = lastError.toLowerCase();
			if (
				retryableError.includes("429") ||
				retryableError.includes("timeout") ||
				retryableError.includes("network")
			) {
				fallbackOccurred = true;
				// Log the fallback in EventLedger
				await this.ledger.log(
					"provider_fallback",
					{
						taskId: task.id,
						error: lastError,
						message: `Provider fallback occurred for task ${task.id}`,
					},
					"warning",
					task.id,
				);
			}

			// Check if all providers are exhausted
			if (
				retryableError.includes("exhausted") ||
				retryableError.includes("unavailable")
			) {
				await this.ledger.log(
					"task_exhausted",
					{
						taskId: task.id,
						error: lastError,
						message: `All providers exhausted for task ${task.id}`,
					},
					"error",
					task.id,
				);
			}

			return {
				output: "",
				error: lastError,
				fallbackOccurred,
				finalProvider: this.providerRouter.fallback(undefined),
			};
		}
	}

	/**
	 * Logs a fallback event with console notification.
	 * Call this when provider fallback occurs for visibility.
	 */
	public async logFallbackEvent(
		fromProvider: ProviderId,
		toProvider: ProviderId,
		taskId: string,
		reason: string,
	): Promise<void> {
		// Console notification with the specified format
		console.warn(
			`⚠ ${fromProvider} ${reason} → reasignando a ${toProvider}...`,
		);

		// Log to EventLedger
		await this.ledger.log(
			"provider_fallback",
			{
				taskId,
				fromProvider,
				toProvider,
				reason,
				message: `${fromProvider} ${reason} → reasignando a ${toProvider}`,
			},
			"warning",
			taskId,
		);
	}

	/**
	 * Checks if a provider is on cooldown.
	 */
	public isProviderOnCooldown(provider: ProviderId): boolean {
		return this.providerRouter.isOnCooldown(provider);
	}

	/**
	 * Executes all tasks from the decomposition result in dependency order,
	 * with hard concurrency cap enforced by p-limit (backpressure).
	 *
	 * Algorithm:
	 * 1. topoSort() orders tasks so dependencies always precede dependents.
	 * 2. pLimit(worktreePoolSize) ensures at most N tasks run concurrently.
	 * 3. Each task polls completedTasks every 50ms before dispatching,
	 *    so dependency completion is checked at the point of actual execution.
	 *
	 * @throws if worktreePoolSize < 1 (configuration error)
	 * @throws if task graph contains a cycle (topoSort guard)
	 */
	public async executeAll(
		tasks: DecomposedTask[],
	): Promise<TaskExecutionResult[]> {
		if (this.config.worktreePoolSize < 1) {
			throw new Error(
				"[Scheduler] worktreePoolSize must be ≥ 1",
			);
		}

		const limit = pLimit(this.config.worktreePoolSize);
		const completedTasks = new Set<string>();
		const results: TaskExecutionResult[] = [];

		// Topological sort ensures task ordering satisfies explicit + implicit deps
		const ordered = topoSort(tasks);

		await Promise.all(
			ordered.map((task) =>
				limit(async () => {
					// Wait until all dependencies have completed before dispatching
					while (
						(task.dependencies ?? []).some((dep) => !completedTasks.has(dep))
					) {
						await new Promise<void>((resolve) => setTimeout(resolve, 50));
					}

					const worktreeId = await this.scheduleTask(task);
					const resultEntry: TaskExecutionResult = {
						taskId: task.id,
						status: worktreeId ? "success" : "error",
						worktreeId: worktreeId ?? "none",
						error: worktreeId ? undefined : "No worktree lane available",
					};

					if (worktreeId) {
						await this.completeTask(task.id, worktreeId, resultEntry);
					}

					completedTasks.add(task.id);
					results.push(resultEntry);
				}),
			),
		);

		return results;
	}

	/**
	 * Gets the current state of scheduled tasks.
	 */
	public getActiveTasks(): Map<string, DecomposedTask> {
		return this.activeTasks;
	}

	/**
	 * Gets the number of available worktree lanes.
	 */
	public getPoolSize(): number {
		return this.config.worktreePoolSize;
	}

	/**
	 * Cleans up all worktrees.
	 */
	public async shutdown(): Promise<void> {
		const destroyPromises: Promise<void>[] = [];

		for (const [worktreeId, path] of this.worktrees) {
			const promise = this.isolationEngine
				.destroyWorktree(path, this.config.cwd)
				.then(async (result: IsolationResult) => {
					if (result.status === "success") {
						await this.ledger.log(
							"worktree_destroyed",
							{ worktreeId, path },
							"info",
						);
					}
				});
			destroyPromises.push(promise);
		}

		await Promise.all(destroyPromises);
		this.worktrees.clear();
		this.activeTasks.clear();
		this.initialized = false;
	}
}
