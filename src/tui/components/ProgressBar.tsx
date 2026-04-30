import React from "react";
import { Box, Text } from "ink";

export interface ProgressBarProps {
	/** Number of completed items */
	completed: number;
	/** Total number of items */
	total: number;
	/** Width of the bar in characters (default 30) */
	width?: number;
}

/**
 * Renders a textual progress bar showing percentage completion.
 */
export function ProgressBar({ completed, total, width = 30 }: ProgressBarProps) {
	const percentage = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
	const filled = Math.round((percentage / 100) * width);
	const empty = Math.max(0, width - filled);
	const bar = "█".repeat(filled) + "░".repeat(empty);

	return (
		<Box>
			<Text>
				{bar} {percentage}%
			</Text>
		</Box>
	);
}
