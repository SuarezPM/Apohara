/**
 * Agent Router - Routes tasks to appropriate providers based on role.
 * Handles provider selection, fallback on errors, and token validation.
 * Now supports 15+ models including DeepSeek V4, Kimi K2.6, Qwen 3.6, etc.
 */

import type { ProviderId, TaskRole, EventLog, EventSeverity, ModelCapability } from "./types";
import { ROLE_TO_PROVIDER, ROLE_FALLBACK_ORDER, getModelById, getBestModelsForRole, MODELS } from "./types";
import { EventLedger } from "./ledger";
import { config } from "../core/config";
import { ProviderRouter } from "../providers/router";

// Re-export types for external use
export type { ProviderId, TaskRole, ModelCapability };

// Token validation map - validates API keys exist before dispatch
const TOKEN_VALIDATORS: Record<ProviderId, () => boolean> = {
	"opencode-go": () => !!config.OPENCODE_API_KEY,
	"deepseek": () => !!config.DEEPSEEK_API_KEY,
	"deepseek-v4": () => !!config.DEEPSEEK_API_KEY,
	"tavily": () => !!config.TAVILY_API_KEY,
	"gemini": () => !!config.GEMINI_API_KEY,
	"moonshot-k2.5": () => !!config.MOONSHOT_API_KEY,
	"moonshot-k2.6": () => !!config.MOONSHOT_API_KEY,
	"xiaomi-mimo": () => !!config.XIAOMI_API_KEY,
	"qwen3.5-plus": () => !!config.ALIBABA_API_KEY,
	"qwen3.6-plus": () => !!config.ALIBABA_API_KEY,
	"minimax-m2.5": () => !!config.MINIMAX_API_KEY,
	"minimax-m2.7": () => !!config.MINIMAX_API_KEY,
	"glm-deepinfra": () => !!config.DEEPINFRA_API_KEY,
	"glm-fireworks": () => !!config.FIREWORKS_API_KEY,
	"glm-zai": () => !!config.ZAI_API_KEY,
};

/**
 * Result of a routeTask call including provider and validation info.
 */
export interface RouteResult {
	provider: ProviderId;
	model: ModelCapability | undefined;
	requiresFallback: boolean;
	fallbackProviders: ProviderId[];
}

/**
 * Validates that the required API token exists for a provider.
 * Returns true if token is valid, false otherwise.
 */
export function validateToken(provider: ProviderId): boolean {
	const validator = TOKEN_VALIDATORS[provider];
	if (!validator) {
		console.warn(`No token validator for provider: ${provider}`);
		return false;
	}
	return validator();
}

/**
 * Gets all available providers (those with valid tokens).
 * Useful for debugging and UI display.
 */
export function getAvailableProviders(): ProviderId[] {
	const available: ProviderId[] = [];
	for (const provider of MODELS.map(m => m.id)) {
		if (validateToken(provider)) {
			available.push(provider);
		}
	}
	return available;
}

/**
 * Gets provider info for display.
 */
export function getProviderInfo(provider: ProviderId): { name: string; provider: string; strengths: string[] } | undefined {
	const model = getModelById(provider);
	if (!model) return undefined;
	return {
		name: model.name,
		provider: model.provider,
		strengths: model.strengths,
	};
}

/**
 * Logs role assignment and provider selection events to the ledger.
 */
async function logProviderEvent(
	ledger: EventLedger,
	type: string,
	message: string,
	role: TaskRole,
	provider: ProviderId,
	metadata?: EventLog["metadata"],
): Promise<void> {
	const severity: EventSeverity =
		type === "provider_fallback" ? "warning" : "info";
	await ledger.log(
		type,
		{ message, role, provider },
		severity,
		undefined, // taskId handled externally if needed
		{ role, provider, ...metadata },
	);
}

/**
 * Routes a task to the correct provider based on its role.
 * Implements:
 * - Intelligent role-based provider selection using top models
 * - Token validation before dispatch (Decision D006)
 * - Fallback chain activation on 429/timeout
 * - Structured logging to EventLedger
 *
 * @param role - The role of the task (research, planning, execution, verification)
 * @param task - Optional task object for additional context
 * @returns The selected provider ID with model capabilities
 */
