import { useState } from "react";
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
 * Top bar: cost meter (always visible).
 * Stream: SSE tail of .events/run-*.jsonl from Bun.serve backend.
 */
export function App() {
	const [sessionId, setSessionId] = useState<string | null>(null);
	const ledger = useLedgerStream(sessionId);

	return (
		<div className="apohara-app">
			<header className="topbar">
				<span className="brand">◈ Apohara</span>
				<span className="session">
					{sessionId ? `Session ${sessionId.slice(0, 8)}` : "No active run"}
				</span>
				<CostMeter events={ledger.events} />
			</header>
			<main className="three-pane">
				<ObjectivePane onRun={setSessionId} active={!!sessionId} />
				<SwarmCanvas events={ledger.events} />
				<CodeDiffPane events={ledger.events} />
			</main>
		</div>
	);
}
