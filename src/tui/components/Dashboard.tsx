import React from "react";
import { Box, Text } from "ink";
import { useResponsiveMode } from "../hooks/useResponsiveMode.tsx";
import { Timer } from "./Timer.tsx";
import { ProgressBar } from "./ProgressBar.tsx";
import type { ResponsiveMode, DebugCounters } from "../types.ts";

export interface DashboardProps {
	/** Content rendered in the body area */
	children?: React.ReactNode;
	/** ISO timestamp when the current run started */
	startedAt?: string;
	/** Number of completed tasks */
	completedTasks?: number;
	/** Total number of tasks */
	totalTasks?: number;
	/** Debug counters surfaced in debug mode */
	debugCounters?: DebugCounters;
	/** Whether debug mode is active */
	debugMode?: boolean;
}

function Header({ startedAt, mode }: { startedAt?: string; mode: ResponsiveMode }) {
	if (mode === "minimal") {
		return (
			<Box>
				<Text bold>Clarity</Text>
			</Box>
		);
	}

	return (
		<Box justifyContent="space-between">
			<Box>
				<Text bold>Clarity Dashboard</Text>
			</Box>
			{startedAt && (
				<Box>
					<Text dimColor>Elapsed: </Text>
					<Timer startedAt={startedAt} />
				</Box>
			)}
		</Box>
	);
}

function Footer({
	completedTasks,
	totalTasks,
	mode,
	debugCounters,
	debugMode,
}: {
	completedTasks: number;
	totalTasks: number;
	mode: ResponsiveMode;
	debugCounters?: DebugCounters;
	debugMode?: boolean;
}) {
	if (mode === "minimal") {
		return (
			<Box>
				<Text dimColor>[q]uit</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column" marginTop={1}>
			<ProgressBar
				completed={completedTasks}
				total={totalTasks}
				width={mode === "compact" ? 20 : 40}
			/>
			{debugMode && debugCounters && (
				<Box marginTop={1}>
					<Text dimColor>
						Debug: malformed={debugCounters.malformedLines} unknown={
							debugCounters.unknownEventTypes
						}
					</Text>
				</Box>
			)}
			<Box marginTop={1}>
				<Text dimColor>
					{mode === "compact"
						? "[q]uit [d]ebug"
						: "[q]uit [d]ebug [r]efresh [→]next [←]prev"}
				</Text>
			</Box>
		</Box>
	);
}

/**
 * Main dashboard shell that adapts to terminal width.
 * Renders a header (title + timer), body area, and footer (progress + shortcuts).
 */
export function Dashboard({
	children,
	startedAt,
	completedTasks = 0,
	totalTasks = 0,
	debugCounters,
	debugMode = false,
}: DashboardProps) {
	const mode = useResponsiveMode();

	return (
		<Box flexDirection="column" paddingX={1}>
			<Header startedAt={startedAt} mode={mode} />
			<Box flexDirection="column" marginY={1}>
				{children}
			</Box>
			<Footer
				completedTasks={completedTasks}
				totalTasks={totalTasks}
				mode={mode}
				debugCounters={debugCounters}
				debugMode={debugMode}
			/>
		</Box>
	);
}
