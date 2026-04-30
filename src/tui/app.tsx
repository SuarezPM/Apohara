import React, { useState, useEffect, useCallback } from "react";
import { render, useInput, useApp, Box, Text } from "ink";
import { Dashboard } from "./components/Dashboard.tsx";
import { TaskList } from "./components/TaskList.tsx";
import { AgentStatus } from "./components/AgentStatus.tsx";
import { CostTable } from "./components/CostTable.tsx";
import { DashboardProvider, useDashboard, useActiveRun } from "./hooks/useDashboard.tsx";
import type { Run, EventLog } from "./types.ts";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const EVENTS_DIR = join(process.cwd(), ".events");

interface AppState {
	showCostTable: boolean;
	debugMode: boolean;
	debugCounters: { malformedLines: number; unknownEventTypes: number };
	loading: boolean;
	error?: string;
}

async function loadRuns(): Promise<Run[]> {
	try {
		const files = await readdir(EVENTS_DIR);
		const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

		const runs: Run[] = [];
		for (const file of jsonlFiles) {
			const runId = file.replace(/^run-/, "").replace(/\.jsonl$/, "");
			const content = await readFile(join(EVENTS_DIR, file), "utf-8");
			const lines = content.split("\n").filter((l) => l.trim());
			const events: EventLog[] = [];
			let malformedLines = 0;
			let unknownEventTypes = 0;

			for (const line of lines) {
				try {
					const event = JSON.parse(line) as EventLog;
					if (!event.type || !event.timestamp) {
						malformedLines++;
						continue;
					}
					events.push(event);
				} catch {
					malformedLines++;
				}
			}

			const startedAt =
				events.length > 0
					? events[0].timestamp
					: new Date().toISOString();

			runs.push({
				id: runId,
				startedAt,
				events,
			});
		}

		return runs.sort(
			(a, b) =>
				new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
		);
	} catch {
		return [];
	}
}

function DashboardApp() {
	const { state, dispatch } = useDashboard();
	const activeRun = useActiveRun();
	const { exit } = useApp();

	const [appState, setAppState] = useState<AppState>({
		showCostTable: false,
		debugMode: false,
		debugCounters: { malformedLines: 0, unknownEventTypes: 0 },
		loading: true,
	});

	useEffect(() => {
		loadRuns()
			.then((runs) => {
				let malformedLines = 0;
				let unknownEventTypes = 0;
				for (const run of runs) {
					for (const event of run.events) {
						if (!event.type) malformedLines++;
						// Track unknown event types if needed
					}
				}
				dispatch({ type: "SET_RUNS", payload: runs });
				setAppState((prev) => ({
					...prev,
					loading: false,
					debugCounters: { malformedLines, unknownEventTypes },
				}));
			})
			.catch((err) => {
				setAppState((prev) => ({
					...prev,
					loading: false,
					error: err instanceof Error ? err.message : String(err),
				}));
			});
	}, [dispatch]);

	useInput((input, key) => {
		if (input === "q") {
			exit();
		}
		if (input === "c") {
			setAppState((prev) => {
				const next = { ...prev, showCostTable: !prev.showCostTable };
				if (next.debugMode) {
					console.error(`[debug] costTable=${next.showCostTable}`);
				}
				return next;
			});
		}
		if (input === "d") {
			setAppState((prev) => {
				const next = { ...prev, debugMode: !prev.debugMode };
				console.error(`[debug] debugMode=${next.debugMode}`);
				return next;
			});
		}
		if (key.tab || key.rightArrow || key.downArrow) {
			const nextIndex = (state.activeRunIndex + 1) % Math.max(state.runs.length, 1);
			dispatch({ type: "SET_ACTIVE_RUN", payload: nextIndex });
			if (appState.debugMode) {
				console.error(`[debug] activeRunIndex=${nextIndex}`);
			}
		}
		if (key.leftArrow || key.upArrow) {
			const nextIndex =
				state.activeRunIndex === 0
					? Math.max(state.runs.length - 1, 0)
					: state.activeRunIndex - 1;
			dispatch({ type: "SET_ACTIVE_RUN", payload: nextIndex });
			if (appState.debugMode) {
				console.error(`[debug] activeRunIndex=${nextIndex}`);
			}
		}
	});

	if (appState.loading) {
		return (
			<Box>
				<Text>Loading dashboard...</Text>
			</Box>
		);
	}

	if (appState.error) {
		return (
			<Box flexDirection="column">
				<Text color="red">Error: {appState.error}</Text>
			</Box>
		);
	}

	if (state.runs.length === 0) {
		return (
			<Box flexDirection="column">
				<Text dimColor>Waiting for first execution...</Text>
				<Text dimColor>Run `clarity auto` to start.</Text>
			</Box>
		);
	}

	const completedTasks = activeRun?.events.filter((e) => e.type === "task_completed").length ?? 0;
	const totalTasks = activeRun?.events.filter((e) => e.type === "task_scheduled").length ?? 0;

	return (
		<Dashboard
			startedAt={activeRun?.startedAt}
			completedTasks={completedTasks}
			totalTasks={totalTasks}
			debugMode={appState.debugMode}
			debugCounters={appState.debugCounters}
		>
			<TaskList />
			<AgentStatus />
			{appState.showCostTable && <CostTable />}
		</Dashboard>
	);
}

function App() {
	const runId = process.env.CLARITY_RUN_ID;
	const initialRuns = runId
		? [{
				id: runId,
				startedAt: new Date().toISOString(),
				events: [],
			}]
		: undefined;

	return (
		<DashboardProvider initialRuns={initialRuns}>
			<DashboardApp />
		</DashboardProvider>
	);
}

render(<App />);
