import React from "react";
import { Box, Text } from "ink";
import { useCostTable } from "../hooks/useCostTable.tsx";
import { useResponsiveMode } from "../hooks/useResponsiveMode.tsx";

export interface CostTableProps {
	/** Override to force a specific responsive mode */
	mode?: "normal" | "compact" | "minimal";
}

function formatCost(cost: number): string {
	return `$${cost.toFixed(4)}`;
}

function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return n.toString();
}

/**
 * Renders a cost breakdown table by provider.
 * Adapts to terminal width: compact/minimal show fewer columns.
 */
export function CostTable({ mode: modeProp }: CostTableProps) {
	const { rows, totalCostUsd, totalTokens } = useCostTable();
	const mode = modeProp ?? useResponsiveMode();

	if (mode === "minimal") {
		return (
			<Box flexDirection="column">
				<Text dimColor>Cost: {formatCost(totalCostUsd)}</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column">
			<Box marginBottom={1}>
				<Text bold>Cost Breakdown</Text>
				<Text dimColor> Total: {formatCost(totalCostUsd)}</Text>
			</Box>
			{rows.length === 0 ? (
				<Text dimColor>No cost data yet</Text>
			) : (
				<>
					{mode === "normal" && (
						<Box>
							<Text bold dimColor>
								Provider{"         "}Cost{"       "}Tokens
							</Text>
						</Box>
					)}
					{rows.map((row) => (
						<Box key={row.provider}>
							{mode === "compact" ? (
								<Text>
									{row.provider.padEnd(14)} {formatCost(row.costUsd)}
								</Text>
							) : (
								<Text>
									{row.provider.padEnd(16)}{" "}
									{formatCost(row.costUsd).padStart(10)}{" "}
									{formatTokens(row.tokensTotal).padStart(8)}
								</Text>
							)}
						</Box>
					))}
					{mode === "normal" && (
						<Box marginTop={1}>
							<Text bold>
								{"Total"}{" "}
								{formatCost(totalCostUsd).padStart(24)}{" "}
								{formatTokens(totalTokens).padStart(8)}
							</Text>
						</Box>
					)}
				</>
			)}
		</Box>
	);
}
