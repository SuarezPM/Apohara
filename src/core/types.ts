// Role types for task routing (role: research, planning, execution, verification)
export type TaskRole = "research" | "planning" | "execution" | "verification";

// All supported LLM provider IDs
export type ProviderId =
	| "opencode-go"
	| "deepseek"
	| "perplexity"
	| "gemini";

// Role-to-provider mapping constants
export const ROLE_TO_PROVIDER: Record<TaskRole, ProviderId> = {
	research: "perplexity",
	planning: "gemini",
	execution: "opencode-go",
	verification: "deepseek",
};

// Fallback provider order for each role (primary + fallback)
export const ROLE_FALLBACK_ORDER: Record<TaskRole, ProviderId[]> = {
	research: ["perplexity", "gemini"],
	planning: ["gemini", "deepseek"],
	execution: ["opencode-go", "deepseek"],
	verification: ["deepseek", "opencode-go"],
};

export interface Task {
	id: string;
	role?: TaskRole;
	description: string;
	status: "pending" | "in_progress" | "completed" | "failed";
	createdAt: Date;
	updatedAt: Date;
}

export type EventSeverity = "info" | "warning" | "error";

export interface EventLog {
	id: string;
	timestamp: string; // ISO string
	type: string;
	severity: EventSeverity;
	taskId?: string;
	payload: Record<string, unknown>;
	metadata?: {
		provider?: ProviderId;
		model?: string;
		tokens?: { prompt: number; completion: number; total: number };
		costUsd?: number;
		durationMs?: number;
		role?: TaskRole;
		fromProvider?: ProviderId;
		toProvider?: ProviderId;
		errorReason?: string;
	};
}

export interface OrchestratorState {
	currentTaskId: string | null;
	tasks: Task[];
	status: "idle" | "running" | "paused" | "error";
	lastError?: string;
	// Provider cooldown tracking for state persistence
	failedProviderTimestamps?: Record<string, number>; // providerId -> timestamp of last failure
}
