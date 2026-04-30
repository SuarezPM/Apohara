export interface Task {
	id: string;
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
		provider?: "opencode-go" | "deepseek";
		model?: string;
		tokens?: { prompt: number; completion: number; total: number };
		costUsd?: number;
		durationMs?: number;
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
