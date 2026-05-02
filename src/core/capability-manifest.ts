/**
 * Capability Manifest - Scores providers by task type for intelligent routing.
 * Based on public benchmarks (SWE-bench, HumanEval, MBPP) and community evaluations.
 * Scores are normalized 0.0-1.0, with 1.0 being state-of-the-art for that task.
 */

import type { ProviderId, TaskRole } from "./types";

export type TaskType = "research" | "planning" | "codegen" | "debugging" | "verification";

/**
 * Capability scores for a single provider across all task types.
 */
export interface ProviderCapability {
	provider: ProviderId;
	scores: Record<TaskType, number>;
	sources: string[]; // Benchmark sources
	lastUpdated: string; // ISO date
}

/**
 * Conservative capability scores based on public benchmarks.
 * These are estimates — actual performance varies by use case.
 */
const CAPABILITY_MANIFEST: ProviderCapability[] = [
	{
		provider: "groq",
		scores: {
			research: 0.6,
			planning: 0.85,
			codegen: 0.9,
			debugging: 0.85,
			verification: 0.8,
		},
		sources: ["HumanEval", "MBPP", "internal-eval"],
		lastUpdated: "2026-05-01",
	},
	{
		provider: "kiro-ai",
		scores: {
			research: 0.7,
			planning: 0.8,
			codegen: 0.75,
			debugging: 0.7,
			verification: 0.6,
		},
		sources: ["community-eval", "CLAUDE-benchmarks"],
		lastUpdated: "2026-05-01",
	},
	{
		provider: "deepseek",
		scores: {
			research: 0.65,
			planning: 0.8,
			codegen: 0.9,
			debugging: 0.85,
			verification: 0.8,
		},
		sources: ["SWE-bench", "HumanEval", "LiveCodeBench"],
		lastUpdated: "2026-05-01",
	},
	{
		provider: "deepseek-v4",
		scores: {
			research: 0.7,
			planning: 0.85,
			codegen: 0.92,
			debugging: 0.88,
			verification: 0.82,
		},
		sources: ["SWE-bench", "HumanEval", "LiveCodeBench"],
		lastUpdated: "2026-05-01",
	},
	{
		provider: "mistral",
		scores: {
			research: 0.6,
			planning: 0.7,
			codegen: 0.75,
			debugging: 0.7,
			verification: 0.65,
		},
		sources: ["HumanEval", "MBPP", "community-eval"],
		lastUpdated: "2026-05-01",
	},
	{
		provider: "openai",
		scores: {
			research: 0.7,
			planning: 0.85,
			codegen: 0.85,
			debugging: 0.8,
			verification: 0.85,
		},
		sources: ["SWE-bench", "HumanEval", "MBPP"],
		lastUpdated: "2026-05-01",
	},
	{
		provider: "gemini",
		scores: {
			research: 0.75,
			planning: 0.8,
			codegen: 0.82,
			debugging: 0.78,
			verification: 0.75,
		},
		sources: ["HumanEval", "MBPP", "BigCodeBench"],
		lastUpdated: "2026-05-01",
	},
	{
		provider: "tavily",
		scores: {
			research: 0.95,
			planning: 0.3,
			codegen: 0.1,
			debugging: 0.1,
			verification: 0.4,
		},
		sources: ["internal-eval"],
		lastUpdated: "2026-05-01",
	},
	{
		provider: "opencode-go",
		scores: {
			research: 0.55,
			planning: 0.75,
			codegen: 0.88,
			debugging: 0.82,
			verification: 0.78,
		},
		sources: ["HumanEval", "MBPP"],
		lastUpdated: "2026-05-01",
	},
	{
		provider: "moonshot-k2.6",
		scores: {
			research: 0.7,
			planning: 0.85,
			codegen: 0.88,
			debugging: 0.84,
			verification: 0.8,
		},
		sources: ["HumanEval", "LiveCodeBench"],
		lastUpdated: "2026-05-01",
	},
	{
		provider: "qwen3.6-plus",
		scores: {
			research: 0.65,
			planning: 0.8,
			codegen: 0.85,
			debugging: 0.8,
			verification: 0.75,
		},
		sources: ["HumanEval", "MBPP", "SWE-bench"],
		lastUpdated: "2026-05-01",
	},
];

/**
 * Gets the capability score for a provider on a specific task type.
 */
export function getCapabilityScore(
	provider: ProviderId,
	taskType: TaskType,
): number {
	const entry = CAPABILITY_MANIFEST.find((c) => c.provider === provider);
	return entry?.scores[taskType] ?? 0.5;
}

/**
 * Gets all capability data for a provider.
 */
export function getProviderCapability(provider: ProviderId): ProviderCapability | undefined {
	return CAPABILITY_MANIFEST.find((c) => c.provider === provider);
}

/**
 * Ranks providers for a given task type, sorted by capability score (descending).
 * Only returns providers with scores above the minimum threshold.
 */
export function rankProvidersForTask(
	taskType: TaskType,
	minScore: number = 0.0,
): Array<{ provider: ProviderId; score: number }> {
	return CAPABILITY_MANIFEST
		.map((c) => ({ provider: c.provider, score: c.scores[taskType] }))
		.filter((c) => c.score >= minScore)
		.sort((a, b) => b.score - a.score);
}

/**
 * Selects the best provider for a task type from a list of available providers.
 */
export function selectBestProvider(
	availableProviders: ProviderId[],
	taskType: TaskType,
): ProviderId | null {
	const ranked = rankProvidersForTask(taskType);
	for (const { provider } of ranked) {
		if (availableProviders.includes(provider)) {
			return provider;
		}
	}
	return null;
}

/**
 * Maps TaskRole to TaskType for capability lookup.
 */
export function roleToTaskType(role: TaskRole): TaskType {
	switch (role) {
		case "research":
			return "research";
		case "planning":
			return "planning";
		case "execution":
			return "codegen";
		case "verification":
			return "verification";
		default:
			return "codegen";
	}
}

export default {
	getCapabilityScore,
	getProviderCapability,
	rankProvidersForTask,
	selectBestProvider,
	roleToTaskType,
	CAPABILITY_MANIFEST,
};
