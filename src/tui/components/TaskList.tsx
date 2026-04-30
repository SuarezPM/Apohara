import React from "react";
import { Box, Text } from "ink";
import { useTaskList, type TaskStatus } from "../hooks/useTaskList.tsx";
import { useResponsiveMode } from "../hooks/useResponsiveMode.tsx";

const STATUS_ICON: Record<TaskStatus, string> = {
	pending: "○",
	in_progress: "◐",
	completed: "✓",
	failed: "✗",
};

const STATUS_COLOR: Record<TaskStatus, string> = {
	pending: "gray",
	in_progress: "yellow",
	completed: "green",
	failed: "red",
};

export interface TaskListProps {
	/** Override to force a specific responsive mode */
	mode?: "normal" | "compact" | "minimal";
	/** Maximum number of tasks to show (default: no limit) */
	maxItems?: number;
}

/**
 * Renders a list of tasks with status icons.
 * Adapts to terminal width: minimal shows only counts.
 */
export function TaskList({ mode: modeProp, maxItems }: TaskListProps) {
	const { tasks, counts } = useTaskList();
	const mode = modeProp ?? useResponsiveMode();

	if (mode === "minimal") {
		return (
			<Box flexDirection="column">
				<Text dimColor>
					Tasks: {counts.completed}/{tasks.length}
				</Text>
			</Box>
		);
	}

	const displayTasks = maxItems ? tasks.slice(0, maxItems) : tasks;

	return (
		<Box flexDirection="column">
			<Box marginBottom={1}>
				<Text bold>Tasks</Text>
				<Text dimColor>
					{" "}({counts.completed}/{tasks.length})
				</Text>
			</Box>
			{displayTasks.length === 0 ? (
				<Text dimColor>No tasks yet</Text>
			) : (
				displayTasks.map((task) => (
					<Box key={task.id}>
						<Text color={STATUS_COLOR[task.status]}>
							{STATUS_ICON[task.status]}{" "}
						</Text>
						{mode === "compact" ? (
							<Text>{task.description.slice(0, 30)}</Text>
						) : (
							<>
								<Text>{task.description}</Text>
								{task.role && (
									<Text dimColor>
										{" "}({task.role})
									</Text>
								)}
							</>
						)}
					</Box>
				))
			)}
		</Box>
	);
}
