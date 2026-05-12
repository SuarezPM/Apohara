import { useCallback, useEffect, useState } from "react";
import { ObjectivePane } from "./components/ObjectivePane.js";
import { SwarmCanvas } from "./components/SwarmCanvas.js";
import { CodeDiffPane } from "./components/CodeDiffPane.js";
import { CostMeter } from "./components/CostMeter.js";
import { useLedgerStream } from "./hooks/useLedgerStream.js";

/**
 * Three-column visual orchestrator layout per Roadmap v2.0 M017.
 *
 * | Objective | Swarm Canvas | Code + Diff |
 *
 * Top bar: cost meter + GPU/Cloud mode toggle (M017.6 + M015.5).
 * Stream: SSE tail of .events/run-*.jsonl from Bun.serve backend.
 */

type RoutingMode = "gpu" | "cloud";

const MODE_STORAGE_KEY = "apohara.routingMode";

export function App() {
	const [sessionId, setSessionId] = useState<string | null>(null);
	const [mode, setMode] = useState<RoutingMode>(() => {
		if (typeof window === "undefined") return "gpu";
		const stored = window.localStorage.getItem(MODE_STORAGE_KEY);
		return stored === "cloud" ? "cloud" : "gpu";
	});

	const ledger = useLedgerStream(sessionId);

	useEffect(() => {
		if (typeof window === "undefined") return;
		window.localStorage.setItem(MODE_STORAGE_KEY, mode);
	}, [mode]);

	const handleModeChange = useCallback((next: RoutingMode) => {
		setMode(next);
		fetch("/api/mode", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ mode: next }),
		}).catch(() => {
			// Best-effort: the toggle stays valid client-side via localStorage.
		});
	}, []);

	return (
		<div className="apohara-app">
			<header className="topbar">
				<span className="brand">◈ Apohara</span>
				<span className="session">
					{sessionId ? `Session ${sessionId.slice(0, 12)}` : "No active run"}
				</span>
				<CostMeter
					events={ledger.events}
					mode={mode}
					onModeChange={handleModeChange}
				/>
			</header>
			<main className="three-pane">
				<ObjectivePane
					onRun={setSessionId}
					active={!!sessionId}
					mode={mode}
				/>
				<SwarmCanvas events={ledger.events} />
				<CodeDiffPane events={ledger.events} />
			</main>
		</div>
	);
}
