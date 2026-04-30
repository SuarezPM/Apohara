export interface Task {
	id: string;
	description: string;
	status: "pending" | "in_progress" | "completed" | "failed";
	createdAt: Date;
	updatedAt: Date;
}

export interface EventLog {
	id: string;
	taskId?: string;
	type: string;
	payload: Record<string, unknown>;
	timestamp: Date;
}

export interface OrchestratorState {
	currentTaskId: string | null;
	tasks: Task[];
	status: "idle" | "running" | "paused" | "error";
	lastError?: string;
}
