import type { EventLog } from "../lib/types.js";

interface CostMeterProps {
	events: EventLog[];
}

/**
 * Top-bar cost meter — cumulative tokens + USD across the run.
 * GPU mode toggle (ContextForge) will land in M015.5.
 */
export function CostMeter({ events }: CostMeterProps) {
	let totalTokens = 0;
	let totalCost = 0;

	for (const e of events) {
		const tok = e.metadata?.tokens?.total;
		if (typeof tok === "number") totalTokens += tok;
		const cost = e.metadata?.costUsd;
		if (typeof cost === "number") totalCost += cost;
	}

	return (
		<span className="cost-meter mono">
			{totalTokens.toLocaleString()} tok · ${totalCost.toFixed(4)}
		</span>
	);
}