export async function routeTask(
	role: TaskRole,
	task?: { id?: string; description?: string },
): Promise<RouteResult> {
	const ledger = new EventLedger();
	const taskId = task?.id;
	const primaryProvider = ROLE_TO_PROVIDER[role];
	const fallbackOrder = ROLE_FALLBACK_ORDER[role];
	const modelCapability = getModelById(primaryProvider);

	// Log role assignment
	await ledger.log(
		"role_assignment",
		{
			message: `Task assigned to role: ${role}`,
			taskId,
			role,
		},
		"info",
		taskId,
		{ role },
	);

	// Validate token for primary provider (Decision D006)
	const tokenValid = validateToken(primaryProvider);
	if (!tokenValid) {
		console.warn(
			`⚠ Token validation failed for ${primaryProvider} (role: ${role})`,
		);
		// Find fallback with valid token
		for (const fallbackProvider of fallbackOrder) {
			if (fallbackProvider !== primaryProvider && validateToken(fallbackProvider)) {
				await logProviderEvent(
					ledger,
					"provider_fallback",
					`Fallback from ${primaryProvider} to ${fallbackProvider} due to invalid token`,
					role,
					fallbackProvider,
					{
						fromProvider: primaryProvider,
						toProvider: fallbackProvider,
						errorReason: "invalid_token",
					},
				);
				return {
					provider: fallbackProvider,
					model: getModelById(fallbackProvider),
					requiresFallback: true,
					fallbackProviders: fallbackOrder,
				};
			}
		}
		// No valid fallback, return primary anyway (fail-fast is better)
		console.error(`⚠ No valid token found for role ${role}, using primary anyway`);
	}

	// Log provider selection with model info
	const modelInfo = modelCapability ? `${modelCapability.name} (${modelCapability.provider})` : primaryProvider;
	await logProviderEvent(
		ledger,
		"provider_selected",
		`Provider ${modelInfo} selected for role ${role}`,
		role,
		primaryProvider,
		{
			modelName: modelCapability?.name,
			modelProvider: modelCapability?.provider,
			contextWindow: modelCapability?.contextWindow,
		},
	);

	return {
		provider: primaryProvider,
		model: modelCapability,
		requiresFallback: false,
		fallbackProviders: fallbackOrder,
	};
}

/**
 * Executes a task with automatic fallback to alternate providers on failure.
 * Uses ProviderRouter's built-in fallback mechanism for 429/timeout errors.
 *
 * @param role - The role of the task
 * @param task - Task object with messages for the LLM
 * @param router - Optional ProviderRouter instance (creates one if not provided)
 * @returns The LLM response from the provider with model info
 */
export async function routeTaskWithFallback(
	role: TaskRole,
	task: { id?: string; messages: Array<{ role: "system" | "user" | "assistant"; content: string }> },
	router?: ProviderRouter,
): Promise<{ provider: ProviderId; model: ModelCapability | undefined; response: any }> {
	const result = await routeTask(role, task);
	const ledger = new EventLedger();

	// Use provided router or create new one
	const providerRouter = router || new ProviderRouter();

	// Attempt with primary provider
	try {
		const response = await providerRouter.completion({
			messages: task.messages,
			provider: result.provider,
		});
		return { provider: result.provider, model: result.model, response };
	} catch (error) {
		// Check if error is retryable (429, timeout)
		const isRetryable = isRetryableError(error);
		if (!isRetryable) {
			throw error;
		}

		// Log fallback event
		const errorMessage = error instanceof Error ? error.message : String(error);
		await ledger.log(
			"provider_fallback",
			{
				message: `Provider ${result.provider} failed: ${errorMessage}. Trying fallback.`,
				taskId: task.id,
				role,
			},
			"warning",
			task.id,
			{
				role,
				provider: result.provider,
				fromProvider: result.provider,
				toProvider: result.fallbackProviders[1],
				errorReason: errorMessage,
			},
		);

		// Try fallback providers
		for (let i = 1; i < result.fallbackProviders.length; i++) {
			const fallbackProvider = result.fallbackProviders[i];

			// Validate token before trying fallback
			if (!validateToken(fallbackProvider)) {
				console.warn(`⚠ Skipping fallback to ${fallbackProvider}: no valid token`);
				continue;
			}

			try {
				const response = await providerRouter.completion({
					messages: task.messages,
					provider: fallbackProvider,
				});

				// Log successful fallback
				await ledger.log(
					"fallback_succeeded",
					{
						message: `Task completed via fallback provider: ${fallbackProvider}`,
						taskId: task.id,
						role,
					},
					"info",
					task.id,
					{
						role,
						provider: fallbackProvider,
						fromProvider: result.provider,
						toProvider: fallbackProvider,
					},
				);

				return { 
					provider: fallbackProvider, 
					model: getModelById(fallbackProvider),
					response 
				};
			} catch (fallbackError) {
				const errorMsg = fallbackError instanceof Error
					? fallbackError.message
					: String(fallbackError);
				console.warn(`⚠ Fallback to ${fallbackProvider} failed: ${errorMsg}`);
			}
		}

		// Log exhaustion
		await ledger.log(
			"task_exhausted",
			{
				message: `All providers exhausted for role ${role}`,
				taskId: task.id,
				role,
			},
			"error",
			task.id,
			{
				role,
				provider: result.provider,
				fallbackProviders: result.fallbackProviders,
			},
		);

		throw error;
	}
}

/**
 * Determines if an error is retryable (429, timeout, network).
 */
function isRetryableError(error: unknown): boolean {
	if (error instanceof Error) {
		const message = error.message.toLowerCase();
		if (message.includes("429") || message.includes("rate limit")) {
			return true;
		}
		if (
			message.includes("timeout") ||
			message.includes("etimedout") ||
			message.includes("econnaborted")
		) {
			return true;
		}
		if (
			message.includes("network") ||
			message.includes("fetch") ||
			message.includes("econnrefused") ||
			message.includes("enotfound")
		) {
			return true;
		}
	}
	return false;
}

// Default export for easy importing
export default { 
	routeTask, 
	routeTaskWithFallback, 
	validateToken,
	getAvailableProviders,
	getProviderInfo,
	getModelById,
	getBestModelsForRole,
	MODELS,
};