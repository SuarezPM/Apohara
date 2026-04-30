import { useMemo } from "react";
import { useActiveRun } from "./useDashboard.tsx";
import type { ProviderId } from "../../core/types.ts";

export interface CostRow {
	provider: ProviderId;
	costUsd: number;
	tokensPrompt: number;
	tokensCompletion: number;
	tokensTotal: number;
}

export interface CostTableResult {
	rows: CostRow[];
	totalCostUsd: number;
	totalTokens: number;
}

/**
 * Aggregates cost and token usage by provider from the active run's events.
 */
export function useCostTable(): CostTableResult {
	const activeRun = useActiveRun();

	return useMemo(() => {
		const events = activeRun?.events ?? [];
		const map = new Map<ProviderId, CostRow>();

		for (const event of events) {
			const provider = event.metadata?.provider;
			const cost = event.metadata?.costUsd;
			const tokens = event.metadata?.tokens;

			if (!provider || typeof cost !== "number") continue;

			const existing = map.get(provider);
			if (existing) {
				existing.costUsd += cost;
				existing.tokensPrompt += tokens?.prompt ?? 0;
				existing.tokensCompletion += tokens?.completion ?? 0;
				existing.tokensTotal += tokens?.total ?? 0;
			} else {
				map.set(provider, {
					provider,
					costUsd: cost,
					tokensPrompt: tokens?.prompt ?? 0,
					tokensCompletion: tokens?.completion ?? 0,
					tokensTotal: tokens?.total ?? 0,
				});
			}
		}

		const rows = Array.from(map.values());
		const totalCostUsd = rows.reduce((sum, r) => sum + r.costUsd, 0);
		const totalTokens = rows.reduce((sum, r) => sum + r.tokensTotal, 0);

		return { rows, totalCostUsd, totalTokens };
	}, [activeRun]);
}
